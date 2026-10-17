/* ========================================================================
   Regional Hospital Stroke Capabilities — application
   ------------------------------------------------------------------------
   Static single-page app. Loads hospitals.json (schema 4), renders the map,
   the Find / Explore / Compare / Data views, the hospital detail panel and
   exports. All calculation lives in core.js (StrokeCore); this file owns
   state, DOM and Leaflet.

   Safety: all dataset text is inserted with textContent or as DOM nodes.
   Marker SVG is built only from internal constants and numbers.
   ======================================================================== */

'use strict';

const C = window.StrokeCore;
const DATA_URL = 'hospitals.json';
const HARBORVIEW_ID = '500064';
const PREFS_KEY = 'stroke-atlas-prefs-v4';
const LEGACY_KEYS = ['stroke-dark', 'stroke-cb', 'stroke-dashboard'];
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE_Q = typeof matchMedia === 'function' ? matchMedia('(max-width: 767px)') : { matches: false, addEventListener() {} };
const STALE_DAYS = 365;

const BODY_ABBR = { 'Joint Commission': 'JC', DNV: 'DNV', ACHC: 'ACHC', CIHQ: 'CIHQ' };
const STATE_SYS_ABBR = { 'WA ECS': 'WA', 'Idaho TSE': 'ID TSE' };
const STATE_NAMES = { WA: 'Washington', AK: 'Alaska', ID: 'Idaho', MT: 'Montana', WY: 'Wyoming' };
const TIER_ORDER = { CSC: 0, TSC: 1, PSC: 2, ASR: 3 };
const TIER_VAR = { CSC: '--c-csc', TSC: '--c-tsc', PSC: '--c-psc', ASR: '--c-asr' };
const MODE_LABELS = {
  capability: 'Capability',
  'evt-distance': 'Miles to nearest documented 24/7 EVT center',
  'adv-distance': 'Miles to nearest CSC/TSC-level center',
  'hub-distance': 'Miles to my receiving center',
  evidence: 'Evidence status',
  eligibility: 'Analysis eligibility',
};
const ELIG_LABELS = { eligible: 'In analysis set', excluded: 'Excluded', unknown: 'Eligibility unresolved', 'not-applicable': 'Outside WWAMI (destination only)' };
const CAP_LABELS = { assessed: 'Capability assessed', partial: 'Capability partly assessed', unassessed: 'Capability not assessed', conflicting: 'Conflicting evidence', 'n/a': 'Outside WWAMI' };
const NV_LABELS = {
  'capability-unassessed': 'Stroke capability not assessed',
  'conflicting-evidence': 'Conflicting evidence',
  'evidence-stale': 'Capability evidence older than 12 months',
  'eligibility-unresolved': 'Analysis eligibility unresolved',
  unlocated: 'No verified map location',
  'location-unverified': 'Coordinates not verified to the campus',
  'address-unverified': 'Physical address not verified',
  'status-unknown': 'Active/closed status not confirmed',
  'outside-state-boundary': 'Coordinates outside the named state',
  'near-state-boundary': 'Coordinates at the state boundary',
  'near-county-boundary': 'County assignment uncertain (near a boundary)',
  'far-from-named-city': 'Coordinates far from the town the address names',
  'location-conflict': 'Two coordinate sources disagree',
  'address-conflicting': 'Address sources disagree',
};
const ADDRESS_STATUS = {
  corroborated: 'Two registries agree (previous edition and NPPES)',
  'source-reported': 'From one registry record (NPPES or CMS)',
  'prior-edition': 'Carried from the previous edition',
  'coordinate-derived': 'Town inferred from coordinates in the previous edition',
  conflicting: 'Sources give different addresses',
  unknown: 'Not documented',
};
const METRO = [
  { key: 'm-seattle', label: 'Seattle–Tacoma–Everett', lat: 47.45, lng: -122.3, mi: 32 },
  { key: 'm-spokane', label: 'Spokane–Coeur d’Alene', lat: 47.68, lng: -117.1, mi: 30 },
  { key: 'm-tricities', label: 'Tri-Cities–Yakima', lat: 46.4, lng: -119.7, mi: 50 },
  { key: 'm-boise', label: 'Boise–Nampa', lat: 43.6, lng: -116.4, mi: 30 },
  { key: 'm-eastid', label: 'Idaho Falls–Pocatello', lat: 43.2, lng: -112.2, mi: 40 },
  { key: 'm-billings', label: 'Billings', lat: 45.78, lng: -108.5, mi: 25 },
  { key: 'm-missoula', label: 'Missoula–Kalispell', lat: 47.4, lng: -114.1, mi: 70 },
  { key: 'm-wy', label: 'Casper–Cheyenne', lat: 42.0, lng: -105.8, mi: 110 },
  { key: 'm-anchorage', label: 'Anchorage–Mat-Su–Kenai', lat: 61.0, lng: -150.0, mi: 110 },
  { key: 'm-seak', label: 'Southeast Alaska', lat: 57.0, lng: -134.0, mi: 220 },
];

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const S = {
  meta: null,
  all: [],            // every record incl. out-of-region destinations
  byId: new Map(),
  systems: [],
  ui: C.defaultUiState(),
  explicit: {},
  prefs: { theme: 'auto', cb: false, basemap: 'muted', hub: null, shortcuts: true, legend: true },
  sets: { evt247: [], advanced: [] },
  access: {},
  results: [],
  map: null,
  tiles: null,
  markers: new Map(),
  markerSig: new Map(),
  lineLayer: null,
  overlayLayer: null,
  ringLayer: null,
  offsets: new Map(),
  detailOpener: null,
  showAdvLine: false,
  tileStats: { ok: 0, err: 0, warned: false },
  reviewTab: 'ranked',
  reviewScope: 'results',
  storageOk: true,
  booted: false,
};

// ------------------------------------------------------------------
// DOM helpers
// ------------------------------------------------------------------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'on') { for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn); }
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('aria-') || k === 'role' || k === 'tabindex' || k === 'for' || k === 'scope' || k === 'colspan' || k === 'title') node.setAttribute(k, v === true ? 'true' : String(v));
      else node[k] = v;
    }
  }
  appendAll(node, children);
  return node;
}
function appendAll(node, children) {
  if (children == null) return node;
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}
function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
function svgEl(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup; // internal constant markup only (see glyphSvg)
  return t.content.firstElementChild;
}

function toast(message, kind, ms) {
  const box = $('#toasts');
  if (!box) return;
  const n = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: kind === 'error' ? 'alert' : 'status', text: message });
  box.appendChild(n);
  setTimeout(() => n.remove(), ms || 3200);
}

// ------------------------------------------------------------------
// Storage: preferences are conveniences; failure to store never breaks startup.
// ------------------------------------------------------------------
const store = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch { S.storageOk = false; return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch { S.storageOk = false; return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch { S.storageOk = false; }
  },
};
function loadPrefs() {
  const raw = store.get(PREFS_KEY);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (['auto', 'light', 'dark'].includes(p.theme)) S.prefs.theme = p.theme;
        if (typeof p.cb === 'boolean') S.prefs.cb = p.cb;
        if (['muted', 'standard', 'none'].includes(p.basemap)) S.prefs.basemap = p.basemap;
        if (typeof p.hub === 'string') S.prefs.hub = p.hub;
        if (typeof p.shortcuts === 'boolean') S.prefs.shortcuts = p.shortcuts;
        if (typeof p.legend === 'boolean') S.prefs.legend = p.legend;
        S.prefs.legendChosen = typeof p.legend === 'boolean';
      }
    } catch { /* corrupt preference: ignore */ }
  } else {
    // One-time migration from the v3 keys.
    if (store.get('stroke-dark') === 'true') S.prefs.theme = 'dark';
    if (store.get('stroke-cb') === 'true') S.prefs.cb = true;
  }
  for (const k of LEGACY_KEYS) store.remove(k);
  if (!S.prefs.legendChosen && MOBILE_Q.matches) S.prefs.legend = false;
}
function savePrefs() {
  const { legendChosen, ...p } = S.prefs;
  void legendChosen;
  store.set(PREFS_KEY, JSON.stringify(p));
}

// ------------------------------------------------------------------
// Theme
// ------------------------------------------------------------------
function effectiveTheme() {
  const choice = S.ui.theme || S.prefs.theme;
  if (choice === 'light' || choice === 'dark') return choice;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme();
  const cb = S.ui.cb != null ? S.ui.cb : S.prefs.cb;
  document.documentElement.classList.toggle('cb', !!cb);
  cssCache.clear();
  if (S.booted) { refreshMarkerStyles(); renderLegend(); }
}
const cssCache = new Map();
function cssVar(name) {
  if (!cssCache.has(name)) cssCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#777');
  return cssCache.get(name);
}

// ------------------------------------------------------------------
// Record helpers
// ------------------------------------------------------------------
const tierOf = h => (h && h.derived && h.derived.tier) || null;
const capOf = h => (h && h.derived && h.derived.capability) || 'unassessed';
const eligOf = h => (h && h.derived && h.derived.eligibility && h.derived.eligibility.value) || 'unknown';
const stOf = c => C.claimState(c);
const isOOR = h => !!(h && h.outOfRegion);
const isLocated = h => !!C.locationOf(h);
const cityOf = h => (h && h.address && h.address.city) || null;
function placeLine(h) {
  return [cityOf(h), h.state].filter(Boolean).join(', ');
}
function nationalLabel(h) {
  const n = h.national || {};
  switch (stOf(n)) {
    case 'affirmative': return [n.body, n.program || C.TIER_NAMES[n.tier]].filter(Boolean).join(' — ');
    case 'negative': return 'Verified: no national stroke certification' + (n.note ? ` (${n.note})` : '');
    case 'no-record-found': return 'No national stroke certification found in reviewed sources';
    case 'conflicting': return 'Conflicting evidence';
    case 'not-applicable': return 'Not applicable';
    default: return 'Not assessed';
  }
}
function stateLabel(h) {
  const s = h.stateDesignation || {};
  const st = stOf(s);
  if (st === 'affirmative') {
    const lvl = `${s.system} Level ${s.level}`;
    return s.status && s.status !== 'designated' ? `${lvl} (${s.status})` : lvl;
  }
  if (st === 'not-applicable') return s.note || 'No state stroke-designation program identified for this state';
  if (st === 'no-record-found') return `Not found on the ${s.system || 'state'} roster as reviewed`;
  if (st === 'negative') return `Not designated (${s.system || 'state'} roster, as reviewed)`;
  if (st === 'conflicting') return 'Conflicting evidence';
  return 'Not assessed';
}
function evtLabel(h) {
  const e = stOf(h.evt);
  const e24 = stOf(h.evt247);
  if (e24 === 'affirmative') return 'Documented 24/7';
  if (e === 'affirmative') return e24 === 'conflicting' ? 'Documented; 24/7 coverage conflicting' : 'Documented; 24/7 coverage not documented';
  if (e === 'conflicting' || e24 === 'conflicting') return 'Conflicting evidence';
  if (e === 'no-record-found' || e24 === 'no-record-found') return 'No thrombectomy program found in reviewed sources';
  if (e === 'negative') return 'Verified: no thrombectomy program';
  return 'Not assessed';
}
function lastCheckedOf(h) { return (h.derived && h.derived.capabilityChecked) || null; }
function ageDays(dateStr) {
  if (!dateStr || !S.meta) return null;
  const a = Date.parse(dateStr.length === 7 ? dateStr + '-01' : dateStr);
  const b = Date.parse(S.meta.evidence_review_date);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}
function sourceOf(id) { return (S.meta && S.meta.sources && S.meta.sources[id]) || null; }

