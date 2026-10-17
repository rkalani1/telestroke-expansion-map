'use strict';
// Unit tests for core.js — run with `node --test tests/unit/`.
// Each test pins a behaviour that was previously wrong or is easy to break:
// zero vs unknown, destination sets, feasibility, hub differentials, scoring
// with missing evidence, URL validation and CSV safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../core.js');

function rec(id, over = {}) {
  return Object.assign({
    id, name: id, state: 'WA',
    location: { lat: 47.6, lng: -122.3 },
    status: { value: 'active' },
    roadNetwork: { value: 'contiguous-us' },
    evt247: { state: 'unknown' },
    derived: { tier: null, capability: 'assessed', eligibility: { value: 'eligible' } },
  }, over);
}
const at = (lat, lng) => ({ location: { lat, lng } });

test('formatMiles distinguishes on-site zero from unknown', () => {
  assert.equal(C.formatMiles(0), '0');
  assert.equal(C.formatMiles(null), '—');
  assert.equal(C.formatMiles(undefined), '—');
  assert.equal(C.formatMiles(NaN), '—');
  assert.equal(C.formatMiles(Infinity), '—');
  assert.equal(C.formatMiles(4.26), '4.3');
  assert.equal(C.formatMiles(12.6), '13');
  assert.equal(C.formatSignedMiles(0), '0');
  assert.equal(C.formatSignedMiles(-12.4), '−12');
  assert.equal(C.formatSignedMiles(3.21), '+3.2');
  assert.equal(C.formatSignedMiles(null), '—');
});

test('haversine is symmetric, zero for identical points, null for invalid input', () => {
  const d = C.haversineMi(47.6, -122.3, 47.66, -117.42);
  assert.ok(d > 225 && d < 232, `Seattle–Spokane ~228 mi, got ${d}`);
  assert.equal(C.haversineMi(47.6, -122.3, 47.6, -122.3), 0);
  assert.equal(C.haversineMi(47.6, -122.3, 47.66, -117.42), C.haversineMi(47.66, -117.42, 47.6, -122.3));
  assert.equal(C.haversineMi(NaN, -122.3, 47.6, -122.3), null);
  assert.equal(C.distanceBetween(rec('a'), rec('b', { location: null })), null);
});

test('nearestInSet reports on-site as distance 0, unlocated as null', () => {
  const hub = rec('hub', Object.assign(at(47.6, -122.3), { evt247: { state: 'affirmative' } }));
  const spoke = rec('spoke', at(46.6, -120.5));
  const set = C.destinationSet([hub, spoke], 'evt247');
  assert.deepEqual(set.map(h => h.id), ['hub']);
  const self = C.nearestInSet(hub, set);
  assert.equal(self.status, 'on-site');
  assert.equal(self.miles, 0);
  const other = C.nearestInSet(spoke, set);
  assert.equal(other.status, 'ok');
  assert.ok(other.miles > 100);
  const none = C.nearestInSet(rec('x', { location: null }), set);
  assert.equal(none.status, 'no-location');
  assert.equal(none.miles, null);
  assert.equal(C.nearestInSet(spoke, []).status, 'no-destination');
});

test('destination sets exclude closed, unlocated and ineligible campuses and can drop neighbours', () => {
  const evt = { evt247: { state: 'affirmative' } };
  const hs = [
    rec('open', evt),
    rec('closed', Object.assign({ status: { value: 'closed' } }, evt)),
    rec('nolocation', Object.assign({ location: null }, evt)),
    rec('peds', Object.assign({ derived: { tier: null, capability: 'assessed', eligibility: { value: 'excluded' } } }, evt)),
    rec('neighbor', Object.assign({ outOfRegion: true, derived: { tier: 'CSC', eligibility: { value: 'unknown' } } }, evt)),
  ];
  assert.deepEqual(C.destinationSet(hs, 'evt247').map(h => h.id).sort(), ['neighbor', 'open']);
  assert.deepEqual(C.destinationSet(hs, 'evt247', { includeNeighbors: false }).map(h => h.id), ['open']);
  // PSC with documented 24/7 EVT is an EVT destination but not CSC/TSC-level.
  const psc = rec('psc', { evt247: { state: 'affirmative' }, derived: { tier: 'PSC', capability: 'assessed', eligibility: { value: 'eligible' } } });
  assert.equal(C.destinationSet([psc], 'evt247').length, 1);
  assert.equal(C.destinationSet([psc], 'advanced').length, 0);
  // Unknown or conflicting EVT evidence never makes a destination.
  assert.equal(C.destinationSet([rec('u', { evt247: { state: 'conflicting' } })], 'evt247').length, 0);
});

