'use strict';
// Startup and resilience: the list and evidence must work when optional
// resources fail, and failures must be stated on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

test('boots without runtime errors and shows counts, markers and a legend', async () => {
  const { page, errors, context } = await openApp(browser, srv.base);
  const info = await page.evaluate(() => ({
    summary: document.querySelector('#result-summary').textContent,
    rows: document.querySelectorAll('#results .result').length,
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    legend: document.querySelector('#legend-title').textContent,
    provenance: document.querySelector('#provenance-text').textContent,
  }));
  assert.match(info.summary, /^\d+ of \d+ records/);
  assert.ok(info.rows > 50, 'list renders');
  assert.ok(info.markers > 50, 'markers render');
  assert.match(info.legend, /Capability/);
  assert.match(info.provenance, /data \d{4}\.\d{2}\.\d{2}/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('failed data load shows a recoverable error instead of hanging', async () => {
  const { page, context } = await openApp(browser, srv.base, '', {
    routes: [[/hospitals\.json/, r => r.fulfill({ status: 500, body: 'nope' })]],
  });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ready), 'error');
  assert.match(await page.textContent('#result-summary'), /could not be loaded/i);
  assert.ok(await page.isVisible('#results button:has-text("Retry")'));
  await context.close();
});

test('slow data shows a loading state, then loads', async () => {
  const { page, context } = await openApp(browser, srv.base, '', {
    waitReady: false,
    routes: [[/hospitals\.json/, async r => { await new Promise(res => setTimeout(res, 1200)); await r.continue(); }]],
  });
  assert.match(await page.textContent('#result-summary'), /Loading/);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 20000 });
  assert.match(await page.textContent('#result-summary'), /of \d+ records/);
  await context.close();
});

test('blocked map library: list, search and details still work', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '', {
    routes: [[/vendor\/leaflet\/leaflet\.js/, r => r.abort()]],
  });
  assert.ok(await page.isVisible('text=The map library did not load'));
  await search(page, 'harborview');
  await page.click('#results .result');
  await page.waitForSelector('#detail:not([hidden])');
  assert.match(await page.textContent('#detail-title'), /Harborview/i);
  assert.deepEqual(errors, []);
  await context.close();
});

test('blocked basemap tiles are reported and nothing else breaks', async () => {
  const { page, context } = await openApp(browser, srv.base, '', { tiles: 'blocked' });
  await page.waitForSelector('#map-banner:not([hidden])', { timeout: 10000 });
  assert.match(await page.textContent('#map-banner'), /Basemap tiles could not be loaded/);
  assert.ok((await page.$$('.leaflet-marker-icon')).length > 50);
  await context.close();
});

test('storage that throws (privacy mode) does not break startup', async () => {
  const { page, errors, context } = await openApp(browser, srv.base, '', {
    initScript: () => {
      const boom = () => { throw new DOMException('denied', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
    },
  });
  assert.ok((await page.$$('#results .result')).length > 50);
  await page.click('#tab-data');
  await page.selectOption('#theme-select', 'dark');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.match(await page.textContent('#data-overview'), /Browser storage/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('terrain shading is an opt-in basemap with its own attribution, restorable from a link', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?bm=terrain');
  await page.waitForSelector('.relief-layer', { state: 'attached' });
  assert.match(await page.textContent('.leaflet-control-attribution'), /USGS The National Map/);
  assert.match(await page.textContent('.leaflet-control-attribution'), /OpenStreetMap/);
  await page.click('#tab-data');
  await page.selectOption('#basemap-select', 'none');
  assert.equal(await page.$('.relief-layer'), null);
  assert.doesNotMatch(await page.textContent('.leaflet-control-attribution'), /USGS/);
  assert.deepEqual(errors, []);
  await context.close();
});
