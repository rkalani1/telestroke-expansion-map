'use strict';
// Downloads are checked by content, not by whether a button ran.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, readDownload, parseCsv, search, frames, recordFixture } = require('./helpers');

// Before the app loads: record every string drawn on a canvas (the PNG export
// is composed with fillText), and stand in for the print dialog, keeping a
// copy of what the print root held when printing was asked for.
function instrument() {
  window.__drawn = [];
  const proto = window.CanvasRenderingContext2D.prototype;
  const fillText = proto.fillText;
  proto.fillText = function (text, ...rest) { window.__drawn.push(String(text)); return fillText.call(this, text, ...rest); };
  window.__printed = [];
  window.print = () => {
    const root = document.querySelector('#print-root');
    window.__printed.push({ root: root.cloneNode(true), printing: document.body.classList.contains('printing') });
  };
}

let srv; let browser; let ctx; let page; let errors;
test.before(async () => {
  srv = await startServer(); browser = await launch();
  ({ context: ctx, page, errors } = await openApp(browser, srv.base, '?hub=500064', { initScript: instrument }));
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
    'capability_oldest_critical_checked', 'tier_class', 'distances_approximate', 'miles_to_nearest_documented_24x7_evt', 'miles_to_my_center', 'export_scope', 'data_version', 'distance_metric']) {
    assert.ok(col(k) >= 0, 'column ' + k);
  }
  const data = rows.slice(1).filter(r => r.length === head.length);
  const total = await page.evaluate(() => window.__strokeAtlas.all.filter(h => !h.outOfRegion).length);
  assert.equal(data.length, total);
  assert.equal(new Set(data.map(r => r[col('record_id')])).size, total, 'ids unique');
  const hv = data.find(r => r[col('record_id')] === '500064');
  assert.equal(hv[col('miles_to_nearest_documented_24x7_evt')], '0', 'on-site is 0');
  assert.equal(hv[col('miles_to_my_center')], '0');
  // Unlocated records (blank, never 0) are checked against a fixture below:
  // the current data has none.
  for (const r of data) {
    if (r[col('national_state')] === 'unknown') assert.equal(r[col('tier_shown')] === '' || r[col('tier_basis')] === 'state-crosswalk', true);
    for (const cell of r) assert.ok(!/^[=+@]/.test(cell), 'no formula-leading cell: ' + cell);
  }
  assert.ok(data.every(r => r[col('distance_metric')] === 'straight-line miles'));
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
  assert.equal(hv.access.nearest_documented_24x7_evt.status, 'on-site');
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

