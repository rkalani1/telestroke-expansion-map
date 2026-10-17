'use strict';
// Regressions for the fourth review round: focus after a control goes away
// with a re-render, a cleared preset putting the view back, counts of
// five-state records only, a CSC/TSC-level line setting with nothing to draw,
// wording that names the documented set and keeps the two "partly assessed"
// sets apart, the scope of an export naming its search, and a colour-vision
// ring that keeps its contrast on the map.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, readDownload, parseCsv, pick, search, frames } = require('./helpers');

let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

// What has focus: never <body>, and something shown and on top at its centre.
const focusNow = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const b = a.getBoundingClientRect();
  const top = b.width ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
  return { tag: a.tagName, id: a.id, act: a.dataset.act || null, preset: a.dataset.preset || null, text: a.textContent.trim().slice(0, 60),
    shown: !!top && (top === a || a.contains(top)), inert: !!a.closest('[inert]') };
});
const linkHas = (page, key, value) => page.waitForFunction(([k, v]) => {
  const q = new URL(location.href).searchParams;
  return v === null ? !q.has(k) : q.get(k) === v;
}, [key, value], { timeout: 5000 });

async function anyWa(page) {
  return pick(page, (S) => { const h = S.all.find(x => x.state === 'WA' && !x.outOfRegion && x.location && x.id !== '500064'); return { id: h.id, name: h.name }; });
}