// ------------------------------------------------------------------
// Data
// ------------------------------------------------------------------
async function fetchData(attempt) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), 20000);
  try {
    const resp = await fetch(DATA_URL, { cache: 'no-cache', signal: ctl ? ctl.signal : undefined });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${DATA_URL}`);
    const json = await resp.json();
    if (!json || !Array.isArray(json.hospitals) || !String(json.schema_version || '').startsWith('4.')) {
      throw new Error('Unexpected data format (expected schema 4)');
    }
    return json;
  } catch (err) {
    if ((attempt || 0) < 1 && err && err.name !== 'SyntaxError') return fetchData((attempt || 0) + 1);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function ingest(json) {
  S.meta = json;
  S.all = json.hospitals.map(h => {
    h.fields = C.buildSearchFields(h);
    return h;
  });
  S.byId = new Map(S.all.map(h => [h.id, h]));
  const sys = new Set();
  for (const h of S.all) if (!isOOR(h) && h.system && h.system.value) sys.add(h.system.value);
  S.systems = Array.from(sys).sort((a, b) => a.localeCompare(b));
}

function recomputeAccess() {
  const opts = { includeNeighbors: S.ui.neighbors };
  S.sets.evt247 = C.destinationSet(S.all, 'evt247', opts);
  S.sets.advanced = C.destinationSet(S.all, 'advanced', opts);
  const hub = S.ui.hub ? S.byId.get(S.ui.hub) : null;
  S.access = {};
  for (const h of S.all) S.access[h.id] = C.computeAccess(h, S.sets, hub);
}

// ------------------------------------------------------------------
// Filtering
// ------------------------------------------------------------------
function presetPredicate(key) {
  if (key === 'telestroke') {
    return h => !isOOR(h) && eligOf(h) === 'eligible' && !C.hasDocumented247Evt(h) && !C.isAdvancedCenter(h);
  }
  if (key === 'evt') {
    return h => {
      if (isOOR(h) || (h.status && h.status.value) !== 'active') return false;
      const e = stOf(h.evt);
      const e24 = stOf(h.evt247);
      const t = tierOf(h);
      if (e === 'conflicting' || e24 === 'conflicting') return true;
      if (e === 'affirmative' && e24 !== 'affirmative') return true;
      if ((t === 'CSC' || t === 'TSC') && e24 !== 'affirmative') return true;
      if (t === 'PSC' && (e24 === 'unknown' || e24 === 'no-record-found')) return true;
      const beds = h.cms && h.cms.beds;
      if (capOf(h) === 'unassessed' && beds >= 100) return true;
      return false;
    };
  }
  if (key === 'state') {
    return h => {
      if (isOOR(h) || !['WA', 'ID'].includes(h.state) || (h.status && h.status.value) !== 'active') return false;
      const sd = h.stateDesignation || {};
      const s = stOf(sd);
      if (s === 'unknown' || s === 'conflicting') return true;
      if (s === 'affirmative' && sd.status && sd.status !== 'designated') return true;
      if (s === 'affirmative' && stOf(h.national) === 'affirmative') {
        const x = (C.STATE_CROSSWALK[sd.system] || {})[sd.level];
        if (x && x !== h.national.tier) return true;
      }
      if (s === 'no-record-found' && stOf(h.national) === 'affirmative') return true;
      return false;
    };
  }
  return null;
}

function inScope(h, ui, hasQuery) {
  if (isOOR(h)) return hasQuery || ui.scope === 'all';
  if (hasQuery || ui.scope === 'all') return true;
  const e = eligOf(h);
  if (e === 'eligible') return true;
  if (e === 'unknown') return ui.include.includes('unknown');
  if (e === 'excluded') return ui.include.includes('excluded');
  return false;
}

function tierKey(h) {
  if (isOOR(h)) return null;
  const t = tierOf(h);
  if (t) return t.toLowerCase();
  const cap = capOf(h);
  if (cap === 'unassessed') return 'unassessed';
  if (cap === 'conflicting') return 'conflicting';
  return 'none';
}

function passesOther(h, ui, tokens, exceptTier) {
  if (tokens.length && !C.matchesQuery(h.fields, tokens)) return false;
  if (ui.state !== 'ALL' && h.state !== ui.state && !isOOR(h)) return false;
  if (ui.state !== 'ALL' && isOOR(h)) return false;
  if (ui.system) {
    if (ui.system === '__independent') { if (!(h.system && h.system.state === 'independent')) return false; }
    else if (ui.system === '__unknown') { if (!(h.system && h.system.state === 'unknown')) return false; }
    else if (!(h.system && h.system.value === ui.system)) return false;
  }
  if (ui.basis === 'national' && !(stOf(h.national) === 'affirmative')) return false;
  if (ui.basis === 'state' && !(h.derived && h.derived.tierBasis === 'state-crosswalk')) return false;
  if (ui.cah) {
    const s = stOf(h.cah);
    if (ui.cah === 'yes' && s !== 'affirmative') return false;
    if (ui.cah === 'no' && s !== 'negative') return false;
    if (ui.cah === 'unknown' && (s === 'affirmative' || s === 'negative')) return false;
  }
  if (ui.evidence.length) {
    const cap = capOf(h);
    const nv = (h.derived && h.derived.needsVerification) || [];
    const ok = ui.evidence.some(f => (f === 'assessed' && (cap === 'assessed' || cap === 'partial'))
      || (f === 'unassessed' && cap === 'unassessed')
      || (f === 'conflicting' && cap === 'conflicting')
      || (f === 'needs-verification' && nv.length > 0));
    if (!ok) return false;
  }
  if (ui.evtMin > 0) {
    const a = S.access[h.id];
    const mi = a && a.evt247.miles;
    if (!C.isNum(mi) || mi < ui.evtMin) return false;
  }
  if (!exceptTier) {
    if (ui.tiers.length && !ui.tiers.includes(tierKey(h))) return false;
    if (ui.evt && !C.hasDocumented247Evt(h)) return false;
  }
  if (ui.preset) {
    const pred = presetPredicate(ui.preset);
    if (pred && !pred(h)) return false;
  }
  return true;
}

function computeResults() {
  const ui = S.ui;
  const tokens = C.tokenize(ui.q);
  const hasQuery = tokens.length > 0;
  const results = [];
  const counts = { csc: 0, tsc: 0, psc: 0, asr: 0, none: 0, unassessed: 0, evt: 0, 'inc-unknown': 0, 'inc-excluded': 0 };
  for (const h of S.all) {
    const scoped = inScope(h, ui, hasQuery);
    if (!isOOR(h) && !hasQuery && ui.scope === 'eligible') {
      // Counts for the include toggles: what each would add.
      if (passesOther(h, ui, tokens, false)) {
        if (eligOf(h) === 'unknown') counts['inc-unknown']++;
        if (eligOf(h) === 'excluded') counts['inc-excluded']++;
      }
    }
    if (!scoped) continue;
    if (passesOther(h, ui, tokens, true)) {
      const k = tierKey(h);
      if (k && counts[k] != null) counts[k]++;
      if (C.hasDocumented247Evt(h) && (!ui.tiers.length || ui.tiers.includes(k))) counts.evt++;
    }
    if (passesOther(h, ui, tokens, false)) results.push(h);
  }
  sortResults(results, tokens);
  S.results = results;
  S.counts = counts;
}

function sortResults(rows, tokens) {
  const ui = S.ui;
  const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const tierRank = h => (tierOf(h) ? TIER_ORDER[tierOf(h)] : capOf(h) === 'unassessed' ? 5 : 4);
  const evtMi = h => { const a = S.access[h.id]; return a && C.isNum(a.evt247.miles) ? a.evt247.miles : Infinity; };
  const hubMi = h => { const a = S.access[h.id]; return a && a.hub && C.isNum(a.hub.miles) ? a.hub.miles : Infinity; };
  const key = ui.sort;
  rows.sort((a, b) => {
    if (key === 'relevance' && tokens.length) {
      const ra = C.searchRank(a.fields, ui.q, tokens);
      const rb = C.searchRank(b.fields, ui.q, tokens);
      if (ra !== rb) return ra - rb;
      if (isOOR(a) !== isOOR(b)) return isOOR(a) ? 1 : -1;
    }
    if (key === 'name') return byName(a, b);
    if (key === 'evt') return evtMi(a) - evtMi(b) || byName(a, b);
    if (key === 'hub') return hubMi(a) - hubMi(b) || byName(a, b);
    if (key === 'checked') {
      const ca = lastCheckedOf(a) || '';
      const cb = lastCheckedOf(b) || '';
      if (ca !== cb) return ca < cb ? 1 : -1;
      return byName(a, b);
    }
    if (isOOR(a) !== isOOR(b)) return isOOR(a) ? 1 : -1;
    return tierRank(a) - tierRank(b) || byName(a, b);
  });
}

function activeFilterParts() {
  const ui = S.ui;
  const parts = [];
  if (ui.preset) parts.push('preset: ' + presetTitle(ui.preset));
  if (ui.state !== 'ALL') parts.push(STATE_NAMES[ui.state]);
  if (ui.tiers.length) parts.push(ui.tiers.map(t => ({ none: 'none found', unassessed: 'not assessed' }[t] || t.toUpperCase())).join('/'));
  if (ui.evt) parts.push('24/7 EVT');
  if (ui.basis) parts.push(ui.basis === 'national' ? 'national certification' : 'state designation only');
  if (ui.cah) parts.push('CAH: ' + ui.cah);
  if (ui.system) parts.push(ui.system === '__independent' ? 'independent' : ui.system === '__unknown' ? 'system unknown' : ui.system);
  if (ui.evidence.length) parts.push(ui.evidence.join('/'));
  if (ui.evtMin) parts.push(`≥${ui.evtMin} mi to 24/7 EVT`);
  return parts;
}
function scopeLabel() {
  const ui = S.ui;
  if (C.tokenize(ui.q).length) return 'search across all records';
  if (ui.scope === 'all') return 'all facility records';
  const inc = [];
  if (ui.include.includes('unknown')) inc.push('eligibility unresolved');
  if (ui.include.includes('excluded')) inc.push('excluded');
  return 'adult emergency analysis set' + (inc.length ? ' + ' + inc.join(' + ') : '');
}
function filtersActive() {
  const ui = S.ui;
  const d = C.defaultUiState();
  const incChanged = ui.include.slice().sort().join(',') !== d.include.slice().sort().join(',');
  return !!(ui.preset || ui.state !== 'ALL' || ui.tiers.length || ui.evt || ui.basis || ui.cah || ui.system || ui.evidence.length || ui.evtMin || ui.scope !== 'eligible' || incChanged);
}

// ------------------------------------------------------------------
// Render orchestration
// ------------------------------------------------------------------
let renderQueued = false;
function update(opts) {
  if (opts && opts.access) recomputeAccess();
  computeResults();
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderResults();
    renderCounts();
    renderStatus();
    renderMap();
    renderLegend();
    renderSummaryTables();
    renderCompareList();
    if (S.ui.selected) renderDetail();
    scheduleUrlSave();
  });
}

// ------------------------------------------------------------------
// Find view
// ------------------------------------------------------------------
function badge(cls, text, title) {
  return el('span', { class: 'badge ' + cls, text, title });
}
function rowBadges(h) {
  const out = [];
  if (S.ui.hub === h.id) out.push(badge('b-HUB', 'My center'));
  if (isOOR(h)) out.push(badge('b-OOR', 'Outside WWAMI · destination only'));
  const n = h.national || {};
  if (stOf(n) === 'affirmative') out.push(badge('b-' + n.tier, `${n.tier} · ${BODY_ABBR[n.body] || n.body}`, nationalLabel(h)));
  const sd = h.stateDesignation || {};
  if (stOf(sd) === 'affirmative') {
    const lvl = `${STATE_SYS_ABBR[sd.system] || sd.system} L${sd.level}` + (sd.status && sd.status !== 'designated' ? ` (${sd.status})` : '');
    out.push(badge(stOf(n) === 'affirmative' ? 'b-STATE' : 'b-' + (tierOf(h) || 'STATE') + ' b-STATE', lvl, stateLabel(h) + ' — state designation, not national accreditation'));
  }
  if (C.hasDocumented247Evt(h)) out.push(badge('b-EVT', '24/7 EVT'));
  const cap = capOf(h);
  if (!isOOR(h)) {
    if (cap === 'unassessed') out.push(badge('b-UNASSESSED', 'Capability not assessed'));
    else if (cap === 'conflicting') out.push(badge('b-CONFLICT', 'Conflicting evidence'));
    else if (!tierOf(h)) out.push(badge('b-MUTED', 'No certification found'));
  }
  const e = h.derived && h.derived.eligibility;
  const status = h.status && h.status.value;
  if (status === 'closed' || status === 'merged') out.push(badge('b-MUTED', status === 'closed' ? 'Closed' : 'Merged campus'));
  else if (e && e.value === 'excluded') out.push(badge('b-MUTED', 'Excluded: ' + ({ pediatric: 'pediatric', 'no-general-ed': 'no general ED' }[e.code] || e.code)));
  else if (e && e.value === 'unknown' && !isOOR(h)) out.push(badge('b-MUTED', 'Eligibility unresolved'));
  if (!isLocated(h)) out.push(badge('b-MUTED', 'No map location'));
  return out;
}

function rowDistance(h) {
  const a = S.access[h.id];
  if (!a) return '';
  if (S.ui.hub && a.hub && S.ui.sort === 'hub') {
    return a.hub.status === 'on-site' ? 'my center' : C.isNum(a.hub.miles) ? C.formatMiles(a.hub.miles) + ' mi to my center' : '';
  }
  if (a.evt247.status === 'on-site') return '24/7 EVT on site';
  if (C.isNum(a.evt247.miles)) return C.formatMiles(a.evt247.miles) + ' mi to 24/7 EVT';
  return '';
}

function renderResults() {
  const list = $('#results');
  if (!list) return;
  const focusedId = document.activeElement && document.activeElement.closest && document.activeElement.closest('#results')
    ? document.activeElement.dataset.id : null;
  clear(list);
  if (!S.results.length) {
    const li = el('li', { class: 'empty' }, [
      el('p', { text: S.ui.q ? `No hospitals match “${S.ui.q}”${filtersActive() ? ' with the current filters' : ''}.` : 'No hospitals match the current filters.' }),
      filtersActive() ? el('button', { type: 'button', class: 'btn', text: 'Reset filters', on: { click: resetFilters } }) : null,
      S.ui.q ? el('p', { class: 'hint', text: 'Search matches whole-word beginnings across names, former names, nicknames, city, county, system and CMS number.' }) : null,
    ]);
    list.appendChild(li);
    return;
  }
  let tabbable = S.results.findIndex(h => h.id === (focusedId || S.ui.selected));
  if (tabbable < 0) tabbable = 0;
  const frag = document.createDocumentFragment();
  S.results.forEach((h, i) => {
    const glyph = svgEl(glyphSvg(glyphModel(h, { forList: true })));
    const btn = el('button', {
      type: 'button', class: 'result', tabindex: i === tabbable ? '0' : '-1',
      dataset: { id: h.id, index: String(i) },
      'aria-current': S.ui.selected === h.id ? 'true' : null,
    }, [
      el('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph),
      el('span', { class: 'r-name', text: h.name }),
      el('span', { class: 'r-dist', text: rowDistance(h) }),
      el('span', { class: 'r-meta', text: [placeLine(h), h.system && h.system.value].filter(Boolean).join(' · ') }),
      el('span', { class: 'r-badges' }, rowBadges(h)),
    ]);
    frag.appendChild(el('li', null, btn));
  });
  list.appendChild(frag);
  if (focusedId) {
    const again = list.querySelector(`.result[data-id="${CSS.escape(focusedId)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

function onResultsKey(e) {
  const btn = e.target.closest('.result');
  if (!btn) return;
  const all = $$('.result', $('#results'));
  const i = all.indexOf(btn);
  let next = null;
  if (e.key === 'ArrowDown') next = Math.min(all.length - 1, i + 1);
  else if (e.key === 'ArrowUp') next = i === 0 ? -1 : i - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = all.length - 1;
  else if (e.key === 'PageDown') next = Math.min(all.length - 1, i + 10);
  else if (e.key === 'PageUp') next = Math.max(0, i - 10);
  else return;
  e.preventDefault();
  if (next === -1) { $('#search').focus(); return; }
  all.forEach((b, j) => { b.tabIndex = j === next ? 0 : -1; });
  all[next].focus();
  all[next].scrollIntoView({ block: 'nearest' });
}

function renderCounts() {
  const c = S.counts || {};
  for (const chip of $$('#tier-chips .chip')) {
    const k = chip.dataset.tier;
    chip.setAttribute('aria-pressed', String(S.ui.tiers.includes(k)));
    const span = $('.count', chip);
    if (span) span.textContent = c[k] != null ? String(c[k]) : '';
  }
  const setCount = (key, v) => { const n = document.querySelector(`[data-count="${key}"]`); if (n) n.textContent = v != null ? `(${v})` : ''; };
  setCount('evt', c.evt);
  const scopeAll = S.ui.scope === 'all' || C.tokenize(S.ui.q).length;
  setCount('inc-unknown', scopeAll ? null : c['inc-unknown']);
  setCount('inc-excluded', scopeAll ? null : c['inc-excluded']);
  const n = activeFilterParts().length + (S.ui.scope !== 'eligible' || S.ui.include.slice().sort().join(',') !== 'unknown' ? 1 : 0);
  $('#filter-count').textContent = n ? String(n) : '';
  $('#reset-filters').hidden = !filtersActive();
  const nb = $('#nb-count');
  if (nb) nb.textContent = `(${S.all.filter(isOOR).length})`;
}

function renderStatus() {
  const total = S.all.filter(h => !isOOR(h)).length;
  const shown = S.results.length;
  const onMap = S.results.filter(isLocated).length;
  const unloc = shown - onMap;
  const summary = $('#result-summary');
  clear(summary);
  appendAll(summary, [el('strong', { text: String(shown) }), ` of ${total} records · ${scopeLabel()}`,
    unloc ? ` · ${unloc} without a map location` : '']);
  const toggle = $('#sheet-toggle');
  if (toggle) toggle.textContent = document.body.classList.contains('sheet-open') ? 'Show map' : `Show list (${shown})`;
  const ms = $('#map-status');
  clear(ms);
  const parts = activeFilterParts();
  const sep = () => el('span', { class: 'sep', text: ' · ', 'aria-hidden': 'true' });
  const sel = S.ui.selected && S.byId.get(S.ui.selected);
  appendAll(ms, [
    el('span', null, ['Map: ', el('strong', { text: MODE_LABELS[S.ui.mode] })]), sep(),
    el('span', { text: `${onMap} on map` + (unloc ? `, ${unloc} not located` : '') + '; ' }),
    el('span', { text: scopeLabel() + (parts.length ? '; ' : '') }),
    parts.length ? el('span', { text: 'filters: ' + parts.join(', ') }) : null,
    filtersActive() ? el('button', { type: 'button', class: 'link-btn', text: 'Reset filters', on: { click: resetFilters } }) : null,
    sel && $('#detail').hidden ? sep() : null,
    sel && $('#detail').hidden ? el('button', { type: 'button', class: 'link-btn', text: 'Details: ' + sel.name, on: { click: () => { document.body.classList.remove('detail-minimized'); openDetail(); renderDetail(); $('#detail-title').focus(); } } }) : null,
  ]);
}

function resetFilters() {
  const d = C.defaultUiState();
  Object.assign(S.ui, { state: 'ALL', tiers: [], evt: false, evidence: [], basis: null, cah: null, system: null, scope: 'eligible', include: d.include.slice(), evtMin: 0, preset: null, sort: d.sort });
  syncControls();
  update();
  toast('Filters reset');
}

// ------------------------------------------------------------------
// Marker glyphs (one model → SVG for map/list/legend, canvas for PNG)
// ------------------------------------------------------------------
function glyphModel(h, opts) {
  const mode = (opts && opts.mode) || S.ui.mode;
  const a = S.access[h.id];
  const cap = capOf(h);
  const tier = tierOf(h);
  const m = {
    shape: isOOR(h) ? 'square' : cap === 'conflicting' ? 'diamond' : 'circle',
    size: 14, fill: '--c-none', stroke: '--marker-stroke', dashed: false, hollow: false,
    evtRing: C.hasDocumented247Evt(h), hub: S.ui.hub === h.id, selected: S.ui.selected === h.id,
    dim: false, dashOverlay: false,
  };
  if (mode === 'capability') {
    m.size = tier ? { CSC: 20, TSC: 19, PSC: 17, ASR: 15 }[tier] : 13;
    if (isOOR(h)) { m.fill = tier ? TIER_VAR[tier] : '--c-neighbor'; m.size = 14; }
    else if (cap === 'unassessed') { m.hollow = true; m.dashed = true; m.stroke = '--c-unassessed'; }
    else if (cap === 'conflicting') {
      // Shape carries the conflict; fill still shows the tier when one is documented (e.g. a state level).
      m.size = tier ? Math.max(15, m.size - 2) : 15;
      if (tier) m.fill = TIER_VAR[tier];
      else { m.hollow = true; m.stroke = '--c-conflict'; }
    } else m.fill = tier ? TIER_VAR[tier] : '--c-none';
  } else if (mode === 'evt-distance' || mode === 'adv-distance' || mode === 'hub-distance') {
    const r = !a ? null : mode === 'evt-distance' ? a.evt247 : mode === 'adv-distance' ? a.advanced : a.hub;
    const bin = r ? C.distanceBin(r.miles) : 'unknown';
    m.fill = { 'on-site': '--d-0', lt50: '--d-1', '50-100': '--d-2', '100-150': '--d-3', '150plus': '--d-4' }[bin] || null;
    if (!m.fill) { m.hollow = true; m.stroke = '--text-3'; }
    m.size = 14;
    if (cap === 'unassessed' && !isOOR(h)) m.dashOverlay = true;
    if (isOOR(h)) m.fill = '--c-neighbor';
  } else if (mode === 'evidence') {
    m.size = 14;
    if (isOOR(h)) m.fill = '--c-neighbor';
    else if (cap === 'unassessed') { m.hollow = true; m.dashed = true; m.stroke = '--c-unassessed'; }
    else if (cap === 'conflicting') { m.hollow = true; m.stroke = '--c-conflict'; m.size = 16; }
    else if (cap === 'partial') m.fill = '--e-partial';
    else {
      const age = ageDays(lastCheckedOf(h));
      m.fill = age != null && age <= STALE_DAYS ? '--e-assessed' : '--e-old';
    }
  } else if (mode === 'eligibility') {
    m.size = 14;
    const e = eligOf(h);
    if (isOOR(h)) m.fill = '--c-neighbor';
    else if (e === 'eligible') m.fill = '--c-hub';
    else if (e === 'excluded') m.fill = '--c-excluded';
    else { m.hollow = true; m.dashed = true; m.stroke = '--text-3'; }
  }
  if (!isOOR(h) && eligOf(h) === 'excluded' && mode !== 'eligibility') m.dim = true;
  if (opts && opts.forList) { m.selected = false; m.size = Math.min(m.size, 16); }
  return m;
}

function shapePath(shape, cx, cy, r) {
  if (shape === 'diamond') return `M${cx} ${cy - r * 1.2}L${cx + r * 1.2} ${cy}L${cx} ${cy + r * 1.2}L${cx - r * 1.2} ${cy}Z`;
  if (shape === 'square') return `M${cx - r} ${cy - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

// Builds markup from the model only (numbers and internal CSS variable names).
function glyphSvg(m) {
  const pad = 8;
  const box = m.size + pad * 2;
  const c = box / 2;
  const r = m.size / 2;
  const parts = [];
  if (m.selected) parts.push(`<path d="${shapePath('circle', c, c, r + 6)}" style="fill:none;stroke:var(--marker-halo);stroke-width:6"/>`);
  if (m.hub) parts.push(`<path d="${shapePath('circle', c, c, r + 5.5)}" style="fill:none;stroke:var(--c-hub);stroke-width:2.5"/><path d="${shapePath('circle', c, c, r + 2.8)}" style="fill:none;stroke:var(--surface);stroke-width:2"/>`);
  if (m.evtRing) parts.push(`<path d="${shapePath(m.shape === 'diamond' ? 'circle' : m.shape, c, c, r + (m.hub ? 1.4 : 2.6))}" style="fill:none;stroke:var(--c-evt);stroke-width:3"/>`);
  const fill = m.hollow ? 'var(--surface)' : `var(${m.fill})`;
  const dash = m.dashed ? 'stroke-dasharray:2.6 2;' : '';
  const sw = m.hollow ? 2 : 1.6;
  parts.push(`<path d="${shapePath(m.shape, c, c, r)}" style="fill:${fill};stroke:var(${m.stroke});stroke-width:${sw};${dash}"/>`);
  if (m.dashOverlay) parts.push(`<path d="${shapePath('circle', c, c, r + 2.4)}" style="fill:none;stroke:var(--c-unassessed);stroke-width:1.8;stroke-dasharray:2.6 2"/>`);
  return `<svg class="mk" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

function glyphSignature(m) {
  return [m.shape, m.size, m.fill, m.stroke, m.dashed, m.hollow, m.evtRing, m.hub, m.selected, m.dim, m.dashOverlay].join('|');
}

// ------------------------------------------------------------------
// Map
// ------------------------------------------------------------------
function initMap() {
  if (typeof window.L === 'undefined') {
    const mapEl = $('#map');
    mapEl.appendChild(el('div', { class: 'boot-error', role: 'note' }, [
      el('h2', { text: 'The map library did not load' }),
      el('p', { text: 'Some networks block parts of the page. The hospital list, details, sources and exports still work from the Find view.' }),
    ]));
    return false;
  }
  S.map = L.map('map', {
    zoomControl: false, minZoom: 2, maxZoom: 17, zoomSnap: 0.5, zoomDelta: 0.5,
    worldCopyJump: false, keyboard: true,
    fadeAnimation: !REDUCED_MOTION, zoomAnimation: !REDUCED_MOTION, markerZoomAnimation: !REDUCED_MOTION,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(S.map);
  S.map.attributionControl.setPrefix('<a href="https://leafletjs.com" title="Leaflet">Leaflet</a>');
  S.lineLayer = L.layerGroup().addTo(S.map);
  S.overlayLayer = L.layerGroup().addTo(S.map);
  S.ringLayer = L.layerGroup().addTo(S.map);
  S.markerLayer = L.layerGroup().addTo(S.map);
  setBasemap();
  S.map.on('moveend', () => { if (S.booted) scheduleUrlSave(); });
  S.map.on('zoomend', () => { if (S.booted) refreshOffsets(); });
  return true;
}

function currentBasemap() { return S.ui.basemap || S.prefs.basemap || 'muted'; }
function setBasemap() {
  if (!S.map) return;
  const bm = currentBasemap();
  const mapEl = S.map.getContainer();
  mapEl.classList.remove('bm-muted', 'bm-standard', 'bm-none');
  mapEl.classList.add('bm-' + bm);
  if (bm === 'none') {
    if (S.tiles) { S.map.removeLayer(S.tiles); S.tiles = null; }
    S.map.attributionControl.removeAttribution(TILE_ATTRIBUTION);
    return;
  }
  if (!S.tiles) {
    // crossOrigin lets the PNG export draw tiles without tainting the canvas;
    // OpenStreetMap serves CORS headers. Attribution stays visible per the
    // OSMF tile usage policy.
    S.tiles = L.tileLayer(TILE_URL, { maxZoom: 19, crossOrigin: 'anonymous', attribution: TILE_ATTRIBUTION }).addTo(S.map);
    S.tiles.on('tileload', () => { S.tileStats.ok++; if (S.tileStats.warned) { $('#map-banner').hidden = true; S.tileStats.warned = false; } });
    S.tiles.on('tileerror', () => {
      S.tileStats.err++;
      if (S.tileStats.err >= 6 && S.tileStats.ok === 0 && !S.tileStats.warned) {
        S.tileStats.warned = true;
        const b = $('#map-banner');
        b.textContent = 'Basemap tiles could not be loaded (offline or blocked). Hospital markers, the list, details and exports still work.';
        b.hidden = false;
      }
    });
  }
}

function dataBounds(records) {
  const pts = records.filter(isLocated).map(h => [h.location.lat, h.location.lng]);
  return pts.length ? L.latLngBounds(pts) : null;
}

function mapPadding() {
  const pad = { tl: [24, 24], br: [24, 24] };
  if (!S.map) return pad;
  const mapRect = S.map.getContainer().getBoundingClientRect();
  const status = $('#map-status');
  if (status && status.offsetParent) {
    const r = status.getBoundingClientRect();
    if (r.top - mapRect.top < 100) pad.tl[1] = Math.max(pad.tl[1], r.bottom - mapRect.top + 16);
  }
  const legend = $('#legend');
  if (legend && legend.offsetParent && !MOBILE_Q.matches) {
    const r = legend.getBoundingClientRect();
    if (r.width < mapRect.width / 2) pad.tl[0] = Math.max(pad.tl[0], r.right - mapRect.left + 16);
  }
  const detail = $('#detail');
  if (detail && !detail.hidden && !MOBILE_Q.matches) {
    const r = detail.getBoundingClientRect();
    // On narrower desktops the panel floats over the map.
    const overlap = mapRect.right - r.left;
    if (overlap > 0) pad.br[0] = Math.max(pad.br[0], overlap + 24);
  }
  return pad;
}

function fitTo(bounds, maxZoom) {
  if (!S.map || !bounds) return;
  const p = mapPadding();
  S.map.fitBounds(bounds, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: maxZoom || 11, animate: !REDUCED_MOTION });
}

// Same-coordinate campuses get small, fixed screen-space offsets so each stays
// visible and clickable at every zoom; their true coordinates are unchanged.
function computeOffsets(records) {
  S.offsets = new Map();
  const groups = new Map();
  for (const h of records) {
    if (!isLocated(h)) continue;
    const key = h.location.lat.toFixed(3) + ',' + h.location.lng.toFixed(3);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.id.localeCompare(b.id));
    g.forEach((h, i) => {
      const ang = (2 * Math.PI * i) / g.length - Math.PI / 2;
      const rad = 9 + g.length * 1.5;
      S.offsets.set(h.id, [Math.round(Math.cos(ang) * rad), Math.round(Math.sin(ang) * rad)]);
    });
  }
}
function refreshOffsets() { /* offsets are in screen pixels and zoom-independent */ }

function markerIcon(h, m) {
  const box = m.size + 16;
  const off = S.offsets.get(h.id) || [0, 0];
  return L.divIcon({
    className: 'mk-icon' + (m.dim ? ' dim' : ''),
    html: glyphSvg(m),
    iconSize: [box, box],
    iconAnchor: [box / 2 - off[0], box / 2 - off[1]],
  });
}

function mapRecords() {
  // Results plus whatever the selection needs to stay legible: the selected
  // hospital, its destinations and my receiving center, even when filtered out.
  const ids = new Set(S.results.filter(isLocated).map(h => h.id));
  const extra = [];
  const sel = S.ui.selected && S.byId.get(S.ui.selected);
  const want = [];
  if (sel) {
    want.push(sel);
    const a = S.access[sel.id];
    if (a) { if (a.evt247.dest) want.push(a.evt247.dest); if (a.advanced.dest) want.push(a.advanced.dest); }
  }
  if (S.ui.hub && S.byId.get(S.ui.hub)) want.push(S.byId.get(S.ui.hub));
  if (S.ui.neighbors) for (const h of S.all) if (isOOR(h)) want.push(h);
  for (const h of want) if (h && isLocated(h) && !ids.has(h.id)) { ids.add(h.id); extra.push(h); }
  return S.results.filter(isLocated).concat(extra);
}

function renderMap() {
  if (!S.map) return;
  const records = mapRecords();
  computeOffsets(records);
  const keep = new Set();
  for (const h of records) {
    keep.add(h.id);
    const m = glyphModel(h);
    const off = S.offsets.get(h.id) || [0, 0];
    const sig = glyphSignature(m) + '|' + off.join(',');
    let mk = S.markers.get(h.id);
    if (!mk) {
      mk = L.marker([h.location.lat, h.location.lng], { icon: markerIcon(h, m), keyboard: false, riseOnHover: true, title: '' });
      mk.bindTooltip(() => markerTooltip(h), { direction: 'top', offset: [0, -10], opacity: 1 });
      mk.on('click', (e) => onMarkerClick(h, e));
      S.markers.set(h.id, mk);
      S.markerSig.set(h.id, sig);
    } else if (S.markerSig.get(h.id) !== sig) {
      mk.setIcon(markerIcon(h, m));
      S.markerSig.set(h.id, sig);
    }
    mk.setZIndexOffset(m.selected ? 2000 : m.hub ? 1500 : m.evtRing ? 800 : tierOf(h) ? 400 - TIER_ORDER[tierOf(h)] * 50 : 0);
    if (!S.markerLayer.hasLayer(mk)) S.markerLayer.addLayer(mk);
  }
  for (const [id, mk] of S.markers) if (!keep.has(id) && S.markerLayer.hasLayer(mk)) S.markerLayer.removeLayer(mk);
  renderLines();
  renderOverlays();
}

function refreshMarkerStyles() {
  S.markerSig.clear();
  renderMap();
}

function markerTooltip(h) {
  const a = S.access[h.id];
  const lines = [el('strong', { text: h.name }), el('br'), placeLine(h)];
  if (isOOR(h)) { lines.push(el('br'), 'Outside WWAMI — destination only'); }
  else {
    lines.push(el('br'), tierOf(h) ? `${tierOf(h)} (${h.derived.tierBasis === 'national' ? 'national' : 'state level'})` : CAP_LABELS[capOf(h)] || '');
  }
  if (C.hasDocumented247Evt(h)) lines.push(' · 24/7 EVT');
  if (a && a.evt247.status === 'ok') lines.push(el('br'), `${C.formatMiles(a.evt247.miles)} mi straight-line to nearest 24/7 EVT`);
  return el('span', null, lines);
}

function onMarkerClick(h, e) {
  // Overlapping markers: offer a chooser instead of silently picking the top one.
  if (S.map && e && e.containerPoint) {
    const near = [];
    for (const [id, mk] of S.markers) {
      if (!S.markerLayer.hasLayer(mk)) continue;
      const p = S.map.latLngToContainerPoint(mk.getLatLng());
      const off = S.offsets.get(id) || [0, 0];
      const dx = p.x + off[0] - e.containerPoint.x;
      const dy = p.y + off[1] - e.containerPoint.y;
      if (dx * dx + dy * dy <= 13 * 13) near.push(S.byId.get(id));
    }
    if (near.length > 1) { openChooser(near, mk => mk, e.latlng); return; }
  }
  selectHospital(h.id, { source: 'map' });
}

function openChooser(records, _unused, latlng) {
  records.sort((a, b) => (TIER_ORDER[tierOf(a)] ?? 9) - (TIER_ORDER[tierOf(b)] ?? 9) || a.name.localeCompare(b.name));
  const box = el('div', { class: 'chooser', role: 'group', 'aria-label': `${records.length} hospitals at this spot` }, [
    el('h3', { text: `${records.length} hospitals here` }),
    ...records.map(h => el('button', { type: 'button', on: { click: () => { S.map.closePopup(); selectHospital(h.id, { source: 'chooser', focusDetail: true }); } } }, [
      svgEl(glyphSvg(glyphModel(h, { forList: true }))), el('span', { text: h.name }),
    ])),
  ]);
  const pop = L.popup({ maxWidth: 320, autoPan: true }).setLatLng(latlng).setContent(box).openOn(S.map);
  setTimeout(() => { const b = box.querySelector('button'); if (b) b.focus(); }, 0);
  pop.on('remove', () => {});
}

function addLine(layer, from, to, style, label) {
  const line = L.polyline([[from.location.lat, from.location.lng], [to.location.lat, to.location.lng]], Object.assign({ interactive: false }, style));
  layer.addLayer(line);
  if (label) {
    const mid = L.latLng((from.location.lat + to.location.lat) / 2, (from.location.lng + to.location.lng) / 2);
    layer.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'line-label', interactive: false }).setLatLng(mid).setContent(label));
  }
  return line;
}

