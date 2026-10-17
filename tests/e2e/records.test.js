'use strict';
// Record semantics as rendered: a partly assessed record (with no tier, beside
// "none found", beside a tier), a record never assessed, conflicting evidence,
// an out-of-region destination and an on-site (0 mi) distance, each read from
// the list badges, the detail rows, the comparison table and the CSV. The
// comparison is built through the real "Add to comparison" buttons.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, readDownload, parseCsv, pick, search, frames } = require('./helpers');

let srv; let browser; let ctx; let page; let errors; let R;
test.before(async () => {
  srv = await startServer(); browser = await launch();
  ({ context: ctx, page, errors } = await openApp(browser, srv.base, '?hub=500064&scope=all'));
  // Records of each kind, from the live data.
  R = await pick(page, (S) => {
    const inR = S.all.filter(h => !h.outOfRegion && h.location);
    const find = (f) => { const h = inR.find(f); return h ? { id: h.id, name: h.name, tier: h.derived.tier, basis: h.derived.tierBasis } : null; };
    const cap = (h) => h.derived.capability;
    const conflicting = find(h => cap(h) === 'conflicting');
    const spoke = find(h => S.access[h.id].evt247.status === 'ok' && S.access[h.id].evt247.dest.outOfRegion);
    const dest = spoke && S.access[spoke.id].evt247.dest;
    return {
      partial: find(h => cap(h) === 'partial' && h.derived.tierClass === 'partial'),
      partialNone: find(h => cap(h) === 'partial' && h.derived.tierClass === 'none'),
      partialTier: find(h => cap(h) === 'partial' && !!h.derived.tier && h.derived.tierBasis === 'national'),
      unassessed: find(h => cap(h) === 'unassessed' && !h.derived.capabilityOldest && !h.derived.capabilityUndated),
      conflicting,
      conflictingClaim: conflicting && ['national', 'stateDesignation', 'evt', 'evt247'].find(k => S.byId.get(conflicting.id)[k] && S.byId.get(conflicting.id)[k].state === 'conflicting'),
      spoke,
      oor: dest && { id: dest.id, name: dest.name },
      onSite: { id: '500064', name: S.byId.get('500064').name },
    };
  });
});
test.after(async () => { await ctx.close(); await browser.close(); srv.server.close(); });

const badges = (id) => page.$$eval(`#results .result[data-id="${id}"] .badge`, bs => bs.map(b => b.textContent));
async function open(rec) {
  await search(page, rec.name);
  await page.click(`#results .result[data-id="${rec.id}"]`);
  await page.waitForFunction((id) => !document.querySelector('#detail').hidden && window.__strokeAtlas.ui.selected === id, rec.id);
  await frames(page);
}
// The detail as shown: banner, every claim row (label → state tag and value), access rows.
const detail = () => page.evaluate(() => ({
  bannerHead: document.querySelector('#detail-body .status-banner strong').textContent,
  banner: document.querySelector('#detail-body .status-banner').textContent,
  claims: Object.fromEntries(Array.from(document.querySelectorAll('#detail-body .claim')).map(c => [c.querySelector('dt').textContent,
    { value: c.querySelector('.c-value').textContent, tag: (c.querySelector('.state-tag') || {}).textContent || null }])),
  access: Array.from(document.querySelectorAll('#detail-body .access-row')).map(r => ({ label: r.querySelector('.a-label').textContent,
    dest: (r.querySelector('.a-dest') || {}).textContent || null, badge: (r.querySelector('.badge') || {}).textContent || null,
    mi: r.querySelector('.a-mi').textContent, note: (r.querySelector('.a-note') || {}).textContent || '' })),
  scenario: !!document.querySelector('#detail-body table.scenario'),
  actions: Array.from(document.querySelectorAll('#detail-actions button')).map(b => b.dataset.act),
}));
const addToComparison = async () => {
  await page.click('#detail-actions [data-act="compare"]');
  await page.waitForFunction((id) => window.__strokeAtlas.ui.compare.includes(id), await page.evaluate(() => window.__strokeAtlas.ui.selected));
};

test('every kind of record exists in the data', () => {
  for (const k of ['partial', 'partialNone', 'partialTier', 'unassessed', 'conflicting', 'conflictingClaim', 'spoke', 'oor']) assert.ok(R[k], k);
});