test('PNG map image: a real PNG with the title, mode, selection, legend, line labels, provenance and attribution drawn in', async () => {
  await page.click('#tab-find');
  await search(page, 'sacred heart spokane');
  await page.click('#results .result');
  await page.waitForSelector('#detail:not([hidden])');
  await frames(page);
  await page.click('#tab-data');
  await page.evaluate(() => { window.__drawn = []; });
  const { name, buffer } = await readDownload(page, () => page.click('#export-png'));
  assert.match(name, /\.png$/);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(buffer.length > 20000, 'non-trivial image');
  // The map as shown plus the legend column, a header and a footer.
  const size = await page.evaluate(() => { const s = window.__strokeAtlas.map.getSize(); return { w: s.x + 280, h: Math.max(s.y, 420) + 76 + 58 }; });
  assert.deepEqual({ w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) }, size);
  // What should be drawn, read from what the page shows.
  const want = await page.evaluate(() => {
    const S = window.__strokeAtlas;
    const legend = Array.from(document.querySelectorAll('#legend-body .legend-group'))
      .filter(g => !g.querySelector('.stack-badge')) // the image draws no overlap badges, so it does not explain them
      .flatMap(g => [g.querySelector('h3') && g.querySelector('h3').textContent.toUpperCase(),
        ...Array.from(g.querySelectorAll('.legend-row')).map(r => r.lastElementChild.textContent),
        ...Array.from(g.querySelectorAll('.legend-note')).map(n => n.textContent)]).filter(Boolean);
    return {
      mode: document.querySelector('#legend-title').textContent.replace(/^Legend · /, ''),
      onMap: Number(document.querySelector('#map-status').textContent.match(/(\d+) on map/)[1]),
      selected: S.byId.get(S.ui.selected).name, hub: S.byId.get(S.ui.hub).name,
      lineLabels: Array.from(document.querySelectorAll('.leaflet-tooltip.line-label')).map(t => t.textContent),
      legend, meta: { release: S.meta.release, data: S.meta.data_version, review: S.meta.evidence_review_date },
    };
  });
  const drawn = await page.evaluate(() => window.__drawn);
  // Legend rows and notes wrap over several fillText calls; joined, they read as on screen.
  const joined = drawn.join(' ');
  assert.ok(drawn.includes('Regional Hospital Stroke Capabilities — WA · AK · ID · MT · WY'), 'title');
  assert.ok(drawn.some(t => t.startsWith(`Map: ${want.mode} · ${want.onMap} on map · `)), `mode line: ${drawn.find(t => t.startsWith('Map: '))}`);
  assert.ok(drawn.includes(`Selected: ${want.selected} · My receiving center: ${want.hub}`), 'selection and my center');
  assert.ok(want.lineLabels.length >= 1, 'a selection line is shown');
  for (const l of want.lineLabels) assert.ok(drawn.includes(l), 'line label ' + l);
  assert.ok(drawn.includes('Legend'));
  assert.ok(want.legend.length > 10);
  for (const t of want.legend) assert.ok(joined.includes(t), 'legend text drawn: ' + t);
  assert.ok(drawn.some(t => t.startsWith(`Release ${want.meta.release} · data ${want.meta.data} · evidence review ${want.meta.review} · exported `)), 'provenance line');
  const foot = drawn.find(t => /Straight-line distances/.test(t));
  assert.equal(foot, 'Basemap © OpenStreetMap contributors. Straight-line distances; lines are not routes or referral relationships. Planning reference — not for clinical decisions.', 'attribution');
  await page.click('#detail-close');
});

