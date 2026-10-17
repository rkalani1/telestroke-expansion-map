'use strict';
// Shared harness for the end-to-end tests: a static file server for the repo,
// headless Chromium, stubbed map tiles, and console-error capture. Tests make
// assertions on the DOM, accessibility tree, computed styles, layout geometry
// and downloaded files. They never capture screenshots.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
// 1×1 transparent PNG, scaled by the browser to a 256 px tile.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function launch() {
  const opts = { headless: true };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

async function openApp(browser, base, query, options) {
  const o = Object.assign({ viewport: { width: 1440, height: 900 }, tiles: 'ok' }, options || {});
  const context = await browser.newContext({ viewport: o.viewport, deviceScaleFactor: o.dpr || 1, acceptDownloads: true,
    reducedMotion: o.reducedMotion || 'no-preference', colorScheme: o.colorScheme || 'light', hasTouch: !!o.touch, isMobile: !!o.mobile });
  if (o.initScript) await context.addInitScript(o.initScript);
  const page = await context.newPage();
  // E2E_CPU_THROTTLE=4 slows the page's CPU (Chromium only) to shake out
  // timing assumptions that a fast workstation hides and a CI runner exposes.
  const throttle = Number(process.env.E2E_CPU_THROTTLE || 0);
  if (throttle > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return; // network failures are asserted explicitly where relevant
    errors.push('console: ' + t);
  });
  await page.route(/tile\.openstreetmap\.org|basemap\.nationalmap\.gov/, route => (o.tiles === 'ok'
    ? route.fulfill({ status: 200, body: TILE, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } })
    : route.abort()));
  if (o.routes) for (const [pattern, handler] of o.routes) await page.route(pattern, handler);
  await page.goto(base + (query || ''), { waitUntil: 'domcontentloaded' });
  if (o.waitReady !== false) await page.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 20000 });
  return { context, page, errors };
}

async function readDownload(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), trigger()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), buffer: fs.readFileSync(p) };
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, ''); // exports start with a UTF-8 byte-order mark
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Pick records from the live dataset so tests follow the data rather than
// hard-coding facts that a later evidence pass may legitimately change.
async function pick(page, fnSource) {
  return page.evaluate(`(() => { const S = window.__strokeAtlas; const C = window.StrokeCore; return (${fnSource})(S, C); })()`);
}

// Type a query and wait until the rendered list reflects it (first row is the
// first computed result, or the empty state when nothing matches).
async function search(page, text) {
  await page.fill('#search', text);
  await page.waitForFunction((t) => {
    const S = window.__strokeAtlas;
    if (S.ui.q !== t) return false;
    const first = document.querySelector('#results .result');
    if (!S.results.length) return !first && !!document.querySelector('#results .empty');
    return !!first && first.dataset.id === S.results[0].id;
  }, text);
}

