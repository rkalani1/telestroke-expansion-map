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