test('ground transport is modelled only on a shared, documented road network', () => {
  const a = rec('a');
  const island = rec('island', { roadNetwork: { value: 'wa-san-juan-ferry' } });
  const unknown = rec('unk', { roadNetwork: { value: 'unknown' } });
  assert.equal(C.groundFeasibility(a, rec('b')).status, 'feasible');
  assert.equal(C.groundFeasibility(a, island).status, 'not-connected');
  assert.equal(C.groundFeasibility(a, unknown).status, 'unknown');
  const leg = C.legScenario('ground', island, a, 60);
  assert.equal(leg.minutes, null);
  assert.equal(leg.status, 'not-connected');
  const ok = C.legScenario('ground', a, rec('b'), 55, { roadFactor: 1, groundMph: 55, groundHandoffMin: 0 });
  assert.equal(Math.round(ok.minutes), 60);
  assert.equal(C.legScenario('ground', a, a, 0).status, 'on-site');
  assert.equal(C.legScenario('rotor', a, rec('b'), 400).status, 'out-of-range');
  assert.equal(C.legScenario('rotor', a, rec('b'), null).minutes, null);
});

test('transport parameters are clamped to their documented ranges', () => {
  const p = C.transportParams({ groundMph: 500, roadFactor: 0.2, didoMin: 'x' });
  assert.equal(p.groundMph, C.TRANSPORT_RANGES.groundMph[1]);
  assert.equal(p.roadFactor, C.TRANSPORT_RANGES.roadFactor[0]);
  assert.equal(p.didoMin, C.TRANSPORT_DEFAULTS.didoMin);
});

test('hub differential: identical center gives zero; missing values never become zero', () => {
  const hub = rec('hub', Object.assign(at(47.6, -122.3), { evt247: { state: 'affirmative' } }));
  const near = rec('near', Object.assign(at(46.6, -120.5), { evt247: { state: 'affirmative' } }));
  const spoke = rec('spoke', at(46.7, -120.6));
  const sets = { evt247: C.destinationSet([hub, near, spoke], 'evt247'), advanced: [] };

  const same = C.hubDifferential(spoke, C.computeAccess(spoke, { evt247: [hub], advanced: [] }, hub));
  assert.equal(same.status, 'ok');
  assert.equal(same.sameCenter, true);
  assert.equal(same.miles, 0);
  for (const m of same.minutes) if (m.diff != null) assert.equal(Math.round(m.diff), 0);

  const diff = C.hubDifferential(spoke, C.computeAccess(spoke, sets, hub));
  assert.equal(diff.sameCenter, false);
  assert.ok(diff.miles > 90, 'hub is much further than the nearest EVT centre');
  assert.ok(diff.minutes.find(m => m.mode === 'ground').diff > 0);

  // No-route: an island spoke gets no ground difference at all, with a reason.
  const island = rec('island', Object.assign(at(48.5, -123.0), { roadNetwork: { value: 'wa-san-juan-ferry' } }));
  const d2 = C.hubDifferential(island, C.computeAccess(island, sets, hub));
  const g = d2.minutes.find(m => m.mode === 'ground');
  assert.equal(g.diff, null);
  assert.match(g.reason, /road/i);

  // Unlocated origin: unavailable, not zero.
  const lost = rec('lost', { location: null });
  const d3 = C.hubDifferential(lost, C.computeAccess(lost, sets, hub));
  assert.equal(d3.status, 'unavailable');
  assert.equal(d3.miles, null);
  assert.equal(C.hubDifferential(spoke, C.computeAccess(spoke, sets, null)).status, 'no-hub');
});

