'use strict';
// Cartography: the chooser for markers that overlap at this zoom, fixed
// screen offsets for campuses that share coordinates, and the jump menu.
/* global METRO -- app.js's metro areas, a top-level const the page can name. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, frames } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

// Screen centre of each drawn hospital marker, from the rendered icons.
const markerCentres = (page) => page.evaluate(() => {
  const S = window.__strokeAtlas;
  const out = [];
  for (const [id, mk] of S.markers) {
    if (!S.markerLayer.hasLayer(mk)) continue;
    const b = mk.getElement().getBoundingClientRect();
    out.push({ id, name: S.byId.get(id).name, x: b.left + b.width / 2, y: b.top + b.height / 2 });
  }
  return out;
});

test('crowded markers: a click opens a chooser, focus goes into it, choosing selects, Escape returns to the map', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?scope=all', { reducedMotion: 'reduce' });
  // A spot where markers overlap and the top one is what a click there hits.
  const centres = await markerCentres(page);
  const spot = await page.evaluate((centres) => {
    const S = window.__strokeAtlas;
    for (const c of centres) {
      if (!S.stacks.has(c.id)) continue;
      const icon = document.elementFromPoint(c.x, c.y);
      if (!icon || !icon.closest('.leaflet-marker-icon') || icon.closest('.stack-badge')) continue;
      if (S.markers.get(c.id).getElement() !== icon.closest('.leaflet-marker-icon')) continue;
      return c;
    }
    return null;
  }, centres);
  assert.ok(spot, 'some markers overlap at the default view');
  // Hospitals drawn within the click tolerance (13 px) of that point.
  const here = centres.filter(c => (c.x - spot.x) ** 2 + (c.y - spot.y) ** 2 <= 13 * 13).map(c => c.name).sort();
  assert.ok(here.length >= 2, here.join(' | '));

  await page.mouse.click(spot.x, spot.y);
  await page.waitForSelector('.leaflet-popup .chooser');
  await page.waitForFunction(() => !!document.activeElement.closest('.chooser'));
  const box = await page.evaluate(() => {
    const c = document.querySelector('.chooser');
    return { role: c.getAttribute('role'), label: c.getAttribute('aria-label'), title: c.querySelector('h3').textContent,
      names: Array.from(c.querySelectorAll('button')).map(b => b.textContent),
      small: Array.from(document.querySelectorAll('.chooser button, .leaflet-popup-close-button')).map(b => b.getBoundingClientRect()).filter(r => r.width < 24 || r.height < 24).length,
      focus: document.activeElement.textContent };
  });
  assert.equal(box.role, 'group');
  assert.equal(box.label, `${here.length} hospitals at this spot`);
  assert.equal(box.title, `${here.length} hospitals here`);
  assert.deepEqual(box.names.slice().sort(), here, 'every overlapping hospital is offered');
  assert.equal(box.focus, box.names[0], 'focus on the first choice');
  assert.equal(box.small, 0, 'choices and the close button are at least 24×24');
  assert.equal(await page.evaluate(() => window.__strokeAtlas.ui.selected), null, 'nothing chosen silently');

  await page.keyboard.press('Escape');
  await page.waitForSelector('.leaflet-popup', { state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'map', 'focus returns to the map');
  assert.equal(await page.$eval('#detail', d => d.hidden), true);

  // Choosing by keyboard selects that hospital and opens its details.
  await page.mouse.click(spot.x, spot.y);
  await page.waitForFunction(() => !!document.activeElement.closest('.chooser'));
  await page.keyboard.press('Tab');
  const pick = await page.evaluate(() => document.activeElement.textContent);
  assert.equal(pick, box.names[1], 'Tab moves through the choices');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#detail:not([hidden])');
  await page.waitForFunction(() => document.activeElement.id === 'detail-title');
  assert.equal(await page.textContent('#detail-title'), pick);
  assert.equal(await page.evaluate(() => window.__strokeAtlas.byId.get(window.__strokeAtlas.ui.selected).name), pick);
  assert.equal(await page.$('.leaflet-popup'), null, 'the chooser closed');
  assert.deepEqual(errors, []);
  await context.close();
});

test('campuses at the same coordinates get distinct fixed offsets, keep their true coordinates, and each can be clicked', async () => {
  const ids = ['OR-LEGACY-EMANUEL', 'OR-OHSU'];
  const { page, context, errors } = await openApp(browser, srv.base, '', { reducedMotion: 'reduce' });
  const same = await page.evaluate((ids) => ids.map(id => window.__strokeAtlas.byId.get(id).location).map(l => `${l.lat},${l.lng}`), ids);
  assert.equal(same[0], same[1], 'the data places both at one point');
  const g = await page.evaluate((ids) => {
    const S = window.__strokeAtlas;
    return ids.map(id => { const mk = S.markers.get(id); const ll = mk.getLatLng(); const h = S.byId.get(id); return { onMap: S.markerLayer.hasLayer(mk), off: S.offsets.get(id), trueLL: ll.lat === h.location.lat && ll.lng === h.location.lng }; });
  }, ids);
  for (const m of g) {
    assert.equal(m.onMap, true, 'drawn while neighboring-state centers are shown');
    assert.equal(m.trueLL, true, 'the marker keeps the recorded coordinates');
    assert.ok(m.off && Math.hypot(m.off[0], m.off[1]) >= 8, `a visible offset ${m.off}`);
  }
  assert.notDeepEqual(g[0].off, g[1].off);
  // Close in on the point so nothing else is within a click of either.
  await page.evaluate((id) => { const S = window.__strokeAtlas; const l = S.byId.get(id).location; S.map.setView([l.lat, l.lng], 12, { animate: false }); }, ids[0]);
  await frames(page);
  for (const id of ids) {
    const c = (await markerCentres(page)).find(x => x.id === id);
    const other = (await markerCentres(page)).find(x => x.id === ids.find(y => y !== id));
    assert.ok(Math.hypot(c.x - other.x, c.y - other.y) >= 16, 'the two markers sit apart on screen');
    await page.mouse.click(c.x, c.y);
    await page.waitForFunction((id) => window.__strokeAtlas.ui.selected === id && !document.querySelector('#detail').hidden, id);
    assert.equal(await page.$('.leaflet-popup'), null, 'selected directly, no chooser');
    await page.click('#detail-close');
    await frames(page);
  }
  assert.deepEqual(errors, []);
  await context.close();
  // With neighboring-state centers left out they are not drawn at all.
  const off = await openApp(browser, srv.base, '?nb=0');
  const drawn = await off.page.evaluate((ids) => ids.map(id => { const S = window.__strokeAtlas; const mk = S.markers.get(id); return !!(mk && S.markerLayer.hasLayer(mk)); }), ids);
  assert.deepEqual(drawn, [false, false]);
  await off.context.close();
});

test('jump menu: each option shows its located-record count and moves the map to bounds holding those records; arrow keys only choose', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '', { reducedMotion: 'reduce' });
  const opts = await page.$$eval('#jump option', os => os.filter(o => o.value).map(o => ({ value: o.value, text: o.textContent })));
  assert.ok(opts.length >= 15, opts.length + ' options');
  // Expected members, counted from the records and each area's definition.
  const expected = await page.evaluate(() => {
    const S = window.__strokeAtlas; const C = window.StrokeCore;
    const located = S.all.filter(h => !h.outOfRegion && h.location);
    const out = { all: located, contig: located.filter(h => h.state !== 'AK') };
    for (const st of ['WA', 'AK', 'ID', 'MT', 'WY']) out[st] = located.filter(h => h.state === st);
    for (const m of METRO) out[m.key] = located.filter(h => C.haversineMi(m.lat, m.lng, h.location.lat, h.location.lng) <= m.mi);
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.map(h => [h.location.lat, h.location.lng])]));
  });
  let last = null;
  for (const o of opts) {
    const pts = expected[o.value];
    assert.ok(pts && pts.length > 0, `${o.value}: has records`);
    assert.match(o.text, new RegExp(`\\(${pts.length}\\)$`), `${o.text}: count of located records`);
    await page.selectOption('#jump', o.value);
    await frames(page);
    const v = await page.evaluate((pts) => {
      const S = window.__strokeAtlas;
      const b = S.map.getBounds();
      const c = S.map.getCenter();
      return { outside: pts.filter(p => !b.contains(p)).length, view: `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${S.map.getZoom()}` };
    }, pts);
    assert.equal(v.outside, 0, `${o.value}: every record inside the map`);
    assert.notEqual(v.view, last, `${o.value}: the map moved`);
    last = v.view;
  }
  // Keyboard: arrows on the closed menu choose without moving; Enter applies.
  await page.selectOption('#jump', 'AK');
  await frames(page);
  const view = () => page.evaluate(() => { const S = window.__strokeAtlas; const c = S.map.getCenter(); return `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${S.map.getZoom()}`; });
  const atAK = await view();
  await page.focus('#jump');
  await page.keyboard.press('ArrowDown');
  await frames(page);
  assert.equal(await page.$eval('#jump', s => s.value), 'WA');
  assert.equal(await view(), atAK, 'an arrow key alone does not move the map');
  await page.keyboard.press('Enter');
  await frames(page);
  const atWA = await view();
  assert.notEqual(atWA, atAK, 'Enter applies the choice');
  const outside = await page.evaluate((pts) => pts.filter(p => !window.__strokeAtlas.map.getBounds().contains(p)).length, expected.WA);
  assert.equal(outside, 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'jump', 'focus stays on the menu');
  assert.deepEqual(errors, []);
  await context.close();
});
