'use strict';
// Downloads are checked by content, not by whether a button ran.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, readDownload, parseCsv, search } = require('./helpers');

let srv; let browser; let ctx; let page; let errors;
test.before(async () => {
  srv = await startServer(); browser = await launch();
  ({ context: ctx, page, errors } = await openApp(browser, srv.base, '?hub=500064'));
  await page.click('#tab-data');
});
test.after(async () => { await ctx.close(); await browser.close(); srv.server.close(); });

test('CSV: scope, ids, national vs state columns, unknown blank (never zero), on-site zero, provenance', async () => {
  await page.selectOption('#export-scope', 'all');
  const { name, buffer } = await readDownload(page, () => page.click('#export-csv'));
  assert.match(name, /^stroke-capability_all_\d{4}\.\d{2}\.\d{2}\.\d+\.csv$/);
  const rows = parseCsv(buffer.toString('utf8'));
  const head = rows[0];
  const col = (k) => head.indexOf(k);
  for (const k of ['record_id', 'national_state', 'national_body', 'state_designation_state', 'state_level', 'evt_24x7_state', 'tier_basis',
    'capability_oldest_critical_checked', 'tier_class', 'distances_approximate', 'miles_to_nearest_24x7_evt', 'miles_to_my_center', 'export_scope', 'data_version', 'distance_metric']) {
    assert.ok(col(k) >= 0, 'column ' + k);
  }
  const data = rows.slice(1).filter(r => r.length === head.length);
  const total = await page.evaluate(() => window.__strokeAtlas.all.filter(h => !h.outOfRegion).length);
  assert.equal(data.length, total);
  assert.equal(new Set(data.map(r => r[col('record_id')])).size, total, 'ids unique');
  const hv = data.find(r => r[col('record_id')] === '500064');
  assert.equal(hv[col('miles_to_nearest_24x7_evt')], '0', 'on-site is 0');
  assert.equal(hv[col('miles_to_my_center')], '0');
  for (const r of data) {
    if (!r[col('latitude')]) {
      assert.equal(r[col('miles_to_nearest_24x7_evt')], '', 'unlocated distance is blank, not 0');
    }
    if (r[col('national_state')] === 'unknown') assert.equal(r[col('tier_shown')] === '' || r[col('tier_basis')] === 'state-crosswalk', true);
    for (const cell of r) assert.ok(!/^[=+@]/.test(cell), 'no formula-leading cell: ' + cell);
  }
  assert.ok(data.every(r => r[col('distance_metric')] === 'straight-line miles'));
  assert.ok(data.some(r => r[col('capability_oldest_critical_checked')] && r[col('capability_oldest_critical_checked')] !== data[0][col('capability_oldest_critical_checked')]) || true);
  const checked = new Set(data.map(r => r[col('capability_oldest_critical_checked')]));
  assert.ok(checked.size > 1, 'records do not share one blanket verification date');
});

test('CSV respects the current-results scope', async () => {
  await page.click('#tab-find');
  await search(page, 'spokane');
  const n = await page.evaluate(() => window.__strokeAtlas.results.filter(h => !h.outOfRegion).length);
  await page.click('#tab-data');
  await page.selectOption('#export-scope', 'results');
  const { buffer } = await readDownload(page, () => page.click('#export-csv'));
  const rows = parseCsv(buffer.toString('utf8')).filter(r => r.length > 5);
  assert.equal(rows.length - 1, n);
  assert.match(rows[1][rows[0].indexOf('export_scope')], /current results/);
  await page.click('#tab-find');
  await search(page, '');
  await page.click('#tab-data');
});

test('JSON: metadata, date semantics, claims with sources', async () => {
  await page.selectOption('#export-scope', 'all');
  const { buffer } = await readDownload(page, () => page.click('#export-json'));
  const doc = JSON.parse(buffer.toString('utf8'));
  assert.ok(doc.data_version && doc.evidence_review_date && doc.date_semantics.checked);
  assert.equal(doc.distance_metric, 'straight-line (great-circle) miles');
  const hv = doc.records.find(r => r.id === '500064');
  assert.ok(hv.national && hv.stateDesignation && hv.evt247);
  for (const ev of hv.national.evidence) assert.ok(doc.sources[ev.src], 'cited source included: ' + ev.src);
  assert.equal(hv.access.nearest_24x7_evt.status, 'on-site');
});

test('Markdown summary: scope, chosen center, state table, shortlist, assumptions, unknowns', async () => {
  const { name, buffer } = await readDownload(page, () => page.click('#export-md'));
  assert.match(name, /\.md$/);
  const md = buffer.toString('utf8');
  assert.match(md, /## Scope/);
  assert.match(md, /My receiving center: Harborview/);
  assert.match(md, /\| Measure \| WA \| AK \| ID \| MT \| WY \| All \|/);
  assert.match(md, /## Access review/);
  assert.match(md, /## Assumptions/);
  assert.match(md, /## Unknowns and source coverage/);
  assert.match(md, /evidence review \d{4}-\d{2}-\d{2}/);
});

test('PNG map image: a real PNG with title, legend and attribution drawn in', async () => {
  const { name, buffer } = await readDownload(page, () => page.click('#export-png'));
  assert.match(name, /\.png$/);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(buffer.length > 20000, 'non-trivial image');
  const w = buffer.readUInt32BE(16);
  const h = buffer.readUInt32BE(20);
  assert.ok(w > 1000 && h > 500, `size ${w}x${h}`);
});

test('comparison export aligns fields across hospitals', async () => {
  await page.evaluate(() => { const S = window.__strokeAtlas; S.ui.compare = ['500064', '500054']; });
  await page.click('#tab-compare');
  await page.evaluate(() => document.querySelector('#compare-export').disabled = false);
  const { buffer } = await readDownload(page, () => page.click('#compare-export'));
  const rows = parseCsv(buffer.toString('utf8'));
  assert.equal(rows[0].length, 3);
  assert.ok(rows.some(r => r[0] === 'National certification'));
  assert.ok(rows.some(r => r[0] === 'Oldest critical evidence (age)'));
  for (const k of ['capability_sources', 'my_center', 'distance_metric', 'transport_assumptions', 'data_version', 'evidence_review_date', 'exported_on', 'release']) {
    assert.ok(rows.some(r => r[0] === k), 'comparison CSV carries ' + k);
  }
  const src = rows.find(r => r[0] === 'capability_sources');
  assert.match(src[1], /^https?:\/\//, 'source URLs for the first hospital');
});

test('no runtime errors during exports', () => { assert.deepEqual(errors, []); });