function selectionLines() {
  const sel = S.ui.selected && S.byId.get(S.ui.selected);
  if (!sel || !isLocated(sel) || !S.ui.overlays.includes('lines')) return [];
  const a = S.access[sel.id];
  const out = [];
  if (a.evt247.status === 'ok') out.push({ kind: 'evt', to: a.evt247.dest, miles: a.evt247.miles });
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  if (hub && a.hub && a.hub.status === 'ok' && (!a.evt247.dest || hub.id !== a.evt247.dest.id)) out.push({ kind: 'hub', to: hub, miles: a.hub.miles });
  if (S.showAdvLine && a.advanced.status === 'ok' && !out.some(x => x.to.id === a.advanced.dest.id)) out.push({ kind: 'adv', to: a.advanced.dest, miles: a.advanced.miles });
  return out;
}

function lineStyle(kind) {
  if (kind === 'evt') return { color: cssVar('--c-evt'), weight: 3.5, opacity: 0.95 };
  if (kind === 'hub') return { color: cssVar('--c-hub'), weight: 3, opacity: 0.95, dashArray: '9 7' };
  return { color: cssVar('--text-2'), weight: 2.5, opacity: 0.9, dashArray: '2 6' };
}

function renderLines() {
  if (!S.lineLayer) return;
  S.lineLayer.clearLayers();
  const sel = S.ui.selected && S.byId.get(S.ui.selected);
  for (const l of selectionLines()) {
    const label = `${C.formatMiles(l.miles)} mi straight-line` + (l.kind === 'hub' ? ' · my center' : l.kind === 'adv' ? ' · CSC/TSC-level' : ' · 24/7 EVT');
    addLine(S.lineLayer, sel, l.to, lineStyle(l.kind), label);
  }
}

function renderOverlays() {
  if (!S.overlayLayer) return;
  S.overlayLayer.clearLayers();
  S.ringLayer.clearLayers();
  if (S.ui.overlays.includes('nearest')) {
    let n = 0;
    for (const h of S.results) {
      if (isOOR(h) || !isLocated(h)) continue;
      const a = S.access[h.id];
      if (!a || a.evt247.status !== 'ok') continue;
      const line = L.polyline([[h.location.lat, h.location.lng], [a.evt247.dest.location.lat, a.evt247.dest.location.lng]],
        { color: cssVar('--text-3'), weight: 1.2, opacity: 0.55, interactive: true });
      line.bindTooltip(() => el('span', null, [el('strong', { text: h.name }), el('br'),
        `Modeled nearest documented 24/7 EVT center: ${a.evt247.dest.name} (${C.formatMiles(a.evt247.miles)} mi straight-line).`, el('br'),
        'Geometry only — not a referral relationship.']), { sticky: true });
      S.overlayLayer.addLayer(line);
      n++;
    }
    S.nearestLineCount = n;
  }
  if (S.ui.overlays.includes('rings')) {
    for (const c of S.sets.evt247) {
      for (const [mi, dash] of [[50, null], [100, '6 6']]) {
        S.ringLayer.addLayer(L.circle([c.location.lat, c.location.lng], {
          radius: mi * 1609.344, color: cssVar('--c-evt'), weight: 1.2, opacity: 0.6, fill: false, dashArray: dash, interactive: false,
        }));
      }
    }
  }
}

// ------------------------------------------------------------------
// Legend (always matches the active mode)
// ------------------------------------------------------------------
function legendRow(model, text) {
  return el('div', { class: 'legend-row' }, [svgEl(glyphSvg(Object.assign({ shape: 'circle', size: 12, fill: '--c-none', stroke: '--marker-stroke', dashed: false, hollow: false, evtRing: false, hub: false, selected: false, dim: false, dashOverlay: false }, model))), el('span', { text })]);
}
function legendLine(cls, text) {
  return el('div', { class: 'legend-row' }, [el('span', { class: 'line-key ' + cls, 'aria-hidden': 'true' }), el('span', { text })]);
}
function legendModel() {
  const mode = S.ui.mode;
  const groups = [];
  if (mode === 'capability') {
    groups.push({ title: 'Fill: tier shown', rows: [
      [{ fill: '--c-csc', size: 16 }, 'CSC — Comprehensive'],
      [{ fill: '--c-tsc', size: 15 }, 'TSC — Thrombectomy-Capable (incl. DNV PSC+)'],
      [{ fill: '--c-psc', size: 14 }, 'PSC — Primary'],
      [{ fill: '--c-asr', size: 13 }, 'ASR — Acute Stroke Ready'],
      [{ fill: '--c-none' }, 'No certification or designation found in reviewed sources'],
      [{ hollow: true, dashed: true, stroke: '--c-unassessed' }, 'Capability not assessed'],
      [{ shape: 'diamond', hollow: true, stroke: '--c-conflict' }, 'Diamond: conflicting evidence (filled when a tier is still documented)'],
    ], note: 'A state level is shown on the tier it maps to (display crosswalk) — not national accreditation. The list and details name the basis.' });
  } else if (mode === 'evidence') {
    groups.push({ title: 'Fill: evidence status', rows: [
      [{ fill: '--e-assessed' }, `Assessed, checked within ${STALE_DAYS} days of the review date`],
      [{ fill: '--e-old' }, 'Assessed, older evidence'],
      [{ fill: '--e-partial' }, 'Partly assessed'],
      [{ hollow: true, dashed: true, stroke: '--c-unassessed' }, 'Not assessed'],
      [{ shape: 'diamond', hollow: true, stroke: '--c-conflict' }, 'Conflicting evidence'],
    ] });
  } else if (mode === 'eligibility') {
    groups.push({ title: 'Fill: analysis eligibility', rows: [
      [{ fill: '--c-hub' }, 'Adult emergency analysis set'],
      [{ fill: '--c-excluded' }, 'Excluded (reason in details)'],
      [{ hollow: true, dashed: true, stroke: '--text-3' }, 'Eligibility unresolved'],
    ], note: S.ui.scope === 'eligible' && !S.ui.include.length ? 'Excluded and unresolved records are hidden by the current scope (Find → Filters & scope).' : null });
  } else {
    const what = mode === 'evt-distance' ? 'nearest documented 24/7 EVT center' : mode === 'adv-distance' ? 'nearest CSC/TSC-level center' : 'my receiving center';
    groups.push({ title: `Fill: straight-line miles to ${what}`, rows: [
      [{ fill: '--d-0' }, mode === 'hub-distance' ? 'This is my center (0 mi)' : 'On site (0 mi)'],
      [{ fill: '--d-1' }, 'Under 50 mi'],
      [{ fill: '--d-2' }, '50–100 mi'],
      [{ fill: '--d-3' }, '100–150 mi'],
      [{ fill: '--d-4' }, '150 mi or more'],
      [{ hollow: true, stroke: '--text-3' }, 'Distance unknown'],
    ], note: `Destinations: ${destinationNote(mode)}. Straight-line, not road distance or travel time.` });
  }
  const shape = [
    [{ fill: '--c-psc', evtRing: true }, 'Teal ring: documented 24/7 EVT'],
  ];
  if (mode !== 'capability' && mode !== 'evidence') {
    shape.push([{ fill: '--d-2', dashOverlay: true }, 'Dashed ring: capability not assessed']);
    shape.push([{ fill: '--d-2', shape: 'diamond' }, 'Diamond: conflicting capability evidence']);
  }
  if (S.ui.hub) shape.push([{ fill: '--c-none', hub: true }, 'Double blue ring: my receiving center']);
  if (S.ui.neighbors && S.all.some(isOOR)) shape.push([{ shape: 'square', fill: '--c-neighbor' }, 'Square: center in a neighboring state (destination only)']);
  shape.push([{ fill: '--c-none', selected: true }, 'Halo: selected hospital']);
  groups.push({ title: 'Rings and shapes', rows: shape });
  const lines = selectionLines();
  if (lines.length || S.ui.overlays.includes('nearest') || S.ui.overlays.includes('rings')) {
    const rows = [];
    if (lines.some(l => l.kind === 'evt')) rows.push(['', 'Selected → nearest documented 24/7 EVT']);
    if (lines.some(l => l.kind === 'hub')) rows.push(['hub', 'Selected → my receiving center']);
    if (lines.some(l => l.kind === 'adv')) rows.push(['adv', 'Selected → nearest CSC/TSC-level center']);
    groups.push({ title: 'Lines', lines: rows, note: 'Straight-line geometry. Not road routes, transfer pathways or referral relationships.'
      + (S.ui.overlays.includes('nearest') ? ' Thin grey lines: modeled nearest 24/7 EVT center for each listed hospital.' : '')
      + (S.ui.overlays.includes('rings') ? ' Teal circles: 50 / 100 mi straight-line radius, not travel time.' : '') });
  }
  return groups;
}
function destinationNote(mode) {
  if (mode === 'hub-distance') { const hub = S.byId.get(S.ui.hub); return hub ? hub.name : 'none chosen'; }
  const set = mode === 'evt-distance' ? S.sets.evt247 : S.sets.advanced;
  const nb = set.filter(isOOR).length;
  return `${set.length} ${mode === 'evt-distance' ? 'documented 24/7 EVT centers' : 'CSC/TSC-level centers'} in this dataset` + (nb ? ` (incl. ${nb} in neighboring states)` : '');
}
function renderLegend() {
  const body = $('#legend-body');
  if (!body) return;
  clear(body);
  $('#legend-title').textContent = 'Legend · ' + MODE_LABELS[S.ui.mode];
  for (const g of legendModel()) {
    const grp = el('div', { class: 'legend-group' }, [el('h3', { text: g.title })]);
    for (const [m, t] of g.rows || []) grp.appendChild(legendRow(m, t));
    for (const [cls, t] of g.lines || []) grp.appendChild(legendLine(cls, t));
    if (g.note) grp.appendChild(el('p', { class: 'legend-note', text: g.note }));
    body.appendChild(grp);
  }
  const lg = $('#legend');
  lg.classList.toggle('collapsed', !S.prefs.legend);
  const tg = $('#legend-toggle');
  tg.setAttribute('aria-expanded', String(!!S.prefs.legend));
  tg.setAttribute('aria-label', S.prefs.legend ? 'Collapse legend' : 'Expand legend');
}

// ------------------------------------------------------------------
// Selection + detail panel
// ------------------------------------------------------------------
function selectHospital(id, opts) {
  const h = S.byId.get(id);
  if (!h) return;
  const o = opts || {};
  if (o.source !== 'url') S.detailOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  S.ui.selected = id;
  S.showAdvLine = false;
  openDetail();
  update();
  if (S.map && isLocated(h) && o.source !== 'url-keep-view') {
    if (o.source === 'map') {
      if (!S.map.getBounds().pad(-0.15).contains([h.location.lat, h.location.lng])) S.map.panTo([h.location.lat, h.location.lng], { animate: !REDUCED_MOTION });
    } else {
      requestAnimationFrame(() => fitConnections(false));
    }
  }
  if (o.focusDetail !== false && o.source !== 'url') {
    requestAnimationFrame(() => $('#detail-title').focus({ preventScroll: true }));
  }
}

function openDetail() {
  const d = $('#detail');
  d.hidden = false;
  document.body.classList.add('detail-open');
  if (S.map) setTimeout(() => S.map.invalidateSize(), 0);
}

function closeDetail(restore) {
  const d = $('#detail');
  if (d.hidden) return;
  d.hidden = true;
  document.body.classList.remove('detail-open');
  const prevId = S.ui.selected;
  S.ui.selected = null;
  update();
  if (S.map) setTimeout(() => S.map.invalidateSize(), 0);
  if (restore !== false) {
    const opener = S.detailOpener;
    S.detailOpener = null;
    const openerId = opener && opener.dataset ? opener.dataset.id : null;
    // Resolve the target after the re-render: list rows are rebuilt, so the
    // element that opened the panel may have been replaced by an equivalent one.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      let target = opener && document.contains(opener) && opener.offsetParent ? opener : null;
      const rowId = openerId || prevId;
      if (!target && rowId) target = $(`.result[data-id="${CSS.escape(rowId)}"]`);
      if (!target) target = $('#search');
      if (target) target.focus({ preventScroll: false });
    }));
  }
}

function fitConnections(closeOnMobile) {
  const h = S.byId.get(S.ui.selected);
  if (!h || !S.map || !isLocated(h)) return;
  if (closeOnMobile && MOBILE_Q.matches) {
    $('#detail').hidden = true;
    document.body.classList.remove('detail-open');
    document.body.classList.add('detail-minimized');
  }
  const pts = [[h.location.lat, h.location.lng]];
  for (const l of selectionLines()) pts.push([l.to.location.lat, l.to.location.lng]);
  if (pts.length === 1) { S.map.setView(pts[0], Math.max(S.map.getZoom(), 10), { animate: !REDUCED_MOTION }); return; }
  fitTo(L.latLngBounds(pts), 11);
}

function claimRow(label, valueNodes, claim, extra) {
  const st = claim ? stOf(claim) : null;
  const meta = [];
  if (claim) {
    if (claim.effective) meta.push('effective ' + claim.effective);
    if (claim.expires) meta.push('expires ' + claim.expires);
    meta.push(claim.checked ? 'checked ' + claim.checked + (claim.method ? ' · ' + methodShort(claim.method) : '') : 'never checked');
  }
  return el('div', { class: 'claim' }, [
    el('dt', { text: label }),
    el('dd', null, [
      st && claim.state !== undefined ? el('span', { class: 'state-tag st-' + st, text: C.CLAIM_LABELS[st] }) : null,
      el('span', { class: 'c-value' }, valueNodes),
      extra ? el('div', { class: 'c-meta', text: extra }) : null,
      claim && claim.note ? el('div', { class: 'c-meta', text: claim.note }) : null,
      claim ? el('div', { class: 'c-meta', text: meta.join(' · ') }) : null,
    ]),
  ]);
}
function methodShort(m) {
  return { 'prior-edition': 'carried from previous edition', 'search-extract': 'web search extract', 'nppes-api': 'NPPES API', 'cms-dataset': 'CMS dataset', 'regulatory-inference': 'regulatory inference', 'rule-based': 'documented rule', 'manual-review': 'maintainer review', derived: 'derived' }[m] || m;
}
function valueClaimText(c, map) {
  if (!c) return '—';
  const v = c.value;
  return (map && map[v]) || (v == null || v === 'unknown' ? 'Not documented' : String(v));
}

