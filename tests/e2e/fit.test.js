'use strict';
// The automatic fit on selection with the CSC/TSC-level line shown: every
// line's far end, that line's destination included, stays inside the map and
// clear of the panels at phone, tablet and laptop sizes, with motion on as
// well as reduced, and a legend the fit collapsed comes back without the
// saved choice changing. Where the panels leave no room, the status bar says so.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search, pick, frames, endpointsClear } = require('./helpers');

let srv; let browser; let target;
test.before(async () => {
  srv = await startServer(); browser = await launch();
  const { page, context } = await openApp(browser, srv.base, '?hub=500064');
  target = await threeWay(page);
  await context.close();
});
test.after(async () => { await browser.close(); srv.server.close(); });

const SIZES = [[768, 1024], [1280, 720], [1440, 900]];
const ALL_FOUR = ['sender', 'nearest EVT', 'my center', 'CSC/TSC-level'];

// A hospital with three different far ends: nearest documented 24/7 EVT
// center, nearest CSC/TSC-level center and my center (Harborview), the last
// hundreds of miles away. Of those, the one whose CSC/TSC-level center lies
// farthest outside the box of the other three points, so a fit that left that
// line out would leave its end off the map.
async function threeWay(page) {
  return pick(page, (S) => {
    const hub = S.byId.get('500064').location;
    let best = null;
    for (const x of S.all.filter(y => !y.outOfRegion && y.location)) {
      const a = S.access[x.id];
      if (a.evt247.status !== 'ok' || a.advanced.status !== 'ok' || !a.hub || a.hub.status !== 'ok' || a.hub.miles < 300) continue;
      if (new Set([a.evt247.dest.id, a.advanced.dest.id, '500064']).size !== 3) continue;
      const box = [x.location, a.evt247.dest.location, hub];
      const lat = box.map(p => p.lat); const lng = box.map(p => p.lng);
      const q = a.advanced.dest.location;
      const out = Math.max(0, Math.min(...lat) - q.lat, q.lat - Math.max(...lat)) + Math.max(0, Math.min(...lng) - q.lng, q.lng - Math.max(...lng));
      if (!best || out > best.out) best = { id: x.id, name: x.name, out };
    }
    return best && best.out > 1 ? best : null;
  });
}

function assertClear(pts, label) {
  assert.deepEqual(pts.map(p => p.what), ALL_FOUR, `${label}: every line drawn, the CSC/TSC-level one included`);
  for (const p of pts) {
    assert.ok(p.inMap, `${label}: ${p.what} inside the map`);
    assert.deepEqual(p.under, [], `${label}: ${p.what} not under a panel`);
  }
}

test('a hospital with three distinct destinations exists', () => {
  assert.ok(target, 'nearest EVT, nearest CSC/TSC-level and my center all differ');
});

