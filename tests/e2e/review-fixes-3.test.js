'use strict';
// Regressions for the third review round: the automatic fit on selection, the
// distance table, the strict meaning of "capability assessed", the partly
// assessed cue, labels that name the documented set, link state, search,
// focus after a view switch, and counts on the select filters.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, readDownload, parseCsv, pick, search, frames, endpointsClear } = require('./helpers');

const AXE = require.resolve('axe-core/axe.min.js');
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

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'region': { enabled: false } },
  }));
  const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  assert.equal(bad.length, 0, bad.map(v => `${label}: ${v.id} ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`).join('\n'));
}

for (const [w, h] of [[768, 1024], [820, 1180], [1024, 768], [1280, 720], [1440, 900], [1920, 1080], [390, 844], [320, 568], [667, 375], [844, 390]]) {
  test(`automatic fit on selection keeps sender, nearest EVT and my center clear at ${w}×${h} (list, Enter, link)`, async () => {
    // Phone layout: narrow, or a short landscape screen (app.css).
    const phone = w < 768 || h <= 480;
    const opts = { viewport: { width: w, height: h }, reducedMotion: 'reduce', mobile: phone, touch: phone };
    for (const flow of ['list', 'enter', 'link']) {
      let app = await openApp(browser, srv.base, '?hub=500064', opts);
      const spoke = await spokeFor(app.page);
      assert.ok(spoke);
      if (flow === 'link') {
        await app.context.close();
        app = await openApp(browser, srv.base, `?hub=500064&h=${spoke.id}`, opts);
      } else {
        await search(app.page, spoke.name);
        if (flow === 'list') {
          if (phone) await app.page.click('#sheet-toggle');
          await app.page.click(`#results .result[data-id="${spoke.id}"]`);
        } else {
          await app.page.focus('#search');
          await app.page.keyboard.press('Enter');
          // Several matches: Enter moves to the first (best) match; Enter again opens it.
          await app.page.waitForFunction(() => !document.querySelector('#detail').hidden || document.activeElement.classList.contains('result'));
          if (await app.page.$eval('#detail', d => d.hidden)) await app.page.keyboard.press('Enter');
        }
      }
      const { page, context, errors } = app;
      await page.waitForSelector('#detail:not([hidden])');
      assert.equal(await page.evaluate(() => window.__strokeAtlas.ui.selected), spoke.id, `${flow}: the spoke is selected`);
      await frames(page);
      if (phone) {
        // The phone detail covers the map; the fit is for the map under it.
        await page.focus('#detail-title');
        await page.keyboard.press('m');
        await frames(page);
      } else {
        assert.equal(await page.$eval('#detail', d => d.hidden), false, `${flow}: the details just opened stay open`);
      }
      const pts = await endpointsClear(page);
      assert.deepEqual(pts.map(p => p.what), ['sender', 'nearest EVT', 'my center'], `${flow}: both lines drawn`);
      for (const p of pts) {
        assert.ok(p.inMap, `${flow} at ${w}×${h}: ${p.what} inside the map`);
        assert.deepEqual(p.under, [], `${flow} at ${w}×${h}: ${p.what} not under a panel`);
      }
      assert.equal(await page.evaluate(() => window.__strokeAtlas.prefs.legend), !phone, 'the saved legend choice is unchanged');
      assert.deepEqual(errors, []);
      await context.close();
    }
  });
}