function renderDetail() {
  const h = S.byId.get(S.ui.selected);
  const body = $('#detail-body');
  if (!h || !body) return;
  const scrollTop = body.scrollTop;
  $('#detail-title').textContent = h.name;
  $('#detail-sub').textContent = [placeLine(h), h.system && h.system.value].filter(Boolean).join(' · ');
  renderDetailActions(h);
  clear(body);

  // 1. Evidence banner
  const cap = capOf(h);
  const elig = h.derived.eligibility || {};
  const checked = lastCheckedOf(h);
  const age = ageDays(checked);
  const banner = el('div', { class: 'status-banner ' + (cap === 'unassessed' ? 'unassessed' : cap === 'conflicting' ? 'conflicting' : elig.value === 'excluded' ? 'excluded' : '') });
  if (isOOR(h)) {
    banner.appendChild(el('strong', { text: 'Receiving center outside the five WWAMI states.' }));
    banner.appendChild(el('span', { text: 'Included only so distances from border hospitals name the true nearest documented center. Not part of the WWAMI inventory or counts.' }));
  } else {
    banner.appendChild(el('strong', { text: CAP_LABELS[cap] + (checked ? ` · last checked ${checked}${age != null ? ` (${age} days before the ${S.meta.evidence_review_date} review)` : ''}` : '') }));
    if (cap === 'unassessed') banner.appendChild(el('span', { text: 'No certification shown here means not checked — not that none exists. Confirm directly before relying on it.' }));
    if (cap === 'conflicting') banner.appendChild(el('span', { text: 'Credible sources disagree. Both are cited below; neither is shown as settled.' }));
    banner.appendChild(el('span', { text: `${ELIG_LABELS[elig.value] || ''}: ${elig.reason || ''}` }));
  }
  body.appendChild(banner);

  // 2. Stroke capability
  const capSec = el('section', { class: 'd-section', 'aria-labelledby': 'd-cap' }, [el('h3', { id: 'd-cap', text: 'Stroke capability' })]);
  const dl = el('dl', { class: 'claims' });
  dl.appendChild(claimRow('National certification', nationalLabel(h), h.national));
  dl.appendChild(claimRow('State designation', stateLabel(h), h.stateDesignation));
  dl.appendChild(claimRow('Thrombectomy (EVT)', evtLabel(h), h.evt247 && stOf(h.evt247) !== 'unknown' ? h.evt247 : h.evt,
    h.evt247 && h.evt247.basis ? 'Basis for 24/7: ' + h.evt247.basis : null));
  const tier = tierOf(h);
  dl.appendChild(claimRow('Tier shown on map', tier ? `${tier} — ${C.TIER_NAMES[tier]}` : (cap === 'unassessed' ? 'None (not assessed)' : 'None'), null,
    tier ? (h.derived.tierBasis === 'national' ? 'From the national certification.' : 'From the state designation via the display crosswalk — not a national certification.') : null));
  capSec.appendChild(dl);
  body.appendChild(capSec);

  // 3. Access
  if (!isOOR(h)) body.appendChild(renderAccessSection(h));

  // 4. Identity and campus
  const idSec = el('section', { class: 'd-section', 'aria-labelledby': 'd-id' }, [el('h3', { id: 'd-id', text: 'Identity and campus' })]);
  const idl = el('dl', { class: 'claims' });
  const addr = h.address || {};
  idl.appendChild(claimRow('Status', valueClaimText(h.status, { active: 'Active', closed: 'Closed', merged: 'Merged into another campus' }), h.status));
  idl.appendChild(claimRow('Address', [C.formatStreet(addr.street), [addr.city, h.state, addr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Not documented', addr,
    ADDRESS_STATUS[addr.status] || null));
  idl.appendChild(claimRow('County / borough', h.derived.county ? h.derived.county + (h.derived.geoFlags.includes('near-county-boundary') ? ' (near a boundary — uncertain)' : '') : '—', null, 'Derived from the coordinates (2017 Census boundaries).'));
  const loc = h.location;
  idl.appendChild(claimRow('Map location', loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` + (loc.precision === 'city' ? ' (town centre — approximate)' : '') : 'No cited location — not drawn on the map', null,
    loc ? [`Method: ${locMethod(loc.method)} · precision: ${loc.precision}`, loc.note,
      loc.conflict ? `A second source puts it at ${loc.conflict.lat.toFixed(4)}, ${loc.conflict.lng.toFixed(4)} (${loc.conflict.distanceMi} mi away).` : null,
      h.derived.cityDistanceMi != null ? `${h.derived.cityDistanceMi} mi from the centre of ${addr.city}.` : null].filter(Boolean).join(' · ') : null));
  if (!isOOR(h)) {
    idl.appendChild(claimRow('Emergency department', h.ed ? (stOf(h.ed) === 'affirmative' ? 'Documented: ' + (h.ed.scope || '24/7 general ED') : C.CLAIM_LABELS[stOf(h.ed)]) : '—', h.ed));
    idl.appendChild(claimRow('Population served', valueClaimText(h.population, { 'all-ages': 'All ages', adult: 'Adults', pediatric: 'Pediatric' }), h.population));
    idl.appendChild(claimRow('Service type', valueClaimText(h.serviceType, { 'general-acute': 'General acute care', 'specialty-surgical': 'Specialty surgical', 'specialty-cancer': 'Specialty cancer', 'specialty-other': 'Specialty', 'rural-emergency-hospital': 'Rural Emergency Hospital' }), h.serviceType));
    idl.appendChild(claimRow('Critical Access Hospital', stOf(h.cah) === 'affirmative' ? 'Yes' : stOf(h.cah) === 'negative' ? 'No' : C.CLAIM_LABELS[stOf(h.cah)], h.cah));
    idl.appendChild(claimRow('Ownership / governance', valueClaimText(h.governance, { nonprofit: 'Nonprofit', proprietary: 'Proprietary', 'government-local': 'Local government / hospital district', 'government-state': 'State government', 'federal-ihs': 'Indian Health Service (federal)', tribal: 'Tribal', 'military-dod': 'Military (DoD)', 'veterans-affairs': 'Veterans Affairs' }), h.governance));
    idl.appendChild(claimRow('Health system', h.system && h.system.value ? h.system.value : h.system && h.system.state === 'independent' ? 'Independent' : 'Not documented', h.system,
      'Public affiliation only — it does not establish telestroke, referral or contract relationships.'));
    const ccn = h.ccn || {};
    idl.appendChild(claimRow('CMS Certification Number', ccn.value ? ccn.value + (ccn.relation === 'shared' ? ' (shared with another campus)' : '') : ccn.relation === 'none' ? 'None (not a Medicare-certified provider)' : 'Unknown', null,
      [ccn.note, ccn.correctedFrom ? 'Corrected from ' + ccn.correctedFrom : null,
        (ccn.previous || []).length ? 'Earlier CCN: ' + ccn.previous.map(p => `${p.value}${p.cmsName ? ' (' + p.cmsName + ', last listed ' + p.lastListed + ')' : ''}`).join('; ') : null,
        (h.previousIds || []).length ? 'Earlier record id: ' + h.previousIds.join(', ') : null, h.cms ? `CMS name (${h.cms.asOf}): ${h.cms.name}; type ${h.cms.hospitalType || '—'}` + (h.cms.beds != null ? `; ${h.cms.beds} beds (${h.cms.bedsScope})` : '') : null].filter(Boolean).join(' · ') || null));
    if (h.npi) idl.appendChild(claimRow('NPI', h.npi, null, 'NPPES organization record'));
    if ((h.formerNames || []).length || (h.aliases || []).length) idl.appendChild(claimRow('Also searched as', [].concat(h.formerNames || [], h.aliases || []).join(' · '), null));
  }
  idSec.appendChild(idl);
  body.appendChild(idSec);

  // 5. Sources
  body.appendChild(renderSourcesSection(h));

  // 6. Nearby
  if (isLocated(h)) body.appendChild(renderNearby(h));
  body.scrollTop = scrollTop;
}

function locMethod(m) {
  return { 'rule-based': 'two independent coordinate sources agree (see note)', 'cms-dataset': 'CMS-supplied coordinates (geocoding method not documented by CMS)', 'legacy-geocode': 'earlier-edition geocode (geocoder, query and match type not recorded)', 'city-centroid': 'town centre from the GeoNames gazetteer (approximate)', 'source-reported': 'coordinates stated by the cited source', 'manual-review': 'maintainer review against the cited source' }[m] || m;
}

function renderDetailActions(h) {
  const bar = $('#detail-actions');
  clear(bar);
  const inCmp = S.ui.compare.includes(h.id);
  if (isLocated(h) && S.map) {
    bar.appendChild(el('button', { type: 'button', class: 'btn', text: MOBILE_Q.matches ? 'Show on map' : 'Fit connections', on: { click: () => fitConnections(true) } }));
  }
  if (!isOOR(h) && C.canBeDestination(h)) {
    const isHub = S.ui.hub === h.id;
    bar.appendChild(el('button', { type: 'button', class: 'btn', 'aria-pressed': String(isHub), text: isHub ? 'My receiving center ✓' : 'Set as my receiving center', on: { click: () => setHub(isHub ? null : h.id, true) } }));
  }
  if (!isOOR(h)) {
    bar.appendChild(el('button', { type: 'button', class: 'btn', 'aria-pressed': String(inCmp), text: inCmp ? 'In comparison ✓' : 'Add to comparison', disabled: !inCmp && S.ui.compare.length >= C.MAX_COMPARE, on: { click: () => toggleCompare(h.id) } }));
  }
  const a = S.access[h.id];
  if (isLocated(h) && a && a.advanced.status === 'ok' && (!a.evt247.dest || a.advanced.dest.id !== a.evt247.dest.id)) {
    bar.appendChild(el('button', { type: 'button', class: 'btn', 'aria-pressed': String(S.showAdvLine), text: S.showAdvLine ? 'Hide CSC/TSC-level line' : 'Show CSC/TSC-level line', on: { click: () => { S.showAdvLine = !S.showAdvLine; renderLines(); renderLegend(); renderDetailActions(h); } } }));
  }
  bar.appendChild(el('button', { type: 'button', class: 'btn', text: 'Copy link', on: { click: () => copyLink() } }));
}

function accessRow(kind, label, res, extraNote) {
  const lineCls = kind === 'evt' ? '' : kind === 'hub' ? 'hub' : 'adv';
  const dest = res && res.dest;
  let mi;
  let note = extraNote || '';
  if (!res) { mi = '—'; }
  else if (res.status === 'on-site') { mi = '0 mi'; note = (note ? note + ' ' : '') + (kind === 'hub' ? 'This is my receiving center.' : 'On site — no interfacility transfer for this destination class.'); }
  else if (res.status === 'ok') mi = C.formatMiles(res.miles) + ' mi';
  else if (res.status === 'no-location') { mi = '—'; note = 'Unavailable: no verified location for this hospital.'; }
  else { mi = '—'; note = 'Unavailable: no destination in this set.'; }
  return el('div', { class: 'access-row' }, [
    el('div', null, [
      el('div', { class: 'a-label' }, [el('span', { class: 'line-key ' + lineCls, 'aria-hidden': 'true' }), label]),
      dest && res.status === 'ok' ? el('button', { type: 'button', class: 'link-btn a-dest', text: dest.name, on: { click: () => selectHospital(dest.id, { source: 'detail' }) } }) : null,
      dest && res.status === 'ok' && isOOR(dest) ? el('span', { class: 'badge b-OOR', text: 'Outside WWAMI' }) : null,
    ]),
    el('div', { class: 'a-mi', text: mi }),
    note ? el('p', { class: 'a-note', text: note }) : null,
  ]);
}

function renderAccessSection(h) {
  const sec = el('section', { class: 'd-section', 'aria-labelledby': 'd-acc' }, [el('h3', { id: 'd-acc', text: 'Straight-line access' })]);
  const a = S.access[h.id];
  const box = el('div', { class: 'access' });
  const nbNote = S.ui.neighbors ? '' : ' Neighboring-state centers excluded.';
  box.appendChild(accessRow('evt', `Nearest of ${S.sets.evt247.length} documented 24/7 EVT centers in this dataset`, a.evt247, nbNote.trim() || null));
  box.appendChild(accessRow('adv', `Nearest of ${S.sets.advanced.length} CSC/TSC-level centers`, a.advanced,
    a.advanced.dest && a.advanced.dest.derived && a.advanced.dest.derived.tierBasis === 'state-crosswalk' ? 'This destination’s tier rests on a state designation.' : null));
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  if (hub) {
    box.appendChild(accessRow('hub', 'My receiving center', a.hub));
    const diff = C.hubDifferential(h, a, S.ui.transport);
    if (diff.status === 'ok' && a.hub.status !== 'on-site') {
      const lines = [];
      lines.push(diff.sameCenter
        ? 'My center is also the nearest documented 24/7 EVT center (difference 0 mi).'
        : `My center is ${C.formatSignedMiles(diff.miles)} mi straight-line compared with the nearest documented 24/7 EVT center.`);
      for (const m of diff.minutes) {
        const name = { ground: 'Ground', rotor: 'Rotor-wing', fixed: 'Fixed-wing' }[m.mode];
        lines.push(m.diff == null ? `${name}: comparison unavailable — ${m.reason}.` : `${name} scenario: ${m.diff > 0.5 ? Math.round(m.diff) + ' min longer' : m.diff < -0.5 ? Math.round(-m.diff) + ' min shorter' : 'about the same'} under the stated assumptions.`);
      }
      box.appendChild(el('div', { class: 'note' }, [el('strong', { text: 'Comparison (same metric, same assumptions): ' }), el('br'), ...lines.flatMap((t, i) => i ? [el('br'), t] : [t])]));
    } else if (diff.status === 'unavailable') {
      box.appendChild(el('p', { class: 'hint', text: 'Comparison unavailable: ' + diff.reason + '.' }));
    }
  } else {
    box.appendChild(el('p', { class: 'hint' }, ['Choose ', el('button', { type: 'button', class: 'link-btn', text: 'my receiving center', on: { click: () => switchView('explore', { focus: '#hub-select' }) } }), ' to compare distances.']));
  }
  sec.appendChild(box);
  // Transport scenario table for the nearest 24/7 EVT destination and my center.
  const dests = [];
  if (a.evt247.status === 'ok') dests.push(['Nearest 24/7 EVT', a.evt247.dest, a.evt247.miles]);
  if (hub && a.hub && a.hub.status === 'ok' && (!a.evt247.dest || a.evt247.dest.id !== hub.id)) dests.push(['My center', hub, a.hub.miles]);
  if (dests.length) {
    const p = C.transportParams(S.ui.transport);
    const tbl = el('table', { class: 'data scenario' });
    tbl.appendChild(el('caption', { text: 'Illustrative transfer scenario (minutes, departure → arrival at the receiving hospital)' }));
    tbl.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Leg' }), ...dests.map(d => el('th', { scope: 'col', class: 'num', text: d[0] }))])));
    const tb = el('tbody');
    tb.appendChild(el('tr', null, [el('th', { scope: 'row', text: `DIDO at this hospital (scenario input; includes activation and loading)` }), ...dests.map(() => el('td', { class: 'num', text: String(p.didoMin) }))]));
    for (const [mode, name] of [['ground', 'Ground ambulance'], ['rotor', 'Rotor-wing'], ['fixed', 'Fixed-wing (incl. ground legs)']]) {
      tb.appendChild(el('tr', null, [el('th', { scope: 'row', text: name }), ...dests.map(d => {
        const leg = C.legScenario(mode, h, d[1], d[2], p);
        return el('td', { class: 'num', text: leg.minutes == null ? '—' : C.formatMinutes(leg.minutes), title: leg.reason || null });
      })]));
    }
    tbl.appendChild(tb);
    sec.appendChild(el('div', { class: 'table-wrap' }, tbl));
    const reasons = [];
    for (const d of dests) for (const mode of ['ground', 'rotor']) {
      const leg = C.legScenario(mode, h, d[1], d[2], p);
      if (leg.minutes == null && leg.reason) reasons.push(`${d[0]}, ${mode}: ${leg.reason}.`);
    }
    sec.appendChild(el('p', { class: 'hint', text: (reasons.length ? reasons.join(' ') + ' ' : '')
      + `Assumptions: road distance = straight-line × ${p.roadFactor} at ${p.groundMph} mph; rotor ${p.rotorMph} mph up to ${p.rotorMaxMi} mi; fixed-wing ${p.fixedMph} mph plus ${p.fixedGroundLegsMin} min of ground legs. Not dispatch times; aircraft, weather and acceptance are not modelled; receiving-center treatment intervals are not included. Adjust in Explore → Transport scenario assumptions.` }));
  }
  return sec;
}

function renderSourcesSection(h) {
  const sec = el('section', { class: 'd-section', 'aria-labelledby': 'd-src' }, [el('h3', { id: 'd-src', text: 'Evidence and sources' })]);
  const list = el('div', { class: 'sources' });
  const claims = [['national', 'National certification'], ['stateDesignation', 'State designation'], ['evt', 'Thrombectomy'], ['evt247', '24/7 thrombectomy'],
    ['ed', 'Emergency department'], ['status', 'Status'], ['cah', 'CAH'], ['system', 'Health system'], ['population', 'Population'], ['serviceType', 'Service type'],
    ['governance', 'Governance'], ['address', 'Address'], ['location', 'Location']];
  const seen = new Map();
  for (const [key, label] of claims) {
    const c = h[key];
    for (const ev of (c && c.evidence) || []) {
      const k = ev.src + '|' + (ev.excerpt || '');
      if (!seen.has(k)) seen.set(k, { ev, labels: [] });
      seen.get(k).labels.push(label);
    }
  }
  if (!seen.size) list.appendChild(el('p', { class: 'hint', text: 'No sources cited for this record yet.' }));
  for (const { ev, labels } of seen.values()) {
    const s = sourceOf(ev.src) || { title: ev.src };
    const dates = [s.published ? 'published ' + s.published : null, s.effective ? 'effective ' + s.effective : null, s.accessed ? 'accessed ' + s.accessed : null].filter(Boolean).join(' · ');
    list.appendChild(el('div', { class: 'source' }, [
      el('span', { class: 's-title' }, s.url && s.access !== 'inaccessible' ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title || s.url }) : (s.title || ev.src)),
      el('span', { text: [s.publisher, ({ 'issuer-registry': 'issuer registry', 'official-facility': 'hospital/system source', government: 'government', news: 'news', tertiary: 'tertiary', dataset: 'dataset', nppes: 'NPPES', 'prior-edition': 'previous edition', regulation: 'regulation' }[s.type] || s.type)].filter(Boolean).join(' · ') }),
      el('span', { text: 'Supports: ' + labels.join(', ') + (ev.supports ? ' — ' + ev.supports : '') }),
      ev.excerpt ? el('q', { text: ev.excerpt }) : null,
      dates ? el('span', { class: 'hint', text: dates + (s.access ? ' · access: ' + s.access : '') }) : null,
    ]));
  }
  sec.appendChild(list);
  return sec;
}

function renderNearby(h) {
  const sec = el('section', { class: 'd-section', 'aria-labelledby': 'd-near' }, [el('h3', { id: 'd-near', text: 'Nearby hospitals (straight-line)' })]);
  const rows = S.all.filter(x => x.id !== h.id && isLocated(x) && !isOOR(x) && (x.status && x.status.value) !== 'closed')
    .map(x => ({ x, mi: C.distanceBetween(h, x) }))
    .sort((a, b) => a.mi - b.mi).slice(0, 6);
  const box = el('div', { class: 'nearby' });
  for (const { x, mi } of rows) {
    box.appendChild(el('button', { type: 'button', on: { click: () => selectHospital(x.id, { source: 'detail' }) } }, [
      svgEl(glyphSvg(glyphModel(x, { forList: true }))),
      el('span', { class: 'n-name' }, [x.name + ' ', ...rowBadges(x).slice(0, 2)]),
      el('span', { class: 'n-mi', text: C.formatMiles(mi) + ' mi' }),
    ]));
  }
  sec.appendChild(box);
  return sec;
}

// ------------------------------------------------------------------
// Hub (my receiving center)
// ------------------------------------------------------------------
function hubCandidates() {
  return S.all.filter(h => !isOOR(h) && C.canBeDestination(h))
    .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
}
function populateHubSelect() {
  const sel = $('#hub-select');
  clear(sel);
  sel.appendChild(el('option', { value: '', text: '— Choose a hospital —' }));
  const byState = {};
  for (const h of hubCandidates()) (byState[h.state] = byState[h.state] || []).push(h);
  for (const st of ['WA', 'AK', 'ID', 'MT', 'WY']) {
    if (!byState[st]) continue;
    const g = el('optgroup', { label: STATE_NAMES[st] });
    for (const h of byState[st]) g.appendChild(el('option', { value: h.id, text: `${h.name} — ${cityOf(h) || ''}` }));
    sel.appendChild(g);
  }
  const hv = S.byId.get(HARBORVIEW_ID);
  const ok = hv && C.canBeDestination(hv);
  $('#hub-preset').hidden = !ok;
}
function setHub(id, persist) {
  if (id && !S.byId.get(id)) return;
  S.ui.hub = id || null;
  if (persist) { S.prefs.hub = S.ui.hub; savePrefs(); }
  const radio = $('input[name="mode"][value="hub-distance"]');
  radio.disabled = !S.ui.hub;
  if (!S.ui.hub && S.ui.mode === 'hub-distance') S.ui.mode = 'capability';
  if (!S.ui.hub && S.ui.sort === 'hub') S.ui.sort = 'relevance';
  syncControls();
  update({ access: true });
  if (persist) toast(S.ui.hub ? `My receiving center: ${S.byId.get(S.ui.hub).name}` : 'Receiving center cleared');
}
function renderHub() {
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const cur = $('#hub-current');
  clear(cur);
  if (hub) appendAll(cur, ['Current: ', el('strong', { text: hub.name }), ` (${placeLine(hub)})`]);
  else cur.textContent = 'No center chosen. Distances compare against the nearest documented center only.';
  $('#hub-select').value = hub ? hub.id : '';
  $('#hub-clear').hidden = !hub;
  const opt = $('#sort option[value="hub"]');
  if (opt) opt.disabled = !hub;
}

// ------------------------------------------------------------------
// Explore: modes, presets, layers, transport, summary tables
// ------------------------------------------------------------------
function presetTitle(k) {
  return { telestroke: 'Telestroke access review', evt: 'EVT capability assessment', state: 'State designation review' }[k] || k;
}
const PRESET_NOTES = {
  telestroke: 'Asks: which campuses in the adult emergency analysis set lack on-site documented 24/7 EVT, and how far are they (straight-line) from documented centers? Does not establish telestroke coverage, onboarding eligibility, transfer agreements or feasibility.',
  evt: 'Asks: where is thrombectomy evidence missing, conflicting, or not documented as 24/7 — including CSC/TSC/PSC-tier sites and large unassessed hospitals? A list of things to verify, not a judgement of any program.',
  state: 'Asks: which Washington and Idaho campuses have an unresolved or pending state stroke level, or a state level that does not match their national tier? State levels and national certifications are different systems.',
};
function applyPreset(key) {
  if (S.ui.preset === key) { S.ui.preset = null; syncControls(); update(); return; }
  S.ui.preset = key;
  Object.assign(S.ui, { tiers: [], evt: false, evidence: [], basis: null, cah: null, system: null, evtMin: 0 });
  if (key === 'telestroke') { S.ui.scope = 'eligible'; S.ui.include = ['unknown']; S.ui.mode = 'evt-distance'; S.ui.sort = 'evt'; Object.assign(S.ui.review, { wGap: 30, wEvt: 50, wAdv: 20 }); }
  if (key === 'evt') { S.ui.scope = 'all'; S.ui.mode = 'capability'; S.ui.sort = 'tier'; }
  if (key === 'state') { S.ui.scope = 'all'; S.ui.mode = 'capability'; S.ui.sort = 'name'; }
  syncControls();
  update();
  toast(`Preset: ${presetTitle(key)} — ${S.results.length} records`);
}

const TRANSPORT_FIELDS = [
  ['didoMin', 'DIDO at sending hospital (min)'], ['roadFactor', 'Road / straight-line factor'], ['groundMph', 'Ground speed (mph)'],
  ['rotorMph', 'Rotor-wing speed (mph)'], ['rotorMaxMi', 'Rotor-wing range (mi)'], ['fixedMph', 'Fixed-wing speed (mph)'],
  ['fixedGroundLegsMin', 'Fixed-wing ground legs (min)'],
];
function buildTransportForm() {
  const f = $('#transport-form');
  clear(f);
  for (const [key, label] of TRANSPORT_FIELDS) {
    const [lo, hi, step] = C.TRANSPORT_RANGES[key];
    const input = el('input', { type: 'number', id: 'tp-' + key, min: String(lo), max: String(hi), step: String(step), value: String(S.ui.transport[key]) });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      const clamped = C.transportParams(Object.assign({}, S.ui.transport, { [key]: v }))[key];
      S.ui.transport[key] = clamped;
      input.value = String(clamped);
      update();
    });
    f.appendChild(el('label', { for: 'tp-' + key }, [label, input]));
  }
}

function stateTableRows(records) {
  const rows = [];
  for (const st of ['WA', 'AK', 'ID', 'MT', 'WY']) {
    const hs = records.filter(h => h.state === st && !isOOR(h));
    rows.push([st, hs]);
  }
  return rows;
}
function stateStats(hs) {
  const c = (f) => hs.filter(f).length;
  return {
    records: hs.length,
    eligible: c(h => eligOf(h) === 'eligible'),
    excluded: c(h => eligOf(h) === 'excluded'),
    unresolved: c(h => eligOf(h) === 'unknown'),
    unlocated: c(h => !isLocated(h)),
    assessed: c(h => capOf(h) === 'assessed' || capOf(h) === 'partial'),
    unassessed: c(h => capOf(h) === 'unassessed'),
    conflicting: c(h => capOf(h) === 'conflicting'),
    advanced: c(h => C.isAdvancedCenter(h)),
    psc: c(h => tierOf(h) === 'PSC'),
    asr: c(h => tierOf(h) === 'ASR'),
    none: c(h => !tierOf(h) && (capOf(h) === 'assessed' || capOf(h) === 'partial')),
    evt: c(h => C.hasDocumented247Evt(h)),
  };
}
const STAT_COLS = [['records', 'Records'], ['eligible', 'Analysis set'], ['excluded', 'Excluded'], ['unresolved', 'Unresolved'], ['unlocated', 'Not located'],
  ['assessed', 'Capability assessed'], ['unassessed', 'Not assessed'], ['conflicting', 'Conflicting'], ['advanced', 'CSC/TSC-level'], ['psc', 'PSC'], ['asr', 'ASR'], ['none', 'None found'], ['evt', '24/7 EVT documented']];

function summaryRecords(scope) {
  return scope === 'all' ? S.all.filter(h => !isOOR(h)) : S.results.filter(h => !isOOR(h));
}
function renderSummaryTables() {
  const wrap = $('#state-table');
  if (!wrap) return;
  const scope = $('#summary-scope').value;
  const recs = summaryRecords(scope);
  clear(wrap);
  const tbl = el('table', { class: 'data' });
  tbl.appendChild(el('caption', { text: `By state — ${scope === 'all' ? 'all facility records' : 'current results (' + scopeLabel() + ')'}` }));
  tbl.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Measure' }), ...['WA', 'AK', 'ID', 'MT', 'WY'].map(s => el('th', { scope: 'col', class: 'num', text: s })), el('th', { scope: 'col', class: 'num', text: 'All' })])));
  const tb = el('tbody');
  const per = stateTableRows(recs).map(([st, hs]) => stateStats(hs));
  const tot = stateStats(recs);
  for (const [k, label] of STAT_COLS) {
    tb.appendChild(el('tr', null, [el('th', { scope: 'row', text: label }), ...per.map(p => el('td', { class: 'num', text: String(p[k]) })), el('td', { class: 'num', text: String(tot[k]) })]));
  }
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
  wrap.appendChild(el('p', { class: 'hint', text: '“None found” = assessed with no certification or designation found in reviewed sources. EVT overlaps the tiers. CSC/TSC-level includes state levels shown on that tier.' }));

  const dwrap = $('#distance-table');
  clear(dwrap);
  const elig = recs.filter(h => eligOf(h) === 'eligible');
  const bins = C.DISTANCE_BINS.map(b => [b, elig.filter(h => C.distanceBin(S.access[h.id] && S.access[h.id].evt247.miles) === b.key).length]);
  const unknown = elig.filter(h => C.distanceBin(S.access[h.id] && S.access[h.id].evt247.miles) === 'unknown').length;
  const max = Math.max(1, ...bins.map(x => x[1]), unknown);
  const t2 = el('table', { class: 'data' });
  t2.appendChild(el('caption', { text: `Straight-line miles to nearest documented 24/7 EVT center — ${elig.length} records in the analysis set within this scope` }));
  t2.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Distance' }), el('th', { scope: 'col', class: 'num', text: 'Records' }), el('th', { scope: 'col', text: '' })])));
  const b2 = el('tbody');
  for (const [b, n] of bins.concat([[{ label: 'Unknown (not located)' }, unknown]])) {
    b2.appendChild(el('tr', null, [el('th', { scope: 'row', text: b.label }), el('td', { class: 'num', text: String(n) }),
      el('td', { 'aria-hidden': 'true' }, el('span', { class: 'bar', style: `width:${Math.round(n / max * 100)}px` }))]));
  }
  t2.appendChild(b2);
  dwrap.appendChild(t2);
}

// ------------------------------------------------------------------
// Access review dialog
// ------------------------------------------------------------------
const REVIEW_FIELDS = [['wGap', 'Weight: documented certification gap'], ['wEvt', 'Weight: miles to nearest 24/7 EVT'], ['wAdv', 'Weight: miles to nearest CSC/TSC-level'], ['wHub', 'Weight: miles to my center'], ['capMi', 'Distance cap (mi)'], ['desertMi', 'Flag beyond (mi) to 24/7 EVT']];
function buildReviewForm() {
  const f = $('#review-form');
  clear(f);
  f.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Candidates from' }), (() => {
    const s = el('select', { id: 'review-scope' }, [el('option', { value: 'results', text: 'Current results' }), el('option', { value: 'all', text: 'Whole analysis set' })]);
    s.value = S.reviewScope;
    s.addEventListener('change', () => { S.reviewScope = s.value; renderReview(); });
    return s;
  })()]));
  for (const [key, label] of REVIEW_FIELDS) {
    const [lo, hi, step] = C.REVIEW_RANGES[key];
    const out = el('output', { for: 'rv-' + key, text: String(S.ui.review[key]) });
    const input = el('input', { type: 'range', id: 'rv-' + key, min: String(lo), max: String(hi), step: String(step), value: String(S.ui.review[key]), disabled: key === 'wHub' && !S.ui.hub });
    input.addEventListener('input', () => { S.ui.review[key] = Number(input.value); out.textContent = input.value; renderReview(); scheduleUrlSave(); });
    f.appendChild(el('label', { for: 'rv-' + key }, [label + (key === 'wHub' && !S.ui.hub ? ' (choose a center first)' : ''), el('span', { class: 'w-row' }, [input, out])]));
  }
}
function reviewInput() {
  const pool = S.reviewScope === 'all' ? S.all : S.results;
  return pool.filter(h => !isOOR(h));
}
function renderReview() {
  const res = C.accessReview(reviewInput(), S.access, S.ui.review, { hasHub: !!S.ui.hub });
  const sens = res.error ? {} : C.rankSensitivity(reviewInput(), S.access, S.ui.review, { hasHub: !!S.ui.hub });
  S.lastReview = res;
  const sum = $('#review-summary');
  if (res.error === 'all-weights-zero') {
    sum.textContent = 'All weights are zero, so there is nothing to rank. Raise at least one weight.';
  } else {
    const beyond = res.ranked.concat(res.shortlist).filter(r => C.isNum(r.evtMi) && r.evtMi > res.params.desertMi).length;
    sum.textContent = `${res.ranked.length} ranked (capability assessed) · ${res.shortlist.length} on the verification shortlist (capability not assessed or conflicting) · ${beyond} beyond ${res.params.desertMi} mi straight-line of a documented 24/7 EVT center · candidates from ${S.reviewScope === 'all' ? 'the whole analysis set' : 'current results'}.`;
  }
  renderReviewTable($('#rp-ranked'), res.ranked, sens, true);
  renderReviewTable($('#rp-short'), res.shortlist, {}, false);
  const rt = $('#rt-short');
  rt.textContent = `Verification shortlist (${res.shortlist.length})`;
  $('#rt-ranked').textContent = `Ranked — capability assessed (${res.ranked.length})`;
}
function compLabel(c) {
  return { gap: 'Documented certification gap', evt: 'Miles to nearest 24/7 EVT', adv: 'Miles to nearest CSC/TSC-level', hub: 'Miles to my center' }[c.key];
}
function renderReviewTable(container, rows, sens, ranked) {
  clear(container);
  if (!rows.length) { container.appendChild(el('p', { class: 'hint', text: ranked ? 'No ranked candidates in this scope.' : 'No unassessed or conflicting candidates in this scope.' })); return; }
  const tbl = el('table', { class: 'data' });
  const head = ['#', 'Hospital', 'State', ranked ? 'Tier (basis)' : 'Capability', 'Mi to 24/7 EVT', 'Mi to CSC/TSC', S.ui.hub ? 'Mi to my center' : null, 'Score', ranked ? 'Rank range' : null, 'Evidence checked', 'Details'].filter(Boolean);
  tbl.appendChild(el('thead', null, el('tr', null, head.map(t => el('th', { scope: 'col', class: /Mi|Score|#|range/.test(t) ? 'num' : null, text: t })))));
  const tb = el('tbody');
  for (const r of rows) {
    const h = r.h;
    const why = el('tr', { hidden: true }, el('td', { colspan: String(head.length) }, el('ul', { class: 'why' }, r.comps.map(c =>
      el('li', { text: c.value == null ? `${compLabel(c)}: not available (${c.detail || 'unknown'}) — weight not used` : `${compLabel(c)}: component ${c.value.toFixed(2)} × weight ${c.weight} → ${c.points.toFixed(1)} points` })).concat([
      el('li', { text: `Nearest 24/7 EVT: ${r.access.evt247.dest ? r.access.evt247.dest.name : '—'}; nearest CSC/TSC-level: ${r.access.advanced.dest ? r.access.advanced.dest.name : '—'}.` }),
      el('li', { text: 'Score = weighted mean of the components shown (0–100). Not an assessment of need, operations or feasibility.' }),
    ]))));
    const whyBtn = el('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false', text: 'Why?', 'aria-label': `Why ${h.name} scores ${r.score.toFixed(0)}` });
    whyBtn.addEventListener('click', () => { why.hidden = !why.hidden; whyBtn.setAttribute('aria-expanded', String(!why.hidden)); });
    const range = sens[h.id];
    const tierTxt = ranked ? (tierOf(h) ? `${tierOf(h)} (${h.derived.tierBasis === 'national' ? 'national' : 'state'})` : 'none found') : CAP_LABELS[capOf(h)];
    const cells = [
      el('td', { class: 'num' }, [String(r.rank), r.tied ? el('span', { class: 'rank-tie', text: ' =' }) : null]),
      el('td', null, el('button', { type: 'button', class: 'link-btn', text: h.name, on: { click: () => { $('#dlg-review').close(); selectHospital(h.id, { source: 'review' }); } } })),
      el('td', { text: h.state }),
      el('td', { text: tierTxt }),
      el('td', { class: 'num', text: C.formatMiles(r.evtMi) }),
      el('td', { class: 'num', text: C.formatMiles(r.advMi) }),
      S.ui.hub ? el('td', { class: 'num', text: C.formatMiles(r.access.hub && r.access.hub.miles) }) : null,
      el('td', { class: 'num', text: r.score.toFixed(0) }),
      ranked ? el('td', { class: 'num', text: range ? (range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`) : '—' }) : null,
      el('td', { text: lastCheckedOf(h) || 'never' }),
      el('td', null, whyBtn),
    ].filter(Boolean);
    tb.appendChild(el('tr', null, cells));
    tb.appendChild(why);
  }
  tbl.appendChild(tb);
  container.appendChild(tbl);
  if (ranked) container.appendChild(el('p', { class: 'hint', text: 'Rank range: lowest and highest rank when each non-zero weight is halved or increased by half in turn. A wide range means the position depends on the weights. “=” marks a tie (same score to 0.1); ties are ordered by distance to EVT, then name.' }));
}
function openReview() {
  buildReviewForm();
  renderReview();
  openDialog('dlg-review');
}

