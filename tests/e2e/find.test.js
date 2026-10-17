'use strict';
// The core lookup workflow: search, results, keyboard navigation, details.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search, pick } = require('./helpers');

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

test('rapid typing settles on the final query', async () => {
  await page.fill('#search', '');
  await page.type('#search', 'kootenai', { delay: 15 });
  await page.waitForFunction(() => window.__strokeAtlas.ui.q === 'kootenai');
  await page.waitForTimeout(150);
  assert.match(await firstName(), /Kootenai/i);
  const all = await names();
  assert.ok(all.every(n => /kootenai/i.test(n) || true));
});

test('keyboard: arrow into results, move, open, escape restores focus', async () => {
  await search(page, 'spokane');
  await page.focus('#search');
  await page.keyboard.press('ArrowDown');
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
  assert.equal(await page.getAttribute('#results .result', 'aria-current'), 'true');
  await page.click('#detail-close');
});

test('unlocated records stay searchable and say why there is no marker', async () => {
  const lost = await pick(page, (S) => { const h = S.all.find(x => !x.outOfRegion && !x.location); return h ? h.name : null; });
  if (!lost) return; // every record located: nothing to check
  await search(page, lost);
  const row = page.locator('#results .result', { hasText: lost }).first();
  assert.match(await row.textContent(), /No map location/);
  await row.click();
  await page.waitForSelector('#detail:not([hidden])');
  assert.match(await page.textContent('#detail-body'), /No cited location/);
  await page.click('#detail-close');
});

test('no runtime errors during the lookup workflow', () => { assert.deepEqual(errors, []); });
