'use strict';
// Explore controls that change several settings at once: the access-review
// weights and their reset, the transport assumptions and their reset, and the
// three question presets. Each is checked on screen, in state and in the link.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, pick, frames } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

const params = (page) => page.evaluate(() => Object.fromEntries(new URL(location.href).searchParams));
// The link is saved shortly after a change; wait for the parameter to settle.
const linkHas = (page, key, value) => page.waitForFunction(([k, v]) => {
  const q = new URL(location.href).searchParams;
  return v === null ? !q.has(k) : q.get(k) === v;
}, [key, value], { timeout: 5000 });

test('access review: weights change the ranking and the link; "Reset weights" restores both and only the weights', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064');
  await page.click('#tab-explore');
  await page.click('#open-review');
  await page.waitForSelector('#dlg-review[open]');
  const defaults = await page.evaluate(() => window.StrokeCore.REVIEW_DEFAULTS);
  const ranking = () => page.$$eval('#rp-ranked tbody tr:not([hidden]) td:nth-child(2)', tds => tds.map(t => t.textContent).join('|'));
  const before = await ranking();
  await page.selectOption('#review-scope', 'all');
  await linkHas(page, 'rc', 'all');
  const scoped = await ranking();
  // Keyboard on the sliders, as a user would: the gap weight to its maximum, the EVT weight to zero.
  await page.focus('#rv-wGap');
  await page.keyboard.press('End');
  await page.focus('#rv-wEvt');
  await page.keyboard.press('Home');
  assert.equal(await page.textContent('output[for="rv-wGap"]'), '100');
  assert.equal(await page.textContent('output[for="rv-wEvt"]'), '0');
  await linkHas(page, 'wg', '100');
  await linkHas(page, 'we', '0');
  assert.notEqual(await ranking(), scoped, 'the ranking follows the weights');
  await page.click('#review-reset');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'review-reset', 'focus stays on the button');
  const st = await page.evaluate(() => ({ review: window.__strokeAtlas.ui.review, gap: document.querySelector('#rv-wGap').value, evt: document.querySelector('#rv-wEvt').value,
    outGap: document.querySelector('output[for="rv-wGap"]').textContent, scope: document.querySelector('#review-scope').value }));
  assert.deepEqual(st.review, defaults);
  assert.deepEqual([st.gap, st.evt, st.outGap], [String(defaults.wGap), String(defaults.wEvt), String(defaults.wGap)]);
  assert.equal(st.scope, 'all', 'the candidate scope is not a weight and stays');
  await linkHas(page, 'wg', null);
  await linkHas(page, 'we', null);
  assert.equal((await params(page)).rc, 'all');
  assert.equal(await ranking(), scoped, 'the ranking is back');
  await page.selectOption('#review-scope', 'results');
  assert.equal(await ranking(), before);
  assert.deepEqual(errors, []);
  await context.close();
});

test('access review: the stated candidate count is the ranked rows plus the shortlist, in both scopes', async () => {
  const { page, context } = await openApp(browser, srv.base, '?scope=all');
  await page.click('#tab-explore');
  await page.click('#open-review');
  await page.waitForSelector('#dlg-review[open]');
  for (const [scope, words] of [['results', 'current results'], ['all', 'the whole dataset']]) {
    await page.selectOption('#review-scope', scope);
    const r = await page.evaluate(() => ({ summary: document.querySelector('#review-summary').textContent,
      ranked: document.querySelectorAll('#rp-ranked tbody tr:not([hidden])').length, short: document.querySelectorAll('#rp-short tbody tr:not([hidden])').length,
      tabs: [document.querySelector('#rt-ranked').textContent, document.querySelector('#rt-short').textContent] }));
    const m = r.summary.match(/^Candidates from (.+?): (\d+) campuses in the analysis set without on-site documented 24\/7 EVT or a CSC\/TSC-level tier\. Of these, (\d+) ranked \(capability assessed\) · (\d+) on the verification shortlist/);
    assert.ok(m, r.summary);
    assert.equal(m[1], words);
    assert.equal(Number(m[2]), r.ranked + r.short, `${scope}: candidates = ranked + shortlist`);
    assert.equal(Number(m[3]), r.ranked);
    assert.equal(Number(m[4]), r.short);
    assert.match(r.tabs[0], new RegExp(`\\(${r.ranked}\\)$`));
    assert.match(r.tabs[1], new RegExp(`\\(${r.short}\\)$`));
  }
  await context.close();
});