// ------------------------------------------------------------------
// Compare
// ------------------------------------------------------------------
function toggleCompare(id) {
  const i = S.ui.compare.indexOf(id);
  if (i >= 0) S.ui.compare.splice(i, 1);
  else if (S.ui.compare.length < C.MAX_COMPARE) S.ui.compare.push(id);
  else { toast(`Comparison holds up to ${C.MAX_COMPARE} hospitals`, 'warn'); return; }
  update();
}
function renderCompareList() {
  const list = $('#compare-list');
  clear(list);
  const n = S.ui.compare.length;
  const badgeEl = $('#compare-count');
  badgeEl.hidden = !n;
  badgeEl.textContent = String(n);
  if (!n) list.appendChild(el('li', { class: 'hint', text: 'Nothing added yet. Open a hospital and choose “Add to comparison”.' }));
  for (const id of S.ui.compare) {
    const h = S.byId.get(id);
    if (!h) continue;
    list.appendChild(el('li', null, [
      el('button', { type: 'button', class: 'link-btn', text: h.name, on: { click: () => selectHospital(h.id, { source: 'compare' }) } }),
      el('button', { type: 'button', class: 'btn btn-quiet', text: 'Remove', 'aria-label': 'Remove ' + h.name + ' from comparison', on: { click: () => toggleCompare(h.id) } }),
    ]));
  }
  for (const b of ['#compare-open', '#compare-export', '#compare-clear']) $(b).disabled = !n;
}
function compareFields() {
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const f = [
    ['Location', h => placeLine(h)],
    ['Status', h => valueClaimText(h.status, { active: 'Active', closed: 'Closed', merged: 'Merged' })],
    ['Analysis eligibility', h => `${ELIG_LABELS[eligOf(h)]} — ${h.derived.eligibility.reason}`],
    ['Health system', h => (h.system && h.system.value) || (h.system && h.system.state === 'independent' ? 'Independent' : 'Not documented')],
    ['Critical Access Hospital', h => stOf(h.cah) === 'affirmative' ? 'Yes' : stOf(h.cah) === 'negative' ? 'No' : C.CLAIM_LABELS[stOf(h.cah)]],
    ['National certification', h => `${nationalLabel(h)}${h.national && h.national.checked ? ' (checked ' + h.national.checked + ')' : ''}`],
    ['State designation', h => `${stateLabel(h)}${h.stateDesignation && h.stateDesignation.checked ? ' (checked ' + h.stateDesignation.checked + ')' : ''}`],
    ['Thrombectomy (EVT)', h => evtLabel(h)],
    ['Tier shown (basis)', h => tierOf(h) ? `${tierOf(h)} (${h.derived.tierBasis === 'national' ? 'national' : 'state crosswalk'})` : capOf(h) === 'unassessed' ? 'Not assessed' : 'None found'],
    ['Evidence: last checked / age', h => { const d = lastCheckedOf(h); const a = ageDays(d); return d ? `${d}${a != null ? ' (' + a + ' days)' : ''}` : 'Never checked'; }],
    ['Nearest 24/7 EVT (straight-line)', h => accessText(S.access[h.id].evt247)],
    ['Nearest CSC/TSC-level (straight-line)', h => accessText(S.access[h.id].advanced)],
  ];
  if (hub) {
    f.push([`My center: ${hub.name}`, h => accessText(S.access[h.id].hub)]);
    f.push(['My center minus nearest 24/7 EVT', h => { const d = C.hubDifferential(h, S.access[h.id], S.ui.transport); return d.status === 'ok' ? `${C.formatSignedMiles(d.miles)} mi` + (d.sameCenter ? ' (same center)' : '') : 'Unavailable' + (d.reason ? ': ' + d.reason : ''); }]);
  }
  f.push(['Road network (ground model)', h => (h.roadNetwork && h.roadNetwork.value) || 'unknown']);
  f.push(['Location precision', h => h.location ? `${h.location.precision} (${h.location.method})` : 'Not located']);
  f.push(['Needs verification', h => (h.derived.needsVerification || []).map(c => NV_LABELS[c] || c).join('; ') || '—']);
  f.push(['Record id / CCN', h => `${h.id}${h.ccn && h.ccn.value ? ' / ' + h.ccn.value + (h.ccn.relation === 'shared' ? ' (shared)' : '') : ''}`]);
  return f;
}
function accessText(r) {
  if (!r) return '—';
  if (r.status === 'on-site') return 'On site (0 mi)';
  if (r.status === 'ok') return `${r.dest.name} — ${C.formatMiles(r.miles)} mi`;
  if (r.status === 'no-location') return 'Unavailable (not located)';
  return 'Unavailable';
}
function renderCompareTable() {
  const wrap = $('#cmp-table');
  clear(wrap);
  const hs = S.ui.compare.map(id => S.byId.get(id)).filter(Boolean);
  const tbl = el('table', { class: 'data' });
  tbl.appendChild(el('caption', { text: `Selected hospitals (${hs.length}) · data ${S.meta.data_version} · straight-line distances` }));
  tbl.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Field' }), ...hs.map(h => el('th', { scope: 'col', text: h.name }))])));
  const tb = el('tbody');
  for (const [label, fn] of compareFields()) tb.appendChild(el('tr', null, [el('th', { scope: 'row', text: label }), ...hs.map(h => el('td', { text: fn(h) }))]));
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
}
function openCompare() { renderCompareTable(); openDialog('dlg-compare'); }