test('distance table: current results, sortable headers, on site 0, unknown with a reason, approximate cue, CSV with provenance', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064');
  // Take the location off one record in this page so the unknown path is
  // exercised through the app's own recompute (the data may also hold unlocated records).
  const lost = await page.evaluate(() => {
    const S = window.__strokeAtlas;
    const h = S.results.find(x => !x.outOfRegion && x.location && x.id !== '500064' && !x.derived.tier);
    h.location = null;
    window.update({ access: true });
    return h.id;
  });
  await page.click('#tab-explore');
  await page.click('#open-matrix');
  await page.waitForSelector('#dlg-matrix[open]');
  const n = await page.evaluate(() => window.__strokeAtlas.results.filter(h => !h.outOfRegion).length);
  assert.match(await page.textContent('#matrix-table caption'), new RegExp(`^Current results: ${n} hospitals`));
  assert.equal(await page.$$eval('#matrix-table tbody tr', rs => rs.length), n);
  // Each heading: its sort key, the words shown and the name spoken (what is not aria-hidden).
  const head = await page.$$eval('#matrix-table thead th', ths => ths.map(t => {
    const b = t.querySelector('button.th-sort');
    return { key: b && b.dataset.sort, sort: t.getAttribute('aria-sort'), shown: b ? b.firstElementChild.textContent : '',
      name: b ? Array.from(b.children).filter(n => n.getAttribute('aria-hidden') !== 'true').map(n => n.textContent).join('') : '' };
  }));
  assert.ok(head.every(t => t.key), 'every header sorts with a real button');
  assert.deepEqual(head.filter(t => t.sort).map(t => [t.key, t.sort]), [['name', 'ascending']]);
  // Short headings, spoken in full: the words shown start the spoken name, and
  // the caption beside them says which sets "EVT" and "CSC/TSC" are.
  for (const [key, full] of [['tier', 'Tier shown (basis)'], ['evtCenter', 'nearest documented 24/7 EVT center'], ['evtMi', 'miles to the nearest documented 24/7 EVT center'],
    ['advCenter', 'nearest CSC/TSC-level center'], ['advMi', 'miles to the nearest CSC/TSC-level center'], ['hubMi', 'miles to my center'], ['diff', 'my center minus the nearest documented 24/7 EVT center']]) {
    const t = head.find(x => x.key === key);
    assert.ok(t && t.name.startsWith(t.shown) && t.name.includes(full), `${key}: "${t && t.shown}" is spoken as "${t && t.name}"`);
  }
  assert.match(await page.textContent('#matrix-table caption'), /“EVT” = nearest documented 24\/7 EVT center; “CSC\/TSC” = nearest CSC\/TSC-level center/);
  const col = (key) => head.findIndex(t => t.key === key);
  const evtCenter = col('evtCenter');
  const evtMi = col('evtMi');
  const cells = (rid) => page.evaluate((name) => {
    const tr = Array.from(document.querySelectorAll('#matrix-table tbody tr')).find(r => r.querySelector('th').textContent === name);
    return Array.from(tr.children).map(c => ({ text: c.textContent, aria: Array.from(c.querySelectorAll('[aria-hidden="true"]')).map(s => s.textContent).join(''),
      hidden: Array.from(c.querySelectorAll('.visually-hidden')).map(s => s.textContent).join('') }));
  }, rid);
  const [hvName, lostName] = await page.evaluate((ids) => ids.map(i => window.__strokeAtlas.byId.get(i).name), ['500064', lost]);
  const hvCells = await cells(hvName);
  assert.equal(hvCells[evtCenter].text, 'On site (0 mi)');
  assert.equal(hvCells[evtMi].text, '0', 'on site is 0, not unknown');
  const lostCells = await cells(lostName);
  assert.equal(lostCells[evtMi].aria, '—');
  assert.match(lostCells[evtMi].hidden, /Unknown: no verified map location/, 'the reason is available to assistive technology');
  // Town-centre locations carry the approximate cue, spoken as well as shown.
  const approx = await page.$$eval('#matrix-table tbody td', tds => tds.filter(td => td.textContent.startsWith('≈')).map(td => td.querySelector('.visually-hidden') && td.querySelector('.visually-hidden').textContent));
  assert.ok(approx.length > 0 && approx.every(t => /approximate/.test(t || '')), 'approximate distances say so');
  // One precision for every distance, approximate or not: a decimal under
  // 10 mi, so "≈0" never reads as on site and a sorted column reads in order.
  // A bare 0 is on site, and only on site.
  const shown = await page.evaluate((keys) => {
    const ix = Array.from(document.querySelectorAll('#matrix-table thead th')).map(t => t.querySelector('button').dataset.sort);
    return Array.from(document.querySelectorAll('#matrix-table tbody tr')).flatMap(tr => keys.map(k => {
      const td = tr.children[ix.indexOf(k)];
      return { k, text: td.firstChild && td.firstChild.nodeType === 3 ? td.firstChild.textContent : null, center: tr.children[ix.indexOf(k === 'advMi' ? 'advCenter' : 'evtCenter')].textContent };
    })).filter(c => c.text != null);
  }, ['evtMi', 'advMi', 'hubMi']);
  assert.ok(shown.length > n, 'distances shown');
  const bad = shown.filter(c => !/^(0|≈?\d\.\d|≈?[1-9]\d+)$/.test(c.text) || (c.text === '0' && c.k !== 'hubMi' && c.center !== 'On site (0 mi)'));
  assert.deepEqual(bad, [], 'one decimal under 10 mi, approximate or not; a bare 0 only on site');
  assert.ok(shown.some(c => /^≈\d\.\d$/.test(c.text)), 'the data has approximate distances under 10 mi, so the rule is exercised');

  // Sorting: the button keeps focus, aria-sort follows, unknown sorts last both ways.
  await page.click('#matrix-table .th-sort[data-sort="evtMi"]');
  const asc = await page.evaluate((i) => ({ focus: document.activeElement.dataset.sort, sort: document.querySelectorAll('#matrix-table thead th')[i].getAttribute('aria-sort'),
    vals: Array.from(document.querySelectorAll('#matrix-table tbody tr')).map(r => r.children[i].textContent) }), evtMi);
  assert.equal(asc.focus, 'evtMi');
  assert.equal(asc.sort, 'ascending');
  const num = (t) => (/^[≈]?\d/.test(t) ? Number(t.replace(/[^\d.]/g, '')) : null);
  const ascNums = asc.vals.map(num);
  assert.equal(ascNums[0], 0, 'on site (0) sorts first ascending');
  assert.equal(ascNums[ascNums.length - 1], null, 'unknown sorts last ascending');
  assert.ok(ascNums.filter(v => v != null).every((v, i, a) => !i || v >= a[i - 1]), 'ascending order, as shown');
  assert.match(await page.textContent('#matrix-status'), /Sorted by Mi to documented 24\/7 EVT, ascending/);
  await page.keyboard.press('Enter');
  const desc = await page.evaluate((i) => ({ sort: document.querySelectorAll('#matrix-table thead th')[i].getAttribute('aria-sort'),
    vals: Array.from(document.querySelectorAll('#matrix-table tbody tr')).map(r => r.children[i].textContent) }), evtMi);
  assert.equal(desc.sort, 'descending');
  const descNums = desc.vals.map(num);
  assert.equal(descNums[descNums.length - 1], null, 'unknown sorts last descending too');
  assert.ok(descNums.filter(v => v != null).every((v, i, a) => !i || v <= a[i - 1]), 'descending order, as shown');
  await axe(page, 'distance-table');

  // CSV: same rows, 0 on site, blank unknown with its status, my center and
  // its status, provenance in trailing columns on every row (no trailing rows).
  const { name, buffer } = await readDownload(page, () => page.click('#matrix-export'));
  assert.match(name, /^stroke-distance-table_.*\.csv$/);
  const rows = parseCsv(buffer.toString('utf8'));
  const hd = rows[0];
  for (const k of ['record_id', 'tier_shown', 'tier_basis', 'nearest_documented_24x7_evt_center', 'nearest_documented_24x7_evt_status', 'miles_to_nearest_documented_24x7_evt',
    'nearest_csc_tsc_level_center', 'miles_to_nearest_csc_tsc_level', 'my_center', 'my_center_record_id', 'my_center_status', 'miles_to_my_center',
    'my_center_minus_nearest_documented_24x7_evt_miles', 'distances_approximate']) {
    assert.ok(hd.includes(k), 'CSV column ' + k);
  }
  const PROV = ['distance_metric', 'export_scope', 'data_version', 'evidence_review_date', 'exported_on', 'release'];
  assert.deepEqual(hd.slice(-PROV.length), PROV, 'provenance in trailing columns, as in the main CSV');
  assert.equal(rows.length, n + 1, 'the header and one row per hospital in the table; no trailing provenance rows');
  assert.ok(rows.every(r => r.length === hd.length), 'every row has every column');
  const data = rows.slice(1);
  const c = (k) => hd.indexOf(k);
  const meta = await page.evaluate(() => ({ data: window.__strokeAtlas.meta.data_version, review: window.__strokeAtlas.meta.evidence_review_date, release: window.__strokeAtlas.meta.release }));
  for (const r of data) {
    assert.match(r[c('export_scope')], /^current results \(/);
    assert.match(r[c('distance_metric')], /straight-line/);
    assert.deepEqual([r[c('data_version')], r[c('evidence_review_date')], r[c('release')]], [meta.data, meta.review, meta.release]);
    assert.match(r[c('exported_on')], /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual([r[c('my_center')], r[c('my_center_record_id')]], [hvName, '500064']);
  }
  const hvRow = data.find(r => r[0] === '500064');
  assert.equal(hvRow[c('miles_to_nearest_documented_24x7_evt')], '0');
  assert.equal(hvRow[c('nearest_documented_24x7_evt_status')], 'on-site');
  assert.equal(hvRow[c('my_center_status')], 'on-site');
  const lostRow = data.find(r => r[0] === lost);
  assert.equal(lostRow[c('miles_to_nearest_documented_24x7_evt')], '', 'unknown is blank, never 0');
  assert.equal(lostRow[c('nearest_documented_24x7_evt_status')], 'no-location');
  assert.equal(lostRow[c('my_center_status')], 'no-location');
  assert.equal(lostRow[c('miles_to_my_center')], '');
  assert.ok(data.filter(r => r[0] !== '500064' && r[0] !== lost && r[c('nearest_documented_24x7_evt_status')] !== 'no-location').every(r => r[c('my_center_status')] === 'ok' && r[c('miles_to_my_center')] !== ''));

  // A hospital name selects it.
  const target = await page.evaluate(() => document.querySelectorAll('#matrix-table tbody th button')[2].textContent);
  await page.click(`#matrix-table tbody th button:text-is("${target}")`);
  await page.waitForSelector('#detail:not([hidden])');
  assert.equal(await page.$eval('#dlg-matrix', d => d.open), false);
  assert.equal(await page.textContent('#detail-title'), target);
  assert.deepEqual(errors, []);
  await context.close();
});

// Is the focused control the topmost thing at its own centre (not under the
// sticky header row, the sticky hospital column or the scroll edge)?
const focusedOnTop = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const b = a.getBoundingClientRect();
  const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { text: a.textContent.slice(0, 40), onTop: !!top && (top === a || a.contains(top)) };
});
for (const [w, h] of [[320, 568], [390, 844], [667, 375], [844, 390]]) {
  test(`distance table at ${w}×${h}: rows in view under a shallow header, and no focused row or heading ever under the sticky parts`, async () => {
    const { page, context, errors } = await openApp(browser, srv.base, '?hub=500064', { viewport: { width: w, height: h }, mobile: true, touch: true });
    await page.click('#tab-explore');
    await page.click('#open-matrix');
    await page.waitForSelector('#dlg-matrix[open]');
    const g = await page.evaluate(() => {
      const d = document.querySelector('#dlg-matrix').getBoundingClientRect();
      const wrap = document.querySelector('#matrix-table');
      const small = Array.from(document.querySelectorAll('#dlg-matrix button')).map(b => b.getBoundingClientRect()).filter(r => r.width && (r.width < 24 || r.height < 24)).length;
      // Data rows whose hospital button is fully on screen and on top, as the dialog opens.
      const shown = Array.from(document.querySelectorAll('#matrix-table tbody th button')).filter(b => {
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.top >= 0 && r.bottom <= innerHeight && top === b;
      }).length;
      return { d: [d.left, d.top, d.width, d.height], iw: innerWidth, ih: innerHeight, scrolls: wrap.scrollWidth > wrap.clientWidth, page: document.documentElement.scrollWidth, small,
        head: document.querySelector('#matrix-table thead').getBoundingClientRect().height, shown,
        sticky: getComputedStyle(document.querySelector('#matrix-table thead th:last-child')).position };
    });
    assert.ok(g.d[0] <= 1 && g.d[1] <= 1 && g.d[2] >= g.iw - 1 && g.d[3] >= g.ih - 1, `full screen ${g.d}`);
    assert.equal(g.scrolls, true, 'the table scrolls sideways inside its wrapper');
    assert.ok(g.page <= g.iw + 1, 'no horizontal page scroll');
    assert.equal(g.small, 0, 'targets at least 24×24');
    assert.ok(g.head <= 48, `the header row is one shallow line (${g.head} px)`);
    assert.ok(g.shown >= 2, `data rows are in view as the dialog opens (${g.shown})`);
    // A short screen scrolls the whole table with the dialog: no sticky header row there.
    assert.equal(g.sticky, h <= 480 ? 'static' : 'sticky');
    // Tab from the headings down through the rows (scrolling down), back up
    // past where the table started scrolling (where a row would land under a
    // sticky header), and back through the headings (sideways, past the sticky
    // hospital column): each focused control is on top at its centre.
    await page.focus('#matrix-table .th-sort[data-sort="name"]');
    const nHead = await page.$$eval('#matrix-table .th-sort', bs => bs.length);
    const seen = [];
    const step = async (key) => { await page.keyboard.press(key); const f = await focusedOnTop(page); seen.push(f); return f; };
    for (let i = 1; i < nHead + 25; i++) await step('Tab');
    for (let i = 0; i < 25 + nHead - 1; i++) await step('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.sort), 'name', 'back at the first heading');
    const hidden = seen.filter(f => !f.onTop);
    assert.deepEqual(hidden, [], 'every focused row button and heading is visible, not under the header or the hospital column');
    assert.ok(seen.length >= 2 * 25, 'the walk covered rows below the first screen');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('"capability assessed" is strict everywhere; partly assessed has its own row and option; denominators stated', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?scope=all&hub=500064');
  await page.click('#tab-explore');
  const t = await page.evaluate(() => {
    const S = window.__strokeAtlas;
    const recs = S.results.filter(h => !h.outOfRegion);
    const rows = Object.fromEntries(Array.from(document.querySelectorAll('#state-table tbody tr')).map(r => [r.querySelector('th').textContent, Number(r.lastElementChild.textContent)]));
    const by = (k) => recs.filter(h => h.derived.capability === k).length;
    return { rows, assessed: by('assessed'), partial: by('partial'), records: recs.length };
  });
  assert.equal(t.rows['Capability assessed'], t.assessed);
  assert.equal(t.rows['Capability partly assessed'], t.partial);
  assert.ok(t.partial > 0);
  assert.equal(t.rows['Capability assessed'] + t.rows['Capability partly assessed'] + t.rows['Capability not assessed'] + t.rows['Capability evidence conflicting'], t.rows.Records, 'the four capability rows add up to Records');
  assert.equal(t.rows.Records, t.records);
  await page.click('#tab-find');
  if (!(await page.$eval('#filters', d => d.open))) await page.click('#filters > summary');
  for (const [v, cap] of [['assessed', 'assessed'], ['partial', 'partial']]) {
    await page.selectOption('#f-evidence', v);
    await page.waitForFunction((v) => window.__strokeAtlas.ui.evidence[0] === v, v);
    const r = await page.evaluate(() => window.__strokeAtlas.results.map(h => h.derived.capability));
    assert.ok(r.length > 0 && r.every(c => c === cap), `Evidence "${v}" lists only ${cap}`);
  }
  await page.selectOption('#f-evidence', '');
  await page.click('#tab-data');
  assert.match(await page.textContent('#data-overview'), /partly assessed .* \(of \d+ records\)/);
  const { buffer } = await readDownload(page, () => page.click('#export-md'));
  const md = buffer.toString('utf8');
  assert.match(md, /\| Capability assessed \| (\d+ \| ){5}\d+ \|/);
  assert.match(md, /\| Capability partly assessed \| (\d+ \| ){5}\d+ \|/);
  assert.match(md, /add up to Records/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('partly assessed keeps a dotted ring in every mode, in the legend and in the PNG; it is not the "not assessed" ring', async () => {
  for (const mode of ['capability', 'evt-distance', 'adv-distance', 'hub-distance', 'evidence', 'eligibility']) {
    const { page, context, errors } = await openApp(browser, srv.base, `?scope=all&hub=500064&mode=${mode}`);
    await frames(page);
    const r = await page.evaluate(() => {
      const S = window.__strokeAtlas;
      const located = S.all.filter(h => !h.outOfRegion && h.location);
      return {
        partial: located.filter(h => h.derived.capability === 'partial').length,
        unassessed: located.filter(h => h.derived.capability === 'unassessed').length,
        dotted: document.querySelectorAll('.leaflet-marker-icon svg [data-ring="partial"]').length,
        dashed: document.querySelectorAll('.leaflet-marker-icon svg [data-ring="unassessed"]').length,
        dash: (document.querySelector('.leaflet-marker-icon svg [data-ring="partial"]') || { style: {} }).style.strokeDasharray,
        legend: document.querySelector('#legend-body').textContent,
        legendRing: !!document.querySelector('#legend-body svg [data-ring="partial"]'),
      };
    });
    assert.ok(r.partial > 0);
    assert.equal(r.dotted, r.partial, `${mode}: every partly assessed marker has the dotted ring`);
    assert.equal(r.dashed, mode === 'capability' || mode === 'evidence' ? 0 : r.unassessed, `${mode}: the dashed ring stays for not assessed only`);
    assert.notEqual(r.dash, '2.6 2', 'dotted, not the dashed pattern');
    assert.match(r.legend, /Dotted ring: capability partly assessed/);
    assert.ok(r.legendRing, `${mode}: the legend draws the ring`);
    if (mode === 'capability') {
      // The PNG export draws the same ring: record the canvas strokes made during the export.
      await page.evaluate(() => {
        window.__strokes = [];
        const proto = window.CanvasRenderingContext2D.prototype;
        const orig = proto.stroke;
        // Canvas keeps dash lengths as single-precision floats.
        proto.stroke = function (...a) { window.__strokes.push({ dash: this.getLineDash().map(v => Math.round(v * 100) / 100).join(','), style: this.strokeStyle }); return orig.apply(this, a); };
      });
      await page.click('#tab-data');
      await readDownload(page, () => page.click('#export-png'));
      const png = await page.evaluate(() => {
        const S = window.__strokeAtlas;
        const want = getComputedStyle(document.documentElement).getPropertyValue('--c-partial').trim().toLowerCase();
        // The exporter draws the markers within the map frame, then the legend.
        const size = S.map.getSize();
        const onMap = S.all.filter(h => !h.outOfRegion && h.location && h.derived.capability === 'partial').filter(h => {
          const p = S.map.latLngToContainerPoint([h.location.lat, h.location.lng]);
          return p.x >= -20 && p.y >= -20 && p.x <= size.x + 20 && p.y <= size.y + 20;
        }).length;
        return { onMap, drawn: window.__strokes.filter(s => s.dash === '0.1,3.4' && s.style.toLowerCase() === want).length };
      });
      assert.ok(png.onMap > 0);
      assert.ok(png.drawn >= png.onMap + 2, `PNG draws the dotted ring on each partly assessed marker and in its legend (${png.drawn} for ${png.onMap})`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  // The ring colour keeps 3:1 against the basemap in the light, dark and colour-vision palettes.
  for (const [scheme, cb] of [['light', false], ['dark', false], ['light', true]]) {
    const { page, context } = await openApp(browser, srv.base, cb ? '?cb=1' : '', { colorScheme: scheme });
    const ratio = await page.evaluate(() => {
      const rgb = (c) => { const n = document.createElement('i'); n.style.color = c; document.body.appendChild(n); const v = getComputedStyle(n).color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); n.remove(); return v; };
      const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const cs = getComputedStyle(document.documentElement);
      const a = lum(rgb(cs.getPropertyValue('--c-partial').trim()));
      const b = lum(rgb(document.documentElement.dataset.theme === 'dark' ? cs.getPropertyValue('--surface-3').trim() : '#f2f2ef'));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    assert.ok(ratio >= 3, `${scheme}${cb ? ' cb' : ''}: dotted ring contrast ${ratio.toFixed(2)}`);
    await context.close();
  }
});

test('detail and labels: partly assessed tier row matches the list wording; "documented" is named everywhere', async () => {
  const probe = await openApp(browser, srv.base);
  const part = await pick(probe.page, (S) => { const h = S.all.find(x => !x.outOfRegion && x.derived.capability === 'partial' && x.derived.tierClass === 'partial'); return h && h.id; });
  await probe.context.close();
  assert.ok(part);
  const { page, context } = await openApp(browser, srv.base, `?h=${part}`);
  await page.waitForSelector('#detail:not([hidden])');
  const tier = await page.evaluate(() => Array.from(document.querySelectorAll('#detail-body .claim')).find(c => c.querySelector('dt').textContent === 'Tier shown on map').querySelector('.c-value').textContent);
  assert.equal(tier, 'Partly assessed, no tier yet');
  await context.close();

  const a = await openApp(browser, srv.base, '?hub=500064');
  const spoke = await spokeFor(a.page);
  await a.context.close();
  const { page: p2, context: c2 } = await openApp(browser, srv.base, `?hub=500064&h=${spoke.id}&cmp=${spoke.id},500064`);
  await p2.waitForSelector('#detail:not([hidden])');
  const scen = await p2.$$eval('#detail-body table.scenario thead th', ths => ths.map(t => t.textContent));
  assert.ok(scen.includes('Nearest documented 24/7 EVT'), scen.join(' | '));
  await p2.click('#detail-close');
  await p2.click('#tab-compare');
  await p2.click('#compare-open');
  const fields = await p2.$$eval('#cmp-table tbody th', ths => ths.map(t => t.textContent));
  assert.ok(fields.includes('My center minus nearest documented 24/7 EVT'));
  await p2.keyboard.press('Escape');
  await p2.click('#tab-explore');
  await p2.click('#open-review');
  await p2.waitForSelector('#dlg-review[open]');
  await p2.click('#rp-ranked tbody tr:not([hidden]) button[aria-expanded]');
  assert.match(await p2.textContent('#rp-ranked tbody tr:not([hidden]) ul.why'), /Nearest documented 24\/7 EVT center: /);
  await p2.keyboard.press('Escape');
  await p2.click('#tab-data');
  const { buffer } = await readDownload(p2, () => p2.click('#export-json'));
  const doc = JSON.parse(buffer.toString('utf8'));
  assert.ok(doc.records.every(r => r.access && r.access.nearest_documented_24x7_evt && !('nearest_24x7_evt' in r.access)));
  assert.match(await p2.textContent('#methods-body'), /nearest documented 24\/7 EVT center, to the nearest CSC\/TSC-level center/);
  await c2.close();
});

test('link state: summary scope, review candidates and the CSC/TSC-level line round-trip; ev keeps one value; sort=hub needs a center', async () => {
  const a = await openApp(browser, srv.base, '?hub=500064');
  const id = await pick(a.page, (S) => {
    const h = S.all.find(x => !x.outOfRegion && x.location && S.access[x.id].advanced.status === 'ok' && S.access[x.id].evt247.status === 'ok'
      && S.access[x.id].advanced.dest.id !== S.access[x.id].evt247.dest.id && S.access[x.id].evt247.dest.id !== '500064');
    return h && h.id;
  });
  assert.ok(id, 'a hospital whose nearest CSC/TSC-level center differs from its nearest EVT center');
  await a.context.close();
  const { page, context } = await openApp(browser, srv.base, `?hub=500064&h=${id}`);
  await page.waitForSelector('#detail:not([hidden])');
  await page.focus('#detail-actions [data-act="adv-line"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'adv-line', 'focus stays on the rebuilt toggle');
  assert.equal(await page.getAttribute('#detail-actions [data-act="adv-line"]', 'aria-pressed'), 'true');
  await page.click('#tab-explore');
  await page.selectOption('#summary-scope', 'all');
  await page.click('#open-review');
  await page.waitForSelector('#dlg-review[open]');
  await page.selectOption('#review-scope', 'all');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => { const q = new URL(location.href).searchParams; return q.get('ss') === 'all' && q.get('rc') === 'all' && q.get('adv') === '1'; }, null, { timeout: 5000 });
  const url = await page.evaluate(() => location.href);
  await context.close();

  const b = await openApp(browser, '', url);
  await b.page.waitForSelector('#detail:not([hidden])');
  const st = await b.page.evaluate(() => {
    const S = window.__strokeAtlas;
    let lines = 0; S.lineLayer.eachLayer(l => { if (l.getLatLngs) lines++; });
    return { ui: { ss: S.ui.summaryScope, rc: S.ui.reviewScope, adv: S.ui.advLine }, select: document.querySelector('#summary-scope').value, lines,
      pressed: document.querySelector('#detail-actions [data-act="adv-line"]').getAttribute('aria-pressed') };
  });
  assert.deepEqual(st.ui, { ss: 'all', rc: 'all', adv: true });
  assert.equal(st.select, 'all');
  assert.equal(st.pressed, 'true');
  assert.equal(st.lines, 3, 'nearest EVT, my center and the CSC/TSC-level line');
  await b.page.click('#detail-close');
  await b.page.click('#tab-explore');
  await b.page.click('#open-review');
  assert.equal(await b.page.$eval('#review-scope', s => s.value), 'all');
  await b.context.close();

  const c = await openApp(browser, srv.base, '?sort=hub&ev=assessed,partial,bogus');
  const r = await c.page.evaluate(() => ({ sort: window.__strokeAtlas.ui.sort, ev: window.__strokeAtlas.ui.evidence, sel: document.querySelector('#f-evidence').value, toast: document.querySelector('#toasts').textContent }));
  assert.equal(r.sort, 'relevance', 'sort by miles to my center needs a center');
  assert.deepEqual(r.ev, ['assessed']);
  assert.equal(r.sel, 'assessed');
  assert.match(r.toast, /not recognised/);
  assert.match(r.toast, /ev:partial/);
  assert.match(r.toast, /sort/);
  await c.context.close();
});

test('search: the CMS registry name and Alaska census areas, boroughs and municipalities', async () => {
  const { page, context } = await openApp(browser, srv.base);
  const cms = await pick(page, (S, C) => {
    const h = S.all.find(x => x.cms && x.cms.name && ![x.name, x.officialName].concat(x.formerNames || [], x.aliases || []).filter(Boolean).map(C.normalizeSearch).includes(C.normalizeSearch(x.cms.name)));
    return h && { id: h.id, q: h.cms.name };
  });
  assert.ok(cms, 'a record whose CMS name differs from its other names');
  await search(page, cms.q);
  assert.ok(await page.$(`#results .result[data-id="${cms.id}"]`), 'found by its CMS name');
  for (const [county, q] of [['Bethel', 'Bethel Census Area'], ['Juneau', 'Juneau City and Borough'], ['Anchorage', 'Anchorage Municipality'], ['Kenai Peninsula', 'Kenai Peninsula Borough'],
    ['Anchorage', 'Municipality of Anchorage'], ['Juneau', 'City and Borough of Juneau'], ['Sitka', 'City and Borough of Sitka'], ['Matanuska-Susitna', 'Matanuska-Susitna Borough']]) {
    // The county search reads: the curated address county, else the one derived from the coordinates.
    const want = await page.evaluate((c) => window.__strokeAtlas.all.filter(h => h.state === 'AK' && ((h.address && h.address.county) || h.derived.county) === c).map(h => h.id).sort(), county);
    assert.ok(want.length > 0, `the data has a hospital in ${county}, so "${q}" is really tested`);
    await search(page, q);
    assert.deepEqual(await page.$$eval('#results .result', rs => rs.map(r => r.dataset.id).sort()), want, q);
  }
  await context.close();
});

test('focus: ArrowDown inside the search debounce lands on a current row; a view shortcut on a phone never leaves focus on <body>', async () => {
  const { page, context, errors } = await openApp(browser, srv.base);
  await search(page, 'spokane');
  await page.focus('#search');
  await page.fill('#search', 'kootenai');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  const f = await page.evaluate(() => ({ cls: document.activeElement.className, id: document.activeElement.dataset.id, q: window.__strokeAtlas.ui.q, ids: window.__strokeAtlas.results.map(h => h.id) }));
  assert.equal(f.cls, 'result');
  assert.equal(f.q, 'kootenai');
  assert.ok(f.ids.includes(f.id), 'the focused row belongs to the new query');
  assert.deepEqual(errors, []);
  await context.close();

  for (const [key, view] of [['e', 'explore'], ['c', 'compare'], ['q', 'data']]) {
    const app = await openApp(browser, srv.base, '?h=500064', { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
    await app.page.waitForSelector('#detail:not([hidden])');
    await app.page.focus('#detail-title');
    await app.page.keyboard.press(key);
    await frames(app.page);
    const r = await app.page.evaluate(() => {
      const a = document.activeElement;
      const b = a.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { tag: a.tagName, id: a.id, visible: !!top && (top === a || a.contains(top)), detail: document.querySelector('#detail').hidden, view: window.__strokeAtlas.ui.view };
    });
    assert.notEqual(r.tag, 'BODY', `${key}: focus is not left on <body>`);
    assert.equal(r.id, 'tab-' + view);
    assert.equal(r.visible, true);
    assert.equal(r.detail, true);
    assert.equal(r.view, view);
    await app.context.close();
  }
});

test('select filters show counts that apply every other filter but their own; values are unchanged', async () => {
  const { page, context, errors } = await openApp(browser, srv.base, '?scope=all');
  if (!(await page.$eval('#filters', d => d.open))) await page.click('#filters > summary');
  const sels = ['#f-state', '#f-system', '#f-basis', '#f-cah', '#f-evidence'];
  const before = await page.evaluate((sels) => sels.map(s => Array.from(document.querySelector(s).options).map(o => o.value)), sels);
  const opts = await page.evaluate((sels) => sels.map(s => Array.from(document.querySelector(s).options).map(o => o.textContent)), sels);
  for (const list of opts) assert.ok(list.every(t => /\(\d+\)$/.test(t)), list.find(t => !/\(\d+\)$/.test(t)));
  const count = (sel, v) => page.$eval(`${sel} option[value="${v}"]`, o => Number(o.textContent.match(/\((\d+)\)$/)[1]));
  // With a chip pressed, each option's count is what choosing it would list.
  await page.click('#tier-chips .chip[data-tier="none"]');
  await page.waitForFunction(() => window.__strokeAtlas.ui.tiers.includes('none'));
  await frames(page);
  for (const [sel, v] of [['#f-state', 'MT'], ['#f-cah', 'yes'], ['#f-basis', 'state'], ['#f-evidence', 'partial'], ['#f-system', '__independent']]) {
    const n = await count(sel, v);
    const all = await count(sel, sel === '#f-state' ? 'ALL' : '');
    await page.selectOption(sel, v);
    await frames(page);
    assert.equal(await page.evaluate(() => window.__strokeAtlas.results.length), n, `${sel}=${v}: the option count is the result count`);
    // The select's own count does not shrink when it is used.
    assert.equal(await count(sel, sel === '#f-state' ? 'ALL' : ''), all, `${sel}: its own filter is left out of its counts`);
    await page.selectOption(sel, sel === '#f-state' ? 'ALL' : '');
    await frames(page);
  }
  const after = await page.evaluate((sels) => sels.map(s => Array.from(document.querySelector(s).options).map(o => o.value)), sels);
  assert.deepEqual(after, before, 'option values unchanged');
  assert.deepEqual(errors, []);
  await context.close();
});