test('transport assumptions: an edit reaches the scenario table and the link; "Reset assumptions" restores both', async () => {
  const probe = await openApp(browser, srv.base, '?hub=500064');
  const spoke = await pick(probe.page, (S) => {
    const h = S.all.find(x => !x.outOfRegion && x.location && x.state === 'WA' && S.access[x.id].evt247.status === 'ok' && S.access[x.id].evt247.dest.id !== '500064'
      && S.access[x.id].hub.miles > 100 && S.access[x.id].hub.miles < 140);
    return h && h.id;
  });
  await probe.context.close();
  assert.ok(spoke, 'a WA hospital within rotor-wing range of my center');
  const { page, context, errors } = await openApp(browser, srv.base, `?hub=500064&h=${spoke}`);
  await page.waitForSelector('#detail:not([hidden])');
  const defaults = await page.evaluate(() => window.StrokeCore.TRANSPORT_DEFAULTS);
  const table = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#detail-body table.scenario tbody tr'))
    .map(r => [r.querySelector('th').textContent.split(' ')[0], Array.from(r.querySelectorAll('td')).map(td => td.textContent)])));
  const t0 = await table();
  assert.deepEqual(t0.DIDO, [String(defaults.didoMin), String(defaults.didoMin)]);
  await page.click('#tab-explore');
  if (!(await page.$eval('#transport-card', d => d.open))) await page.click('#transport-card > summary');
  await page.fill('#tp-didoMin', '90');
  await page.press('#tp-didoMin', 'Tab');
  await page.fill('#tp-groundMph', '999'); // out of range: clamped to the documented maximum
  await page.press('#tp-groundMph', 'Tab');
  const max = await page.evaluate(() => window.StrokeCore.TRANSPORT_RANGES.groundMph[1]);
  assert.equal(await page.inputValue('#tp-groundMph'), String(max));
  await linkHas(page, 'dido', '90');
  await linkHas(page, 'gs', String(max));
  await frames(page);
  const t1 = await table();
  assert.deepEqual(t1.DIDO, ['90', '90']);
  assert.notDeepEqual(t1.Ground, t0.Ground, 'the ground scenario follows the speed');
  assert.match(await page.textContent('#detail-body'), new RegExp(`at ${max} mph`), 'the stated assumptions follow too');
  await page.click('#transport-reset');
  await frames(page);
  assert.deepEqual(await page.evaluate(() => window.__strokeAtlas.ui.transport), defaults);
  assert.equal(await page.inputValue('#tp-didoMin'), String(defaults.didoMin));
  assert.equal(await page.inputValue('#tp-groundMph'), String(defaults.groundMph));
  assert.match(await page.textContent('#toasts'), /Transport assumptions reset/);
  await linkHas(page, 'dido', null);
  await linkHas(page, 'gs', null);
  assert.deepEqual(await table(), t0, 'the scenario table is back');
  assert.deepEqual(errors, []);
  await context.close();
});