test('partly assessed: its own badge and dotted ring, beside "none found" or a tier; detail rows say so', async () => {
  await open(R.partial);
  const b = await badges(R.partial.id);
  assert.ok(b.includes('Capability partly assessed'), b.join(' | '));
  for (const not of ['No certification found', 'Capability not assessed', 'Conflicting evidence']) assert.ok(!b.includes(not), `not "${not}"`);
  assert.ok(await page.$(`#results .result[data-id="${R.partial.id}"] .glyph svg [data-ring="partial"]`), 'the list glyph has the dotted ring');
  let d = await detail();
  assert.match(d.bannerHead, /^Capability partly assessed/);
  assert.equal(d.claims['Tier shown on map'].value, 'Partly assessed — no tier found so far');
  await addToComparison();

  // "None found" so far and still partly assessed: both are said.
  await open(R.partialNone);
  const bn = await badges(R.partialNone.id);
  assert.ok(bn.includes('No certification found') && bn.includes('Capability partly assessed'), bn.join(' | '));
  d = await detail();
  assert.equal(d.claims['Tier shown on map'].value, 'None found in reviewed sources');
  assert.match(d.bannerHead, /^Capability partly assessed/);

  // A documented tier with other capability claims still unknown.
  await open(R.partialTier);
  const bt = await badges(R.partialTier.id);
  assert.ok(bt.some(t => t.startsWith(R.partialTier.tier + ' · ')), `the ${R.partialTier.tier} badge: ${bt.join(' | ')}`);
  assert.ok(bt.includes('Capability partly assessed'));
  d = await detail();
  assert.match(d.claims['Tier shown on map'].value, new RegExp(`^${R.partialTier.tier} — `));
  assert.match(d.bannerHead, /^Capability partly assessed/);
});

