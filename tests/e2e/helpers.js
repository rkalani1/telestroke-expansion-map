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
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return; // network failures are asserted explicitly where relevant
    errors.push('console: ' + t);
  });
  await page.route(/tile\.openstreetmap\.org/, route => (o.tiles === 'ok'
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

async function search(page, text) {
  await page.fill('#search', text);
  await page.waitForFunction((t) => window.__strokeAtlas.ui.q === t, text);
  await page.waitForTimeout(80);
}

module.exports = { startServer, launch, openApp, readDownload, parseCsv, pick, search, ROOT };