for (const [w, h] of SIZES) {
  test(`share link with the CSC/TSC-level line: the fit on load holds all four ends at ${w}×${h}; a collapsed legend comes back`, async () => {
    const { page, context, errors } = await openApp(browser, srv.base, `?hub=500064&h=${target.id}&adv=1`, { viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    await page.waitForSelector('#detail:not([hidden])');
    await frames(page);
    assert.equal(await page.getAttribute('#detail-actions [data-act="adv-line"]', 'aria-pressed'), 'true');
    assert.equal(await page.$eval('#detail', d => d.hidden), false, 'the details stay open');
    assertClear(await endpointsClear(page), `link at ${w}×${h}`);
    // Where the map was too cramped the fit folded the legend for this view
    // only: the saved choice is untouched and closing the details restores it.
    const lg = await page.evaluate(() => ({ collapsed: document.querySelector('#legend').classList.contains('collapsed'),
      expanded: document.querySelector('#legend-toggle').getAttribute('aria-expanded'), saved: window.__strokeAtlas.prefs.legend,
      stored: (() => { try { return localStorage.getItem('stroke-atlas-prefs-v4'); } catch { return 'unreadable'; } })() }));
    assert.equal(lg.expanded, String(!lg.collapsed), 'the toggle says what the legend shows');
    // 1280×720 is too cramped for the legend beside these lines; the fold must happen there.
    if (w === 1280) assert.equal(lg.collapsed, true, 'the fit folded the legend to keep the ends clear');
    assert.equal(lg.saved, true, 'the saved legend choice is unchanged');
    assert.equal(lg.stored, null, 'nothing was written to the saved preferences');
    await page.click('#detail-close');
    await frames(page);
    assert.equal(await page.$eval('#legend', n => n.classList.contains('collapsed')), false, 'the legend is back once the details close');
    assert.equal(await page.getAttribute('#legend-toggle', 'aria-expanded'), 'true');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test(`selection from the list fits at once; turning on the CSC/TSC-level line and Fit connections keep all four ends clear at ${w}×${h}`, async () => {
    const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064', { viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    // Start far from the hospital, so only a fit can bring its lines into view.
    await page.selectOption('#jump', 'AK');
    await search(page, target.name);
    await page.click(`#results .result[data-id="${target.id}"]`);
    await page.waitForSelector('#detail:not([hidden])');
    await frames(page);
    const auto = await endpointsClear(page);
    assert.deepEqual(auto.map(p => p.what), ['sender', 'nearest EVT', 'my center'], 'a new selection starts without the CSC/TSC-level line');
    for (const p of auto) {
      assert.ok(p.inMap, `automatic fit at ${w}×${h}: ${p.what} inside the map`);
      assert.deepEqual(p.under, [], `automatic fit at ${w}×${h}: ${p.what} not under a panel`);
    }
    await page.click('#detail-actions [data-act="adv-line"]');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'adv-line', 'focus stays on the toggle');
    await page.click('#detail-actions [data-act="fit"]');
    await frames(page);
    assertClear(await endpointsClear(page), `Fit connections at ${w}×${h}`);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

// Phones, portrait and short landscape: the details cover the map, so the
// ends are checked once "Show on map" has put them away. The panels there
// (search bar, jump menu, legend, status bar) can take more than 60% of a
// dimension; the fit keeps their full padding and zooms out instead.
for (const [w, h] of [[320, 568], [390, 844], [667, 375], [844, 390]]) {
  test(`phone ${w}×${h}: "Show on map" with the CSC/TSC-level line holds all four ends clear of every panel; the legend sits above the status bar`, async () => {
    const { page, context, errors } = await openApp(browser, srv.base, `?hub=500064&h=${target.id}&adv=1`, { viewport: { width: w, height: h }, reducedMotion: 'reduce', mobile: true, touch: true });
    await page.waitForSelector('#detail:not([hidden])');
    await page.click('#detail-actions [data-act="fit"]');
    await page.waitForFunction(() => document.querySelector('#detail').hidden);
    await frames(page);
    assertClear(await endpointsClear(page), `Show on map at ${w}×${h}`);
    assert.equal(await page.evaluate(() => window.__strokeAtlas.fitShort), false, 'the fit held everything; no note');
    // The legend is placed from the status bar's measured height (it wraps at 320 px).
    const g = await page.evaluate(() => {
      const s = document.querySelector('#map-status').getBoundingClientRect();
      const l = document.querySelector('#legend').getBoundingClientRect();
      return { statusTop: s.top, statusH: s.height, legendBottom: l.bottom };
    });
    assert.ok(g.legendBottom <= g.statusTop, `legend (bottom ${g.legendBottom}) above the status bar (top ${g.statusTop}, ${g.statusH} px tall)`);
    assert.ok(g.statusTop - g.legendBottom <= 12, 'and just above it, not a fixed gap');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /^Details: /);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

// Per state, the located hospital farthest from my center whose nearest
// documented 24/7 EVT center is another campus: the widest spans, where the
// panels' padding matters most on a phone.
async function farthest(page) {
  return pick(page, (S) => ['WA', 'AK', 'ID', 'MT', 'WY'].map(st => S.all
    .filter(x => !x.outOfRegion && x.location && x.state === st && S.access[x.id].evt247.status === 'ok' && S.access[x.id].evt247.dest.id !== '500064' && S.access[x.id].hub.status === 'ok')
    .sort((a, b) => S.access[b.id].hub.miles - S.access[a.id].hub.miles)[0]).filter(Boolean).map(h => ({ id: h.id, name: h.name, state: h.state })));
}
for (const [w, h] of [[320, 568], [667, 375], [844, 390]]) {
  test(`phone ${w}×${h}: the widest spans in each state fit clear of the panels, or the status bar says they do not`, async () => {
    const probe = await openApp(browser, srv.base, '?hub=500064');
    const spokes = await farthest(probe.page);
    await probe.context.close();
    assert.equal(spokes.length, 5);
    let clear = 0;
    for (const s of spokes) {
      const { page, context, errors } = await openApp(browser, srv.base, `?hub=500064&h=${s.id}`, { viewport: { width: w, height: h }, reducedMotion: 'reduce', mobile: true, touch: true });
      await page.waitForSelector('#detail:not([hidden])');
      await page.click('#detail-actions [data-act="fit"]');
      await page.waitForFunction(() => document.querySelector('#detail').hidden);
      await frames(page);
      const pts = await endpointsClear(page);
      assert.deepEqual(pts.map(p => p.what), ['sender', 'nearest EVT', 'my center'], `${s.state} ${s.name}: both lines drawn`);
      const hidden = pts.filter(p => !p.inMap || p.under.length);
      const note = await page.evaluate(() => /Not every connection end fits clear of the map panels/.test(document.querySelector('#map-status').textContent));
      if (hidden.length) assert.equal(note, true, `${s.state} ${s.name}: ${hidden.map(p => p.what + ' under ' + p.under.join('+')).join('; ')} — and the status bar does not say so`);
      else { clear++; assert.equal(note, false, `${s.state} ${s.name}: everything fits, so no note`); }
      assert.ok(pts.every(p => p.inMap), `${s.state} ${s.name}: every end is at least on the map`);
      assert.deepEqual(errors, []);
      await context.close();
    }
    assert.ok(clear >= 3, `most of the widest spans fit clear (${clear} of ${spokes.length})`);
  });
}

test('with motion on, the fit on selection animates and, once Leaflet reports moveend, every end is clear', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064', { viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), false);
  await search(page, target.name);
  // Count the moves from here; the fit is done when one has ended and no zoom or pan is still running.
  await page.evaluate(() => {
    const m = window.__strokeAtlas.map;
    window.__moves = { start: 0, end: 0, anim: 0 };
    m.on('movestart', () => window.__moves.start++);
    m.on('moveend', () => window.__moves.end++);
    m.on('zoomanim', () => window.__moves.anim++);
  });
  await page.click(`#results .result[data-id="${target.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  await page.waitForFunction(() => {
    const m = window.__strokeAtlas.map;
    return window.__moves.end > 0 && window.__moves.end >= window.__moves.start && !m._animatingZoom && !(m._panAnim && m._panAnim._inProgress);
  }, null, { timeout: 15000 });
  await frames(page);
  assert.ok(await page.evaluate(() => window.__moves.anim) > 0, 'the zoom was animated, not set at once');
  const pts = await endpointsClear(page);
  assert.deepEqual(pts.map(p => p.what), ['sender', 'nearest EVT', 'my center']);
  for (const p of pts) {
    assert.ok(p.inMap, `animated fit: ${p.what} inside the map`);
    assert.deepEqual(p.under, [], `animated fit: ${p.what} not under a panel`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('where the panels leave no clear room, the fit says so in the status bar instead of pretending', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064', { viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  // A status bar grown over nearly all of the map (as very large text could make it).
  await page.addStyleTag({ content: '#map-status { width: calc(100% - 40px) !important; max-width: none !important; height: calc(100% - 40px) !important; }' });
  await search(page, target.name);
  await page.click(`#results .result[data-id="${target.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  await frames(page);
  await page.waitForFunction(() => window.__strokeAtlas.fitShort === true);
  assert.match(await page.textContent('#map-status'), /Not every connection end fits clear of the map panels at this size/);
  await page.click('#detail-close');
  await frames(page);
  assert.doesNotMatch(await page.textContent('#map-status'), /Not every connection end fits/, 'the note goes with the selection');
  assert.deepEqual(errors, []);
  await context.close();
});

test('selecting from the access review and the distance table fits at once, as the list does', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064&scope=all', { viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await page.selectOption('#jump', 'AK');
  await page.click('#tab-explore');
  await page.click('#open-review');
  await page.waitForSelector('#dlg-review[open]');
  const name = await page.textContent('#rp-ranked tbody tr:not([hidden]) td:nth-child(2) button');
  await page.click('#rp-ranked tbody tr:not([hidden]) td:nth-child(2) button');
  await page.waitForSelector('#detail:not([hidden])');
  await frames(page);
  assert.equal(await page.textContent('#detail-title'), name);
  for (const p of await endpointsClear(page)) {
    assert.ok(p.inMap, `review: ${p.what} inside the map`);
    assert.deepEqual(p.under, [], `review: ${p.what} not under a panel`);
  }
  await page.click('#detail-close');
  await page.selectOption('#jump', 'AK');
  await page.click('#tab-explore');
  await page.click('#open-matrix');
  await page.waitForSelector('#dlg-matrix[open]');
  await page.click('#matrix-table .th-sort[data-sort="evtMi"]');
  await page.keyboard.press('Enter'); // farthest first
  const far = await page.textContent('#matrix-table tbody tr:first-child th button');
  await page.click('#matrix-table tbody tr:first-child th button');
  await page.waitForSelector('#detail:not([hidden])');
  await frames(page);
  assert.equal(await page.textContent('#detail-title'), far);
  for (const p of await endpointsClear(page)) {
    assert.ok(p.inMap, `distance table: ${p.what} inside the map`);
    assert.deepEqual(p.under, [], `distance table: ${p.what} not under a panel`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});
