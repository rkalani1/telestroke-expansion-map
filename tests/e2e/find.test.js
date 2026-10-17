'use strict';
// The core lookup workflow: search, results, keyboard navigation, details.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search, pick, frames, recordFixture } = require('./helpers');

let srv; let browser; let ctx; let page; let errors;
test.before(async () => {
  srv = await startServer(); browser = await launch();
  ({ context: ctx, page, errors } = await openApp(browser, srv.base));
});
test.after(async () => { await ctx.close(); await browser.close(); srv.server.close(); });

const firstName = () => page.textContent('#results .result .r-name');
const names = () => page.$$eval('#results .result .r-name', ns => ns.map(n => n.textContent));

test('nicknames and shorthand resolve: HMC, Harborview, St V', async () => {
  await search(page, 'HMC');
  assert.match(await firstName(), /Harborview/i);
  await search(page, 'Harborview');
  assert.match(await firstName(), /Harborview/i);
  await search(page, 'St V');
  assert.match(await firstName(), /Vincent/i);
});

test('hospital plus city, county, and a multiword query', async () => {
  await search(page, 'providence everett');
  assert.match(await firstName(), /Providence Regional Medical Center Everett/i);
  const county = await pick(page, (S) => { const h = S.all.find(x => x.derived && x.derived.county === 'Yellowstone'); return h && h.name; });
  await search(page, 'yellowstone county');
  assert.ok((await names()).includes(county), 'a hospital in Yellowstone County is found');
  await search(page, 'sacred heart spokane');
  assert.match(await firstName(), /Sacred Heart/i);
});

test('search covers every record regardless of scope and says so', async () => {
  const excluded = await pick(page, (S) => { const h = S.all.find(x => !x.outOfRegion && x.derived.eligibility.value === 'excluded'); return h ? h.name : null; });
  if (excluded) {
    await search(page, excluded);
    assert.ok((await names()).includes(excluded));
  }
  assert.match(await page.textContent('#result-summary'), /search across all records/);
});

test('no results gives a clear empty state', async () => {
  await search(page, 'zzzz no such hospital');
  assert.equal((await page.$$('#results .result')).length, 0);
  assert.match(await page.textContent('#results'), /No hospitals match/);
  assert.match(await page.textContent('#result-summary'), /^0 of/);
});

// The rows a query should list, worked out from every record's search fields
// rather than read from the app's own results.
const matchesOf = (q) => page.evaluate((q) => {
  const S = window.__strokeAtlas; const C = window.StrokeCore;
  return S.all.filter(h => C.matchesQuery(h.fields, C.tokenize(q))).map(h => h.id).sort();
}, q);
const rowIds = () => page.$$eval('#results .result', rs => rs.map(r => r.dataset.id).sort());

test('rapid typing settles on the final query', async () => {
  const final = await matchesOf('kootenai');
  // An earlier keystroke's list differs, so a stale render would show.
  assert.ok(final.length > 0 && (await matchesOf('k')).length > final.length);
  await page.fill('#search', '');
  await page.type('#search', 'kootenai', { delay: 15 });
  await page.waitForFunction((n) => window.__strokeAtlas.ui.q === 'kootenai' && document.querySelectorAll('#results .result').length === n, final.length);
  await frames(page);
  assert.deepEqual(await rowIds(), final, 'the list shows the final query\'s matches, and only those');
  assert.match(await firstName(), /Kootenai/i);
});

test('rapid typing then ArrowDown focuses a row of the final query and keeps it', async () => {
  await search(page, 'spokane');
  const final = await matchesOf('kootenai');
  assert.ok(final.length > 0);
  assert.ok(!(await rowIds()).some(id => final.includes(id)), 'no row of the old list belongs to the new query');
  await page.fill('#search', '');
  // ArrowDown lands inside the search debounce of the last keystroke.
  await page.type('#search', 'kootenai', { delay: 10 });
  await page.keyboard.press('ArrowDown');
  const now = await page.evaluate(() => ({ cls: document.activeElement.className, id: document.activeElement.dataset.id }));
  assert.equal(now.cls, 'result');
  assert.ok(final.includes(now.id), `focused row ${now.id} belongs to the final query`);
  assert.equal(await page.evaluate(() => window.__strokeAtlas.ui.q), 'kootenai', 'ArrowDown applied the pending query');
  // Outlast the 120 ms search debounce: a timer or render left pending by the
  // typing would rebuild the list and drop this focus. Nothing to wait for
  // here, so this is a bounded wait for something that must not happen.
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await frames(page);
  const later = await page.evaluate(() => ({ cls: document.activeElement.className, id: document.activeElement.dataset.id }));
  assert.equal(later.cls, 'result', 'focus is still on a row, not <body>');
  assert.ok(final.includes(later.id));
  assert.deepEqual(await rowIds(), final);
  await page.keyboard.press('ArrowDown');
  const next = await page.evaluate(() => document.activeElement.dataset.id);
  if (final.length > 1) assert.notEqual(next, later.id, 'a second ArrowDown moves on');
});