test('comparison: built with "Add to comparison", opened and exported only from two hospitals, exported aligned', async () => {
  await page.click('#tab-compare');
  const state = () => page.evaluate(() => ({ open: document.querySelector('#compare-open').disabled, exp: document.querySelector('#compare-export').disabled,
    clear: document.querySelector('#compare-clear').disabled, list: document.querySelector('#compare-list').textContent }));
  let st = await state();
  assert.deepEqual([st.open, st.exp, st.clear], [true, true, true]);
  assert.match(st.list, /Nothing added yet/);
  const names = [];
  for (const q of ['harborview', 'sacred heart spokane']) {
    await page.click('#tab-find');
    await search(page, q);
    await page.click('#results .result');
    await page.waitForSelector('#detail:not([hidden])');
    names.push(await page.textContent('#detail-title'));
    await page.click('#detail-actions [data-act="compare"]');
    await page.waitForSelector('#detail-actions [data-act="compare"][aria-pressed="true"]');
    assert.equal(await page.textContent('#detail-actions [data-act="compare"]'), 'In comparison ✓');
    await page.click('#detail-close');
    await page.click('#tab-compare');
    st = await state();
    if (names.length === 1) {
      assert.deepEqual([st.open, st.exp, st.clear], [true, true, false], 'one hospital: nothing to compare yet, but it can be cleared');
      assert.match(st.list, /Add at least one more hospital/);
    } else assert.deepEqual([st.open, st.exp, st.clear], [false, false, false], 'two hospitals: compare and export');
  }
  assert.equal(await page.textContent('#compare-count'), '2');
  const { name, buffer } = await readDownload(page, () => page.click('#compare-export'));
  assert.match(name, /^stroke-comparison_.*\.csv$/);
  const rows = parseCsv(buffer.toString('utf8'));
  assert.deepEqual(rows[0], ['field'].concat(names));
  assert.ok(rows.every(r => r.length === 3), 'every row aligned to the two hospitals');
  assert.ok(rows.some(r => r[0] === 'National certification'));
  assert.ok(rows.some(r => r[0] === 'Oldest critical evidence (age)'));
  for (const k of ['capability_sources', 'my_center', 'distance_metric', 'transport_assumptions', 'data_version', 'evidence_review_date', 'exported_on', 'release']) {
    assert.ok(rows.some(r => r[0] === k), 'comparison CSV carries ' + k);
  }
  assert.deepEqual(rows.find(r => r[0] === 'my_center').slice(1), ['Harborview Medical Center (500064)', 'Harborview Medical Center (500064)']);
  const src = rows.find(r => r[0] === 'capability_sources');
  assert.match(src[1], /^https?:\/\//, 'source URLs for the first hospital');
});

test('print: the summary and the comparison go to the print root, which alone is shown while printing', async () => {
  await page.click('#tab-data');
  await page.click('#open-summary');
  await page.waitForSelector('#dlg-summary[open]');
  await page.click('#summary-print');
  const sum = await page.evaluate(() => {
    const p = window.__printed[window.__printed.length - 1];
    return { n: window.__printed.length, printing: p.printing, h1: p.root.querySelector('h1').textContent, h2: Array.from(p.root.querySelectorAll('h2')).map(h => h.textContent),
      head: Array.from(p.root.querySelectorAll('table thead th')).slice(0, 7).map(t => t.textContent), text: p.root.textContent };
  });
  assert.equal(sum.n, 1, 'printing was asked for once');
  assert.equal(sum.printing, true);
  assert.equal(sum.h1, 'Regional Hospital Stroke Capabilities — summary');
  for (const h of ['Scope', 'By state (records in scope)', 'Access review — public-data shortlist', 'Assumptions', 'Unknowns and source coverage']) assert.ok(sum.h2.includes(h), 'section ' + h);
  assert.deepEqual(sum.head, ['Measure', 'WA', 'AK', 'ID', 'MT', 'WY', 'All']);
  assert.match(sum.text, /My receiving center: Harborview Medical Center/);
  assert.match(sum.text, /Not for clinical decisions/);
  // The print styles show the print root and hide the app while printing.
  await page.emulateMedia({ media: 'print' });
  const css = await page.evaluate(() => ({ root: getComputedStyle(document.querySelector('#print-root')).display, app: getComputedStyle(document.querySelector('#app')).display }));
  assert.deepEqual(css, { root: 'block', app: 'none' });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new window.Event('afterprint')));
  assert.deepEqual(await page.evaluate(() => ({ empty: !document.querySelector('#print-root').firstChild, printing: document.body.classList.contains('printing') })),
    { empty: true, printing: false }, 'cleared once printing ends');
  await page.keyboard.press('Escape');

  await page.click('#tab-compare');
  await page.click('#compare-open');
  await page.waitForSelector('#dlg-compare[open]');
  const names = await page.$$eval('#cmp-table thead th', ths => ths.slice(1).map(t => t.textContent));
  await page.click('#cmp-print');
  const cmp = await page.evaluate(() => {
    const p = window.__printed[window.__printed.length - 1];
    return { printing: p.printing, h1: p.root.querySelector('h1').textContent, p: p.root.querySelector('p').textContent,
      names: Array.from(p.root.querySelectorAll('table thead th')).slice(1).map(t => t.textContent), fields: Array.from(p.root.querySelectorAll('table tbody th')).map(t => t.textContent) };
  });
  assert.equal(cmp.printing, true);
  assert.equal(cmp.h1, 'Hospital comparison');
  assert.match(cmp.p, /^Generated \d{4}-\d{2}-\d{2} · data \S+ · evidence review \d{4}-\d{2}-\d{2} · straight-line distances · public-source planning reference, not for clinical decisions\.$/);
  assert.equal(names.length, 2);
  assert.deepEqual(cmp.names, names);
  assert.ok(cmp.fields.includes('Tier shown (basis)') && cmp.fields.includes('National certification'));
  await page.evaluate(() => window.dispatchEvent(new window.Event('afterprint')));
  await page.keyboard.press('Escape');
  await page.click('#compare-clear');
  await frames(page);
  assert.equal(await page.$eval('#compare-export', b => b.disabled), true, 'cleared: nothing to export');
  assert.equal(await page.$eval('#compare-count', b => b.hidden), true);
});