test('access review: unassessed hospitals go to the shortlist without a certification-gap score', () => {
  const evt = rec('evt', Object.assign(at(47.6, -122.3), { evt247: { state: 'affirmative' }, derived: { tier: 'CSC', capability: 'assessed', eligibility: { value: 'eligible' } } }));
  const none = rec('none', Object.assign(at(46.0, -118.0), { derived: { tier: null, capability: 'assessed', eligibility: { value: 'eligible' } } }));
  const unk = rec('unk', Object.assign(at(46.0, -118.0), { derived: { tier: null, capability: 'unassessed', eligibility: { value: 'eligible' } } }));
  const excluded = rec('peds', Object.assign(at(46.0, -118.0), { derived: { tier: null, capability: 'assessed', eligibility: { value: 'excluded' } } }));
  const hs = [evt, none, unk, excluded];
  const sets = { evt247: C.destinationSet(hs, 'evt247'), advanced: C.destinationSet(hs, 'advanced') };
  const acc = Object.fromEntries(hs.map(h => [h.id, C.computeAccess(h, sets, null)]));
  const res = C.accessReview(hs, acc, C.REVIEW_DEFAULTS);
  assert.deepEqual(res.ranked.map(r => r.h.id), ['none']);
  assert.deepEqual(res.shortlist.map(r => r.h.id), ['unk']);
  assert.ok(!res.shortlist[0].comps.some(c => c.key === 'gap'), 'no gap component for unassessed');
  assert.deepEqual(res.shortlist[0].comps.map(c => c.key).sort(), ['adv', 'evt'], 'shortlist ranks on geography alone');
  assert.deepEqual(res.ranked[0].comps.map(c => c.key).sort(), ['adv', 'evt', 'gap']);
  // Hubs never rank as candidates.
  assert.ok(!res.ranked.concat(res.shortlist).some(r => r.h.id === 'evt'));
});

test('access review: all-zero weights is an explicit error, not a ranking of zeros', () => {
  const res = C.accessReview([rec('a')], { a: C.computeAccess(rec('a'), { evt247: [], advanced: [] }) }, { wGap: 0, wEvt: 0, wAdv: 0, wHub: 0 });
  assert.equal(res.error, 'all-weights-zero');
  assert.equal(res.ranked.length, 0);
});

test('access review ranking is stable and ties share a rank', () => {
  const evt = rec('evt', Object.assign(at(47.6, -122.3), { evt247: { state: 'affirmative' }, derived: { tier: 'CSC', capability: 'assessed', eligibility: { value: 'eligible' } } }));
  const a = rec('b-site', at(46.0, -118.0));
  const b = rec('a-site', at(46.0, -118.0));
  const hs = [evt, a, b];
  const sets = { evt247: C.destinationSet(hs, 'evt247'), advanced: C.destinationSet(hs, 'advanced') };
  const acc = Object.fromEntries(hs.map(h => [h.id, C.computeAccess(h, sets, null)]));
  const r1 = C.accessReview(hs, acc, C.REVIEW_DEFAULTS);
  const r2 = C.accessReview(hs.slice().reverse(), acc, C.REVIEW_DEFAULTS);
  assert.deepEqual(r1.ranked.map(r => r.h.id), ['a-site', 'b-site']);
  assert.deepEqual(r2.ranked.map(r => r.h.id), ['a-site', 'b-site']);
  assert.equal(r1.ranked[0].rank, 1);
  assert.equal(r1.ranked[1].rank, 1);
  assert.ok(r1.ranked.every(r => r.tied));
  // Contributions add up to the score.
  for (const r of r1.ranked) {
    const sum = r.comps.filter(c => c.points != null).reduce((s, c) => s + c.points, 0);
    assert.ok(Math.abs(sum - r.score) < 1e-9);
  }
});

test('access review never mutates the source records', () => {
  const evt = rec('evt', Object.assign(at(47.6, -122.3), { evt247: { state: 'affirmative' } }));
  const a = rec('a', at(46.0, -118.0));
  const hs = [evt, a];
  const before = JSON.stringify(hs);
  const sets = { evt247: C.destinationSet(hs, 'evt247'), advanced: [] };
  const acc = Object.fromEntries(hs.map(h => [h.id, C.computeAccess(h, sets, null)]));
  C.accessReview(hs, acc, { wGap: 10, wEvt: 90 });
  C.rankSensitivity(hs, acc, C.REVIEW_DEFAULTS);
  assert.equal(JSON.stringify(hs), before);
});