// ------------------------------------------------------------------
// Data & methods view
// ------------------------------------------------------------------
function renderDataPanel() {
  const m = S.meta;
  const c = m.counts;
  const dl = $('#data-overview');
  clear(dl);
  const kv = (k, v) => { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); };
  kv('Release', m.release);
  kv('Data version', m.data_version);
  kv('Evidence review', m.evidence_review_date + ' (each claim has its own checked date)');
  kv('CMS census reference', `${m.census_snapshot.as_of} snapshot`);
  kv('Facility records', `${c.records} (${Object.entries(c.by_state).map(([s, n]) => s + ' ' + n).join(', ')})`);
  kv('Analysis set', `${c.eligible} eligible · ${c.excluded} excluded · ${c.eligibility_unknown} unresolved`);
  kv('Not located', String(c.unlocated));
  kv('Capability evidence', `${c.capability.assessed} assessed · ${c.capability.partial} partial · ${c.capability.unassessed} not assessed · ${c.capability.conflicting} conflicting`);
  kv('24/7 EVT documented', String(c.evt247_documented));
  kv('Neighboring-state destinations', String(c.neighbors));
  kv('Sources cited', String(Object.keys(m.sources).length));
  if (!S.storageOk) kv('Browser storage', 'Unavailable — preferences will not be remembered');

  const nv = {};
  for (const h of S.all) if (!isOOR(h)) for (const code of h.derived.needsVerification || []) nv[code] = (nv[code] || 0) + 1;
  const vb = $('#verify-breakdown');
  clear(vb);
  const ul = el('ul', { class: 'checks' });
  for (const [code, n] of Object.entries(nv).sort((a, b) => b[1] - a[1])) ul.appendChild(el('li', null, [el('span', { class: 'num', text: String(n) }), el('span', { text: NV_LABELS[code] || code })]));
  vb.appendChild(ul);

  renderCoverage();
  renderChecks();
}
function renderCoverage() {
  const wrap = $('#coverage');
  clear(wrap);
  const claims = [['national', 'National cert.'], ['stateDesignation', 'State designation'], ['evt247', '24/7 EVT'], ['ed', 'Emergency dept.'], ['cah', 'CAH'], ['status', 'Status'], ['system', 'System']];
  const methods = ['search-extract', 'nppes-api', 'manual-review', 'regulatory-inference', 'cms-dataset', 'prior-edition', null];
  const recs = S.all.filter(h => !isOOR(h));
  const tbl = el('table', { class: 'data' });
  tbl.appendChild(el('caption', { text: `How each claim was last established — ${recs.length} WWAMI records` }));
  tbl.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Claim' }), ...methods.map(mm => el('th', { scope: 'col', class: 'num', text: mm ? methodShort(mm) : 'not assessed' })), el('th', { scope: 'col', class: 'num', text: 'conflicting' })])));
  const tb = el('tbody');
  for (const [k, label] of claims) {
    const cells = methods.map(mm => recs.filter(h => {
      const c = h[k];
      if (!c) return mm === null;
      const unassessed = (c.state === 'unknown' || c.value === 'unknown' || (c.state == null && c.value == null)) && !c.method;
      return mm === null ? unassessed : (!unassessed && c.method === mm);
    }).length);
    const conf = recs.filter(h => h[k] && h[k].state === 'conflicting').length;
    tb.appendChild(el('tr', null, [el('th', { scope: 'row', text: label }), ...cells.map(n => el('td', { class: 'num', text: String(n) })), el('td', { class: 'num', text: String(conf) })]));
  }
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
}
function renderChecks() {
  const ul = $('#checks');
  clear(ul);
  const recs = S.all;
  const ids = new Set(recs.map(h => h.id));
  const claimNames = ['national', 'stateDesignation', 'evt', 'evt247', 'ed', 'cah'];
  const checks = [
    ['Every record id unique', ids.size === recs.length],
    ['Every claim state recognised', recs.every(h => claimNames.every(k => !h[k] || C.CLAIM_STATES.includes(h[k].state)))],
    ['Every documented claim cites a source and a check date', recs.every(h => claimNames.every(k => !h[k] || !['affirmative', 'negative', 'conflicting', 'no-record-found'].includes(h[k].state) || ((h[k].evidence || []).length && h[k].checked)))],
    ['Every cited source exists in the registry', recs.every(h => claimNames.concat(['status', 'address', 'location', 'system']).every(k => !h[k] || (h[k].evidence || []).every(ev => !!sourceOf(ev.src))))],
    ['No unassessed record shows a tier', recs.every(h => capOf(h) !== 'unassessed' || !tierOf(h))],
    ['Every shown tier traces to a national or state claim', recs.every(h => {
      if (!tierOf(h)) return true;
      return h.derived.tierBasis === 'national' ? stOf(h.national) === 'affirmative' : stOf(h.stateDesignation) === 'affirmative';
    })],
    ['Every located record has valid coordinates', recs.every(h => !h.location || C.locationOf(h))],
    ['Destination sets are non-empty', S.sets.evt247.length > 0 && S.sets.advanced.length > 0],
  ];
  for (const [label, pass] of checks) ul.appendChild(el('li', null, [el('span', { class: pass ? 'pass' : 'fail', text: pass ? '✓ pass' : '✗ fail' }), el('span', { text: label })]));
}

function buildMethods() {
  const m = S.meta;
  const body = $('#methods-body');
  clear(body);
  const h2 = t => el('h2', { text: t });
  const p = t => el('p', { text: t });
  const ul = items => el('ul', null, items.map(t => el('li', { text: t })));
  appendAll(body, [
    p('A public-source reference and planning tool. It is not an official product of any health department or accreditor, not a clinical decision aid, and not dispatch or patient-routing guidance. It does not represent institutional approval, affiliation, referral agreements or real-time availability.'),
    h2('What the dates mean'), ul(Object.entries(m.date_semantics).map(([k, v]) => `${k}: ${v}`)),
    h2('Scope'), p(m.scope),
    h2('Adult emergency-stroke analysis set'), ul([m.eligibility_rule.eligible, 'Excluded: ' + m.eligibility_rule.excluded, 'Unknown: ' + m.eligibility_rule.unknown, m.eligibility_rule.note]),
    h2('Evidence states'), ul(Object.entries(m.claim_states).map(([k, v]) => `${C.CLAIM_LABELS[k] || k}: ${v}`)),
    h2('How evidence was gathered'), ul(Object.entries(m.methods).map(([k, v]) => `${methodShort(k)}: ${v}`)),
    h2('National certification, state designation and EVT are separate'),
    p('National certification (Joint Commission, DNV, ACHC, CIHQ), state designation (Washington ECS categorization; Idaho TSE designation) and documented thrombectomy capability are recorded as separate claims, each with its own evidence. A Primary Stroke Center may document 24/7 thrombectomy; certification alone does not establish current service availability; absence from a directory is not proof of absent capability.'),
    p(m.tier_crosswalk.note), ul(Object.entries(m.tier_crosswalk.mapping).map(([sys, map]) => `${sys}: ` + Object.entries(map).map(([lvl, t]) => `Level ${lvl} → shown as ${t}`).join('; '))),
    h2('Tiers'), ul(Object.entries(m.certification_definitions).map(([k, v]) => `${k}: ${v}`)),
    h2('Distances and destinations'),
    ul([
      'All distances are straight-line (great-circle) miles between recorded coordinates. Lines on the map are geometry, not road routes, transfer pathways or referral relationships; circles are straight-line radii, not travel-time isochrones.',
      '“Nearest” always names its destination set: documented 24/7 EVT centers, or CSC/TSC-level centers (national certification, or a state level shown on that tier). Destinations must be active, located campuses in the analysis set, or listed neighboring-state centers.',
      'The nearest geometric destination is not necessarily the clinically appropriate or accepting destination.',
      'Neighboring-state centers (shown as squares) are included so border hospitals are not told the nearest center is farther than it is. Canadian centers are not included.',
    ]),
    h2('Transport scenarios'),
    ul([
      'Times are illustrative scenarios from adjustable assumptions, not measured performance, dispatch estimates or aircraft availability. The app never chooses a transport asset.',
      'Intervals are kept separate: DIDO at the sending hospital (a scenario input that includes transport activation and loading, so they are not added twice) and the transport leg to arrival at the receiving hospital. Receiving-center treatment intervals are not modelled, and no total is compared with a treatment-time target.',
      'Ground transfer is modelled only between campuses on the same documented road network; ferry crossings and unknown connections are shown as unavailable. Rotor-wing is shown only within the scenario range; fixed-wing assumes airport access at both ends, which is not assessed.',
      'Road networks: ' + Object.entries(m.road_networks).map(([k, v]) => `${k} — ${v}`).join(' '),
    ]),
    h2('Access review scoring'),
    ul([
      'Score = weighted mean (0–100) of normalised components: documented certification gap (none found 1.0 · ASR 0.65 · PSC 0.35), straight-line miles to the nearest 24/7 EVT center, to the nearest CSC/TSC-level center, and optionally to my center, each capped and divided by the cap.',
      'Only campuses in the analysis set without on-site 24/7 EVT or a CSC/TSC-level tier are candidates. Campuses whose capability was not assessed or is conflicting are never given a gap value; they appear on a separate verification shortlist ranked by geography alone.',
      'Ties (same score to 0.1) share a rank and are ordered by distance to EVT, then name. All-zero weights produce no ranking. Rank range shows sensitivity to each weight. Nothing about volumes, population, staffing, existing coverage or business opportunity is modelled.',
    ]),
    h2('Geography'), p(m.geography.note + ' Boundaries: ' + m.geography.boundaries + '.'),
    h2('CMS reference data'), p(`${m.census_snapshot.source}. ${m.census_snapshot.note}`),
    h2('Limits'),
    ul([
      'Primary registries (Joint Commission Quality Check, DNV certificate checker, WA DOH, Idaho TSE, data.cms.gov) could not be opened directly from the authoring environment in the October 2026 pass. Claims checked then were observed through web-search extracts of the cited pages or the NPPES API, and say so.',
      'Many values carried forward from the previous edition keep that edition’s check date; they are not re-verified by being carried forward.',
      'Unknown is a valid answer and is shown as unknown. Structural checks passing does not certify factual accuracy.',
    ]),
    h2('Sources'), el('p', null, [el('a', { href: 'https://github.com/rkalani1/telestroke-expansion-map/blob/main/METHODOLOGY.md', target: '_blank', rel: 'noopener noreferrer', text: 'Full methodology' }), ' · ',
      el('a', { href: 'https://github.com/rkalani1/telestroke-expansion-map/blob/main/data/audit/evidence-audit.csv', target: '_blank', rel: 'noopener noreferrer', text: 'Evidence audit inventory' }), ' · ',
      el('a', { href: 'https://github.com/rkalani1/telestroke-expansion-map/blob/main/data/verification-worklist.csv', target: '_blank', rel: 'noopener noreferrer', text: 'Verification worklist' })]),
  ]);
}

function buildShortcuts() {
  const body = $('#shortcuts-body');
  clear(body);
  const rows = [['/', 'Focus hospital search'], ['L', 'Focus the hospital list'], ['M', 'Focus the map (then arrow keys pan, + and − zoom)'], ['F', 'Find view'], ['E', 'Explore view'], ['C', 'Compare view'], ['Q', 'Data & methods view'], ['G', 'Explore → summary by state'], ['D', 'Toggle light/dark theme'], ['Shift+R', 'Reset filters'], ['?', 'This list'], ['Esc', 'Close the open dialog, the hospital details, or the mobile sheet']];
  const tbl = el('table', { class: 'data' }, [el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Key' }), el('th', { scope: 'col', text: 'Action' })])),
    el('tbody', null, rows.map(([k, v]) => el('tr', null, [el('td', null, el('kbd', { text: k })), el('td', { text: v })])))]);
  appendAll(body, [tbl, el('p', { class: 'hint', text: 'Single-key shortcuts work only when focus is not in a text field, and can be turned off in Data & methods → Display. Browser shortcuts such as Ctrl/⌘+F are never intercepted.' })]);
}

