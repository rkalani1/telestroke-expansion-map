'use strict';
// A closed campus (served from a fixture: the current data has none) renders
// as closed, is outside the analysis set, and is never a destination: not
// offered as my center, never anyone's nearest center, not in Nearby lists.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search, frames, recordFixture } = require('./helpers');

let srv; let browser; let ctx; let page; let errors;
const fx = recordFixture();
const closed = fx.closed;
test.before(async () => {
  srv = await startServer(); browser = await launch();
  ({ context: ctx, page, errors } = await openApp(browser, srv.base, '?hub=500064', { routes: [fx.route] }));
});
test.after(async () => { await ctx.close(); await browser.close(); srv.server.close(); });

// Cells of the distance table's destination columns (by their sort keys), with scope "all records".
async function matrixColumns(keys) {
  await page.click('#tab-explore');
  await page.click('#open-matrix');
  await page.waitForSelector('#dlg-matrix[open]');
  const cols = await page.evaluate((keys) => {
    const head = Array.from(document.querySelectorAll('#matrix-table thead th')).map(t => t.querySelector('button').dataset.sort);
    const rows = Array.from(document.querySelectorAll('#matrix-table tbody tr'));
    return Object.fromEntries(keys.map(k => [k, rows.map(r => [r.querySelector('th').textContent, r.children[head.indexOf(k)].textContent])]));
  }, keys);
  await page.keyboard.press('Escape');
  await page.click('#tab-find');
  return cols;
}

test('the fixture closes a 24/7 EVT center that was the nearest one for several hospitals', () => {
  assert.ok(closed.dependents.length >= 3, closed.dependents.join(','));
  assert.ok(closed.nearbyBefore.length > 0, 'it appeared in some Nearby lists before');
});

test('listed as closed only when searched or with all records; outside the analysis set', async () => {
  assert.equal(await page.$(`#results .result[data-id="${closed.id}"]`), null, 'not in the default (analysis set) list');
  await search(page, closed.name);
  const b = await page.$$eval(`#results .result[data-id="${closed.id}"] .badge`, bs => bs.map(x => x.textContent));
  assert.ok(b.includes('Closed'), b.join(' | '));
  assert.ok(!b.includes('Eligibility unresolved'));
  await page.click(`#results .result[data-id="${closed.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  const d = await page.evaluate(() => ({
    status: Array.from(document.querySelectorAll('#detail-body .claim')).find(c => c.querySelector('dt').textContent === 'Status').querySelector('.c-value').textContent,
    banner: document.querySelector('#detail-body .status-banner').textContent,
    actions: Array.from(document.querySelectorAll('#detail-actions button')).map(x => x.dataset.act),
  }));
  assert.equal(d.status, 'Closed');
  assert.match(d.banner, /Excluded: Not an active hospital campus \(closed\)/);
  assert.ok(!d.actions.includes('hub'), 'not offered as my receiving center');
  await page.click('#detail-close');
  await search(page, '');
  // The state table counts it as excluded, not in the analysis set.
  await page.click('#tab-explore');
  await page.selectOption('#summary-scope', 'all');
  const row = (label) => page.evaluate(([label, st]) => {
    const tbl = document.querySelector('#state-table table');
    const col = Array.from(tbl.querySelectorAll('thead th')).findIndex(t => t.textContent === st);
    const tr = Array.from(tbl.querySelectorAll('tbody tr')).find(r => r.querySelector('th').textContent === label);
    return Number(tr.children[col].textContent);
  }, [label, closed.state]);
  const inState = fx.json.hospitals.filter(h => !h.outOfRegion && h.state === closed.state);
  assert.equal(await row('Excluded'), inState.filter(h => h.derived.eligibility.value === 'excluded').length);
  assert.equal(await row('Analysis set'), inState.filter(h => h.derived.eligibility.value === 'eligible').length);
  await page.selectOption('#summary-scope', 'results');
  await page.click('#tab-find');
});

test('never a destination: not offered as my center, nobody\'s nearest center, not in Nearby lists', async () => {
  const hubOptions = await page.$$eval('#hub-select option', os => os.map(o => o.value));
  assert.ok(hubOptions.length > 10);
  assert.ok(!hubOptions.includes(closed.id), 'not in the my-center list');
  // The destination set shrank by one, and says so.
  await page.click('#tab-explore');
  await page.check('input[name="mode"][value="evt-distance"]');
  await frames(page);
  assert.match(await page.textContent('#legend-body'), new RegExp(`Destinations: ${fx.evtCentersBefore - 1} documented 24/7 EVT centers in this dataset`));
  await page.check('input[name="mode"][value="capability"]');
  // Every hospital that used to name it now names another center.
  await page.click('#tab-find');
  await page.click('#filters > summary');
  await page.check('input[name="scope"][value="all"]');
  await frames(page);
  const cols = await matrixColumns(['evtCenter', 'advCenter']);
  for (const [label, cells] of Object.entries(cols)) {
    assert.ok(cells.length > 200, `${label}: the whole dataset is listed`);
    assert.ok(!cells.some(([, c]) => c === closed.name || c === `${closed.name} (neighboring state)`), `${label}: never the closed campus`);
  }
  const own = cols.evtCenter.find(([n]) => n === closed.name);
  assert.ok(own && own[1] !== 'On site (0 mi)', 'not even "on site" for itself');
  for (const id of closed.dependents) {
    const name = fx.json.hospitals.find(h => h.id === id).name;
    const cell = cols.evtCenter.find(([n]) => n === name);
    assert.ok(cell && cell[1] && cell[1] !== '—', `${name} names another center: ${cell && cell[1]}`);
  }
  // A Nearby list that showed it before no longer does.
  const dep = fx.json.hospitals.find(h => h.id === closed.nearbyBefore[0]);
  await search(page, dep.name);
  await page.click(`#results .result[data-id="${dep.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  const near = await page.$$eval('#detail-body .nearby .n-name', ns => ns.map(n => n.firstChild.textContent.trim()));
  assert.equal(near.length, 6);
  assert.ok(!near.includes(closed.name), near.join(' | '));
  const evt = await page.$eval('#detail-body .access-row .a-dest', b => b.textContent);
  assert.notEqual(evt, closed.name);
  await page.click('#detail-close');
  await search(page, '');
});

test('a link naming it as my center is set aside and reported', async () => {
  const { page: p, context } = await openApp(browser, srv.base, `?hub=${closed.id}`, { routes: [fx.route] });
  const st = await p.evaluate(() => ({ hub: window.__strokeAtlas.ui.hub, toast: document.querySelector('#toasts').textContent }));
  assert.equal(st.hub, null);
  assert.match(st.toast, /not recognised.*hub/);
  await context.close();
});

test('no runtime errors with a closed campus in the data', () => { assert.deepEqual(errors, []); });
