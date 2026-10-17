'use strict';
// My receiving center, connection lines, Fit connections and differentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search, pick, frames } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

async function lineCount(page) {
  return page.evaluate(() => { let n = 0; window.__strokeAtlas.lineLayer.eachLayer(l => { if (l.getLatLngs) n++; }); return n; });
}

test('Harborview preset sets my center; detail shows distances and a same-metric comparison', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '', { reducedMotion: 'reduce' });
  await page.click('#tab-explore');
  assert.ok(await page.isVisible('#hub-preset'), 'Harborview preset offered');
  await page.click('#hub-preset');
  assert.match(await page.textContent('#hub-current'), /Harborview/);
  // A hospital whose nearest documented 24/7 EVT center is not Harborview.
  const spoke = await pick(page, (S) => {
    const h = S.all.find(x => !x.outOfRegion && x.location && x.state === 'WA' && S.access[x.id].evt247.status === 'ok'
      && S.access[x.id].evt247.dest.id !== '500064' && S.access[x.id].hub.miles > S.access[x.id].evt247.miles + 30);
    return h && { id: h.id, name: h.name };
  });
  assert.ok(spoke, 'found a spoke with a nearer EVT center than Harborview');
  await page.click('#tab-find');
  await search(page, spoke.name);
  await page.click(`#results .result[data-id="${spoke.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  const text = await page.textContent('#detail-body');
  assert.match(text, /My receiving center/);
  assert.match(text, /mi straight-line compared with the nearest documented 24\/7 EVT center/);
  assert.equal(await lineCount(page), 2, 'line to nearest EVT and line to my center');
  // Fit connections: both endpoints visible and not hidden under the detail panel.
  await page.click('#detail-actions button:has-text("Fit connections")');
  await frames(page);
  const geo = await page.evaluate((id) => {
    const S = window.__strokeAtlas;
    const h = S.byId.get(id);
    const pts = [h, S.access[id].evt247.dest, S.byId.get(S.ui.hub)].map(x => S.map.latLngToContainerPoint([x.location.lat, x.location.lng]));
    const map = S.map.getContainer().getBoundingClientRect();
    const det = document.querySelector('#detail').getBoundingClientRect();
    return { pts: pts.map(p => ({ x: p.x + map.left, y: p.y + map.top })), map: { l: map.left, r: map.right, t: map.top, b: map.bottom }, det: { l: det.left } };
  }, spoke.id);
  for (const p of geo.pts) {
    assert.ok(p.x >= geo.map.l && p.x <= geo.map.r && p.y >= geo.map.t && p.y <= geo.map.b, 'endpoint inside the map');
    assert.ok(p.x < geo.det.l, 'endpoint not under the detail panel');
  }
  assert.ok(!(await page.isHidden('#detail')), 'detail stays open on desktop');
  assert.deepEqual(errors, []);
  await context.close();
});

test('when my center is the nearest 24/7 EVT center, the difference is zero and one line is drawn', async () => {
  // Find a pair in the data: a hospital whose nearest documented 24/7 EVT
  // center is another in-region campus, then make that campus "my center".
  const probe = await openApp(browser, srv.base);
  const pair = await pick(probe.page, (S, C) => {
    const h = S.all.find(x => !x.outOfRegion && x.location && S.access[x.id].evt247.status === 'ok'
      && !S.access[x.id].evt247.dest.outOfRegion && C.canBeDestination(S.access[x.id].evt247.dest));
    return h && { id: h.id, name: h.name, hub: S.access[h.id].evt247.dest.id };
  });
  await probe.context.close();
  assert.ok(pair, 'some hospital has an in-region nearest 24/7 EVT center');
  const { page, context } = await openApp(browser, srv.base, '?hub=' + encodeURIComponent(pair.hub));
  const near = { id: pair.id, name: pair.name };
  await search(page, near.name);
  await page.click(`#results .result[data-id="${near.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  assert.match(await page.textContent('#detail-body'), /also the nearest documented 24\/7 EVT center \(difference 0 mi\)/);
  assert.equal(await lineCount(page), 1);
  await context.close();
});

test('a hospital that is itself a 24/7 EVT center shows on-site 0 mi, not unknown', async () => {
  const { page, context } = await openApp(browser, srv.base, '?h=500064');
  await page.waitForSelector('#detail:not([hidden])');
  const rows = await page.$$eval('.access-row', rs => rs.map(r => r.textContent));
  assert.ok(rows.some(r => /0 mi/.test(r) && /On site/.test(r)), rows.join(' | '));
  await context.close();
});