test('not assessed: the badge, the dashed glyph and a banner saying unknown is not "none"', async () => {
  await open(R.unassessed);
  const b = await badges(R.unassessed.id);
  assert.ok(b.includes('Capability not assessed'), b.join(' | '));
  assert.ok(!b.includes('No certification found') && !b.includes('Capability partly assessed'));
  const dashed = await page.$eval(`#results .result[data-id="${R.unassessed.id}"] .glyph svg`, s => s.innerHTML);
  assert.match(dashed, /stroke:var\(--c-unassessed-stroke\)[^"]*stroke-dasharray:2\.6 2/, 'hollow dashed outline');
  const d = await detail();
  assert.match(d.bannerHead, /^Capability not assessed/);
  assert.match(d.banner, /No certification shown here means not checked — not that none exists/);
  assert.equal(d.claims['Tier shown on map'].value, 'Not assessed');
  assert.equal(d.claims['National certification'].tag, 'Not assessed');
  await addToComparison();
});

test('conflicting evidence: the badge, a diamond, the conflicting claim tagged, the tier it still shows named with its basis', async () => {
  await open(R.conflicting);
  const b = await badges(R.conflicting.id);
  assert.ok(b.includes('Conflicting evidence'), b.join(' | '));
  assert.ok(!b.includes('Capability partly assessed') && !b.includes('Capability not assessed'));
  // The shape path: a diamond is drawn with straight segments, a circle with arcs.
  const shape = await page.$eval(`#results .result[data-id="${R.conflicting.id}"] .glyph svg`, s => Array.from(s.querySelectorAll('path')).find(p => !/fill:none/.test(p.getAttribute('style'))).getAttribute('d'));
  assert.match(shape, /L/);
  assert.doesNotMatch(shape, /a/);
  const d = await detail();
  assert.match(d.bannerHead, /^Conflicting evidence/);
  assert.match(d.banner, /Credible sources disagree/);
  const row = { national: 'National certification', stateDesignation: 'State designation', evt: 'Thrombectomy (EVT)', evt247: 'Thrombectomy (EVT)' }[R.conflictingClaim];
  assert.equal(d.claims[row].tag, 'Conflicting evidence', `${row} is tagged conflicting`);
  assert.match(d.claims['Tier shown on map'].value, new RegExp(`^${R.conflicting.tier} — `));
  await addToComparison();
});

test('out-of-region destination: "Outside WWAMI" beside it as a nearest center, and on its own row and detail', async () => {
  await open(R.spoke);
  const d = await detail();
  const evt = d.access.find(a => /documented 24\/7 EVT centers/.test(a.label));
  assert.equal(evt.dest, R.oor.name);
  assert.equal(evt.badge, 'Outside WWAMI');
  assert.match(evt.mi, /^≈\d+ mi$/, 'a town-centre destination gives an approximate distance');
  assert.match(evt.note, /Approximate: one end is placed at a town centre/);
  await open(R.oor);
  const b = await badges(R.oor.id);
  assert.ok(b.includes('Outside WWAMI · destination only'), b.join(' | '));
  for (const not of ['Capability not assessed', 'Capability partly assessed', 'No certification found', 'Eligibility unresolved']) assert.ok(!b.includes(not), `no WWAMI inventory badge "${not}"`);
  const od = await detail();
  assert.match(od.banner, /Receiving center outside the five WWAMI states\./);
  assert.equal(od.access.length, 0, 'no access section of its own');
  assert.ok(!od.actions.includes('compare') && !od.actions.includes('hub'), 'neither compared nor offered as my center');
  // The distance table names it as a neighboring-state center.
  await page.click('#detail-close');
  await search(page, R.spoke.name);
  await page.click('#tab-explore');
  await page.click('#open-matrix');
  await page.waitForSelector('#dlg-matrix[open]');
  const cell = await page.evaluate((name) => {
    const head = Array.from(document.querySelectorAll('#matrix-table thead th')).map(t => t.querySelector('button').dataset.sort);
    const tr = Array.from(document.querySelectorAll('#matrix-table tbody tr')).find(r => r.querySelector('th').textContent === name);
    return tr.children[head.indexOf('evtCenter')].textContent;
  }, R.spoke.name);
  assert.equal(cell, `${R.oor.name} (neighboring state)`);
  await page.keyboard.press('Escape');
  await page.click('#tab-find');
});

test('on site: 0 mi with its meaning, never unknown, and no transfer scenario', async () => {
  await open(R.onSite);
  const b = await badges(R.onSite.id);
  assert.ok(b.includes('My center'));
  assert.equal(await page.textContent(`#results .result[data-id="${R.onSite.id}"] .r-dist`), 'documented 24/7 EVT on site');
  const d = await detail();
  const evt = d.access.find(a => /documented 24\/7 EVT centers/.test(a.label));
  assert.equal(evt.mi, '0 mi');
  assert.match(evt.note, /^On site — no interfacility transfer/);
  const hub = d.access.find(a => /My receiving center/.test(a.label));
  assert.equal(hub.mi, '0 mi');
  assert.match(hub.note, /This is my receiving center\./);
  assert.equal(d.scenario, false, 'no transfer to itself is modelled');
  await addToComparison();
});

test('comparison: four added through the buttons, a fifth refused; the table and its CSV use the same wording', async () => {
  assert.deepEqual(await page.evaluate(() => window.__strokeAtlas.ui.compare), [R.partial.id, R.unassessed.id, R.conflicting.id, R.onSite.id]);
  await open(R.partialNone);
  assert.equal(await page.$eval('#detail-actions [data-act="compare"]', b => b.disabled), true, 'the comparison holds four');
  await page.click('#detail-close');
  await page.click('#tab-compare');
  assert.equal(await page.textContent('#compare-count'), '4');
  await page.click('#compare-open');
  await page.waitForSelector('#dlg-compare[open]');
  const t = await page.evaluate(() => {
    const names = Array.from(document.querySelectorAll('#cmp-table thead th')).slice(1).map(th => th.textContent);
    const rows = Object.fromEntries(Array.from(document.querySelectorAll('#cmp-table tbody tr')).map(r => [r.querySelector('th').textContent, Array.from(r.querySelectorAll('td')).map(td => td.textContent)]));
    return { names, rows };
  });
  assert.deepEqual(t.names, [R.partial.name, R.unassessed.name, R.conflicting.name, R.onSite.name]);
  const tier = t.rows['Tier shown (basis)'];
  assert.equal(tier[0], 'Partly assessed — no tier found so far');
  assert.equal(tier[1], 'Not assessed');
  assert.equal(tier[2], `${R.conflicting.tier} (${R.conflicting.basis === 'national' ? 'national' : 'state crosswalk'})`);
  assert.equal(tier[3], 'CSC (national)');
  assert.equal(t.rows['Oldest critical evidence (age)'][1], 'Never checked');
  const conflictingRow = { national: 'National certification', stateDesignation: 'State designation', evt: 'Thrombectomy (EVT)', evt247: 'Thrombectomy (EVT)' }[R.conflictingClaim];
  assert.match(t.rows[conflictingRow][2], /onflicting/, `${conflictingRow} says the evidence conflicts`);
  assert.equal(t.rows['Nearest documented 24/7 EVT center in this dataset (straight-line)'][3], 'On site (0 mi)');
  assert.equal(t.rows[`My center: ${R.onSite.name}`][3], 'On site (0 mi)');
  const { buffer } = await readDownload(page, () => page.click('#cmp-export'));
  const csv = Object.fromEntries(parseCsv(buffer.toString('utf8')).map(r => [r[0], r.slice(1)]));
  assert.deepEqual(csv.field, t.names);
  assert.deepEqual(csv['Tier shown (basis)'], tier, 'the CSV says what the table says');
  await page.keyboard.press('Escape');
});

test('CSV: tier class and capability evidence kept apart; 0 on site; out-of-region nearest center named and flagged approximate', async () => {
  await page.click('#tab-data');
  await page.selectOption('#export-scope', 'all');
  const { buffer } = await readDownload(page, () => page.click('#export-csv'));
  const rows = parseCsv(buffer.toString('utf8'));
  const head = rows[0];
  const by = Object.fromEntries(rows.slice(1).filter(r => r.length === head.length).map(r => [r[0], Object.fromEntries(head.map((k, i) => [k, r[i]]))]));
  const want = [
    [R.partial, { tier_shown: '', tier_class: 'partial', capability_evidence: 'partial' }],
    [R.partialNone, { tier_shown: '', tier_class: 'none', capability_evidence: 'partial' }],
    [R.partialTier, { tier_shown: R.partialTier.tier, tier_class: R.partialTier.tier.toLowerCase(), capability_evidence: 'partial' }],
    [R.unassessed, { tier_shown: '', tier_class: 'unassessed', capability_evidence: 'unassessed', capability_oldest_critical_checked: '' }],
    [R.conflicting, { tier_shown: R.conflicting.tier, capability_evidence: 'conflicting' }],
    [R.onSite, { miles_to_nearest_documented_24x7_evt: '0', miles_to_my_center: '0' }],
  ];
  for (const [rec, fields] of want) {
    for (const [k, v] of Object.entries(fields)) assert.equal(by[rec.id][k], v, `${rec.name}: ${k}`);
  }
  assert.equal(by[R.conflicting.id][{ national: 'national_state', stateDesignation: 'state_designation_state', evt: 'evt_state', evt247: 'evt_24x7_state' }[R.conflictingClaim]], 'conflicting');
  assert.equal(by[R.spoke.id].nearest_documented_24x7_evt_center, R.oor.name);
  assert.match(by[R.spoke.id].distances_approximate, /^yes/);
  assert.equal(by[R.oor.id], undefined, 'an out-of-region destination is not a WWAMI record');
  await page.click('#tab-find');
});

test('with neighboring-state centers left out, the border hospital names an in-region center and says so', async () => {
  const { page: p, context } = await openApp(browser, srv.base, `?hub=500064&nb=0&h=${R.spoke.id}`);
  await p.waitForSelector('#detail:not([hidden])');
  const evt = await p.evaluate(() => { const r = Array.from(document.querySelectorAll('#detail-body .access-row')).find(x => /documented 24\/7 EVT centers/.test(x.querySelector('.a-label').textContent));
    return { dest: r.querySelector('.a-dest').textContent, badge: !!r.querySelector('.badge'), note: r.querySelector('.a-note') ? r.querySelector('.a-note').textContent : '' }; });
  assert.notEqual(evt.dest, R.oor.name);
  assert.equal(evt.badge, false, 'no "Outside WWAMI" label on an in-region center');
  assert.match(evt.note, /Neighboring-state centers excluded\./);
  await context.close();
});

test('no runtime errors while rendering these records', () => { assert.deepEqual(errors, []); });