// What each preset sets, and the test each listed record must pass.
const PRESETS = {
  telestroke: { mode: 'evt-distance', scope: 'eligible', sort: 'evt', title: 'Telestroke access review' },
  evt: { mode: 'capability', scope: 'all', sort: 'tier', title: 'EVT capability assessment' },
  state: { mode: 'capability', scope: 'all', sort: 'name', title: 'State designation review' },
};
for (const [key, want] of Object.entries(PRESETS)) {
  test(`preset "${key}": sets its filters, mode and sort, in the link; clearing it puts the mode, scope and sort back`, async () => {
    const { page, context, errors } = await openApp(browser, srv.base, '');
    const rows = () => page.$$eval('#results .result', rs => rs.length);
    const view = () => page.evaluate(() => { const u = window.__strokeAtlas.ui; return { mode: u.mode, scope: u.scope, include: u.include.slice().sort(), sort: u.sort }; });
    const start = await rows();
    const startView = await view();
    await page.click('#tab-explore');
    await page.click(`.preset[data-preset="${key}"]`);
    await frames(page);
    const st = await page.evaluate(() => { const u = window.__strokeAtlas.ui; return { preset: u.preset, mode: u.mode, scope: u.scope, sort: u.sort }; });
    assert.deepEqual(st, { preset: key, mode: want.mode, scope: want.scope, sort: want.sort });
    assert.equal(await page.getAttribute(`.preset[data-preset="${key}"]`, 'aria-pressed'), 'true');
    assert.equal(await page.$$eval('.preset[aria-pressed="true"]', bs => bs.length), 1, 'one preset at a time');
    assert.match(await page.textContent('#preset-active'), new RegExp(`^${want.title}\\. `));
    assert.equal(await page.isChecked(`input[name="mode"][value="${want.mode}"]`), true);
    const n = await rows();
    assert.ok(n > 0 && n !== start, `the list changed (${start} → ${n})`);
    assert.match(await page.textContent('#toasts'), new RegExp(`Preset: ${want.title} — ${n} records`));
    // Every listed record is one the preset asks about.
    const ok = await page.evaluate((key) => {
      const S = window.__strokeAtlas; const C = window.StrokeCore;
      const ids = Array.from(document.querySelectorAll('#results .result')).map(r => r.dataset.id);
      const test = {
        telestroke: h => h.derived.eligibility.value === 'eligible' && !C.hasDocumented247Evt(h) && !C.isAdvancedCenter(h),
        evt: h => !h.outOfRegion && h.status.value === 'active',
        state: h => ['WA', 'ID', 'WY'].includes(h.state) && h.status.value === 'active',
      }[key];
      return ids.filter(id => !test(S.byId.get(id)));
    }, key);
    assert.deepEqual(ok, [], 'every row fits the preset\'s question');
    await linkHas(page, 'preset', key);
    const q = await params(page);
    if (want.mode !== 'capability') assert.equal(q.mode, want.mode);
    if (want.scope !== 'eligible') assert.equal(q.scope, want.scope);
    // A fresh page from this link frames the same question.
    const url = await page.evaluate(() => location.href);
    const again = await openApp(browser, '', url);
    assert.equal(await again.page.$$eval('#results .result', rs => rs.length), n);
    assert.equal(await again.page.getAttribute(`.preset[data-preset="${key}"]`, 'aria-pressed'), 'true');
    await again.context.close();
    // Pressing it again (or "Clear preset") lifts the preset's filter and puts
    // back the mode, scope and sort it set, none of which was changed since.
    if (key === 'evt') await page.click('#preset-active button:has-text("Clear preset")');
    else await page.click(`.preset[data-preset="${key}"]`);
    await frames(page);
    assert.equal(await page.evaluate(() => window.__strokeAtlas.ui.preset), null);
    assert.equal(await page.getAttribute(`.preset[data-preset="${key}"]`, 'aria-pressed'), 'false');
    assert.equal(await page.$eval('#preset-active', p => p.hidden), true);
    assert.deepEqual(await view(), startView, 'mode, scope and sort as before the preset');
    assert.equal(await page.isChecked(`input[name="mode"][value="${startView.mode}"]`), true);
    assert.equal(await page.inputValue('#sort'), startView.sort);
    await linkHas(page, 'preset', null);
    for (const k of ['mode', 'scope', 'sort']) await linkHas(page, k, null);
    assert.equal(await rows(), start, 'the starting list is back');
    // The list is what the remaining settings give, as a fresh page from the link shows.
    const cleared = await rows();
    const fresh = await openApp(browser, '', await page.evaluate(() => location.href));
    assert.equal(await fresh.page.$$eval('#results .result', rs => rs.length), cleared);
    await fresh.context.close();
    // "Reset filters" returns the starting list.
    await page.click('#tab-find');
    if (await page.isVisible('#reset-filters')) await page.click('#reset-filters');
    await frames(page);
    assert.equal(await rows(), start);
    assert.deepEqual(errors, []);
    await context.close();
  });
}