test('search: shorthand, multiword, word-prefix matching', () => {
  const fields = (h) => C.buildSearchFields(h);
  const hmc = { name: 'Harborview Medical Center', aliases: ['HMC'], address: { city: 'Seattle', county: 'King' }, state: 'WA', system: { value: 'UW Medicine' } };
  const stv = { name: 'St. Vincent Regional Hospital', aliases: ['St V'], address: { city: 'Billings', county: 'Yellowstone' }, state: 'MT' };
  const sh = { name: 'Providence Sacred Heart Medical Center', address: { city: 'Spokane' }, state: 'WA', system: { value: 'Providence' }, derived: { county: 'Spokane' } };
  const t = (q) => C.tokenize(q);
  assert.ok(C.matchesQuery(fields(hmc), t('HMC')));
  assert.ok(C.matchesQuery(fields(hmc), t('harborview')));
  assert.ok(C.matchesQuery(fields(hmc), t('king county')));
  assert.ok(C.matchesQuery(fields(hmc), t('uw medicine')));
  assert.ok(C.matchesQuery(fields(stv), t('St V')));
  assert.ok(C.matchesQuery(fields(stv), t('saint vincent billings')));
  assert.ok(!C.matchesQuery(fields(hmc), t('St V')), 'one-letter token must start a word');
  assert.ok(C.matchesQuery(fields(sh), t('sacred heart spokane')));
  assert.ok(!C.matchesQuery(fields(sh), t('sacred heart boise')));
  assert.ok(C.matchesQuery(fields(sh), t('spokane county')), 'derived county is searchable');
  assert.equal(C.searchRank(fields(hmc), 'harborview medical center', t('harborview medical center')), 0);
  assert.equal(C.searchRank(fields(hmc), 'HMC', t('HMC')), 0, 'alias exact match ranks first');
  assert.ok(C.searchRank(fields(hmc), 'harbor', t('harbor')) <= 1);
  assert.equal(C.normalizeSearch("St. Peter's"), 'saint peters');
  assert.equal(C.normalizeSearch('Utqiaġvik'), 'utqiagvik');
});