for (const [w, h] of [[1024, 768], [390, 844]]) {
  test(`Shift+R with the details open at ${w}×${h}: the details are put away and focus goes to "Details: …", not <body>`, async () => {
    const phone = w < 768;
    const probe = await openApp(browser, srv.base);
    const rec = await anyWa(probe.page);
    await probe.context.close();
    const { page, context, errors } = await openApp(browser, srv.base, `?state=WA&h=${rec.id}`, { viewport: { width: w, height: h }, mobile: phone, touch: phone });
    await page.waitForSelector('#detail:not([hidden])');
    await page.focus('#detail-title');
    await page.keyboard.press('Shift+R');
    let f = await focusNow(page);
    assert.equal(f.act, 'details', `focus on the way back to the details (${f.tag} ${f.text})`);
    // The status bar is rebuilt by the render that follows; focus stays on its link.
    await frames(page);
    f = await focusNow(page);
    assert.equal(f.act, 'details', `still there after the re-render (${f.tag} ${f.text})`);
    assert.match(f.text, new RegExp(`^Details: ${rec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(f.shown && !f.inert, true, 'shown, on top and usable');
    assert.equal(await page.evaluate(() => window.__strokeAtlas.ui.state), 'ALL', 'the filters were reset');
    assert.equal(await page.evaluate(() => window.__strokeAtlas.ui.selected), rec.id, 'the selection is kept');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('"Reset filters" in the map status bar: once it is gone, focus goes to "Details: …" or the search, never <body>', async () => {
  // No selection: the search.
  const a = await openApp(browser, srv.base, '?state=WA', { viewport: { width: 1440, height: 900 } });
  await a.page.focus('#map-status [data-act="reset"]');
  await a.page.keyboard.press('Enter');
  await frames(a.page);
  let f = await focusNow(a.page);
  assert.equal(await a.page.$('#map-status [data-act="reset"]'), null, 'the link went with the filters');
  assert.equal(f.id, 'search', `focus on the search (${f.tag} ${f.text})`);
  assert.deepEqual(a.errors, []);
  await a.context.close();
  // Details put away on a tablet (a view shortcut): the way back to them.
  const probe = await openApp(browser, srv.base);
  const rec = await anyWa(probe.page);
  await probe.context.close();
  const { page, context, errors } = await openApp(browser, srv.base, `?state=WA&h=${rec.id}`, { viewport: { width: 1024, height: 768 } });
  await page.waitForSelector('#detail:not([hidden])');
  await page.focus('#detail-title');
  await page.keyboard.press('e');
  await page.waitForFunction(() => document.querySelector('#detail').hidden);
  await page.focus('#map-status [data-act="reset"]');
  await page.keyboard.press('Enter');
  await frames(page);
  f = await focusNow(page);
  assert.equal(f.act, 'details', `focus on "Details: …" (${f.tag} ${f.text})`);
  assert.equal(f.shown && !f.inert, true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('"Reset filters" beside the result count: focus moves to the filters summary when the button hides', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?state=WA');
  await page.focus('#reset-filters');
  await page.keyboard.press('Enter');
  await frames(page);
  assert.equal(await page.$eval('#reset-filters', b => b.hidden), true);
  const f = await focusNow(page);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#filters > summary')), true, `focus on the filters summary (${f.tag} ${f.text})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('"Clear preset": focus moves to that preset\'s button, and the mode, scope and sort it set go back unless changed since', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064');
  const view = () => page.evaluate(() => { const u = window.__strokeAtlas.ui; return { mode: u.mode, scope: u.scope, include: u.include.slice().sort(), sort: u.sort }; });
  const start = await view();
  await page.click('#tab-explore');
  await page.click('.preset[data-preset="telestroke"]');
  await frames(page);
  assert.deepEqual(await view(), { mode: 'evt-distance', scope: 'eligible', include: ['unknown'], sort: 'evt' });
  // The user changes the mode after applying the preset: that choice stays.
  await page.check('input[name="mode"][value="hub-distance"]');
  await frames(page);
  await page.focus('#preset-active button:has-text("Clear preset")');
  await page.keyboard.press('Enter');
  await frames(page);
  let f = await focusNow(page);
  assert.equal(f.preset, 'telestroke', `focus on the preset button (${f.tag} ${f.text})`);
  assert.equal(await page.getAttribute('.preset[data-preset="telestroke"]', 'aria-pressed'), 'false');
  assert.deepEqual(await view(), Object.assign({}, start, { mode: 'hub-distance' }), 'scope and sort back; the mode chosen since kept');
  await linkHas(page, 'sort', null);
  // One preset after another, then cleared: back to the view before the first.
  await page.check('input[name="mode"][value="capability"]');
  await page.click('.preset[data-preset="telestroke"]');
  await page.click('.preset[data-preset="state"]');
  await frames(page);
  assert.deepEqual(await view(), { mode: 'capability', scope: 'all', include: ['unknown'], sort: 'name' });
  await page.click('.preset[data-preset="state"]');
  await frames(page);
  assert.deepEqual(await view(), start, 'the view from before the first preset');
  f = await focusNow(page);
  assert.equal(f.preset, 'state', 'pressing the preset again keeps focus on it');
  // A preset that came with a link has nothing to put back: only its filter goes.
  const b = await openApp(browser, srv.base, '?preset=evt&scope=all&sort=tier');
  await b.page.click('#tab-explore');
  await b.page.click('#preset-active button:has-text("Clear preset")');
  await frames(b.page);
  assert.deepEqual(await b.page.evaluate(() => { const u = window.__strokeAtlas.ui; return [u.preset, u.scope, u.sort]; }), [null, 'all', 'tier']);
  await b.context.close();
  assert.deepEqual(errors, []);
  await context.close();
});

test('counts are of five-state records only: the State select, the 24/7 EVT checkbox and the chips agree; neighbors are counted apart', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?scope=all');
  if (!(await page.$eval('#filters', d => d.open))) await page.click('#filters > summary');
  await frames(page);
  const r = await page.evaluate(() => {
    const S = window.__strokeAtlas; const C = window.StrokeCore;
    const count = (sel) => Number(document.querySelector(sel).textContent.match(/\((\d+)\)\s*$/)[1]);
    return {
      inRegion: S.results.filter(h => !h.outOfRegion).length,
      neighbors: S.results.filter(h => h.outOfRegion).length,
      evtInRegion: S.results.filter(h => !h.outOfRegion && C.hasDocumented247Evt(h)).length,
      allStates: count('#f-state option[value="ALL"]'),
      anySystem: count('#f-system option[value=""]'),
      anyCah: count('#f-cah option[value=""]'),
      anyEvidence: count('#f-evidence option[value=""]'),
      evt: count('[data-count="evt"]'),
      chips: Array.from(document.querySelectorAll('#tier-chips .count')).reduce((a, n) => a + Number(n.textContent), 0),
      summary: document.querySelector('#result-summary').textContent,
    };
  });
  assert.ok(r.neighbors > 0, 'neighboring-state destinations are listed with "all records"');
  for (const k of ['allStates', 'anySystem', 'anyCah', 'anyEvidence', 'chips']) assert.equal(r[k], r.inRegion, `${k}: five-state records only`);
  assert.equal(r.evt, r.evtInRegion, 'the 24/7 EVT checkbox counts five-state records');
  assert.match(r.summary, new RegExp(`^${r.inRegion} of \\d+ records \\+ ${r.neighbors} neighboring-state destinations`), 'the summary says how many neighbors are listed besides');
  // Checking the box lists what its count said, plus the neighboring 24/7 EVT destinations named apart.
  await page.check('#f-evt');
  await frames(page);
  assert.equal(await page.evaluate(() => window.__strokeAtlas.results.filter(h => !h.outOfRegion).length), r.evt);
  assert.match(await page.textContent('#result-summary'), /neighboring-state destination/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('adv=1 for a selection with no separate CSC/TSC-level line is dropped, reported, and leaves the saved link', async () => {
  const probe = await openApp(browser, srv.base);
  const same = await pick(probe.page, (S) => {
    const h = S.all.find(x => !x.outOfRegion && x.location && S.access[x.id].evt247.status === 'ok' && S.access[x.id].advanced.status === 'ok'
      && S.access[x.id].advanced.dest.id === S.access[x.id].evt247.dest.id);
    return h && h.id;
  });
  await probe.context.close();
  assert.ok(same, 'a hospital whose nearest CSC/TSC-level center is its nearest documented 24/7 EVT center');
  // Its nearest CSC/TSC-level center is the EVT one; and a CSC itself (on site) has none to draw.
  for (const id of [same, '500064']) {
    const { page, context, errors } = await openApp(browser, srv.base, `?h=${id}&adv=1`);
    await page.waitForSelector('#detail:not([hidden])');
    const st = await page.evaluate(() => ({ adv: window.__strokeAtlas.ui.advLine, toast: document.querySelector('#toasts').textContent,
      button: !!document.querySelector('#detail-actions [data-act="adv-line"]') }));
    assert.equal(st.adv, false, `${id}: no CSC/TSC-level line to show`);
    assert.equal(st.button, false, `${id}: and no button for it`);
    assert.match(st.toast, /ignored \(.*adv/, `${id}: reported as ignored`);
    // The link the page saves keeps the selection and drops adv.
    await linkHas(page, 'adv', null);
    assert.equal(new URL(page.url()).searchParams.get('h'), id);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('"documented" names the set on the list, map labels, tooltips and the rings layer', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064');
  const spoke = await pick(page, (S) => {
    const h = S.all.find(x => !x.outOfRegion && x.location && x.state === 'WA' && S.access[x.id].evt247.status === 'ok' && S.access[x.id].evt247.dest.id !== '500064');
    return { id: h.id, name: h.name };
  });
  // A "24/7 EVT" left once every "documented 24/7 EVT" (any case) is taken out.
  const bare = (t) => /24\/7 EVT/.test(t.replace(/documented 24\/7 EVT/gi, ''));
  await search(page, 'harborview');
  const row = await page.textContent('#results .result[data-id="500064"]');
  assert.match(row, /Documented 24\/7 EVT/, 'the badge');
  assert.match(row, /documented 24\/7 EVT on site/, 'the distance line');
  assert.equal(bare(row), false, row);
  await search(page, spoke.name);
  const dist = await page.textContent(`#results .result[data-id="${spoke.id}"] .r-dist`);
  assert.match(dist, /^≈?[\d.]+ mi to documented 24\/7 EVT$/);
  await page.click(`#results .result[data-id="${spoke.id}"]`);
  await page.waitForSelector('#detail:not([hidden])');
  await frames(page);
  const labels = await page.$$eval('.leaflet-tooltip.line-label', ts => ts.map(t => t.textContent));
  assert.ok(labels.some(l => /· documented 24\/7 EVT$/.test(l)), labels.join(' | '));
  assert.ok(labels.every(l => !bare(l)), labels.join(' | '));
  const tip = await page.evaluate(() => {
    const mk = window.__strokeAtlas.markers.get('500064');
    mk.openTooltip();
    const t = mk.getTooltip().getElement().textContent;
    mk.closeTooltip();
    return t;
  });
  assert.match(tip, /· documented 24\/7 EVT/);
  assert.equal(bare(tip), false, tip);
  assert.match(await page.textContent('label:has(#ov-rings)'), /rings around documented 24\/7 EVT centers/);
  // The list row keeps the hospital name readable beside the longer distance text.
  const g = await page.evaluate((id) => {
    const r = document.querySelector(`#results .result[data-id="${id}"]`);
    return { name: r.querySelector('.r-name').getBoundingClientRect().width, row: r.getBoundingClientRect().width };
  }, spoke.id);
  assert.ok(g.name >= g.row * 0.45, `the name keeps most of the row (${g.name} of ${g.row})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('"None found" and the two "partly assessed" sets are worded apart in the chip, legend, filters, table note and summary', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?scope=all');
  if (!(await page.$eval('#filters', d => d.open))) await page.click('#filters > summary');
  assert.match(await page.textContent('#tier-chips .chip[data-tier="partial"]'), /^Partly assessed, no tier yet/);
  assert.match(await page.textContent('#f-evidence option[value="partial"]'), /^Capability partly assessed/);
  assert.match(await page.textContent('#legend-body'), /Partly assessed, no tier yet \(dotted ring\)/);
  await page.click('#tier-chips .chip[data-tier="partial"]');
  await frames(page);
  assert.match(await page.textContent('#map-status'), /filters: partly assessed, no tier yet/);
  await page.click('#tier-chips .chip[data-tier="partial"]');
  const note = /“None found” = national certification and state designation checked; none found in reviewed sources \(other capability claims may still be unknown\)/;
  await page.click('#tab-explore');
  assert.match(await page.textContent('#state-table'), note);
  const rows = await page.$$eval('#state-table tbody th', ths => ths.map(t => t.textContent));
  assert.ok(rows.includes('Capability partly assessed') && rows.includes('Partly assessed, no tier yet'));
  await page.check('input[name="mode"][value="evidence"]');
  await frames(page);
  assert.match(await page.textContent('#legend-body'), /Capability partly assessed \(dotted ring\)/);
  await page.click('#tab-data');
  const { buffer } = await readDownload(page, () => page.click('#export-md'));
  assert.match(buffer.toString('utf8'), note);
  // The wording matches the data: some "none found" records are also partly assessed.
  const n = await page.evaluate(() => window.__strokeAtlas.all.filter(h => !h.outOfRegion && h.derived.tierClass === 'none' && h.derived.capability === 'partial').length);
  assert.ok(n > 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('exports name the search in their scope; the distance-table CSV keeps its columns without my center', async () => {
  const { page, context, errors } = await openApp(browser, srv.base);
  await search(page, 'spokane');
  const n = await page.evaluate(() => window.__strokeAtlas.results.filter(h => !h.outOfRegion).length);
  assert.ok(n > 0);
  await page.click('#tab-data');
  await page.selectOption('#export-scope', 'results');
  const main = parseCsv((await readDownload(page, () => page.click('#export-csv'))).buffer.toString('utf8'));
  const mi = main[0].indexOf('export_scope');
  assert.ok(main.slice(1).every(r => /search: "spokane"/.test(r[mi])), main[1] && main[1][mi]);
  const json = JSON.parse((await readDownload(page, () => page.click('#export-json'))).buffer.toString('utf8'));
  assert.match(json.export_scope, /search: "spokane"/);
  await page.click('#tab-explore');
  await page.click('#open-matrix');
  await page.waitForSelector('#dlg-matrix[open]');
  assert.match(await page.textContent('#matrix-table caption'), /search: "spokane"/);
  const rows = parseCsv((await readDownload(page, () => page.click('#matrix-export'))).buffer.toString('utf8'));
  const hd = rows[0];
  const c = (k) => hd.indexOf(k);
  assert.equal(rows.length, n + 1);
  assert.ok(['my_center', 'my_center_record_id', 'my_center_status', 'miles_to_my_center', 'my_center_minus_nearest_documented_24x7_evt_miles'].every(k => c(k) >= 0), 'the my-center columns are there without a center');
  for (const r of rows.slice(1)) {
    assert.equal(r.length, hd.length);
    assert.match(r[c('export_scope')], /^current results \(search across all records; search: "spokane"/);
    assert.deepEqual([r[c('my_center')], r[c('my_center_status')], r[c('miles_to_my_center')]], ['', 'none-chosen', '']);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

// Colour of a CSS colour string, and the basemap colours as the page filters
// them: OpenStreetMap's land and water through the tile pane's own CSS filter.
const CONTRAST = () => {
  const rgb = (c) => { const n = document.createElement('i'); n.style.color = c; document.body.appendChild(n); const v = getComputedStyle(n).color.match(/[\d.]+/g).slice(0, 3).map(Number); n.remove(); return v; };
  const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const clamp = (v) => Math.max(0, Math.min(255, v));
  // CSS filter functions in sRGB, as the Filter Effects spec defines them.
  const fns = {
    saturate: (s, [r, g, b]) => [(0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
      (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b],
    contrast: (s, px) => px.map(v => ((v / 255 - 0.5) * s + 0.5) * 255),
    brightness: (s, px) => px.map(v => v * s),
    invert: (s, px) => px.map(v => (s * (255 - v) + (1 - s) * v)),
    'hue-rotate': (deg, [r, g, b]) => {
      const a = deg * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
      return [[0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]].map(m => m[0] * r + m[1] * g + m[2] * b);
    },
  };
  const filter = getComputedStyle(document.querySelector('.leaflet-tile-pane')).filter;
  const steps = Array.from(filter.matchAll(/([a-z-]+)\(([-\d.]+)(deg)?\)/g)).map(m => [m[1], Number(m[2])]);
  const tiled = (hex) => steps.reduce((px, [f, v]) => fns[f](v, px).map(clamp), rgb(hex));
  const cs = getComputedStyle(document.documentElement);
  const ring = rgb(cs.getPropertyValue('--c-unassessed-stroke').trim());
  const marker = document.querySelector('.leaflet-marker-icon svg [data-ring="unassessed"], .leaflet-marker-icon svg path[style*="--c-unassessed-stroke"]');
  return {
    filter, theme: document.documentElement.dataset.theme, cb: document.documentElement.classList.contains('cb'),
    ring: cs.getPropertyValue('--c-unassessed-stroke').trim(), fill: cs.getPropertyValue('--c-unassessed').trim(),
    drawn: marker ? getComputedStyle(marker).stroke : null, want: `rgb(${ring.join(', ')})`,
    land: ratio(ring, tiled('#f2efe9')), water: ratio(ring, tiled('#aad3df')), background: ratio(ring, rgb(cs.getPropertyValue('--surface-3').trim())),
  };
};

test('the "not assessed" ring and hollow stroke keep 3:1 on the basemap (land, water, map background) in every palette', async () => {
  for (const [scheme, cb] of [['light', true], ['dark', true], ['light', false], ['dark', false]]) {
    for (const mode of ['capability', 'evt-distance']) {
      const { page, context, errors } = await openApp(browser, srv.base, `?scope=all&mode=${mode}${cb ? '&cb=1' : ''}`, { colorScheme: scheme });
      const r = await page.evaluate(CONTRAST);
      const label = `${scheme}${cb ? ' colour-vision' : ''} ${mode}`;
      assert.equal(r.theme, scheme);
      assert.equal(r.cb, cb);
      assert.ok(r.filter && r.filter !== 'none', `the muted basemap filter is read (${r.filter})`);
      assert.ok(r.drawn, `${label}: a not-assessed marker is drawn`);
      assert.equal(r.drawn, r.want, `${label}: markers draw the ring in the stroke colour`);
      for (const k of ['land', 'water', 'background']) assert.ok(r[k] >= 3, `${label}: ${r.ring} on ${k} ${r[k].toFixed(2)}:1`);
      // The colour-vision stroke keeps the palette's hue; the light one is darker.
      if (cb) assert.equal(r.fill, '#cc79a7', 'the palette colour itself is unchanged');
      if (cb && scheme === 'light') assert.notEqual(r.ring, r.fill, 'a darker stroke variant on the light map');
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
});