test('a focused row that drops out of the list hands focus to a current row, never <body>', async () => {
  await search(page, 'spokane');
  await page.focus('#search');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement.classList.contains('result'));
  const gone = await page.evaluate(() => document.activeElement.dataset.id);
  // The list changes under the focused row (as when a pending search lands).
  await page.evaluate(() => { const S = window.__strokeAtlas; S.ui.q = 'kootenai'; window.update(); });
  await frames(page);
  const r = await page.evaluate(() => ({ tag: document.activeElement.tagName, cls: document.activeElement.className, id: document.activeElement.dataset.id, tabbable: document.activeElement.tabIndex }));
  assert.notEqual(r.tag, 'BODY');
  assert.equal(r.cls, 'result');
  assert.notEqual(r.id, gone);
  assert.ok((await matchesOf('kootenai')).includes(r.id));
  assert.equal(r.tabbable, 0, 'the focused row is the tabbable one');
  await page.fill('#search', '');
});

test('keyboard: arrow into results, move, open, escape restores focus', async () => {
  await search(page, 'spokane');
  await page.focus('#search');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement.classList.contains('result'), null, { timeout: 2000 }).catch(() => {});
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('result')), true);
  const firstId = await page.evaluate(() => document.activeElement.dataset.id);
  await page.keyboard.press('ArrowDown');
  const secondId = await page.evaluate(() => document.activeElement.dataset.id);
  assert.notEqual(firstId, secondId);
  assert.equal(await page.$$eval('#results .result[tabindex="0"]', ns => ns.length), 1, 'roving tabindex');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#detail:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'detail-title');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#detail', { state: 'hidden' });
  // Focus returns after the list re-renders (two animation frames).
  await page.waitForFunction((id) => document.activeElement && document.activeElement.dataset.id === id, secondId, { timeout: 2000 }).catch(() => {});
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), secondId);
});

test('Enter on a single match opens it; the selected row is marked', async () => {
  await search(page, 'harborview');
  await page.focus('#search');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#detail:not([hidden])');
  assert.match(await page.textContent('#detail-title'), /Harborview/);
  // The detail opens at once; the list is re-rendered with the selected row
  // marked on the next animation frame, which a slow runner can reach later.
  await page.waitForSelector('#results .result[aria-current="true"]', { timeout: 5000 });
  assert.equal(await page.getAttribute('#results .result', 'aria-current'), 'true');
  await page.click('#detail-close');
});

test('unlocated records stay searchable, say why there is no marker, and are counted apart (fixture)', async () => {
  const fx = recordFixture();
  const { page: p, context, errors: errs } = await openApp(browser, srv.base, '', { routes: [fx.route] });
  const lost = fx.unlocated;
  // In the analysis set, so the default list and the status lines count it.
  assert.ok(await p.$(`#results .result[data-id="${lost.id}"]`), 'listed without a search');
  // The fixture's record plus any record the data itself leaves unlocated.
  const unlocated = await p.evaluate(() => window.__strokeAtlas.results.filter(h => !h.outOfRegion && !h.location).length);
  assert.ok(unlocated >= 1);
  assert.match(await p.textContent('#result-summary'), new RegExp(` · ${unlocated} without a map location$`));
  assert.match(await p.textContent('#map-status'), new RegExp(`, ${unlocated} not located;`));
  const marked = await p.evaluate((id) => { const S = window.__strokeAtlas; const mk = S.markers.get(id); return !!(mk && S.markerLayer.hasLayer(mk)); }, lost.id);
  assert.equal(marked, false, 'no marker is drawn for it');
  await search(p, lost.name);
  const row = p.locator(`#results .result[data-id="${lost.id}"]`);
  assert.match(await row.textContent(), /No map location/);
  await row.click();
  await p.waitForSelector('#detail:not([hidden])');
  const body = await p.textContent('#detail-body');
  assert.match(body, /No cited location — not drawn on the map/);
  assert.match(body, /Unavailable: no verified location for this hospital\./);
  assert.doesNotMatch(body, /Nearby hospitals/, 'no straight-line neighbours without a location');
  assert.equal(await p.$('#detail-actions [data-act="fit"]'), null, 'nothing to fit on the map');
  assert.equal(await p.evaluate(() => { let n = 0; window.__strokeAtlas.lineLayer.eachLayer(l => { if (l.getLatLngs) n++; }); return n; }), 0, 'no lines drawn');
  assert.deepEqual(errs, []);
  await context.close();
});

test('no runtime errors during the lookup workflow', () => { assert.deepEqual(errors, []); });