// Two animation frames: the app renders on the frame after a change.
const frames = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// The selected hospital and the far end of every selection line drawn (nearest
// documented 24/7 EVT center, my center, and the CSC/TSC-level center when
// that line is shown) must sit inside the map and outside every panel floating
// over it. Read from the drawn lines, so a destination left out of a fit shows.
async function endpointsClear(page) {
  return page.evaluate(() => {
    const S = window.__strokeAtlas;
    const m = S.map.getContainer().getBoundingClientRect();
    const sel = S.byId.get(S.ui.selected);
    const a = S.access[sel.id];
    const named = [['nearest EVT', a.evt247.dest], ['my center', S.ui.hub && S.byId.get(S.ui.hub)], ['CSC/TSC-level', S.ui.advLine && a.advanced.dest]];
    const pts = [{ what: 'sender', ll: sel.location }];
    S.lineLayer.eachLayer(l => {
      if (!l.getLatLngs) return;
      const end = l.getLatLngs()[1];
      const hit = named.find(([, h]) => h && h.location && Math.abs(h.location.lat - end.lat) < 1e-9 && Math.abs(h.location.lng - end.lng) < 1e-9);
      pts.push({ what: hit ? hit[0] : 'line end', ll: end });
    });
    const overlays = ['#detail', '#legend', '#map-status', '.map-jump', '.search-block']
      .map(q => [q, document.querySelector(q)])
      .filter(([, n]) => n && !n.hidden && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width)
      .map(([q, n]) => [q, n.getBoundingClientRect()]);
    return pts.map(({ what, ll }) => {
      const p = S.map.latLngToContainerPoint([ll.lat, ll.lng]);
      const x = m.left + p.x; const y = m.top + p.y;
      return { what, inMap: x >= m.left && x <= m.right && y >= m.top && y <= m.bottom,
        under: overlays.filter(([, r]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom).map(o => o[0]) };
    });
  });
}

// The current data has no unlocated and no closed record. This serves a copy
// of the real hospitals.json, built at test time, in which one campus has lost
// its coordinates and one 24/7 EVT center (the nearest one for several other
// hospitals) is closed, each with the derived fields the build gives such a
// record (scripts/build-dataset.py). Everything else follows the data.
function recordFixture() {
  const C = require(path.join(ROOT, 'core.js'));
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'hospitals.json'), 'utf8'));
  const all = json.hospitals;
  const inRegion = all.filter(h => !h.outOfRegion);
  const evtSet = C.destinationSet(all, 'evt247');
  const advSet = C.destinationSet(all, 'advanced');
  const byId = (id) => all.find(h => h.id === id);
  const dependents = (c) => inRegion.filter(h => h.id !== c.id && C.nearestInSet(h, evtSet).dest === c);
  const closed = evtSet.filter(h => !h.outOfRegion && h.id !== '500064' && dependents(h).length >= 3).sort((a, b) => a.id.localeCompare(b.id))[0];
  const unlocated = inRegion.filter(h => h.state === 'WA' && C.isEligible(h) && C.isActive(h) && C.locationOf(h) && !evtSet.includes(h) && !advSet.includes(h))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  const deps = dependents(closed).map(h => h.id);
  // Dependents whose six nearest hospitals (the detail's Nearby list) included the closed campus.
  const nearbyBefore = deps.filter(id => inRegion.filter(x => x.id !== id && C.locationOf(x))
    .map(x => [x, C.distanceBetween(byId(id), x)]).sort((p, q) => p[1] - q[1]).slice(0, 6).some(([x]) => x === closed));
  const c = json.counts;
  const was = closed.derived.eligibility.value;
  c[was === 'eligible' ? 'eligible' : was === 'excluded' ? 'excluded' : 'eligibility_unknown']--;
  c.excluded++;
  c.closed_or_merged++;
  if (closed.status.value === 'active') c.active--;
  else if (closed.status.value === 'unknown') c.status_unknown--;
  closed.status = Object.assign({}, closed.status, { value: 'closed' });
  closed.derived.eligibility = { value: 'excluded', code: 'not-active', reason: 'Not an active hospital campus (closed)' };
  closed.derived.needsVerification = closed.derived.needsVerification.filter(k => !['eligibility-unresolved', 'status-unknown', 'location-unverified', 'address-unverified'].includes(k));
  const geo = ['location-unverified', 'location-conflict', 'outside-state-boundary', 'near-state-boundary', 'near-county-boundary', 'far-from-named-city', 'nearer-to-another-town', 'town-not-in-gazetteer'];
  unlocated.location = null;
  Object.assign(unlocated.derived, { located: false, county: null, countyFips: null, cityDistanceMi: null, nearestTown: null, geoFlags: [] });
  unlocated.derived.needsVerification = unlocated.derived.needsVerification.filter(k => !geo.includes(k)).concat('unlocated');
  c.unlocated++;
  const body = JSON.stringify(json);
  return {
    json,
    closed: { id: closed.id, name: closed.name, state: closed.state, dependents: deps, nearbyBefore },
    unlocated: { id: unlocated.id, name: unlocated.name },
    evtCentersBefore: evtSet.length,
    route: [/hospitals\.json/, r => r.fulfill({ status: 200, body, headers: { 'Content-Type': 'application/json; charset=utf-8' } })],
  };
}

module.exports = { startServer, launch, openApp, readDownload, parseCsv, pick, search, frames, endpointsClear, recordFixture, ROOT };