// ------------------------------------------------------------------
// Exports
// ------------------------------------------------------------------
function stamp() { return S.meta ? S.meta.data_version : ''; }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function download(content, filename, mime) {
  try {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Downloaded ${filename}`);
    return true;
  } catch (err) {
    toast('Download failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    return false;
  }
}
function exportRecords(scope) {
  if (scope === 'compare') return S.ui.compare.map(id => S.byId.get(id)).filter(Boolean);
  if (scope === 'selected') return S.ui.selected ? [S.byId.get(S.ui.selected)] : [];
  if (scope === 'all') return S.all.filter(h => !isOOR(h));
  return S.results.filter(h => !isOOR(h));
}
function scopeDescription(scope) {
  return { compare: 'comparison set', selected: 'selected hospital', all: 'all facility records', results: 'current results (' + scopeLabel() + (activeFilterParts().length ? '; filters: ' + activeFilterParts().join(', ') : '') + ')' }[scope];
}
function claimSources(c) { return ((c && c.evidence) || []).map(e => { const s = sourceOf(e.src); return s && s.url ? s.url : e.src; }).filter((v, i, a) => a.indexOf(v) === i).join(' | '); }
const CSV_HEADER = ['record_id', 'name', 'state', 'city', 'county_derived', 'status', 'analysis_eligibility', 'eligibility_reason',
  'ccn', 'ccn_relation', 'health_system', 'governance', 'cah_state', 'ed_24x7_state',
  'national_state', 'national_body', 'national_program', 'national_tier', 'national_effective', 'national_expires', 'national_checked', 'national_method', 'national_sources',
  'state_designation_state', 'state_system', 'state_level', 'state_status', 'state_checked', 'state_method', 'state_sources',
  'evt_state', 'evt_24x7_state', 'evt_24x7_basis', 'evt_checked', 'evt_sources',
  'tier_shown', 'tier_basis', 'capability_evidence', 'capability_last_checked',
  'latitude', 'longitude', 'location_method', 'location_precision', 'road_network',
  'nearest_24x7_evt_center', 'miles_to_nearest_24x7_evt', 'nearest_csc_tsc_level_center', 'miles_to_nearest_csc_tsc_level',
  'my_center', 'miles_to_my_center', 'my_center_minus_nearest_evt_miles',
  'needs_verification', 'distance_metric', 'export_scope', 'data_version', 'evidence_review_date', 'exported_on'];
function csvRow(h, scope) {
  const a = S.access[h.id];
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const miles = r => (r && C.isNum(r.miles) ? Number(r.miles.toFixed(1)) : '');
  const diff = hub ? C.hubDifferential(h, a, S.ui.transport) : null;
  const n = h.national || {};
  const sd = h.stateDesignation || {};
  return [h.id, h.name, h.state, cityOf(h) || '', h.derived.county || '', (h.status && h.status.value) || '', eligOf(h), h.derived.eligibility.reason,
    (h.ccn && h.ccn.value) || '', (h.ccn && h.ccn.relation) || '', (h.system && h.system.value) || (h.system && h.system.state) || '', (h.governance && h.governance.value) || '', stOf(h.cah), stOf(h.ed),
    stOf(n), n.body || '', n.program || '', n.tier || '', n.effective || '', n.expires || '', n.checked || '', n.method || '', claimSources(n),
    stOf(sd), sd.system || '', sd.level || '', sd.status || '', sd.checked || '', sd.method || '', claimSources(sd),
    stOf(h.evt), stOf(h.evt247), (h.evt247 && h.evt247.basis) || '', (h.evt247 && h.evt247.checked) || (h.evt && h.evt.checked) || '', claimSources(h.evt247) || claimSources(h.evt),
    tierOf(h) || '', h.derived.tierBasis || '', capOf(h), lastCheckedOf(h) || '',
    h.location ? h.location.lat : '', h.location ? h.location.lng : '', h.location ? h.location.method : '', h.location ? h.location.precision : '', (h.roadNetwork && h.roadNetwork.value) || 'unknown',
    a.evt247.dest ? a.evt247.dest.name : '', miles(a.evt247), a.advanced.dest ? a.advanced.dest.name : '', miles(a.advanced),
    hub ? hub.name : '', hub ? miles(a.hub) : '', diff && diff.status === 'ok' ? Number(diff.miles.toFixed(1)) : '',
    (h.derived.needsVerification || []).join(' '), 'straight-line miles', scopeDescription(scope), stamp(), S.meta.evidence_review_date, todayStr()];
}
function exportCsv(scope) {
  const recs = exportRecords(scope);
  if (!recs.length) { toast('Nothing to export in this scope', 'warn'); return; }
  const rows = [CSV_HEADER].concat(recs.map(h => csvRow(h, scope)));
  download(C.toCsv(rows), `stroke-capability_${scope}_${stamp()}.csv`, 'text/csv');
}
function exportJson(scope) {
  const recs = exportRecords(scope);
  if (!recs.length) { toast('Nothing to export in this scope', 'warn'); return; }
  const used = new Set();
  for (const h of recs) for (const v of Object.values(h)) if (v && typeof v === 'object' && Array.isArray(v.evidence)) v.evidence.forEach(e => used.add(e.src));
  const doc = {
    title: 'Regional Hospital Stroke Capabilities — export',
    export_scope: scopeDescription(scope), exported_on: todayStr(),
    release: S.meta.release, data_version: S.meta.data_version, evidence_review_date: S.meta.evidence_review_date,
    date_semantics: S.meta.date_semantics, claim_states: S.meta.claim_states, distance_metric: 'straight-line (great-circle) miles',
    my_center: S.ui.hub || null, include_neighbor_centers: S.ui.neighbors, transport_assumptions: C.transportParams(S.ui.transport),
    records: recs.map(h => {
      const r = Object.assign({}, h);
      delete r.fields;
      const a = S.access[h.id];
      r.access = { nearest_24x7_evt: a.evt247.dest ? { id: a.evt247.dest.id, name: a.evt247.dest.name, miles: a.evt247.miles, status: a.evt247.status } : { status: a.evt247.status },
        nearest_csc_tsc_level: a.advanced.dest ? { id: a.advanced.dest.id, name: a.advanced.dest.name, miles: a.advanced.miles, status: a.advanced.status } : { status: a.advanced.status },
        my_center: a.hub ? { id: a.hub.dest && a.hub.dest.id, miles: a.hub.miles, status: a.hub.status } : null };
      return r;
    }),
    sources: Object.fromEntries(Array.from(used).sort().map(id => [id, sourceOf(id)])),
  };
  download(JSON.stringify(doc, null, 1), `stroke-capability_${scope}_${stamp()}.json`, 'application/json');
}

// One-page summary (Markdown): scope, chosen center, state table, shortlist, assumptions, unknowns.
function summaryMarkdown() {
  const m = S.meta;
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const recs = S.results.filter(h => !isOOR(h));
  const lines = [];
  const esc = t => String(t == null ? '' : t).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  lines.push('# Regional Hospital Stroke Capabilities — summary', '');
  lines.push(`Generated ${todayStr()} · release ${m.release} · data ${m.data_version} · evidence review ${m.evidence_review_date} (each claim carries its own check date).`, '');
  lines.push('Public-source planning reference. Not for clinical decisions, dispatch or patient routing; not an official product of any health department or accreditor.', '');
  lines.push('## Scope', '');
  lines.push(`- Records in scope: **${recs.length}** — ${scopeLabel()}${activeFilterParts().length ? '; filters: ' + activeFilterParts().join(', ') : ''}.`);
  lines.push(`- My receiving center: ${hub ? hub.name + ' (' + placeLine(hub) + ')' : 'none chosen'}.`);
  lines.push(`- Destination sets: ${S.sets.evt247.length} documented 24/7 EVT centers; ${S.sets.advanced.length} CSC/TSC-level centers${S.ui.neighbors ? ' (incl. neighboring-state centers)' : ' (neighboring-state centers excluded)'}. Distances are straight-line miles.`, '');
  lines.push('## By state (records in scope)', '');
  lines.push('| Measure | WA | AK | ID | MT | WY | All |', '|---|---:|---:|---:|---:|---:|---:|');
  const per = stateTableRows(recs).map(([, hs]) => stateStats(hs));
  const tot = stateStats(recs);
  for (const [k, label] of STAT_COLS) lines.push(`| ${label} | ${per.map(p => p[k]).join(' | ')} | ${tot[k]} |`);
  lines.push('', '“None found” = assessed, no certification or designation found in reviewed sources. EVT overlaps the tiers.', '');
  const res = C.accessReview(recs, S.access, S.ui.review, { hasHub: !!hub });
  lines.push('## Access review — public-data shortlist', '');
  if (res.error) lines.push('All weights are zero; no ranking computed.');
  else {
    const w = res.params;
    lines.push(`Weights: certification gap ${w.wGap}, miles to 24/7 EVT ${w.wEvt}, miles to CSC/TSC-level ${w.wAdv}${hub ? ', miles to my center ' + w.wHub : ''}; cap ${w.capMi} mi. Questions to investigate — not onboarding eligibility, feasibility or an outreach list.`, '');
    lines.push('| Rank | Hospital | State | Tier (basis) | Mi to 24/7 EVT | Score | Evidence checked |', '|---:|---|---|---|---:|---:|---|');
    for (const r of res.ranked.slice(0, 10)) lines.push(`| ${r.rank}${r.tied ? '=' : ''} | ${esc(r.h.name)} | ${r.h.state} | ${tierOf(r.h) ? tierOf(r.h) + ' (' + (r.h.derived.tierBasis === 'national' ? 'national' : 'state') + ')' : 'none found'} | ${C.formatMiles(r.evtMi)} | ${r.score.toFixed(0)} | ${lastCheckedOf(r.h) || 'never'} |`);
    lines.push('', `Verification shortlist (capability not assessed or conflicting; ranked by geography only): ${res.shortlist.slice(0, 8).map(r => esc(r.h.name) + ' (' + r.h.state + ', ' + C.formatMiles(r.evtMi) + ' mi)').join('; ') || 'none'}.`, '');
  }
  const p = C.transportParams(S.ui.transport);
  lines.push('## Assumptions', '');
  lines.push(`- Transport scenarios (illustrative): DIDO ${p.didoMin} min; road distance = straight-line × ${p.roadFactor} at ${p.groundMph} mph; rotor-wing ${p.rotorMph} mph within ${p.rotorMaxMi} mi; fixed-wing ${p.fixedMph} mph + ${p.fixedGroundLegsMin} min ground legs. Endpoint: arrival at the receiving hospital. Not dispatch times; no treatment-time targets are applied.`);
  lines.push('- Lines are straight-line geometry, not routes or referral relationships. Health-system affiliation does not imply telestroke or transfer agreements.', '');
  lines.push('## Unknowns and source coverage', '');
  const nv = {};
  for (const h of recs) for (const code of h.derived.needsVerification || []) nv[code] = (nv[code] || 0) + 1;
  for (const [code, n] of Object.entries(nv).sort((a, b) => b[1] - a[1])) lines.push(`- ${NV_LABELS[code] || code}: ${n}`);
  const methods = {};
  for (const h of recs) { const mm = (h.national && h.national.method) || 'not assessed'; methods[mm] = (methods[mm] || 0) + 1; }
  lines.push(`- National-certification claims by method: ${Object.entries(methods).map(([k, v]) => methodShort(k) + ' ' + v).join(', ')}.`);
  lines.push('', `Source: ${location.origin}${location.pathname} · dataset hospitals.json ${m.data_version}.`);
  return lines.join('\n') + '\n';
}

// Minimal renderer for the Markdown this app generates (headings, lists, tables, bold).
function markdownToNodes(md) {
  const frag = document.createDocumentFragment();
  const lines = md.split('\n');
  const inline = (text) => {
    const span = document.createDocumentFragment();
    const parts = text.split(/(\*\*[^*]+\*\*)/);
    for (const p of parts) span.appendChild(p.startsWith('**') ? el('strong', { text: p.slice(2, -2) }) : document.createTextNode(p.replace(/\\\|/g, '|')));
    return span;
  };
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith('# ')) frag.appendChild(el('h1', null, inline(ln.slice(2))));
    else if (ln.startsWith('## ')) frag.appendChild(el('h2', null, inline(ln.slice(3))));
    else if (ln.startsWith('- ')) {
      const ul = el('ul');
      while (i < lines.length && lines[i].startsWith('- ')) { ul.appendChild(el('li', null, inline(lines[i].slice(2)))); i++; }
      frag.appendChild(ul);
      continue;
    } else if (ln.startsWith('|')) {
      const tbl = el('table');
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      const cells = r => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
      const head = cells(rows[0]);
      tbl.appendChild(el('thead', null, el('tr', null, head.map(c => el('th', null, inline(c))))));
      const tb = el('tbody');
      for (const r of rows.slice(2)) tb.appendChild(el('tr', null, cells(r).map(c => el('td', null, inline(c)))));
      tbl.appendChild(tb);
      frag.appendChild(tbl);
      continue;
    } else if (ln.trim()) frag.appendChild(el('p', null, inline(ln)));
    i++;
  }
  return frag;
}
function openSummary() {
  const md = summaryMarkdown();
  S.lastSummary = md;
  const box = $('#summary-preview');
  clear(box);
  box.appendChild(markdownToNodes(md));
  openDialog('dlg-summary');
}
function printNodes(nodes) {
  const root = $('#print-root');
  clear(root);
  root.appendChild(nodes);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); clear(root); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); } catch { done(); toast('Printing is not available here', 'error'); }
}
function printSummary() { printNodes(markdownToNodes(S.lastSummary || summaryMarkdown())); }
function printComparison() {
  renderCompareTable();
  const frag = document.createDocumentFragment();
  frag.appendChild(el('h1', { text: 'Hospital comparison' }));
  frag.appendChild(el('p', { text: `Generated ${todayStr()} · data ${stamp()} · evidence review ${S.meta.evidence_review_date} · straight-line distances · public-source planning reference, not for clinical decisions.` }));
  frag.appendChild($('#cmp-table table').cloneNode(true));
  printNodes(frag);
}
function exportCompareCsv() {
  const hs = S.ui.compare.map(id => S.byId.get(id)).filter(Boolean);
  const fields = compareFields();
  const rows = [['field'].concat(hs.map(h => h.name))].concat(fields.map(([label, fn]) => [label].concat(hs.map(fn))));
  rows.push(['data_version'].concat(hs.map(() => stamp())), ['distance_metric'].concat(hs.map(() => 'straight-line miles')));
  download(C.toCsv(rows), `stroke-comparison_${stamp()}.csv`, 'text/csv');
}

// PNG: composed in a canvas from the visible tiles, the drawn lines and the
// markers (redrawn from the same glyph model), plus title, legend, scope and
// attribution. No external library is needed.
async function exportPng() {
  if (!S.map) { toast('Map unavailable — nothing to draw', 'warn'); return; }
  const size = S.map.getSize();
  const legendW = 280;
  const headH = 64;
  const footH = 58;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = size.x + legendW;
  const H = Math.max(size.y, 420) + headH + footH;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const draw = (withTiles) => {
    ctx.save();
    ctx.fillStyle = cssVar('--surface');
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = cssVar('--surface-3');
    ctx.fillRect(0, headH, size.x, size.y);
    let tiles = 0;
    if (withTiles) {
      const rect = S.map.getContainer().getBoundingClientRect();
      ctx.save();
      ctx.beginPath(); ctx.rect(0, headH, size.x, size.y); ctx.clip();
      const bm = currentBasemap();
      if (bm === 'muted') ctx.filter = effectiveTheme() === 'dark' ? 'invert(1) hue-rotate(180deg) saturate(.25) brightness(.85) contrast(.9)' : 'saturate(.25) contrast(.9) brightness(1.06)';
      else if (effectiveTheme() === 'dark') ctx.filter = 'invert(1) hue-rotate(180deg) saturate(.25) brightness(.85) contrast(.9)';
      for (const img of S.map.getContainer().querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded')) {
        const r = img.getBoundingClientRect();
        if (r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom) continue;
        ctx.drawImage(img, r.left - rect.left, r.top - rect.top + headH, r.width, r.height);
        tiles++;
      }
      ctx.restore();
    }
    // Lines
    const sel = S.ui.selected && S.byId.get(S.ui.selected);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, headH, size.x, size.y); ctx.clip();
    for (const l of selectionLines()) {
      const a = S.map.latLngToContainerPoint([sel.location.lat, sel.location.lng]);
      const b = S.map.latLngToContainerPoint([l.to.location.lat, l.to.location.lng]);
      const st = lineStyle(l.kind);
      ctx.strokeStyle = st.color; ctx.lineWidth = st.weight;
      ctx.setLineDash(st.dashArray ? st.dashArray.split(' ').map(Number) : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y + headH); ctx.lineTo(b.x, b.y + headH); ctx.stroke();
      ctx.setLineDash([]);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 + headH;
      const label = `${C.formatMiles(l.miles)} mi straight-line`;
      ctx.font = '600 11px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = cssVar('--surface'); ctx.fillRect(mx - tw / 2, my - 9, tw, 18);
      ctx.strokeStyle = cssVar('--border-strong'); ctx.lineWidth = 1; ctx.strokeRect(mx - tw / 2, my - 9, tw, 18);
      ctx.fillStyle = cssVar('--text'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, mx, my);
    }
    // Markers, lowest z first
    const recs = mapRecords().map(h => ({ h, m: glyphModel(h) }));
    recs.sort((x, y) => (x.m.selected - y.m.selected) || (x.m.hub - y.m.hub) || (x.m.evtRing - y.m.evtRing) || (y.m.size - x.m.size));
    for (const { h, m } of recs) {
      const p = S.map.latLngToContainerPoint([h.location.lat, h.location.lng]);
      const off = S.offsets.get(h.id) || [0, 0];
      if (p.x < -20 || p.y < -20 || p.x > size.x + 20 || p.y > size.y + 20) continue;
      drawGlyph(ctx, m, p.x + off[0], p.y + off[1] + headH);
    }
    ctx.restore();
    // Header
    ctx.fillStyle = cssVar('--text'); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '650 17px system-ui, sans-serif';
    ctx.fillText('Regional Hospital Stroke Capabilities — WA · AK · ID · MT · WY', 14, 26);
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = cssVar('--text-2');
    const parts = activeFilterParts();
    ctx.fillText(`Map: ${MODE_LABELS[S.ui.mode]} · ${S.results.filter(isLocated).length} on map · ${scopeLabel()}${parts.length ? ' · filters: ' + parts.join(', ') : ''}`.slice(0, 170), 14, 46);
    // Legend panel
    drawLegendPanel(ctx, size.x + 12, headH + 6, legendW - 24);
    // Footer
    ctx.fillStyle = cssVar('--text-2'); ctx.font = '11.5px system-ui, sans-serif';
    ctx.fillText(`Release ${S.meta.release} · data ${S.meta.data_version} · evidence review ${S.meta.evidence_review_date} · exported ${todayStr()} · ${location.origin}${location.pathname}`, 14, headH + size.y + 22);
    ctx.fillText(`${withTiles && tiles ? 'Basemap © OpenStreetMap contributors. ' : 'Basemap omitted. '}Straight-line distances; lines are not routes or referral relationships. Planning reference — not for clinical decisions.`, 14, headH + size.y + 40);
    ctx.restore();
    return tiles;
  };
  let tiles = draw(currentBasemap() !== 'none');
  let blob = null;
  try {
    blob = await new Promise((res, rej) => { try { canvas.toBlob(b => (b ? res(b) : rej(new Error('empty'))), 'image/png'); } catch (e) { rej(e); } });
  } catch {
    // Tiles without CORS headers taint the canvas; redraw without them.
    tiles = draw(false);
    try { blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('empty'))), 'image/png')); } catch { blob = null; }
    if (blob) toast('Basemap could not be included; exported markers, lines and legend only', 'warn', 4500);
  }
  if (!blob) { toast('Map image export failed', 'error'); return; }
  download(blob, `stroke-capability-map_${stamp()}.png`, 'image/png');
  return tiles;
}
function drawShape(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.2, y); ctx.closePath(); }
  else if (shape === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r);
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}
function drawGlyph(ctx, m, x, y) {
  const r = m.size / 2;
  ctx.save();
  if (m.dim) ctx.globalAlpha = 0.45;
  if (m.selected) { drawShape(ctx, 'circle', x, y, r + 6); ctx.strokeStyle = cssVar('--marker-halo'); ctx.lineWidth = 6; ctx.stroke(); }
  if (m.hub) { drawShape(ctx, 'circle', x, y, r + 5.5); ctx.strokeStyle = cssVar('--c-hub'); ctx.lineWidth = 2.5; ctx.stroke(); }
  if (m.evtRing) { drawShape(ctx, m.shape === 'diamond' ? 'circle' : m.shape, x, y, r + (m.hub ? 1.4 : 2.6)); ctx.strokeStyle = cssVar('--c-evt'); ctx.lineWidth = 3; ctx.stroke(); }
  drawShape(ctx, m.shape, x, y, r);
  ctx.fillStyle = m.hollow ? cssVar('--surface') : cssVar(m.fill);
  ctx.fill();
  ctx.setLineDash(m.dashed ? [2.6, 2] : []);
  ctx.strokeStyle = cssVar(m.stroke); ctx.lineWidth = m.hollow ? 2 : 1.6; ctx.stroke();
  ctx.setLineDash([]);
  if (m.dashOverlay) { drawShape(ctx, 'circle', x, y, r + 2.4); ctx.setLineDash([2.6, 2]); ctx.strokeStyle = cssVar('--c-unassessed'); ctx.lineWidth = 1.8; ctx.stroke(); ctx.setLineDash([]); }
  ctx.restore();
}
function drawLegendPanel(ctx, x, y, w) {
  const base = { shape: 'circle', size: 12, fill: '--c-none', stroke: '--marker-stroke', dashed: false, hollow: false, evtRing: false, hub: false, selected: false, dim: false, dashOverlay: false };
  ctx.fillStyle = cssVar('--text'); ctx.font = '650 12px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('Legend', x, y + 12);
  let cy = y + 30;
  const wrap = (text, maxW) => {
    const words = String(text).split(' ');
    const out = [];
    let cur = '';
    for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = wd; } else cur = t; }
    if (cur) out.push(cur);
    return out;
  };
  for (const g of legendModel()) {
    ctx.font = '650 11px system-ui, sans-serif'; ctx.fillStyle = cssVar('--text-3');
    for (const ln of wrap(g.title.toUpperCase(), w)) { ctx.fillText(ln, x, cy); cy += 14; }
    ctx.font = '11.5px system-ui, sans-serif';
    for (const [m, t] of g.rows || []) {
      drawGlyph(ctx, Object.assign({}, base, m), x + 9, cy - 4);
      ctx.fillStyle = cssVar('--text-2');
      const ls = wrap(t, w - 26);
      ls.forEach((ln, i) => ctx.fillText(ln, x + 24, cy + i * 13));
      cy += Math.max(18, ls.length * 13 + 5);
    }
    for (const [cls, t] of g.lines || []) {
      const st = lineStyle(cls === 'hub' ? 'hub' : cls === 'adv' ? 'adv' : 'evt');
      ctx.strokeStyle = st.color; ctx.lineWidth = st.weight; ctx.setLineDash(st.dashArray ? st.dashArray.split(' ').map(Number) : []);
      ctx.beginPath(); ctx.moveTo(x, cy - 4); ctx.lineTo(x + 18, cy - 4); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssVar('--text-2'); ctx.fillText(t, x + 24, cy); cy += 18;
    }
    if (g.note) {
      ctx.fillStyle = cssVar('--text-3'); ctx.font = '10.5px system-ui, sans-serif';
      for (const ln of wrap(g.note, w)) { ctx.fillText(ln, x, cy); cy += 13; }
      ctx.font = '11.5px system-ui, sans-serif';
    }
    cy += 8;
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = el('textarea', { value: text, readOnly: true });
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch { return false; }
}
async function copyLink() {
  saveUrlNow();
  const ok = await copyText(location.href);
  toast(ok ? 'Link copied' : 'Could not copy — the link is in the address bar', ok ? null : 'warn');
}

// ------------------------------------------------------------------
// URL state
// ------------------------------------------------------------------
let urlTimer = null;
function scheduleUrlSave() { clearTimeout(urlTimer); urlTimer = setTimeout(saveUrlNow, 300); }
function saveUrlNow() {
  if (!S.booted) return;
  const ui = Object.assign({}, S.ui);
  if (S.map) {
    const c = S.map.getCenter();
    ui.view_lat = c.lat; ui.view_lng = c.lng; ui.view_z = S.map.getZoom();
  }
  // Display choices travel with the link only when they were chosen explicitly.
  ui.theme = S.ui.theme || (S.prefs.theme !== 'auto' ? S.prefs.theme : null);
  ui.cb = S.ui.cb != null ? S.ui.cb : (S.prefs.cb ? true : null);
  ui.basemap = S.ui.basemap || (S.prefs.basemap !== 'muted' ? S.prefs.basemap : null);
  const qs = C.serializeUrlState(ui, { includeDisplay: true });
  try { history.replaceState(null, '', qs ? '?' + qs : location.pathname); } catch { /* sandboxed */ }
}
function readUrl() {
  const aliases = new Map();
  for (const h of S.all) for (const old of h.previousIds || []) aliases.set(old, h.id);
  const parsed = C.parseUrlState(location.search, { ids: new Set(S.all.map(h => h.id)), aliases, systems: new Set(S.systems.concat(['__independent', '__unknown'])) });
  S.ui = parsed.state;
  S.explicit = parsed.explicit;
  if (!S.ui.hub && S.prefs.hub && S.byId.get(S.prefs.hub)) S.ui.hub = S.prefs.hub;
  if (S.ui.mode === 'hub-distance' && !S.ui.hub) { S.ui.mode = 'capability'; parsed.ignored.push('mode'); }
  if (parsed.ignored.length) toast(`Some link settings were not recognised and were ignored (${parsed.ignored.slice(0, 4).join(', ')}${parsed.ignored.length > 4 ? '…' : ''})`, 'warn', 5000);
  return parsed;
}

// ------------------------------------------------------------------
// Controls ↔ state
// ------------------------------------------------------------------
function syncControls() {
  const ui = S.ui;
  $('#search').value = ui.q;
  $('#search-clear').hidden = !ui.q;
  $('#f-state').value = ui.state;
  $('#f-system').value = ui.system || '';
  $('#f-basis').value = ui.basis || '';
  $('#f-cah').value = ui.cah || '';
  $('#f-evidence').value = ui.evidence[0] || '';
  $('#f-evt').checked = ui.evt;
  $('#f-evtmin').value = String(ui.evtMin);
  $('#f-evtmin-out').textContent = String(ui.evtMin);
  for (const r of $$('input[name="scope"]')) r.checked = r.value === ui.scope;
  $('#inc-unknown').checked = ui.include.includes('unknown');
  $('#inc-excluded').checked = ui.include.includes('excluded');
  $('#inc-unknown').disabled = $('#inc-excluded').disabled = ui.scope === 'all';
  $('#sort').value = ui.sort;
  for (const r of $$('input[name="mode"]')) r.checked = r.value === ui.mode;
  $('input[name="mode"][value="hub-distance"]').disabled = !ui.hub;
  $('#ov-lines').checked = ui.overlays.includes('lines');
  $('#ov-nearest').checked = ui.overlays.includes('nearest');
  $('#ov-rings').checked = ui.overlays.includes('rings');
  $('#nb-toggle').checked = ui.neighbors;
  for (const b of $$('.preset')) b.setAttribute('aria-pressed', String(ui.preset === b.dataset.preset));
  const pa = $('#preset-active');
  pa.hidden = !ui.preset;
  if (ui.preset) {
    clear(pa);
    appendAll(pa, [el('strong', { text: presetTitle(ui.preset) + '. ' }), PRESET_NOTES[ui.preset] + ' ',
      el('button', { type: 'button', class: 'link-btn', text: 'Clear preset', on: { click: () => applyPreset(ui.preset) } }),
      ui.preset === 'telestroke' ? el('button', { type: 'button', class: 'link-btn', text: 'Open access review', on: { click: openReview } }) : null]);
  }
  $('#theme-select').value = S.ui.theme || S.prefs.theme;
  $('#basemap-select').value = currentBasemap();
  $('#cb-toggle').checked = S.ui.cb != null ? S.ui.cb : S.prefs.cb;
  $('#shortcuts-toggle').checked = S.prefs.shortcuts;
  for (const [key] of TRANSPORT_FIELDS) { const i = $('#tp-' + key); if (i) i.value = String(S.ui.transport[key]); }
  renderHub();
}

function populateSystems() {
  const sel = $('#f-system');
  for (const s of S.systems) sel.appendChild(el('option', { value: s, text: s }));
  sel.appendChild(el('option', { value: '__independent', text: 'Independent (no system documented)' }));
  sel.appendChild(el('option', { value: '__unknown', text: 'Affiliation not documented' }));
}

function populateJump() {
  const sel = $('#jump');
  const add = (value, label) => sel.appendChild(el('option', { value, text: label }));
  const og1 = el('optgroup', { label: 'Regions' });
  sel.appendChild(og1);
  const region = (value, label) => og1.appendChild(el('option', { value, text: label }));
  region('all', 'All five states');
  region('contig', 'Washington · Idaho · Montana · Wyoming');
  region('AK', 'Alaska');
  const og2 = el('optgroup', { label: 'States' });
  sel.appendChild(og2);
  for (const st of ['WA', 'ID', 'MT', 'WY']) og2.appendChild(el('option', { value: st, text: STATE_NAMES[st] + ` (${S.all.filter(h => h.state === st && !isOOR(h) && isLocated(h)).length})` }));
  const og3 = el('optgroup', { label: 'Metro areas' });
  sel.appendChild(og3);
  for (const m of METRO) og3.appendChild(el('option', { value: m.key, text: m.label }));
  void add;
}
function jumpBounds(key) {
  const inRegion = S.all.filter(h => !isOOR(h) && isLocated(h));
  if (key === 'all') return dataBounds(inRegion);
  if (key === 'contig') return dataBounds(inRegion.filter(h => h.state !== 'AK'));
  if (['WA', 'AK', 'ID', 'MT', 'WY'].includes(key)) return dataBounds(inRegion.filter(h => h.state === key));
  const m = METRO.find(x => x.key === key);
  if (m) return dataBounds(inRegion.filter(h => C.haversineMi(m.lat, m.lng, h.location.lat, h.location.lng) <= m.mi));
  return null;
}
function jumpTo(key) {
  const b = jumpBounds(key);
  if (b) fitTo(b, key.startsWith('m-') ? 11 : 9);
}

// ------------------------------------------------------------------
// Views (tabs) + mobile sheet
// ------------------------------------------------------------------
function switchView(view, opts) {
  if (!C.VIEWS.includes(view)) return;
  S.ui.view = view;
  for (const t of $$('#view-tabs [role="tab"]')) {
    const on = t.dataset.view === view;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  for (const v of C.VIEWS) $('#panel-' + v).hidden = v !== view;
  if (view === 'data') renderDataPanel();
  if (MOBILE_Q.matches && (!opts || opts.sheet !== false)) setSheet(view !== 'find' || (opts && opts.sheet === true));
  scheduleUrlSave();
  if (opts && opts.focus) requestAnimationFrame(() => { const n = $(opts.focus); if (n) n.focus(); });
}
function setSheet(open) {
  document.body.classList.toggle('sheet-open', !!open);
  const t = $('#sheet-toggle');
  t.setAttribute('aria-expanded', String(!!open));
  renderStatus();
  if (S.map) setTimeout(() => S.map.invalidateSize(), 50);
  const mapNode = $('#main');
  if (MOBILE_Q.matches) mapNode.toggleAttribute('inert', !!open);
  else mapNode.removeAttribute('inert');
  measureSheetTop();
}
function measureSheetTop() {
  const sb = $('.search-block');
  if (sb && MOBILE_Q.matches) document.documentElement.style.setProperty('--sheet-top', Math.round(sb.getBoundingClientRect().bottom + 4) + 'px');
}
function onTabKey(e) {
  const tabs = $$('#view-tabs [role="tab"]');
  const i = tabs.indexOf(e.target);
  if (i < 0) return;
  let n = null;
  if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = tabs.length - 1;
  if (n == null) return;
  e.preventDefault();
  tabs[n].focus();
  switchView(tabs[n].dataset.view, { sheet: MOBILE_Q.matches ? true : undefined });
}

// ------------------------------------------------------------------
// Dialogs
// ------------------------------------------------------------------
function openDialog(id) {
  const d = $('#' + id);
  if (!d) return;
  d._opener = document.activeElement;
  if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
  else d.setAttribute('open', '');
  const f = d.querySelector('[data-close]');
  if (f) f.focus();
}
function bindDialogs() {
  for (const d of $$('dialog')) {
    d.addEventListener('close', () => { const o = d._opener; d._opener = null; if (o && document.contains(o)) o.focus(); });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    for (const b of $$('[data-close]', d)) b.addEventListener('click', () => d.close());
  }
}

// ------------------------------------------------------------------
// Events
// ------------------------------------------------------------------
function bindEvents() {
  // Tabs
  for (const t of $$('#view-tabs [role="tab"]')) {
    t.addEventListener('click', () => {
      if (MOBILE_Q.matches && S.ui.view === t.dataset.view && document.body.classList.contains('sheet-open')) { setSheet(false); return; }
      switchView(t.dataset.view, { sheet: MOBILE_Q.matches ? true : undefined });
    });
  }
  $('#view-tabs').addEventListener('keydown', onTabKey);
  $('#sheet-toggle').addEventListener('click', () => setSheet(!document.body.classList.contains('sheet-open')));

  // Search
  const search = $('#search');
  let timer = null;
  search.addEventListener('input', () => {
    $('#search-clear').hidden = !search.value;
    clearTimeout(timer);
    timer = setTimeout(() => { S.ui.q = search.value.slice(0, 120); if (S.ui.sort !== 'relevance' && S.ui.q) S.ui.sort = 'relevance'; $('#sort').value = S.ui.sort; update(); }, 120);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer);
      S.ui.q = search.value.slice(0, 120);
      computeResults();
      update();
      if (S.results.length === 1) selectHospital(S.results[0].id, { source: 'search' });
      else if (S.results.length) {
        if (MOBILE_Q.matches) setSheet(true);
        requestAnimationFrame(() => { const f = $('.result'); if (f) f.focus(); });
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (MOBILE_Q.matches) setSheet(true);
      requestAnimationFrame(() => { const f = $('.result'); if (f) f.focus(); });
    } else if (e.key === 'Escape' && search.value) {
      e.preventDefault(); e.stopPropagation();
      search.value = ''; S.ui.q = ''; $('#search-clear').hidden = true; update();
    }
  });
  $('#search-clear').addEventListener('click', () => { search.value = ''; S.ui.q = ''; $('#search-clear').hidden = true; update(); search.focus(); });

  // Results
  const results = $('#results');
  results.addEventListener('click', (e) => { const b = e.target.closest('.result'); if (b) selectHospital(b.dataset.id, { source: 'list' }); });
  results.addEventListener('keydown', onResultsKey);
  results.addEventListener('focusin', (e) => {
    const b = e.target.closest('.result');
    if (!b) return;
    for (const x of $$('.result', results)) x.tabIndex = x === b ? 0 : -1;
  });

  // Filters
  for (const chip of $$('#tier-chips .chip')) chip.addEventListener('click', () => {
    const k = chip.dataset.tier;
    const i = S.ui.tiers.indexOf(k);
    if (i >= 0) S.ui.tiers.splice(i, 1); else S.ui.tiers.push(k);
    update();
  });
  $('#f-evt').addEventListener('change', e => { S.ui.evt = e.target.checked; update(); });
  $('#f-state').addEventListener('change', e => { S.ui.state = e.target.value; update(); if (S.ui.state !== 'ALL') jumpTo(S.ui.state); });
  $('#f-system').addEventListener('change', e => { S.ui.system = e.target.value || null; update(); });
  $('#f-basis').addEventListener('change', e => { S.ui.basis = e.target.value || null; update(); });
  $('#f-cah').addEventListener('change', e => { S.ui.cah = e.target.value || null; update(); });
  $('#f-evidence').addEventListener('change', e => { S.ui.evidence = e.target.value ? [e.target.value] : []; update(); });
  $('#f-evtmin').addEventListener('input', e => { S.ui.evtMin = Number(e.target.value); $('#f-evtmin-out').textContent = e.target.value; update(); });
  for (const r of $$('input[name="scope"]')) r.addEventListener('change', () => { S.ui.scope = r.value; syncControls(); update(); });
  $('#inc-unknown').addEventListener('change', e => { toggleInclude('unknown', e.target.checked); });
  $('#inc-excluded').addEventListener('change', e => { toggleInclude('excluded', e.target.checked); });
  $('#sort').addEventListener('change', e => { S.ui.sort = e.target.value; update(); });
  $('#reset-filters').addEventListener('click', resetFilters);

  // Explore
  $('#hub-select').addEventListener('change', e => setHub(e.target.value || null, true));
  $('#hub-preset').addEventListener('click', () => setHub(HARBORVIEW_ID, true));
  $('#hub-clear').addEventListener('click', () => setHub(null, true));
  for (const r of $$('input[name="mode"]')) r.addEventListener('change', () => { if (r.checked) { S.ui.mode = r.value; update(); } });
  for (const b of $$('.preset')) b.addEventListener('click', () => applyPreset(b.dataset.preset));
  const ov = (id, key) => $(id).addEventListener('change', e => {
    const s = new Set(S.ui.overlays);
    if (e.target.checked) s.add(key); else s.delete(key);
    S.ui.overlays = Array.from(s);
    update();
  });
  ov('#ov-lines', 'lines'); ov('#ov-nearest', 'nearest'); ov('#ov-rings', 'rings');
  $('#nb-toggle').addEventListener('change', e => { S.ui.neighbors = e.target.checked; update({ access: true }); });
  $('#open-review').addEventListener('click', openReview);
  $('#transport-reset').addEventListener('click', () => { S.ui.transport = Object.assign({}, C.TRANSPORT_DEFAULTS); syncControls(); update(); toast('Transport assumptions reset'); });
  $('#summary-scope').addEventListener('change', renderSummaryTables);

  // Review dialog
  $('#review-reset').addEventListener('click', () => { S.ui.review = Object.assign({}, C.REVIEW_DEFAULTS); buildReviewForm(); renderReview(); scheduleUrlSave(); });
  $('#review-export').addEventListener('click', exportReviewCsv);
  const rtabs = [$('#rt-ranked'), $('#rt-short')];
  const showRt = (i) => { rtabs.forEach((t, j) => { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; }); $('#rp-ranked').hidden = i !== 0; $('#rp-short').hidden = i !== 1; };
  rtabs.forEach((t, i) => { t.addEventListener('click', () => showRt(i)); t.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = 1 - i; rtabs[n].focus(); showRt(n); } }); });

  // Compare
  $('#compare-open').addEventListener('click', openCompare);
  $('#compare-export').addEventListener('click', exportCompareCsv);
  $('#compare-clear').addEventListener('click', () => { S.ui.compare = []; update(); });
  $('#cmp-export').addEventListener('click', exportCompareCsv);
  $('#cmp-print').addEventListener('click', printComparison);

  // Data
  $('#open-methods').addEventListener('click', () => openDialog('dlg-methods'));
  $('#show-needs-verification').addEventListener('click', () => {
    Object.assign(S.ui, { evidence: ['needs-verification'], scope: 'all', preset: null, tiers: [], evt: false });
    syncControls(); update(); switchView('find', { sheet: true });
    toast(`${S.results.length} records need verification`);
  });
  $('#export-csv').addEventListener('click', () => exportCsv($('#export-scope').value));
  $('#export-json').addEventListener('click', () => exportJson($('#export-scope').value));
  $('#export-md').addEventListener('click', () => download(summaryMarkdown(), `stroke-capability-summary_${stamp()}.md`, 'text/markdown'));
  $('#export-png').addEventListener('click', exportPng);
  $('#open-summary').addEventListener('click', openSummary);
  $('#share-link').addEventListener('click', copyLink);
  $('#summary-copy').addEventListener('click', async () => { const ok = await copyText(S.lastSummary || summaryMarkdown()); toast(ok ? 'Summary copied' : 'Copy failed — use Download instead', ok ? null : 'warn'); });
  $('#summary-download').addEventListener('click', () => download(S.lastSummary || summaryMarkdown(), `stroke-capability-summary_${stamp()}.md`, 'text/markdown'));
  $('#summary-print').addEventListener('click', printSummary);
  $('#theme-select').addEventListener('change', e => { S.prefs.theme = e.target.value; S.ui.theme = null; savePrefs(); applyTheme(); scheduleUrlSave(); });
  $('#basemap-select').addEventListener('change', e => { S.prefs.basemap = e.target.value; S.ui.basemap = null; savePrefs(); setBasemap(); scheduleUrlSave(); });
  $('#cb-toggle').addEventListener('change', e => { S.prefs.cb = e.target.checked; S.ui.cb = null; savePrefs(); applyTheme(); scheduleUrlSave(); });
  $('#shortcuts-toggle').addEventListener('change', e => { S.prefs.shortcuts = e.target.checked; savePrefs(); });
  $('#open-shortcuts').addEventListener('click', () => openDialog('dlg-shortcuts'));

  // Map chrome
  $('#jump').addEventListener('change', e => { const v = e.target.value; if (v) jumpTo(v); e.target.value = ''; });
  $('#legend-toggle').addEventListener('click', () => { S.prefs.legend = !S.prefs.legend; S.prefs.legendChosen = true; savePrefs(); renderLegend(); });

  // Detail
  $('#detail-close').addEventListener('click', () => closeDetail(true));
  $('#detail').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDetail(true); } });

  bindDialogs();
  document.addEventListener('keydown', onGlobalKey);
  if (MOBILE_Q.addEventListener) MOBILE_Q.addEventListener('change', onLayoutChange);
  window.addEventListener('resize', () => { measureSheetTop(); });
  if (typeof matchMedia === 'function') {
    const dq = matchMedia('(prefers-color-scheme: dark)');
    if (dq.addEventListener) dq.addEventListener('change', () => { if (!S.ui.theme && S.prefs.theme === 'auto') applyTheme(); });
  }
}
function toggleInclude(key, on) {
  const s = new Set(S.ui.include);
  if (on) s.add(key); else s.delete(key);
  S.ui.include = Array.from(s);
  update();
}
function onLayoutChange() {
  if (!MOBILE_Q.matches) { document.body.classList.remove('sheet-open', 'detail-minimized'); $('#main').removeAttribute('inert'); }
  measureSheetTop();
  if (S.map) setTimeout(() => S.map.invalidateSize(), 50);
}

function exportReviewCsv() {
  const res = S.lastReview || C.accessReview(reviewInput(), S.access, S.ui.review, { hasHub: !!S.ui.hub });
  if (res.error) { toast('All weights are zero — nothing to export', 'warn'); return; }
  const w = res.params;
  const head = ['list', 'rank', 'tied', 'record_id', 'name', 'state', 'tier_shown', 'tier_basis', 'capability_evidence', 'capability_last_checked',
    'miles_to_nearest_24x7_evt', 'nearest_24x7_evt_center', 'miles_to_nearest_csc_tsc_level', 'miles_to_my_center',
    'points_gap', 'points_evt', 'points_adv', 'points_hub', 'score', 'w_gap', 'w_evt', 'w_adv', 'w_hub', 'cap_mi', 'candidate_scope', 'data_version'];
  const pts = (r, k) => { const c = r.comps.find(x => x.key === k); return c && c.points != null ? Number(c.points.toFixed(2)) : ''; };
  const rows = [head];
  for (const [list, arr] of [['ranked', res.ranked], ['verification-shortlist', res.shortlist]]) {
    for (const r of arr) rows.push([list, r.rank, r.tied ? 'yes' : '', r.h.id, r.h.name, r.h.state, tierOf(r.h) || '', r.h.derived.tierBasis || '', capOf(r.h), lastCheckedOf(r.h) || '',
      C.isNum(r.evtMi) ? Number(r.evtMi.toFixed(1)) : '', r.access.evt247.dest ? r.access.evt247.dest.name : '', C.isNum(r.advMi) ? Number(r.advMi.toFixed(1)) : '',
      r.access.hub && C.isNum(r.access.hub.miles) ? Number(r.access.hub.miles.toFixed(1)) : '',
      pts(r, 'gap'), pts(r, 'evt'), pts(r, 'adv'), pts(r, 'hub'), Number(r.score.toFixed(2)), w.wGap, w.wEvt, w.wAdv, S.ui.hub ? w.wHub : '', w.capMi,
      S.reviewScope === 'all' ? 'whole analysis set' : 'current results', stamp()]);
  }
  download(C.toCsv(rows), `stroke-access-review_w${w.wGap}-${w.wEvt}-${w.wAdv}-${w.wHub}_cap${w.capMi}_${stamp()}.csv`, 'text/csv');
}

function onGlobalKey(e) {
  if (e.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return; // native dialog handles it
    if (S.map && S.map._popup && S.map.hasLayer(S.map._popup)) { S.map.closePopup(); return; }
    if (!$('#detail').hidden) { e.preventDefault(); closeDetail(true); return; }
    if (MOBILE_Q.matches && document.body.classList.contains('sheet-open')) { setSheet(false); return; }
    return;
  }
  if (!S.prefs.shortcuts) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const tag = (t && t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key;
  const run = (fn) => { e.preventDefault(); fn(); };
  if (k === '/') return run(() => { switchView('find'); $('#search').focus(); });
  if (k === '?') return run(() => openDialog('dlg-shortcuts'));
  if (k === 'R' && e.shiftKey) return run(resetFilters);
  if (e.shiftKey) return;
  switch (k.toLowerCase()) {
    case 'l': return run(() => { switchView('find', { sheet: true }); const b = $('.result[tabindex="0"]') || $('.result'); if (b) b.focus(); });
    case 'm': return run(() => { if (MOBILE_Q.matches) setSheet(false); $('#map').focus(); });
    case 'f': return run(() => switchView('find'));
    case 'e': return run(() => switchView('explore'));
    case 'c': return run(() => switchView('compare'));
    case 'q': return run(() => switchView('data'));
    case 'g': return run(() => switchView('explore', { focus: '#summary-scope' }));
    case 'd': return run(() => { S.prefs.theme = effectiveTheme() === 'dark' ? 'light' : 'dark'; S.ui.theme = null; savePrefs(); applyTheme(); syncControls(); scheduleUrlSave(); toast(S.prefs.theme === 'dark' ? 'Dark theme' : 'Light theme'); });
    default: return undefined;
  }
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
function renderProvenance() {
  const m = S.meta;
  $('#provenance-text').textContent = `Release ${m.release} · data ${m.data_version} · evidence review ${m.evidence_review_date} (claims carry their own check dates) · CMS reference ${m.census_snapshot.as_of} · straight-line distances.`;
}

function showBootError(err) {
  const msg = String((err && err.message) || err);
  $('#result-summary').textContent = 'Hospital data could not be loaded.';
  const list = $('#results');
  clear(list);
  list.appendChild(el('li', { class: 'empty' }, [el('p', { text: 'The hospital dataset could not be loaded. ' + msg }), el('button', { type: 'button', class: 'btn btn-primary', text: 'Retry', on: { click: () => location.reload() } })]));
  const mapEl = $('#map');
  if (mapEl && !mapEl.querySelector('.boot-error')) {
    mapEl.appendChild(el('div', { class: 'boot-error', role: 'alert' }, [el('h2', { text: 'Hospital data could not be loaded' }), el('p', { text: msg }),
      el('button', { type: 'button', class: 'btn btn-primary', text: 'Retry', on: { click: () => location.reload() } })]));
  }
  $('#provenance-text').textContent = 'Data unavailable.';
}

async function boot() {
  loadPrefs();
  // Display params from the URL win over saved preferences for this visit.
  const early = new URLSearchParams(location.search);
  if (early.has('theme') && ['light', 'dark'].includes(early.get('theme'))) S.ui.theme = early.get('theme');
  else if (early.get('dark') === '1') S.ui.theme = 'dark';
  if (early.has('cb')) S.ui.cb = early.get('cb') === '1';
  applyTheme();
  bindEvents();
  let json;
  try {
    json = await fetchData(0);
  } catch (err) {
    console.error('Data load failed', err);
    showBootError(err);
    document.documentElement.dataset.ready = 'error';
    return;
  }
  ingest(json);
  readUrl();
  const mapOk = initMap();
  populateSystems();
  populateHubSelect();
  populateJump();
  buildTransportForm();
  buildMethods();
  buildShortcuts();
  renderProvenance();
  recomputeAccess();
  syncControls();
  switchView(S.ui.view, { sheet: false });
  if (mapOk) {
    if (S.explicit.viewport) S.map.setView([S.ui.view_lat, S.ui.view_lng], S.ui.view_z);
    else fitTo(jumpBounds('contig'), 7);
  }
  S.booted = true;
  update();
  if (S.ui.selected) {
    const keepView = !!S.explicit.viewport;
    selectHospital(S.ui.selected, { source: keepView ? 'url-keep-view' : 'url', focusDetail: false });
  }
  measureSheetTop();
  // Read-only handle for automated tests and console inspection; also a
  // readiness flag set after the first render.
  window.__strokeAtlas = S;
  requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = 'true'; }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