test('no ground-transfer time across road networks; a shared local network keeps one', async () => {
  const { page, context } = await openApp(browser, srv.base);
  // Alaska ferry and isolated communities have their own networks, so any
  // origin whose nearest documented 24/7 EVT center lies on another network
  // must get no ground time (status not-connected), never a plausible number.
  const cut = await pick(page, (S) => {
    const h = S.all.find(x => x.location && x.roadNetwork && /ferry|isolated/.test(x.roadNetwork.value || '')
      && S.access[x.id].evt247.status === 'ok' && S.access[x.id].evt247.dest.roadNetwork.value !== x.roadNetwork.value);
    return h && h.id;
  });
  assert.ok(cut, 'an island or isolated site whose nearest EVT center is on another network');
  const leg = await pick(page, `(S, C) => C.legScenario('ground', S.byId.get('${cut}'), S.access['${cut}'].evt247.dest, S.access['${cut}'].evt247.miles)`);
  assert.equal(leg.minutes, null);
  assert.equal(leg.status, 'not-connected');
  const rotor = await pick(page, `(S, C) => C.legScenario('fixed', S.byId.get('${cut}'), S.access['${cut}'].evt247.dest, S.access['${cut}'].evt247.miles)`);
  assert.ok(rotor.minutes > 0, 'air scenarios do not depend on roads');
  // Two campuses in the same ferry-served town share its local roads.
  const local = await pick(page, (S, C) => {
    const xs = S.all.filter(x => x.location && x.roadNetwork && /-ferry$/.test(x.roadNetwork.value || ''));
    for (const a of xs) for (const b of xs) {
      if (a.id !== b.id && a.roadNetwork.value === b.roadNetwork.value) {
        return C.legScenario('ground', a, b, C.distanceBetween(a, b));
      }
    }
    return null;
  });
  if (local) assert.ok(local.minutes > 0 && local.status === 'scenario', JSON.stringify(local));
  await context.close();
});

// The scenario table in the details, as shown, for a sender whose nearest
// documented 24/7 EVT center and my center lie on other road networks.
test('detail scenario table: no ground time across road networks, with the reason; air legs still shown; a shared network keeps ground', async () => {
  const probe = await openApp(browser, srv.base, '?hub=500064');
  const cut = await pick(probe.page, (S, C) => {
    const rotorMax = C.TRANSPORT_DEFAULTS.rotorMaxMi;
    const h = S.all.find(x => x.location && !x.outOfRegion && x.roadNetwork && S.access[x.id].evt247.status === 'ok'
      && S.access[x.id].evt247.dest.id !== '500064' && S.access[x.id].evt247.miles <= rotorMax
      && C.groundFeasibility(x, S.access[x.id].evt247.dest).status === 'not-connected' && C.groundFeasibility(x, S.byId.get('500064')).status === 'not-connected');
    return h && { id: h.id, from: h.roadNetwork.value, to: S.access[h.id].evt247.dest.roadNetwork.value, hub: S.byId.get('500064').roadNetwork.value };
  });
  const joined = await pick(probe.page, (S, C) => {
    const h = S.all.find(x => x.location && !x.outOfRegion && S.access[x.id].evt247.status === 'ok' && S.access[x.id].evt247.dest.id !== '500064'
      && C.groundFeasibility(x, S.access[x.id].evt247.dest).status === 'feasible');
    return h && h.id;
  });
  await probe.context.close();
  assert.ok(cut, 'a sender off the road network of its nearest EVT center (within rotor-wing range) and of Harborview');
  assert.ok(joined);
  const { page, context, errors } = await openApp(browser, srv.base, `?hub=500064&h=${cut.id}`);
  await page.waitForSelector('#detail:not([hidden])');
  const t = await page.evaluate(() => {
    const tbl = document.querySelector('#detail-body table.scenario');
    return { head: Array.from(tbl.querySelectorAll('thead th')).map(th => th.textContent),
      rows: Array.from(tbl.querySelectorAll('tbody tr')).map(r => ({ leg: r.querySelector('th').textContent, cells: Array.from(r.querySelectorAll('td')).map(td => ({ text: td.textContent, title: td.getAttribute('title') })) })),
      hint: tbl.closest('.table-wrap').nextElementSibling.textContent, body: document.querySelector('#detail-body').textContent };
  });
  assert.deepEqual(t.head, ['Leg', 'Nearest documented 24/7 EVT', 'My center']);
  const row = (re) => t.rows.find(r => re.test(r.leg));
  const ground = row(/^Ground ambulance/);
  const why = `No road connection between these sites in the network model (${cut.from} vs ${cut.to})`;
  assert.deepEqual(ground.cells[0], { text: '—', title: why }, 'no ground time to the nearest EVT center, and why');
  assert.equal(ground.cells[1].text, '—');
  assert.equal(ground.cells[1].title, `No road connection between these sites in the network model (${cut.from} vs ${cut.hub})`);
  assert.match(t.hint, new RegExp(`Nearest documented 24/7 EVT, ground: ${why.replace(/[()]/g, '\\$&')}\\.`), 'the reason is also in the text under the table');
  const rotor = row(/^Rotor-wing/);
  assert.match(rotor.cells[0].text, /^\d/, 'rotor-wing scenario within range: a time');
  assert.match(rotor.cells[0].title, /Assumes an aircraft and flyable weather/);
  const fixed = row(/^Fixed-wing/);
  assert.ok(fixed.cells.every(c => /^\d/.test(c.text)), 'fixed-wing scenarios do not depend on roads');
  assert.match(t.body, /Ground: comparison unavailable — /, 'the minute comparison with my center says ground is unavailable');
  assert.deepEqual(errors, []);
  await context.close();

  const shared = await openApp(browser, srv.base, `?h=${joined}`);
  await shared.page.waitForSelector('#detail:not([hidden])');
  const g = await shared.page.evaluate(() => Array.from(document.querySelectorAll('#detail-body table.scenario tbody tr')).find(r => /^Ground ambulance/.test(r.querySelector('th').textContent)).querySelector('td').textContent);
  assert.match(g, /^\d/, 'a shared road network gives a ground time');
  await shared.context.close();
});
