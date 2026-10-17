'use strict';
// Regressions for defects found in the independent review: fitting
// connections at laptop/tablet widths, the phone map/sheet flow, links naming
// an ineligible receiving center, filter counts, and the uncertainty channel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search, pick } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

// A Washington hospital whose nearest documented 24/7 EVT center is not my
// center (Harborview), far enough apart that both lines are drawn.
async function spokeFor(page) {
  return pick(page, (S) => {
    const h = S.all.find(x => !x.outOfRegion && x.location && x.state === 'WA' && S.access[x.id].evt247.status === 'ok'
      && S.access[x.id].evt247.dest.id !== '500064' && S.access[x.id].hub && S.access[x.id].hub.miles > 150);
    return h && { id: h.id, name: h.name };
  });
}

// Both ends of every selection line must sit inside the map and outside every
// panel floating over it.
async function endpointsClear(page) {
  return page.evaluate(() => {
    const S = window.__strokeAtlas;
    const m = S.map.getContainer().getBoundingClientRect();
    const sel = S.byId.get(S.ui.selected);
    const a = S.access[sel.id];
    const pts = [sel, a.evt247.dest, S.byId.get(S.ui.hub)].filter(Boolean);
    const overlays = ['#detail', '#legend', '#map-status', '.map-jump']
      .map(q => document.querySelector(q)).filter(n => n && !n.hidden && n.getBoundingClientRect().width)
      .map(n => n.getBoundingClientRect());
    return pts.map(h => {
      const p = S.map.latLngToContainerPoint([h.location.lat, h.location.lng]);
      const x = m.left + p.x; const y = m.top + p.y;
      const inMap = x >= m.left && x <= m.right && y >= m.top && y <= m.bottom;
      const covered = overlays.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      return { name: h.name, inMap, covered };
    });
  });
}

for (const [w, h] of [[1024, 768], [820, 1180], [1440, 900]]) {
  test(`fit connections keeps sender, nearest EVT and my center clear of panels at ${w}×${h}`, async () => {
    const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064', { viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const spoke = await spokeFor(page);
    assert.ok(spoke);
    await search(page, spoke.name);
    await page.click(`#results .result[data-id="${spoke.id}"]`);
    await page.waitForSelector('#detail:not([hidden])');
    await page.click('#detail-actions button:has-text("Fit connections")');
    await page.waitForTimeout(300);
    const pts = await endpointsClear(page);
    for (const p of pts) {
      assert.ok(p.inMap, `${p.name} inside the map at ${w}×${h}`);
      assert.ok(!p.covered, `${p.name} not under a panel at ${w}×${h}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('phone: "Show on map" puts the list and details away and offers a way back', async () => {
  const { page, context } = await openApp(browser, srv.base, '?hub=500064', { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  const spoke = await spokeFor(page);
  await page.click('#tab-find');
  await search(page, spoke.name);
  await page.press('#search', 'Enter');
  if (!(await page.isVisible('#detail'))) await page.click(`#results .result[data-id="${spoke.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#detail-actions button:has-text("Show on map")');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({
    sheet: document.body.classList.contains('sheet-open'),
    inert: document.querySelector('#main').hasAttribute('inert'),
    detail: document.querySelector('#detail').hidden,
    focus: document.activeElement && document.activeElement.textContent,
    selected: window.__strokeAtlas.ui.selected,
  }));
  assert.equal(st.sheet, false, 'list sheet closed');
  assert.equal(st.inert, false, 'map usable');
  assert.equal(st.detail, true, 'details put away');
  assert.equal(st.selected, spoke.id, 'selection kept');
  assert.match(st.focus || '', /^Details: /, 'focus on the way back');
  await context.close();
});

test('phone: a shortcut that moves focus first puts the detail sheet away', async () => {
  const { page, context } = await openApp(browser, srv.base, '?h=500064', { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  await page.waitForSelector('#detail:not([hidden])');
  await page.focus('#detail-title');
  await page.keyboard.press('/');
  const r = await page.evaluate(() => {
    const a = document.activeElement;
    const b = a.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { id: a.id, detailHidden: document.querySelector('#detail').hidden, visible: !!top && (top === a || a.contains(top)) };
  });
  assert.equal(r.id, 'search');
  assert.equal(r.detailHidden, true);
  assert.equal(r.visible, true, 'focused search box is not covered');
  await context.close();
});

test('a link naming an ineligible receiving center is set aside and reported', async () => {
  const { page, context } = await openApp(browser, srv.base, '?hub=503300&mode=hub-distance');
  const st = await page.evaluate(() => ({ hub: window.__strokeAtlas.ui.hub, mode: window.__strokeAtlas.ui.mode, toast: document.querySelector('#toasts').textContent }));
  assert.equal(st.hub, null);
  assert.notEqual(st.mode, 'hub-distance');
  assert.match(st.toast, /hub/);
  await context.close();
});

test('tier chip counts apply the 24/7 EVT filter, so they add up to the list', async () => {
  const { page, context } = await openApp(browser, srv.base, '?scope=all');
  if (!(await page.$eval('#filters', d => d.open))) await page.click('#filters > summary');
  await page.check('#f-evt');
  await page.waitForFunction(() => window.__strokeAtlas.ui.evt === true);
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const S = window.__strokeAtlas;
    const sum = ['csc', 'tsc', 'psc', 'asr', 'none', 'unassessed', 'conflicting'].reduce((a, k) => a + (S.counts[k] || 0), 0);
    return { sum, shown: S.results.filter(h => !h.outOfRegion).length };
  });
  assert.equal(r.sum, r.shown);
  await context.close();
});

test('eligibility mode keeps the "not assessed" ring the legend promises', async () => {
  const { page, context } = await openApp(browser, srv.base, '?mode=eligibility&scope=all');
  const r = await page.evaluate(() => {
    const S = window.__strokeAtlas;
    const unassessed = S.results.filter(h => !h.outOfRegion && h.location && h.derived.capability === 'unassessed').length;
    const rings = document.querySelectorAll('.leaflet-marker-icon svg [data-ring="unassessed"]').length;
    return { unassessed, rings, legend: document.querySelector('#legend-body').textContent };
  });
  assert.ok(r.unassessed > 0);
  assert.match(r.legend, /not assessed/i);
  assert.equal(r.rings, r.unassessed);
  await context.close();
});