test('copy link: a refused clipboard and a failed fallback say where the link is; a working one copies this view', async () => {
  const refuse = () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } });
    document.execCommand = () => false;
  };
  const a = await openApp(browser, srv.base, '?hub=500064&h=500054', { initScript: refuse });
  await a.page.waitForSelector('#detail:not([hidden])');
  await a.page.click('#detail-actions [data-act="link"]');
  await a.page.waitForSelector('.toast.warn');
  assert.equal(await a.page.textContent('.toast.warn'), 'Could not copy — the link is in the address bar');
  assert.equal(await a.page.getAttribute('.toast.warn', 'role'), 'status');
  assert.equal(await a.page.evaluate(() => document.activeElement.dataset.act), 'link', 'focus stays on the button');
  await a.page.click('#detail-close');
  await a.page.click('#tab-data');
  await a.page.click('#share-link');
  await a.page.waitForFunction(() => document.querySelectorAll('.toast.warn').length === 2);
  assert.equal(await a.page.evaluate(() => document.activeElement.id), 'share-link');
  await a.page.click('#open-summary');
  await a.page.click('#summary-copy');
  await a.page.waitForSelector('.toast.warn:has-text("Copy failed")');
  assert.match(await a.page.textContent('#toasts'), /Copy failed — use Download instead/);
  assert.equal(await a.page.evaluate(() => document.activeElement.id), 'summary-copy', 'focus stays in the dialog');
  assert.deepEqual(a.errors, []);
  await a.context.close();

  const record = () => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  };
  const b = await openApp(browser, srv.base, '?hub=500064&h=500054', { initScript: record });
  await b.page.click('#tab-data');
  await b.page.click('#share-link');
  await b.page.waitForSelector('.toast:has-text("Link copied")');
  const r = await b.page.evaluate(() => ({ copied: window.__copied, href: location.href }));
  assert.deepEqual(r.copied, [r.href]);
  assert.match(r.href, /[?&]h=500054(&|$)/);
  assert.match(r.href, /[?&]hub=500064(&|$)/);
  await b.context.close();
});

test('CSV and JSON with an unlocated and a closed record (fixture): blank distances, never 0; the closed campus is nobody\'s nearest center', async () => {
  const fx = recordFixture();
  const { page: p, context, errors: errs } = await openApp(browser, srv.base, '?hub=500064', { routes: [fx.route] });
  await p.click('#tab-data');
  await p.selectOption('#export-scope', 'all');
  const { buffer } = await readDownload(p, () => p.click('#export-csv'));
  const rows = parseCsv(buffer.toString('utf8'));
  const head = rows[0];
  const recs = rows.slice(1).filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
  const lost = recs.find(r => r.record_id === fx.unlocated.id);
  for (const k of ['latitude', 'longitude', 'miles_to_nearest_documented_24x7_evt', 'miles_to_nearest_csc_tsc_level', 'miles_to_my_center', 'my_center_minus_nearest_documented_24x7_evt_miles',
    'nearest_documented_24x7_evt_center', 'nearest_csc_tsc_level_center']) {
    assert.equal(lost[k], '', `unlocated: ${k} is blank, not 0`);
  }
  assert.equal(lost.my_center, 'Harborview Medical Center', 'my center is still named');
  assert.match(lost.needs_verification, /\bunlocated\b/);
  const shut = recs.find(r => r.record_id === fx.closed.id);
  assert.equal(shut.status, 'closed');
  assert.equal(shut.analysis_eligibility, 'excluded');
  assert.ok(!recs.some(r => r.nearest_documented_24x7_evt_center === fx.closed.name || r.nearest_csc_tsc_level_center === fx.closed.name), 'never a nearest center');
  for (const id of fx.closed.dependents) assert.notEqual(recs.find(r => r.record_id === id).nearest_documented_24x7_evt_center, '', `${id} still has a nearest center`);
  const json = JSON.parse((await readDownload(p, () => p.click('#export-json'))).buffer.toString('utf8'));
  const lj = json.records.find(r => r.id === fx.unlocated.id);
  assert.deepEqual(lj.access.nearest_documented_24x7_evt, { status: 'no-location' });
  assert.equal(lj.access.my_center.miles, null);
  assert.deepEqual(errs, []);
  await context.close();
});

test('no runtime errors during exports', () => { assert.deepEqual(errors, []); });
