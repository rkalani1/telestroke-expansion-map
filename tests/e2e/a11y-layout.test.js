'use strict';
// Accessibility and layout, checked through axe-core, the DOM, computed styles
// and element geometry (no screenshots).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, launch, openApp, search } = require('./helpers');

const AXE = require.resolve('axe-core/axe.min.js');
let srv; let browser;
test.before(async () => { srv = await startServer(); browser = await launch(); });
test.after(async () => { await browser.close(); srv.server.close(); });

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'region': { enabled: false } },
  }));
  const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  const msg = bad.map(v => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`).join('\n');
  assert.equal(bad.length, 0, msg);
  return res.violations;
}

test('axe: desktop views, themes, details and dialogs have no serious violations', async () => {
  const { page, context } = await openApp(browser, srv.base);
  await axe(page, 'find-light');
  await search(page, 'harborview');
  await page.click('#results .result');
  await page.waitForSelector('#detail:not([hidden])');
  await axe(page, 'detail-light');
  await page.click('#tab-explore');
  await axe(page, 'explore');
  await page.click('#tab-data');
  await page.selectOption('#theme-select', 'dark');
  await axe(page, 'data-dark');
  await page.click('#tab-explore');
  await page.click('#open-review');
  await page.waitForSelector('#dlg-review[open]');
  await axe(page, 'review-dialog-dark');
  await page.keyboard.press('Escape');
  await page.click('#tab-data');
  await page.click('#open-methods');
  await axe(page, 'methods-dialog');
  await context.close();
});

test('axe: phone layout with the list sheet open', async () => {
  const { page, context } = await openApp(browser, srv.base, '', { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  await page.click('#sheet-toggle');
  await axe(page, 'mobile-sheet');
  await context.close();
});

test('keyboard: skip link, tabs with arrow keys, dialog Escape restores focus', async () => {
  const { page, context } = await openApp(browser, srv.base);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
  await page.focus('#tab-find');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-explore');
  assert.equal(await page.isVisible('#panel-explore'), true);
  await page.focus('#open-review');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#dlg-review[open]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#dlg-review:not([open])', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open-review');
  await context.close();
});

test('single-key shortcuts can be turned off; Ctrl/Cmd+F is never intercepted', async () => {
  const { page, context } = await openApp(browser, srv.base);
  await page.focus('#tab-find');
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
  await page.click('#tab-data');
  await page.uncheck('#shortcuts-toggle');
  await page.focus('#tab-data');
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-data');
  const prevented = await page.evaluate(() => new Promise(res => {
    document.addEventListener('keydown', e => setTimeout(() => res(e.defaultPrevented), 0), { once: true });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
  }));
  assert.equal(prevented, false);
  await context.close();
});

test('text contrast meets 4.5:1 for body, muted and badge text in both themes', async () => {
  const { page, context } = await openApp(browser, srv.base);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const worst = await page.evaluate(() => {
      const parse = (c) => {
        const s = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
        if (s) return [Number(s[1]) * 255, Number(s[2]) * 255, Number(s[3]) * 255];
        return c.match(/[\d.]+/g).map(Number).slice(0, 3);
      };
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const alpha = (c) => { const m = c.match(/\/\s*([\d.]+)\)/) || c.match(/rgba\([^)]*,\s*([\d.]+)\)/); return m ? Number(m[1]) : 1; };
      const bgOf = (el) => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && alpha(c) > 0.9) return parse(c); el = el.parentElement; } return parse(getComputedStyle(document.body).backgroundColor); };
      const sel = ['.r-name', '.r-meta', '.badge', '.hint', '.result-summary', '.brand-sub', '#provenance', '.view-tabs [role=tab]', '.legend-row', '.map-status'];
      let min = { r: 99 };
      for (const s of sel) for (const el of Array.from(document.querySelectorAll(s)).slice(0, 40)) {
        if (!el.offsetParent) continue;
        const r = ratio(parse(getComputedStyle(el).color), bgOf(el));
        if (r < min.r) min = { r, s, text: el.textContent.slice(0, 40) };
      }
      return min;
    });
    assert.ok(worst.r >= 4.5, `${theme}: ${worst.s} "${worst.text}" ${worst.r.toFixed(2)}:1`);
  }
  await context.close();
});

test('interactive targets are at least 24×24 px', async () => {
  const { page, context } = await openApp(browser, srv.base);
  const small = await page.evaluate(() => Array.from(document.querySelectorAll('button, select, input, [role=tab]'))
    .filter(el => el.offsetParent && !el.closest('.leaflet-control-attribution') && !el.closest('.legend-row'))
    .map(el => { const r = el.getBoundingClientRect(); return { id: el.id || el.className || el.textContent.slice(0, 20), w: r.width, h: r.height, type: el.type }; })
    .filter(x => (x.w < 24 || x.h < 24) && x.type !== 'checkbox' && x.type !== 'radio'));
  assert.deepEqual(small, []);
  await context.close();
});

test('reduced motion disables transitions and map animation', async () => {
  const { page, context } = await openApp(browser, srv.base, '', { reducedMotion: 'reduce' });
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration);
  assert.ok(/^0s/.test(d), d);
  assert.equal(await page.evaluate(() => window.__strokeAtlas.map.options.zoomAnimation), false);
  await context.close();
});

const VIEWPORTS = [
  { name: '320 phone', w: 320, h: 640, mobile: true },
  { name: '375 phone', w: 375, h: 667, mobile: true },
  { name: '390x844 phone', w: 390, h: 844, mobile: true },
  { name: 'short landscape', w: 844, h: 390, mobile: true },
  { name: '768 tablet', w: 768, h: 1024 },
  { name: '1440x900 desktop', w: 1440, h: 900 },
  { name: '1920 desktop', w: 1920, h: 1080 },
  { name: '200% zoom of 1440x900', w: 720, h: 450, dpr: 2 },
];
for (const vp of VIEWPORTS) {
  test(`layout at ${vp.name}: no horizontal scroll, controls reachable, no overlaps`, async () => {
    const { page, context, errors } = await openApp(browser, srv.base, '', { viewport: { width: vp.w, height: vp.h }, dpr: vp.dpr, mobile: !!vp.mobile, touch: !!vp.mobile });
    const g = await page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, search: r('#search'), tabs: r('#view-tabs'), map: r('#map'), status: r('#map-status'), jump: r('#jump'), legend: r('#legend') };
    });
    assert.ok(g.sw <= g.iw + 1, `horizontal overflow ${g.sw} > ${g.iw}`);
    for (const k of ['search', 'tabs', 'map']) {
      assert.ok(g[k], `${k} visible`);
      assert.ok(g[k].l >= -1 && g[k].r <= g.iw + 1 && g[k].t >= -1 && g[k].b <= g.ih + 1, `${k} inside viewport ${JSON.stringify(g[k])}`);
    }
    const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    assert.ok(!overlap(g.status, g.jump), 'map status and jump control do not overlap');
    assert.ok(!overlap(g.legend, g.jump), 'legend and jump control do not overlap');
    // The list is reachable at every size.
    if (await page.isVisible('#sheet-toggle')) await page.click('#sheet-toggle');
    await page.waitForSelector('#results .result', { state: 'visible' });
    const row = await page.evaluate(() => { const b = document.querySelector('#results .result').getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width }; });
    assert.ok(row.l >= 0 && row.r <= g.iw + 1 && row.w > 200, `result row visible ${JSON.stringify(row)}`);
    // Details open legibly and close.
    await page.click('#results .result');
    await page.waitForSelector('#detail:not([hidden])');
    const det = await page.evaluate(() => { const b = document.querySelector('#detail').getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, t: b.top }; });
    assert.ok(det.l >= -1 && det.r <= g.iw + 1 && det.w >= Math.min(300, g.iw - 2), `detail fits ${JSON.stringify(det)}`);
    assert.ok(await page.isVisible('#detail-close'));
    await page.click('#detail-close');
    assert.deepEqual(errors, []);
    await context.close();
  });
}
