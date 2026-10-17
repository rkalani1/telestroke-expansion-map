'use strict';
// Analysis modes keep their legend in sync and keep uncertainty visible;
// share links restore state in a fresh browser; malformed and old links are safe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search, frames } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

const markerSvgs = (page) => page.$$eval('.leaflet-marker-icon svg', ns => ns.map(n => n.innerHTML));

test('mode legend follows the mode; uncertainty keeps a second channel; mode survives filters and theme', async () => {
  const { page, context, errors } = await openApp(browser, srv.base);
  await page.click('#tab-explore');
  await page.check('input[name="mode"][value="evt-distance"]');
  await page.waitForFunction(() => /24\/7 EVT/.test(document.querySelector('#legend-title').textContent));
  const legend = await page.textContent('#legend-body');
  assert.match(legend, /Under 50 mi/);
  assert.match(legend, /Distance unknown/);
  assert.match(legend, /Dashed ring: capability not assessed/);
  assert.doesNotMatch(legend, /Comprehensive/, 'certification legend replaced, not appended');
  const svgs = await markerSvgs(page);
  assert.ok(svgs.some(s => /--d-[1-4]/.test(s)), 'distance fills in use');
  const hasUnassessed = await page.evaluate(() => window.__strokeAtlas.results.some(h => h.derived.capability === 'unassessed' && h.location));
  if (hasUnassessed) assert.ok(svgs.some(s => s.includes('--c-unassessed') && s.includes('stroke-dasharray')), 'unassessed keeps a dashed ring');
  // Filters and theme do not reset the mode.
  await page.click('#tab-find');
  await page.click('#filters summary');
  await page.selectOption('#f-state', 'MT');
  await page.click('#tab-data');
  await page.selectOption('#theme-select', 'dark');
  assert.equal(await page.evaluate(() => window.__strokeAtlas.ui.mode), 'evt-distance');
  assert.match(await page.textContent('#legend-title'), /24\/7 EVT/);
  assert.match(await page.textContent('#map-status'), /Miles to nearest documented 24\/7 EVT/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('capability legend distinguishes not assessed, none found and conflicting', async () => {
  const { page, context } = await openApp(browser, srv.base);
  const legend = await page.textContent('#legend-body');
  assert.match(legend, /Capability not assessed/);
  assert.match(legend, /No certification or designation found in reviewed sources/);
  assert.match(legend, /conflicting evidence/i);
  await context.close();
});

test('share link round-trips selection, center, mode, filters, scenario and viewport in a fresh context', async () => {
  // Reduced motion: the fit on selection is then immediate, so the view set below is not overtaken by it.
  const a = await openApp(browser, srv.base, '?hub=500064', { reducedMotion: 'reduce' });
  const page = a.page;
  await page.click('#tab-explore');
  await page.check('input[name="mode"][value="adv-distance"]');
  await page.click('#tab-find');
  await page.click('#filters summary');
  await page.selectOption('#f-state', 'WA');
  await page.click('#tier-chips .chip[data-tier="psc"]');
  await search(page, 'kadlec');
  await page.click('#results .result');
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detail-actions button:has-text("Add to comparison")');
  await page.evaluate(() => { const S = window.__strokeAtlas; S.ui.transport.didoMin = 45; S.ui.review.wEvt = 70; });
  await frames(page);
  await page.evaluate(() => window.__strokeAtlas.map.setView([46.2, -119.2], 9, { animate: false }));
  // The link is saved shortly after the move; wait for it to carry everything.
  await page.waitForFunction(() => { const q = new URL(location.href).searchParams; return q.get('dido') === '45' && q.get('we') === '70' && q.get('lat') === '46.2000' && q.get('z') === '9'; }, null, { timeout: 5000 });
  const url = await page.evaluate(() => location.href);
  const sel = await page.evaluate(() => window.__strokeAtlas.ui.selected);
  await a.context.close();

  const b = await openApp(browser, '', url);
  const s = await b.page.evaluate(() => { const S = window.__strokeAtlas; const c = S.map.getCenter(); return { ui: S.ui, z: S.map.getZoom(), lat: c.lat, lng: c.lng }; });
  assert.equal(s.ui.hub, '500064');
  assert.equal(s.ui.mode, 'adv-distance');
  assert.equal(s.ui.state, 'WA');
  assert.deepEqual(s.ui.tiers, ['psc']);
  assert.equal(s.ui.q, 'kadlec');
  assert.equal(s.ui.selected, sel);
  assert.deepEqual(s.ui.compare, [sel]);
  assert.equal(s.ui.transport.didoMin, 45);
  assert.equal(s.ui.review.wEvt, 70);
  assert.equal(s.z, 9);
  assert.ok(Math.abs(s.lat - 46.2) < 0.01 && Math.abs(s.lng + 119.2) < 0.01, 'viewport restored');
  assert.ok(await b.page.isVisible('#detail'), 'detail reopened');
  assert.equal(await b.page.isChecked('input[name="mode"][value="adv-distance"]'), true);
  assert.equal(await b.page.textContent('#compare-count'), '1');
  await b.context.close();
});

test('malformed parameters are ignored safely and reported', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?mode=<script>&state=CA&h=999999&hub=x&cmp=a,b&lat=999&lng=0&z=7&wg=-5&evtdist=abc&theme=neon&bm=sat&sort=evil');
  const ui = await page.evaluate(() => window.__strokeAtlas.ui);
  assert.equal(ui.mode, 'capability');
  assert.equal(ui.state, 'ALL');
  assert.equal(ui.selected, null);
  assert.equal(ui.hub, null);
  assert.deepEqual(ui.compare, []);
  assert.match(await page.textContent('#toasts'), /not recognised/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('links from earlier versions still work (pill flags, dark=1, scenario keys, viewport)', async () => {
  const { page, context } = await openApp(browser, srv.base, '?csc=1&census=1&dark=1&wc=55&dm=120&lat=47.5000&lng=-120.5000&z=7');
  const ui = await page.evaluate(() => window.__strokeAtlas.ui);
  assert.deepEqual(ui.tiers, ['csc', 'unassessed']);
  assert.equal(ui.review.wGap, 55);
  assert.equal(ui.review.wEvt, 40, 'omitted weights take the earlier version\'s defaults');
  assert.equal(ui.review.wAdv, 20);
  assert.match(await page.textContent('#toasts'), /earlier version/);
  assert.equal(ui.review.desertMi, 120);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => window.__strokeAtlas.map.getZoom()), 7);
  await context.close();
});

test('explicit theme in a link wins over a saved preference, without overwriting it', async () => {
  const { page, context } = await openApp(browser, srv.base, '?theme=dark', {
    initScript: () => { try { localStorage.setItem('stroke-atlas-prefs-v4', JSON.stringify({ theme: 'light' })); } catch { /* ignore */ } },
  });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('stroke-atlas-prefs-v4')).theme), 'light');
  await context.close();
});