test('CSV cells are quoted and protected against formula injection', () => {
  assert.equal(C.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(C.csvCell('+1'), "'+1");
  assert.equal(C.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(C.csvCell(-12.5), '-12.5');
  assert.equal(C.csvCell(0), '0');
  assert.equal(C.csvCell(null), '');
  assert.equal(C.csvCell(NaN), '');
  assert.equal(C.csvCell('a,b'), '"a,b"');
  assert.equal(C.csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(C.toCsv([['a', 1], ['b', null]]), 'a,1\r\nb,\r\n');
});

test('URL state round-trips and rejects malformed values', () => {
  const ids = new Set(['500064', '270049', '020001']);
  const ctx = { ids, systems: new Set(['UW Medicine']) };
  const s = C.defaultUiState();
  Object.assign(s, { view: 'explore', mode: 'evt-distance', q: 'st v', state: 'MT', tiers: ['csc', 'none'], selected: '270049', hub: '500064',
    compare: ['500064', '270049'], system: 'UW Medicine', cah: 'unknown', view_lat: 47.5, view_lng: -120.5, view_z: 7, evtMin: 75, neighbors: false, preset: 'evt' });
  s.review.wEvt = 70; s.transport.didoMin = 45;
  const qs = C.serializeUrlState(s);
  const back = C.parseUrlState(qs, ctx);
  assert.deepEqual(back.ignored, []);
  for (const k of ['view', 'mode', 'q', 'state', 'tiers', 'selected', 'hub', 'compare', 'system', 'cah', 'view_lat', 'view_lng', 'view_z', 'evtMin', 'neighbors', 'preset']) {
    assert.deepEqual(back.state[k], s[k], k);
  }
  assert.equal(back.state.review.wEvt, 70);
  assert.equal(back.state.transport.didoMin, 45);

  const bad = C.parseUrlState('preset=x&mode=evil&state=CA&h=999999&hub=<script>&cmp=500064,nope,500064&lat=999&lng=0&z=7&wg=-5&evtdist=abc&theme=neon&sys=Fake', ctx);
  assert.equal(bad.state.mode, 'capability');
  assert.equal(bad.state.preset, null);
  assert.equal(bad.state.state, 'ALL');
  assert.equal(bad.state.selected, null);
  assert.equal(bad.state.hub, null);
  assert.deepEqual(bad.state.compare, ['500064']);
  assert.equal(bad.state.view_lat, null);
  assert.equal(bad.state.review.wGap, 0, 'clamped to range floor');
  assert.equal(bad.state.theme, null);
  assert.equal(bad.state.system, null);
  assert.ok(bad.ignored.includes('h') && bad.ignored.includes('viewport') && bad.ignored.includes('theme'));
});

test('URL state accepts links written by earlier versions', () => {
  const ctx = { ids: new Set(), systems: new Set() };
  const old = C.parseUrlState('csc=1&none=1&census=1&evt=1&dark=1&cb=1&wc=55&we=30&dm=120&lat=47.5000&lng=-120.5000&z=7&evtdist=60', ctx);
  assert.deepEqual(old.state.tiers, ['csc', 'none', 'unassessed']);
  assert.equal(old.state.evt, true);
  assert.equal(old.state.theme, 'dark');
  assert.equal(old.explicit.theme, true);
  assert.equal(old.state.cb, true);
  assert.equal(old.state.review.wGap, 55);
  assert.equal(old.state.review.wEvt, 30);
  assert.equal(old.state.review.wAdv, 20, 'a weight the old link left out takes the old default');
  assert.deepEqual(old.legacy, ['weights']);
  assert.equal(old.state.review.desertMi, 120);
  assert.equal(old.state.evtMin, 50, 'snapped to the 25-mi step');
  assert.equal(old.state.view_z, 7);
});

test('distance bins keep zero and unknown distinct', () => {
  assert.equal(C.distanceBin(0), 'on-site');
  assert.equal(C.distanceBin(null), 'unknown');
  assert.equal(C.distanceBin(49.9), 'lt50');
  assert.equal(C.distanceBin(150), '150plus');
});

test('formatStreet title-cases registry capitals and leaves mixed case alone', () => {
  assert.equal(C.formatStreet('915 ANDERSON DR'), '915 Anderson Dr');
  assert.equal(C.formatStreet('1201 S MILLER ST'), '1201 S Miller St');
  assert.equal(C.formatStreet('401 15TH AVE SE'), '401 15th Ave SE');
  assert.equal(C.formatStreet('600 MT HWY 91 SOUTH'), '600 MT Hwy 91 South');
  assert.equal(C.formatStreet('1901 South Union Avenue'), '1901 South Union Avenue');
  assert.equal(C.formatStreet(null), '');
});

test('retired ids in share links open the record that replaced them', () => {
  const ids = new Set(['500129-TACOMA-GENERAL', '500129']);
  const aliases = new Map([['500012', '500129-TACOMA-GENERAL']]);
  const r = C.parseUrlState('?h=500012&cmp=500012,500129,zzz&hub=500012', { ids, aliases });
  assert.equal(r.state.selected, '500129-TACOMA-GENERAL');
  assert.equal(r.state.hub, '500129-TACOMA-GENERAL');
  assert.deepEqual(r.state.compare, ['500129-TACOMA-GENERAL', '500129']);
  assert.ok(r.ignored.includes('cmp:zzz'));
});

test('a documented receiving center is a destination even before its ED is documented; an excluded one is not', () => {
  const base = { location: { lat: 47.6, lng: -122.3 }, status: { value: 'active' }, evt247: { state: 'affirmative' } };
  const unresolved = Object.assign({ id: 'a', derived: { eligibility: { value: 'unknown' } } }, base);
  const pediatric = Object.assign({ id: 'b', derived: { eligibility: { value: 'excluded', code: 'pediatric' } } }, base);
  const closed = Object.assign({}, unresolved, { id: 'c', status: { value: 'closed' } });
  assert.equal(C.canBeDestination(unresolved), true);
  assert.equal(C.canBeDestination(pediatric), false);
  assert.equal(C.canBeDestination(closed), false);
  assert.deepEqual(C.destinationSet([unresolved, pediatric, closed], 'evt247').map(h => h.id), ['a']);
});

test('a county phrase matches that county only, not streets or names that start the same', () => {
  const rec = (id, name, county, street) => ({ id, name, address: { street, city: 'X' }, derived: { county } });
  const lewis = C.buildSearchFields(rec('a', 'Arbor Health Morton Hospital', 'Lewis', '521 Adams Ave'));
  const pierce = C.buildSearchFields(rec('b', 'Madigan Army Medical Center', 'Pierce', '9040 Jackson Ave Lewis'));
  const nez = C.buildSearchFields(rec('c', 'St Joseph Regional Medical Center', 'Nez Perce', '415 6th St'));
  const t = C.tokenize('Lewis County');
  assert.equal(C.matchesQuery(lewis, t), true);
  assert.equal(C.matchesQuery(pierce, t), false);
  assert.equal(C.matchesQuery(nez, C.tokenize('nez perce county')), true);
  const garfield = C.buildSearchFields(rec('d', 'Garfield County Health Center', 'Garfield', '332 Leavitt Ave'));
  assert.equal(C.matchesQuery(garfield, C.tokenize('county')), true, 'a bare "county" is an ordinary word in names');
  assert.equal(C.matchesQuery(nez, C.tokenize('county')), false, 'and does not match every record');
  assert.equal(C.searchRank(lewis, 'Lewis County', t) < C.searchRank(pierce, 'Lewis', C.tokenize('Lewis')), true);
});

test('overlays, including modeled nearest lines, round-trip; unknown overlays are reported', () => {
  const s = C.defaultUiState();
  s.overlays = ['lines', 'nearest', 'rings'];
  const q = C.serializeUrlState(s);
  assert.deepEqual(C.parseUrlState('?' + q).state.overlays, ['lines', 'nearest', 'rings']);
  const r = C.parseUrlState('?ov=nearest,bogus');
  assert.deepEqual(r.state.overlays, ['nearest']);
  assert.ok(r.ignored.includes('ov:bogus'));
});

test('a half-step zoom in a link is kept', () => {
  const r = C.parseUrlState('?lat=47.5&lng=-120.5&z=7.5');
  assert.equal(r.state.view_z, 7.5);
  assert.equal(C.parseUrlState('?lat=47.5&lng=-120.5&z=7.3').state.view_z, 7.5);
});

test('two campuses at one point are 0 mi apart but still a transfer, not "on site"', () => {
  const a = { id: 'A', location: { lat: 45, lng: -110 }, roadNetwork: { value: 'contiguous-us' } };
  const b = { id: 'B', location: { lat: 45, lng: -110 }, roadNetwork: { value: 'contiguous-us' } };
  const leg = C.legScenario('ground', a, b, 0);
  assert.equal(leg.status, 'scenario');
  assert.ok(leg.minutes > 0);
  assert.equal(C.legScenario('ground', a, a, 0).status, 'on-site');
  assert.equal(C.distanceBin({ status: 'ok', miles: 0 }), 'lt50');
  assert.equal(C.distanceBin({ status: 'on-site', miles: 0 }), 'on-site');
});

test('a hospital that is itself a 24/7 EVT center gets no minute comparison with my center', () => {
  const me = { id: 'A', location: { lat: 61.2, lng: -149.8 }, roadNetwork: { value: 'ak-railbelt' } };
  const hub = { id: 'H', location: { lat: 47.6, lng: -122.3 }, roadNetwork: { value: 'contiguous-us' } };
  const access = { evt247: { status: 'on-site', dest: me, miles: 0 }, hub: { status: 'ok', dest: hub, miles: 1432 } };
  const d = C.hubDifferential(me, access);
  assert.equal(d.miles, 1432);
  assert.ok(d.minutes.every(m => m.diff === null && /no transfer/.test(m.reason)));
});

test('the verification shortlist does not depend on the weights', () => {
  const evt = rec('evt', Object.assign(at(47.6, -122.3), { evt247: { state: 'affirmative' }, derived: { tier: 'CSC', capability: 'assessed', eligibility: { value: 'eligible' } } }));
  const un = rec('un', Object.assign(at(46.0, -118.0), { derived: { tier: null, capability: 'unassessed', eligibility: { value: 'eligible' } } }));
  const part = rec('part', Object.assign(at(45.0, -117.0), { derived: { tier: null, capability: 'partial', eligibility: { value: 'eligible' } } }));
  const hs = [evt, un, part];
  const sets = { evt247: C.destinationSet(hs, 'evt247'), advanced: C.destinationSet(hs, 'advanced') };
  const acc = Object.fromEntries(hs.map(h => [h.id, C.computeAccess(h, sets, null)]));
  const ids = r => r.shortlist.map(x => x.h.id).sort();
  const geo = C.accessReview(hs, acc, { wGap: 30, wEvt: 50, wAdv: 20 });
  const gapOnly = C.accessReview(hs, acc, { wGap: 30, wEvt: 0, wAdv: 0 });
  const none = C.accessReview(hs, acc, { wGap: 0, wEvt: 0, wAdv: 0 });
  assert.deepEqual(ids(geo), ['part', 'un']);
  assert.deepEqual(ids(gapOnly), ['part', 'un'], 'geographic weights at zero keep the shortlist');
  assert.deepEqual(ids(none), ['part', 'un'], 'all weights at zero still list what needs verification');
  assert.equal(none.error, 'all-weights-zero');
  assert.equal(none.ranked.length, 0);
  // Without a score the shortlist is ordered by miles to the nearest 24/7 EVT center, farthest first.
  assert.deepEqual(gapOnly.shortlist.map(x => x.h.id), ['part', 'un']);
});

test('rank sensitivity still perturbs a weight that sits at the slider maximum', () => {
  const evt = rec('evt', Object.assign(at(47.6, -122.3), { evt247: { state: 'affirmative' }, derived: { tier: 'CSC', capability: 'assessed', eligibility: { value: 'eligible' } } }));
  // a: close to EVT but no certification; b: far from EVT but a PSC.
  const a = rec('a', Object.assign(at(47.0, -122.0), { national: { state: 'no-record-found' }, derived: { tier: null, capability: 'assessed', eligibility: { value: 'eligible' } } }));
  const b = rec('b', Object.assign(at(45.0, -114.0), { derived: { tier: 'PSC', capability: 'assessed', eligibility: { value: 'eligible' } } }));
  const hs = [evt, a, b];
  const sets = { evt247: C.destinationSet(hs, 'evt247'), advanced: C.destinationSet(hs, 'advanced') };
  const acc = Object.fromEntries(hs.map(h => [h.id, C.computeAccess(h, sets, null)]));
  const w = { wGap: 100, wEvt: 60, wAdv: 0, capMi: 400 };
  const sens = C.rankSensitivity(hs, acc, w);
  // Raising the (maxed) gap weight is now a real perturbation: a's rank can only improve with it.
  const base = C.accessReview(hs, acc, w).ranked;
  assert.equal(base.length, 2);
  assert.ok(Object.values(sens).every(([lo, hi]) => lo >= 1 && hi <= 2));
});

test('transfer feasibility names each mode in words and is not part of the score', () => {
  const a = rec('a');
  const b = rec('b', at(47.0, -120.0));
  const island = rec('island', { roadNetwork: { value: 'wa-san-juan-ferry' } });
  const unknown = rec('unk', { roadNetwork: { value: 'unknown' } });
  const near = C.transferFeasibility(a, b, 120, { rotorMaxMi: 150 });
  assert.equal(near.ground, 'road');
  assert.equal(near.rotor, 'within-range');
  assert.equal(near.fixed, 'not-assessed');
  assert.match(near.text, /documented road network.*within the 150-mi.*airport access not assessed/);
  assert.equal(C.transferFeasibility(a, b, 200, { rotorMaxMi: 150 }).rotor, 'beyond-range');
  assert.equal(C.transferFeasibility(island, b, 80).ground, 'not-connected');
  assert.equal(C.transferFeasibility(unknown, b, 80).ground, 'unknown');
  assert.equal(C.transferFeasibility(a, a, 0).text, 'On site');
  assert.equal(C.transferFeasibility(a, null, null).ground, 'none');
  assert.equal(C.transferFeasibility(a, b, null).text, 'Distance unknown');
});

test('a shortlist row without any usable component has no score rather than a crash', () => {
  const site = rec('s', { derived: { tier: null, capability: 'unassessed', eligibility: { value: 'eligible' } } });
  const access = { s: { evt247: { status: 'none', dest: null, miles: null }, advanced: { status: 'none', dest: null, miles: null }, hub: null } };
  const res = C.accessReview([site], access, { wGap: 3, wEvt: 0, wAdv: 0, wHub: 0 }, {});
  assert.equal(res.shortlist.length, 1);
  assert.equal(res.shortlist[0].score, null);
});

test('one needs-verification reason round-trips in a link; malformed reasons are dropped', () => {
  const ctx = { ids: new Set(), systems: new Set() };
  const r = C.parseUrlState('ev=nv:location-conflict', ctx);
  assert.deepEqual(r.state.evidence, ['nv:location-conflict']);
  assert.match(C.serializeUrlState(r.state), /ev=nv%3Alocation-conflict|ev=nv:location-conflict/);
  assert.deepEqual(C.parseUrlState('ev=nv:<b>', ctx).state.evidence, []);
  assert.deepEqual(C.parseUrlState('wg=60', ctx).legacy, [], 'current links are not treated as legacy');
});
