'use strict';
// Regressions for the second review round: what the detail panel covers at
// tablet and phone widths, the tile banner, the access review's unscored
// transfer column and all-zero weights, overlap badges, marker outlines, the
// footer and the disclaimer on phones.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, readDownload, parseCsv } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

test('tablet: the detail covers the tool column, leaves the map chrome clear, and covered tools are inert', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?h=500064', { viewport: { width: 820, height: 1180 } });
  await page.waitForSelector('#detail:not([hidden])');
  const r = await page.evaluate(() => {
    const d = document.querySelector('#detail').getBoundingClientRect();
    const m = document.querySelector('#map').getBoundingClientRect();
    const hit = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return b.left < d.right && b.right > d.left && b.top < d.bottom && b.bottom > d.top; };
    return { overMap: d.right > m.left + 1, sidebarInert: document.querySelector('#sidebar').hasAttribute('inert'),
      mainInert: document.querySelector('#main').hasAttribute('inert'), jumpCovered: hit('#jump'), zoomCovered: hit('.leaflet-control-zoom') };
  });
  assert.equal(r.overMap, false, 'detail does not cover the map');
  assert.equal(r.sidebarInert, true);
  assert.equal(r.mainInert, false);
  assert.equal(r.jumpCovered, false);
  assert.equal(r.zoomCovered, false);
  // A shortcut to another view puts the details away so the view is visible.
  await page.focus('#map');
  await page.keyboard.press('e');
  const after = await page.evaluate(() => ({ detail: document.querySelector('#detail').hidden, inert: document.querySelector('#sidebar').hasAttribute('inert'),
    explore: !document.querySelector('#panel-explore').hidden, selected: window.__strokeAtlas.ui.selected }));
  assert.deepEqual(after, { detail: true, inert: false, explore: true, selected: '500064' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('phone: the full-screen detail makes the map and tools inert but keeps the tab bar usable', async () => {
  const { page, context } = await openApp(browser, srv.base, '?h=500064', { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  await page.waitForSelector('#detail:not([hidden])');
  const r = await page.evaluate(() => ({
    main: document.querySelector('#main').hasAttribute('inert'),
    find: document.querySelector('#panel-find').hasAttribute('inert'),
    tabsInert: !!document.querySelector('#view-tabs').closest('[inert]'),
    // Tab order follows the screen: search and map come before the bottom tab bar.
    tabsAfterMain: !!(document.querySelector('#main').compareDocumentPosition(document.querySelector('#view-tabs')) & 4 /* DOCUMENT_POSITION_FOLLOWING */),
    disclaimer: /not for clinical decisions/.test(document.querySelector('#detail-body').textContent),
  }));
  assert.deepEqual(r, { main: true, find: true, tabsInert: false, tabsAfterMain: true, disclaimer: true });
  await page.click('#tab-data');
  const d = await page.evaluate(() => ({ detail: document.querySelector('#detail').hidden, main: document.querySelector('#main').hasAttribute('inert'),
    disclaimer: getComputedStyle(document.querySelector('#panel-data .disclaimer')).display !== 'none' && /not for clinical decisions/.test(document.querySelector('#panel-data').textContent) }));
  assert.equal(d.detail, true, 'a tab puts the details away');
  assert.equal(d.disclaimer, true, 'Data tab carries the disclaimer on phones');
  await context.close();
});

test('blocked tiles: the banner can be dismissed and does not cover the legend or status', async () => {
  for (const vp of [{ width: 390, height: 844, mobile: true }, { width: 1440, height: 900 }]) {
    const { page, context } = await openApp(browser, srv.base, '', { tiles: 'blocked', viewport: { width: vp.width, height: vp.height }, mobile: !!vp.mobile, touch: !!vp.mobile });
    await page.waitForSelector('#map-banner:not([hidden])', { timeout: 10000 });
    const r = await page.evaluate(() => {
      const box = (q) => { const n = document.querySelector(q); if (!n || n.hidden) return null; const b = n.getBoundingClientRect(); return b.width ? b : null; };
      const ov = (a, b) => !!(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
      const ban = box('#map-banner');
      return { legend: ov(ban, box('#legend-toggle')), status: ov(ban, box('#map-status')), jump: ov(ban, box('#jump')) };
    });
    assert.deepEqual(r, { legend: false, status: false, jump: false }, `banner clear at ${vp.width}`);
    await page.click('#map-banner-close');
    assert.equal(await page.$eval('#map-banner', n => n.hidden), true);
    await context.close();
  }
});

test('access review: transfer column is shown, exported and unscored; all-zero weights still list and export the shortlist', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?scope=all');
  await page.click('#tab-explore');
  await page.click('#open-review');
  await page.waitForSelector('#dlg-review[open]');
  const head = await page.$$eval('#rp-ranked thead th', ns => ns.map(n => n.textContent));
  assert.ok(head.includes('Transfer scenario to nearest 24/7 EVT (not scored)'));
  const cell = await page.$eval('#rp-ranked tbody tr:not([hidden])', tr => tr.textContent);
  assert.match(cell, /airport access not assessed/);
  let { buffer } = await readDownload(page, () => page.click('#review-export'));
  let rows = parseCsv(buffer.toString('utf8'));
  const col = rows[0].indexOf('transfer_scenario_to_nearest_24x7_evt_not_scored');
  assert.ok(col > 0);
  assert.ok(rows.slice(1).every(r => r[col]), 'every row has a transfer description');
  await page.keyboard.press('Escape');
  await context.close();

  const z = await openApp(browser, srv.base, '?scope=all&wg=0&we=0&wa=0&wh=0');
  await z.page.click('#tab-explore');
  await z.page.click('#open-review');
  await z.page.waitForSelector('#dlg-review[open]');
  assert.match(await z.page.textContent('#review-summary'), /All weights are zero/);
  const shortN = await z.page.evaluate(() => window.__strokeAtlas.lastReview.shortlist.length);
  assert.ok(shortN > 0);
  await z.page.click('#rt-short');
  assert.ok((await z.page.$$('#rp-short tbody tr:not([hidden])')).length === shortN, 'shortlist rendered');
  ({ buffer } = await readDownload(z.page, () => z.page.click('#review-export')));
  rows = parseCsv(buffer.toString('utf8')).filter(r => r.length > 5);
  assert.equal(rows.length - 1, shortN, 'shortlist exported with no ranking');
  assert.deepEqual(z.errors, []);
  assert.deepEqual(errors, []);
  await z.context.close();
});

test('markers that overlap at this zoom carry a count badge on the top one, and the legend explains it', async () => {
  const { page, context } = await openApp(browser, srv.base, '?scope=all');
  const r = await page.evaluate(() => {
    const S = window.__strokeAtlas;
    const badges = Array.from(document.querySelectorAll('.leaflet-marker-icon.stack-badge')).map(n => Number(n.textContent));
    const members = Array.from(S.stacks.values());
    return { badges, total: badges.reduce((a, b) => a + b, 0), members: members.length, hidden: Array.from(document.querySelectorAll('.leaflet-marker-icon.stack-badge')).every(n => n.getAttribute('aria-hidden') === 'true'),
      legend: document.querySelector('#legend-body').textContent };
  });
  assert.ok(r.badges.length > 0, 'some markers overlap at the default view');
  assert.ok(r.badges.every(n => n >= 2));
  assert.equal(r.total, r.members, 'each overlapping marker is counted once');
  assert.equal(r.hidden, true);
  assert.match(r.legend, /overlapping at this zoom/);
  await context.close();
});

test('marker outlines keep 3:1 against the basemap background in both themes', async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, context } = await openApp(browser, srv.base, '', { colorScheme: scheme });
    const ratio = await page.evaluate(() => {
      const rgb = (c) => { const n = document.createElement('i'); n.style.color = c; document.body.appendChild(n); const v = getComputedStyle(n).color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); n.remove(); return v; };
      const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const cs = getComputedStyle(document.documentElement);
      const a = lum(rgb(cs.getPropertyValue('--marker-stroke').trim()));
      // Light basemap tiles are near white; dark ones near the dark surface.
      const b = lum(rgb(document.documentElement.dataset.theme === 'dark' ? cs.getPropertyValue('--surface-3').trim() : '#f2f2ef'));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    assert.ok(ratio >= 3, `${scheme} marker outline contrast ${ratio.toFixed(2)}`);
    await context.close();
  }
});

test('the footer wraps instead of clipping, and the layout sits above it', async () => {
  const { page, context } = await openApp(browser, srv.base, '', { viewport: { width: 768, height: 1024 } });
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const f = document.querySelector('#provenance');
    const app = document.querySelector('#app').getBoundingClientRect();
    return { clipped: f.scrollWidth > f.clientWidth + 1 || f.scrollHeight > f.clientHeight + 1, gap: Math.abs(app.bottom - f.getBoundingClientRect().top) };
  });
  assert.equal(r.clipped, false);
  assert.ok(r.gap <= 1, `app ends at the footer (${r.gap}px)`);
  await context.close();
});
