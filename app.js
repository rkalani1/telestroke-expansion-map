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
// Optional terrain shading: USGS The National Map shaded relief (3DEP), public
// domain, no key. Drawn over the muted basemap at low opacity.
const RELIEF_URL = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}';
const RELIEF_ATTRIBUTION = 'Relief: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a> (3DEP)';
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Phone layout: narrow screens, and short landscape screens (the same query as app.css).
const MOBILE_Q = typeof matchMedia === 'function' ? matchMedia('(max-width: 767px), (max-height: 480px) and (max-width: 1000px)') : { matches: false, addEventListener() {} };
// Up to tablet widths the hospital details cover the tool column (on phones,
// the whole screen above the tab bar) instead of the map.
const NARROW_Q = typeof matchMedia === 'function' ? matchMedia('(max-width: 1180px)') : { matches: false, addEventListener() {} };
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
  'capability-partial': 'Stroke capability partly assessed',
  'evidence-undated': 'Capability evidence has no claim-level check date',
  'conflicting-evidence': 'Conflicting evidence',
  'conflicting-identity': 'Conflicting status, emergency department, Critical Access or address evidence',
  'evidence-stale': 'Capability evidence older than 12 months',
  'eligibility-unresolved': 'Analysis eligibility unresolved',
  'federal-ed-access': 'Federal emergency department — civilian access not documented',
  unlocated: 'No verified map location',
  'location-unverified': 'Coordinates not verified to the campus',
  'address-unverified': 'Physical address not verified',
  'status-unknown': 'Active/closed status not confirmed',
  'outside-state-boundary': 'Coordinates outside the named state',
  'near-state-boundary': 'Coordinates at the state boundary',
  'near-county-boundary': 'County assignment uncertain (near a boundary)',
  'far-from-named-city': 'Coordinates far from the town the address names',
  'location-conflict': 'Two coordinate sources disagree',
  'nearer-to-another-town': 'Coordinates much nearer another town than the one named',
  'town-not-in-gazetteer': 'Town not in the gazetteer — town check not run',
};
// Priority of a needs-verification code (published with the data): P1/P2 are
// open items to resolve; P3 are precision notes, such as coordinates or an
// address not yet verified to the campus.
function nvPriority(code) { const c = S.meta && S.meta.needs_verification_codes && S.meta.needs_verification_codes[code]; return c ? c.priority : 'P3'; }
function openItems(h) { return ((h.derived && h.derived.needsVerification) || []).filter(c => nvPriority(c) !== 'P3'); }
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
  tileStats: { ok: 0, err: 0, warned: false },
  reviewTab: 'ranked',
  matrixSort: { key: 'name', dir: 1 },
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
// Focus the first of these that can take it: present, rendered, enabled and
// not under an inert panel. Used where the control that had focus goes away
// with a re-render, so focus never drops to <body>.
function focusFirst(...targets) {
  for (const t of targets) {
    const n = typeof t === 'string' ? $(t) : t;
    if (n && n.isConnected && !n.disabled && n.getClientRects().length && !n.closest('[inert]')) { n.focus(); return n; }
  }
  return null;
}
function focusLost() {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected || !a.getClientRects().length || !!a.closest('[inert]');
}
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
  placeToasts();
  setTimeout(() => { n.remove(); placeToasts(); }, ms || 3200);
}
// A toast never sits over the control that has focus (on a phone the bottom
// stack would cover the status bar's links): while it would, the stack moves
// to the top of the screen. Checked again whenever focus moves.
function placeToasts() {
  const box = $('#toasts');
  if (!box) return;
  box.classList.remove('toasts-top');
  const a = document.activeElement;
  if (!box.childElementCount || !a || a === document.body) return;
  const r = a.getBoundingClientRect();
  const over = (t) => { const b = t.getBoundingClientRect(); return b.left < r.right && r.left < b.right && b.top < r.bottom && r.top < b.bottom; };
  if (Array.from(box.children).some(over)) box.classList.add('toasts-top');
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
        if (['muted', 'terrain', 'standard', 'none'].includes(p.basemap)) S.prefs.basemap = p.basemap;
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
// The reason a capability claim does not apply, from the record's own status.
function closedNote(h) {
  const v = h.status && h.status.value;
  return v === 'closed' ? ' (closed campus)' : v === 'merged' ? ' (merged campus)' : '';
}
function nationalLabel(h) {
  const n = h.national || {};
  switch (stOf(n)) {
    case 'affirmative': return [n.body, n.program || C.TIER_NAMES[n.tier]].filter(Boolean).join(' — ');
    case 'negative': return 'Verified: no national stroke certification' + (n.note ? ` (${n.note})` : '');
    case 'no-record-found': return 'No national stroke certification found in reviewed sources';
    case 'conflicting': return 'Conflicting evidence';
    case 'not-applicable': return 'Not applicable' + closedNote(h);
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
  // Wyoming designation requires national accreditation and has no public
  // roster: its no-record-found is inferred from the national claim, not read off a roster.
  if (st === 'no-record-found' && s.method === 'regulatory-inference') return `None found (inferred from the ${s.system || 'state'} rule; see the note — no roster was available)`;
  if (st === 'no-record-found') return s.system ? `Not found on the ${s.system} roster as reviewed` : `No state stroke-designation program found${s.authority ? ' (' + s.authority + ')' : ''}`;
  if (st === 'negative') return `Not designated (${s.system || 'state'} roster, as reviewed)`;
  if (st === 'conflicting') return 'Conflicting evidence';
  if (s.system) return `Not assessed (${s.system})`;
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
  if (e === 'not-applicable' || e24 === 'not-applicable') return 'Not applicable' + closedNote(h);
  return 'Not assessed';
}
// Evidence age is the OLDEST critical claim's check date (national
// certification, 24/7 EVT, and state designation where the state has a
// program). Null when any of them is undated or none was checked.
function lastCheckedOf(h) { return (h.derived && h.derived.capabilityOldest) || null; }
function evidenceDateText(h) {
  const d = lastCheckedOf(h);
  if (d) { const a = ageDays(d); return `${d}${a != null ? ' (' + a + ' days)' : ''}`; }
  if (h.derived && h.derived.capabilityUndated) return 'Undated (carried from the previous edition)';
  return capOf(h) === 'unassessed' ? 'Never checked' : 'Undated';
}
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
      if (isOOR(h) || !STATE_PROGRAM_STATES.includes(h.state) || (h.status && h.status.value) !== 'active') return false;
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

// Published by the build: a tier, 'none' (searched, nothing found), 'partial'
// (some capability claims still unknown), 'unassessed' or 'conflicting'.
function tierKey(h) {
  if (isOOR(h)) return null;
  return (h.derived && h.derived.tierClass) || (tierOf(h) ? tierOf(h).toLowerCase() : 'unassessed');
}
const TIER_CLASS_TEXT = { none: 'None found in reviewed sources', partial: 'Partly assessed, no tier yet', unassessed: 'Not assessed', conflicting: 'Conflicting evidence' };
function tierText(h, short) {
  const t = tierOf(h);
  if (t) return `${t} (${h.derived.tierBasis === 'national' ? 'national' : short ? 'state' : 'state crosswalk'})`;
  return TIER_CLASS_TEXT[tierKey(h)] || 'Not assessed';
}

// One test per select filter, shared by the filter itself and by the counts
// shown on its options.
function matchState(h, v) { return v === 'ALL' || (h.state === v && !isOOR(h)); }
function matchSystem(h, v) {
  if (!v) return true;
  if (v === '__independent') return !!(h.system && h.system.state === 'independent');
  if (v === '__unknown') return !!(h.system && h.system.state === 'unknown');
  return !!(h.system && h.system.value === v);
}
function matchBasis(h, v) {
  if (v === 'national') return stOf(h.national) === 'affirmative';
  if (v === 'state') return !!(h.derived && h.derived.tierBasis === 'state-crosswalk');
  return true;
}
function matchCah(h, v) {
  const s = stOf(h.cah);
  if (v === 'yes') return s === 'affirmative';
  if (v === 'no') return s === 'negative';
  if (v === 'unknown') return s !== 'affirmative' && s !== 'negative';
  return true;
}
// "assessed" is strict: every critical capability claim assessed. Partly
// assessed records have their own option.
function matchEvidence(h, f) {
  if (!f) return true;
  const cap = capOf(h);
  if (f === 'assessed' || f === 'partial' || f === 'unassessed' || f === 'conflicting') return cap === f;
  if (f === 'needs-verification') return openItems(h).length > 0;
  if (f.startsWith('nv:')) return ((h.derived && h.derived.needsVerification) || []).includes(f.slice(3));
  return false;
}
const EVIDENCE_LABELS = { assessed: 'capability assessed', partial: 'capability partly assessed', unassessed: 'capability not assessed', conflicting: 'conflicting evidence', 'needs-verification': 'open items to verify' };

// `except` leaves one control's own filter out, so the counts on that control
// show what each of its choices would give with every other filter applied:
// 'tier' (the chips and the EVT checkbox), 'state', 'system', 'basis', 'cah', 'evidence'.
function passesOther(h, ui, tokens, except) {
  if (tokens.length && !C.matchesQuery(h.fields, tokens)) return false;
  if (except !== 'state' && !matchState(h, ui.state)) return false;
  if (except !== 'system' && !matchSystem(h, ui.system)) return false;
  if (except !== 'basis' && !matchBasis(h, ui.basis)) return false;
  if (except !== 'cah' && !matchCah(h, ui.cah)) return false;
  if (except !== 'evidence' && ui.evidence.length && !ui.evidence.some(f => matchEvidence(h, f))) return false;
  if (ui.evtMin > 0) {
    const a = S.access[h.id];
    const mi = a && a.evt247.miles;
    if (!C.isNum(mi) || mi < ui.evtMin) return false;
  }
  if (except !== 'tier') {
    if (ui.tiers.length && !ui.tiers.includes(tierKey(h))) return false;
    if (ui.evt && !C.hasDocumented247Evt(h)) return false;
  }
  if (ui.preset) {
    const pred = presetPredicate(ui.preset);
    if (pred && !pred(h)) return false;
  }
  return true;
}

// The select filters whose options carry counts: key in passesOther, element,
// and the test an option value applies.
const SELECT_FILTERS = [['state', '#f-state', matchState], ['system', '#f-system', matchSystem], ['basis', '#f-basis', matchBasis],
  ['cah', '#f-cah', matchCah], ['evidence', '#f-evidence', matchEvidence]];

function computeResults() {
  const ui = S.ui;
  const tokens = C.tokenize(ui.q);
  const hasQuery = tokens.length > 0;
  const results = [];
  const counts = { csc: 0, tsc: 0, psc: 0, asr: 0, none: 0, partial: 0, unassessed: 0, conflicting: 0, evt: 0, 'inc-unknown': 0, 'inc-excluded': 0 };
  // Per select: the records passing every filter but that select's own; the
  // option counts are taken from these in renderCounts.
  const selectPools = Object.fromEntries(SELECT_FILTERS.map(([key]) => [key, []]));
  for (const h of S.all) {
    const scoped = inScope(h, ui, hasQuery);
    if (!isOOR(h) && !hasQuery && ui.scope === 'eligible') {
      // Counts for the include toggles: what each would add.
      if (passesOther(h, ui, tokens)) {
        if (eligOf(h) === 'unknown') counts['inc-unknown']++;
        if (eligOf(h) === 'excluded') counts['inc-excluded']++;
      }
    }
    if (!scoped) continue;
    if (passesOther(h, ui, tokens)) results.push(h);
    // Every count is of five-state records, as the summary line is:
    // neighboring-state destinations listed with a search or "all records"
    // are counted apart there, never in a chip, checkbox or option.
    if (isOOR(h)) continue;
    if (passesOther(h, ui, tokens, 'tier')) {
      // Each control's count applies every other filter but its own: tier
      // chips respect the EVT checkbox; the EVT count respects the chips.
      const k = tierKey(h);
      if (k && counts[k] != null && (!ui.evt || C.hasDocumented247Evt(h))) counts[k]++;
      if (C.hasDocumented247Evt(h) && (!ui.tiers.length || ui.tiers.includes(k))) counts.evt++;
    }
    for (const [key] of SELECT_FILTERS) if (passesOther(h, ui, tokens, key)) selectPools[key].push(h);
  }
  sortResults(results, tokens);
  S.results = results;
  S.counts = counts;
  S.selectPools = selectPools;
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
  if (ui.tiers.length) parts.push(ui.tiers.map(t => ({ none: 'none found', partial: 'partly assessed, no tier yet', unassessed: 'not assessed', conflicting: 'conflicting (no tier)' }[t] || t.toUpperCase())).join('/'));
  if (ui.evt) parts.push('documented 24/7 EVT');
  if (ui.basis) parts.push(ui.basis === 'national' ? 'national certification' : 'state designation only');
  if (ui.cah) parts.push('CAH: ' + ui.cah);
  if (ui.system) parts.push(ui.system === '__independent' ? 'independent' : ui.system === '__unknown' ? 'system unknown' : ui.system);
  if (ui.evidence.length) parts.push(ui.evidence.map(f => f.startsWith('nv:') ? 'needs verification: ' + (NV_LABELS[f.slice(3)] || f.slice(3)).toLowerCase() : EVIDENCE_LABELS[f] || f).join('/'));
  if (ui.evtMin) parts.push(`≥${ui.evtMin} mi to documented 24/7 EVT`);
  return parts;
}
function scopeLabel() {
  const ui = S.ui;
  if (C.tokenize(ui.q).length) return 'search across all records' + (activeFilterParts().length ? ', other filters applied' : '');
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
  // A change of the destination sets (neighboring-state centers on or off) can
  // leave the selection without a separate CSC/TSC-level line; the setting goes with it.
  if (S.ui.advLine && !hasAdvLine(S.byId.get(S.ui.selected))) S.ui.advLine = false;
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
  if (C.hasDocumented247Evt(h)) out.push(badge('b-EVT', 'Documented 24/7 EVT'));
  const cap = capOf(h);
  if (!isOOR(h)) {
    if (cap === 'unassessed') out.push(badge('b-UNASSESSED', 'Capability not assessed'));
    else if (cap === 'conflicting') out.push(badge('b-CONFLICT', 'Conflicting evidence'));
    else {
      if (!tierOf(h) && tierKey(h) === 'none') out.push(badge('b-MUTED', 'No certification found'));
      // Also beside a tier or "none found": some capability claims are still
      // unknown. Named as the Evidence filter names this (wider) set; the tier
      // chip "Partly assessed, no tier yet" is the part of it without a tier.
      if (cap === 'partial') out.push(badge('b-PARTIAL', 'Capability partly assessed'));
    }
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
  if (a.evt247.status === 'on-site') return 'documented 24/7 EVT on site';
  if (C.isNum(a.evt247.miles)) return C.formatMiles(a.evt247.miles) + ' mi to documented 24/7 EVT';
  return '';
}

function renderResults() {
  const list = $('#results');
  if (!list) return;
  const inList = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#results'));
  const focusedId = inList ? document.activeElement.dataset.id : null;
  clear(list);
  if (!S.results.length) {
    if (inList) requestAnimationFrame(() => { if (document.activeElement === document.body) $('#search').focus({ preventScroll: true }); });
    const li = el('li', { class: 'empty' }, [
      el('p', { text: S.ui.q ? `No hospitals match “${S.ui.q}”${filtersActive() ? ' with the current filters' : ''}.` : 'No hospitals match the current filters.' }),
      filtersActive() ? el('button', { type: 'button', class: 'btn', text: 'Reset filters', on: { click: () => resetFilters(['#search']) } }) : null,
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
  if (inList) {
    // A focused row that is no longer listed hands focus to the row now
    // tabbable, never to <body>.
    const again = (focusedId && list.querySelector(`.result[data-id="${CSS.escape(focusedId)}"]`)) || list.querySelector('.result[tabindex="0"]');
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
  // Select options show "(n)": the five-state results each choice would give
  // with every other filter applied (the same rule as the chips). Values
  // never change.
  for (const [key, sel, match] of SELECT_FILTERS) {
    const pool = (S.selectPools && S.selectPools[key]) || [];
    for (const o of $$('option', $(sel))) {
      if (o.dataset.label == null) o.dataset.label = o.textContent;
      o.textContent = `${o.dataset.label} (${pool.filter(h => match(h, o.value)).length})`;
    }
  }
}

function renderStatus() {
  const total = S.all.filter(h => !isOOR(h)).length;
  const shown = S.results.length;
  const onMap = S.results.filter(isLocated).length;
  const unloc = shown - onMap;
  // Neighboring-state destinations are listed with a search or "all records"
  // but are not records of the five states: counted apart, never in "n of total".
  const nb = S.results.filter(isOOR).length;
  const summary = $('#result-summary');
  clear(summary);
  const fparts = activeFilterParts();
  appendAll(summary, [el('strong', { text: String(shown - nb) }), ` of ${total} records${nb ? ` + ${nb} neighboring-state destination${nb === 1 ? '' : 's'}` : ''} · ${scopeLabel()}`,
    C.tokenize(S.ui.q).length && fparts.length ? ` (${fparts.join(', ')})` : '',
    unloc ? ` · ${unloc} without a map location` : '']);
  const toggle = $('#sheet-toggle');
  if (toggle) toggle.textContent = document.body.classList.contains('sheet-open') ? 'Show map' : `Show list (${shown})`;
  const ms = $('#map-status');
  // The bar is rebuilt on every render: a focused link keeps focus on its
  // rebuilt twin; one that is gone ("Reset filters" once nothing is filtered)
  // hands focus to the way back to the details, or to the search.
  const focused = ms.contains(document.activeElement) ? document.activeElement.dataset.act : null;
  clear(ms);
  const parts = activeFilterParts();
  const sep = () => el('span', { class: 'sep', text: ' · ', 'aria-hidden': 'true' });
  const sel = S.ui.selected && S.byId.get(S.ui.selected);
  appendAll(ms, [
    el('span', null, ['Map: ', el('strong', { text: MODE_LABELS[S.ui.mode] })]), sep(),
    el('span', { text: `${onMap} on map` + (unloc ? `, ${unloc} not located` : '') + '; ' }),
    el('span', { text: scopeLabel() + (parts.length ? '; ' : '') }),
    parts.length ? el('span', { text: 'filters: ' + parts.join(', ') }) : null,
    filtersActive() ? el('button', { type: 'button', class: 'link-btn', dataset: { act: 'reset' }, text: 'Reset filters', on: { click: () => resetFilters() } }) : null,
    sel && $('#detail').hidden ? sep() : null,
    sel && $('#detail').hidden ? el('button', { type: 'button', class: 'link-btn', dataset: { act: 'details' }, text: 'Details: ' + sel.name, on: { click: () => { document.body.classList.remove('detail-minimized'); openDetail(); renderDetail(); $('#detail-title').focus(); } } }) : null,
    // Said, not hidden: a fit that could not keep every connection clear of the panels.
    sel && S.fitShort ? sep() : null,
    sel && S.fitShort ? el('span', { class: 'fit-note', text: 'Not every connection end fits clear of the map panels at this size: some may be under a panel.' }) : null,
  ]);
  if (focused) focusFirst(`#map-status [data-act="${focused}"]`, '#map-status [data-act="details"]', '#search', '#map');
  syncStatusHeight();
}
// The legend never rises over the status bar (on phones it sits just above
// it), and the bar wraps to more lines on narrow screens: its real height
// places the legend (app.css --status-h).
function syncStatusHeight() {
  const ms = $('#map-status');
  const h = ms && ms.offsetParent ? Math.ceil(ms.getBoundingClientRect().height) + 'px' : '';
  const main = $('#main');
  if (main && main.style.getPropertyValue('--status-h') !== h) main.style.setProperty('--status-h', h);
}

// `fallback`: where focus goes if the control used goes with the filters
// (the sidebar "Reset filters" hides once nothing is filtered).
function resetFilters(fallback) {
  const d = C.defaultUiState();
  Object.assign(S.ui, { state: 'ALL', tiers: [], evt: false, evidence: [], basis: null, cah: null, system: null, scope: 'eligible', include: d.include.slice(), evtMin: 0, preset: null, sort: d.sort });
  S.presetUndo = null;
  syncControls();
  update();
  toast('Filters reset');
  // Queued after the render that update() queued, so it sees the result.
  // Only a list of selectors moves focus (an event passed by a click handler does not).
  if (Array.isArray(fallback)) requestAnimationFrame(() => { if (focusLost()) focusFirst(...fallback); });
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
    // Partly assessed (some capability claims still unknown) keeps a dotted
    // ring in every mode: a second channel besides colour, and distinct from
    // the dashed "not assessed" ring.
    partialRing: !isOOR(h) && cap === 'partial',
  };
  if (mode === 'capability') {
    m.size = tier ? { CSC: 20, TSC: 19, PSC: 17, ASR: 15 }[tier] : 13;
    if (isOOR(h)) { m.fill = tier ? TIER_VAR[tier] : '--c-neighbor'; m.size = 14; }
    else if (cap === 'unassessed') { m.hollow = true; m.dashed = true; m.stroke = '--c-unassessed-stroke'; }
    else if (cap === 'conflicting') {
      // Shape carries the conflict; fill still shows the tier when one is documented (e.g. a state level).
      m.size = tier ? Math.max(15, m.size - 2) : 15;
      if (tier) m.fill = TIER_VAR[tier];
      else { m.hollow = true; m.stroke = '--c-conflict'; }
    } else if (tier) m.fill = TIER_VAR[tier];
    // Partly assessed with no tier yet: grey like "none found"; the dotted
    // ring tells them apart.
    else m.fill = '--c-none';
  } else if (mode === 'evt-distance' || mode === 'adv-distance' || mode === 'hub-distance') {
    const r = !a ? null : mode === 'evt-distance' ? a.evt247 : mode === 'adv-distance' ? a.advanced : a.hub;
    const bin = r ? C.distanceBin(r) : 'unknown';
    m.fill = { 'on-site': '--d-0', lt50: '--d-1', '50-100': '--d-2', '100-150': '--d-3', '150plus': '--d-4' }[bin] || null;
    if (!m.fill) { m.hollow = true; m.stroke = '--text-3'; }
    m.size = 14;
    if (cap === 'unassessed' && !isOOR(h)) m.dashOverlay = true;
    if (isOOR(h)) m.fill = '--c-neighbor';
  } else if (mode === 'evidence') {
    m.size = 14;
    if (isOOR(h)) m.fill = '--c-neighbor';
    else if (cap === 'unassessed') { m.hollow = true; m.dashed = true; m.stroke = '--c-unassessed-stroke'; }
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
    // Capability assessment stays visible as a second channel, as the legend says.
    if (capOf(h) === 'unassessed' && !isOOR(h)) m.dashOverlay = true;
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
  if (m.dashOverlay) parts.push(`<path data-ring="unassessed" d="${shapePath('circle', c, c, r + 2.4)}" style="fill:none;stroke:var(--c-unassessed-stroke);stroke-width:1.8;stroke-dasharray:2.6 2"/>`);
  if (m.partialRing) parts.push(`<path data-ring="partial" d="${shapePath('circle', c, c, partialRingRadius(m))}" style="fill:none;stroke:var(--c-partial);stroke-width:${PARTIAL_DOT.width};stroke-linecap:round;stroke-dasharray:${PARTIAL_DOT.dash.join(' ')}"/>`);
  return `<svg class="mk" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

function glyphSignature(m) {
  return [m.shape, m.size, m.fill, m.stroke, m.dashed, m.hollow, m.evtRing, m.hub, m.selected, m.dim, m.dashOverlay, m.partialRing].join('|');
}
// The dotted ring sits outside the EVT and my-center rings when those are drawn.
const PARTIAL_DOT = { width: 2, dash: [0.1, 3.4] };
function partialRingRadius(m) { return m.size / 2 + (m.hub ? 8.4 : m.evtRing ? 5.6 : 2.8); }

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
    // Nothing is drawn, so the jump menu and the marker legend have nothing to act on or explain.
    for (const q of ['.map-jump', '#legend']) $(q).hidden = true;
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
  mapEl.classList.remove('bm-muted', 'bm-terrain', 'bm-standard', 'bm-none');
  mapEl.classList.add('bm-' + bm);
  if (bm !== 'terrain' && S.relief) { S.map.removeLayer(S.relief); S.relief = null; }
  if (bm === 'none') {
    if (S.tiles) { S.map.removeLayer(S.tiles); S.tiles = null; }
    S.map.attributionControl.removeAttribution(TILE_ATTRIBUTION);
    return;
  }
  if (bm === 'terrain' && !S.relief) {
    S.relief = L.tileLayer(RELIEF_URL, { maxZoom: 19, maxNativeZoom: 16, opacity: 0.4, className: 'relief-layer', crossOrigin: 'anonymous', attribution: RELIEF_ATTRIBUTION }).addTo(S.map);
    let ok = 0, err = 0, warned = false;
    S.relief.on('tileload', () => { ok++; });
    S.relief.on('tileerror', () => {
      err++;
      if (err >= 6 && ok === 0 && !warned) { warned = true; toast('Terrain shading could not be loaded; the basemap and markers still work.'); }
    });
  }
  if (!S.tiles) {
    // crossOrigin lets the PNG export draw tiles without tainting the canvas;
    // OpenStreetMap serves CORS headers. Attribution stays visible per the
    // OSMF tile usage policy.
    S.tiles = L.tileLayer(TILE_URL, { maxZoom: 19, crossOrigin: 'anonymous', attribution: TILE_ATTRIBUTION }).addTo(S.map);
    S.tiles.on('tileload', () => { S.tileStats.ok++; if (S.tileStats.warned) { $('#map-banner').hidden = true; S.tileStats.warned = false; } });
    $('#map-banner-close').addEventListener('click', () => { $('#map-banner').hidden = true; $('#map').focus(); });
    S.tiles.on('tileerror', () => {
      S.tileStats.err++;
      if (S.tileStats.err >= 6 && S.tileStats.ok === 0 && !S.tileStats.warned) {
        S.tileStats.warned = true;
        $('#map-banner-text').textContent = 'Basemap tiles could not be loaded (offline or blocked). Hospital markers, the list, details and exports still work.';
        $('#map-banner').hidden = false;
      }
    });
  }
}

function dataBounds(records) {
  if (typeof L === 'undefined') return null;
  const pts = records.filter(isLocated).map(h => [h.location.lat, h.location.lng]);
  return pts.length ? L.latLngBounds(pts) : null;
}

// Padding that keeps fitted points clear of everything floating over the map
// (status bar, legend, jump menu, the detail panel where it overlays the map,
// the phone search bar). Each overlay pads the map edge that costs the smallest
// share of that dimension (a small corner pill pads the long edge, not the
// short one). The padding is never scaled down to make room: a fit zooms out
// to the clear rectangle it leaves instead (fitPoints). `cramped` marks a
// rectangle under 40% of either dimension, where a fit folds the legend.
const MAP_OVERLAYS = ['#map-status', '#legend', '.map-jump', '#detail', '.search-block'];
function mapPadding() {
  const base = 20;
  const pad = { top: base, right: base, bottom: base, left: base };
  if (!S.map) return { tl: [base, base], br: [base, base] };
  const m = S.map.getContainer().getBoundingClientRect();
  if (!m.width || !m.height) return { tl: [base, base], br: [base, base] };
  for (const sel of MAP_OVERLAYS) {
    const node = $(sel);
    if (!node || node.hidden) continue;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right <= m.left || r.left >= m.right || r.bottom <= m.top || r.top >= m.bottom) continue;
    // A sheet covering the whole map (the phone detail) is put away before the
    // map is used, so a fit made while it is open aims at the map under it.
    if (r.left <= m.left + 1 && r.right >= m.right - 1 && r.top <= m.top + 1 && r.bottom >= m.bottom - 1) continue;
    const cand = [['left', r.right - m.left, m.width], ['right', m.right - r.left, m.width],
      ['top', r.bottom - m.top, m.height], ['bottom', m.bottom - r.top, m.height]];
    cand.sort((a, b) => a[1] / a[2] - b[1] / b[2]);
    const [edge, depth] = cand[0];
    pad[edge] = Math.max(pad[edge], depth + 12);
  }
  const cramped = pad.left + pad.right > m.width * 0.6 || pad.top + pad.bottom > m.height * 0.6;
  return { tl: [Math.round(pad.left), Math.round(pad.top)], br: [Math.round(pad.right), Math.round(pad.bottom)], cramped };
}

function fitTo(bounds, maxZoom) {
  if (!S.map || !bounds) return;
  fitPoints([bounds.getSouthWest(), bounds.getNorthEast()], maxZoom);
}

// Fit points into the clear rectangle the full padding leaves: the zoom
// Leaflet gives for that rectangle, centred in it as fitBounds would, then
// stepped down until every point lies inside it, never below the map's
// minimum zoom. When the rectangle cannot hold them, the points are fitted to
// the whole map instead and `done(false)` says so, for the status bar.
function fitPoints(latlngs, maxZoom, done) {
  const report = done || (() => {});
  if (!S.map || !latlngs.length) { report(true); return; }
  // A zoom animation in progress ignores a new view: fit once it has ended.
  if (S.map._animatingZoom) { S.map.once('zoomend', () => fitPoints(latlngs, maxZoom, done)); return; }
  const p = mapPadding();
  const size = S.map.getSize();
  const box = { l: p.tl[0], t: p.tl[1], r: size.x - p.br[0], b: size.y - p.br[1] };
  const bounds = L.latLngBounds(latlngs);
  const animate = !REDUCED_MOTION;
  const minZ = S.map.getMinZoom();
  const step = S.map.options.zoomSnap || 0.5;
  // Pixel centre that puts the bounds' centre in the middle of the clear rectangle.
  const centreAt = (z) => S.map.project(bounds.getSouthWest(), z).add(S.map.project(bounds.getNorthEast(), z)).divideBy(2)
    .add(L.point((p.br[0] - p.tl[0]) / 2, (p.br[1] - p.tl[1]) / 2));
  const inside = (z, c) => latlngs.every(ll => {
    const q = S.map.project(ll, z).subtract(c).add(size.divideBy(2));
    return q.x >= box.l && q.x <= box.r && q.y >= box.t && q.y <= box.b;
  });
  if (box.r - box.l >= 1 && box.b - box.t >= 1) {
    let z = Math.min(maxZoom || 11, S.map.getBoundsZoom(bounds, false, L.point(p.tl[0] + p.br[0], p.tl[1] + p.br[1])));
    for (; z >= minZ; z -= step) {
      const c = centreAt(z);
      if (inside(z, c)) { S.map.setView(S.map.unproject(c, z), z, { animate }); report(true); return; }
    }
  }
  S.map.fitBounds(bounds, { padding: [20, 20], maxZoom: maxZoom || 11, animate });
  report(false);
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
// Markers that sit on, or nearly on, each other at the current zoom get a
// count badge on the one drawn on top, so a marker hiding others says so; a
// click there opens the chooser. Recomputed after every render and zoom.
const STACK_PX = 10;
function renderStackBadges() {
  if (!S.map) return;
  if (!S.badgeLayer) S.badgeLayer = L.layerGroup().addTo(S.map);
  S.badgeLayer.clearLayers();
  S.stacks = new Map();
  const pts = [];
  for (const [id, mk] of S.markers) {
    if (!S.markerLayer.hasLayer(mk)) continue;
    const p = S.map.latLngToContainerPoint(mk.getLatLng());
    const off = S.offsets.get(id) || [0, 0];
    // Leaflet stacks markers by screen y plus their z-index offset.
    pts.push({ id, x: p.x + off[0], y: p.y + off[1], top: p.y + (mk.options.zIndexOffset || 0), mk });
  }
  pts.sort((a, b) => b.top - a.top || a.id.localeCompare(b.id));
  const used = new Set();
  for (const a of pts) {
    if (used.has(a.id)) continue;
    const grp = pts.filter(b => !used.has(b.id) && (b.x - a.x) ** 2 + (b.y - a.y) ** 2 <= STACK_PX * STACK_PX);
    if (grp.length < 2) continue;
    for (const b of grp) { used.add(b.id); S.stacks.set(b.id, grp.length); }
    const off = S.offsets.get(a.id) || [0, 0];
    const badge = L.marker(a.mk.getLatLng(), {
      icon: L.divIcon({ className: 'stack-badge', html: `<span>${grp.length}</span>`, iconSize: [20, 16], iconAnchor: [-3 - off[0], 19 - off[1]] }),
      interactive: false, keyboard: false, zIndexOffset: 10000,
    });
    S.badgeLayer.addLayer(badge);
    const n = badge.getElement();
    if (n) n.setAttribute('aria-hidden', 'true');
  }
}
function refreshOffsets() {
  const had = !!(S.stacks && S.stacks.size);
  renderStackBadges();
  if (had !== !!S.stacks.size) renderLegend();
}

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
  renderStackBadges();
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
  if (C.hasDocumented247Evt(h)) lines.push(' · documented 24/7 EVT');
  if (a && a.evt247.status === 'ok') lines.push(el('br'), `${milesText(a.evt247.miles, h, a.evt247.dest)} mi straight-line to nearest documented 24/7 EVT center`);
  const stacked = S.stacks && S.stacks.get(h.id);
  if (stacked > 1) lines.push(el('br'), el('em', { text: `${stacked} hospitals overlap here at this zoom — click to choose, or zoom in` }));
  return el('span', null, lines);
}

function onMarkerClick(h, e) {
  // Overlapping markers: offer a chooser instead of silently picking the top one.
  // Measured between drawn positions (coordinates plus any same-point offset):
  // Leaflet reports a marker click at its coordinates, not where its offset
  // icon is drawn, which would put two offset campuses always "on" each other.
  if (S.map && e && isLocated(h)) {
    const near = [];
    const own = S.offsets.get(h.id) || [0, 0];
    const at = S.map.latLngToContainerPoint([h.location.lat, h.location.lng]);
    for (const [id, mk] of S.markers) {
      if (!S.markerLayer.hasLayer(mk)) continue;
      const p = S.map.latLngToContainerPoint(mk.getLatLng());
      const off = S.offsets.get(id) || [0, 0];
      const dx = p.x + off[0] - (at.x + own[0]);
      const dy = p.y + off[1] - (at.y + own[1]);
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
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  // When my center is also the nearest documented 24/7 EVT center, one line
  // carries both meanings and says so.
  if (a.evt247.status === 'ok') out.push({ kind: 'evt', to: a.evt247.dest, miles: a.evt247.miles, alsoHub: !!(hub && hub.id === a.evt247.dest.id) });
  if (hub && a.hub && a.hub.status === 'ok' && (!a.evt247.dest || hub.id !== a.evt247.dest.id)) out.push({ kind: 'hub', to: hub, miles: a.hub.miles });
  if (S.ui.advLine && a.advanced.status === 'ok' && !out.some(x => x.to.id === a.advanced.dest.id)) out.push({ kind: 'adv', to: a.advanced.dest, miles: a.advanced.miles });
  return out;
}

function lineStyle(kind) {
  if (kind === 'evt') return { color: cssVar('--c-evt'), weight: 3.5, opacity: 0.95 };
  if (kind === 'hub') return { color: cssVar('--c-hub'), weight: 3, opacity: 0.95, dashArray: '9 7' };
  return { color: cssVar('--text-2'), weight: 2.5, opacity: 0.9, dashArray: '2 6' };
}

function lineLabel(l) {
  return `${milesText(l.miles, S.byId.get(S.ui.selected), l.to)} mi straight-line` + (l.kind === 'hub' ? ' · my center' : l.kind === 'adv' ? ' · CSC/TSC-level' : l.alsoHub ? ' · documented 24/7 EVT · my center' : ' · documented 24/7 EVT');
}

function renderLines() {
  if (!S.lineLayer) return;
  S.lineLayer.clearLayers();
  const sel = S.ui.selected && S.byId.get(S.ui.selected);
  for (const l of selectionLines()) {
    const label = lineLabel(l);
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
const LEGEND_GLYPH = { shape: 'circle', size: 12, fill: '--c-none', stroke: '--marker-stroke', dashed: false, hollow: false, evtRing: false, hub: false, selected: false, dim: false, dashOverlay: false, partialRing: false };
function legendRow(model, text) {
  return el('div', { class: 'legend-row' }, [svgEl(glyphSvg(Object.assign({}, LEGEND_GLYPH, model))), el('span', { text })]);
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
      [{ fill: '--c-none', partialRing: true }, 'Partly assessed, no tier yet (dotted ring)'],
      [{ hollow: true, dashed: true, stroke: '--c-unassessed-stroke' }, 'Capability not assessed'],
      [{ shape: 'diamond', hollow: true, stroke: '--c-conflict' }, 'Diamond: conflicting evidence (filled when a tier is still documented)'],
    ], note: 'A state level is shown on the tier it maps to (display crosswalk) — not national accreditation. The list and details name the basis.' });
  } else if (mode === 'evidence') {
    groups.push({ title: 'Fill: evidence status', rows: [
      [{ fill: '--e-assessed' }, `Assessed, oldest critical evidence checked within ${STALE_DAYS} days of the review`],
      [{ fill: '--e-old' }, 'Assessed, older or undated evidence'],
      [{ fill: '--e-partial', partialRing: true }, 'Capability partly assessed (dotted ring)'],
      [{ hollow: true, dashed: true, stroke: '--c-unassessed-stroke' }, 'Not assessed'],
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
  const sample = mode === 'capability' ? '--c-psc' : mode === 'evidence' ? '--e-partial' : mode === 'eligibility' ? '--c-hub' : '--d-2';
  shape.push([{ fill: sample, partialRing: true }, 'Dotted ring: capability partly assessed (some claims still unknown)']);
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
    if (lines.some(l => l.kind === 'evt' && l.alsoHub)) rows.push(['', 'Selected → my receiving center, also the nearest documented 24/7 EVT']);
    else if (lines.some(l => l.kind === 'evt')) rows.push(['', 'Selected → nearest documented 24/7 EVT']);
    if (lines.some(l => l.kind === 'hub')) rows.push(['hub', 'Selected → my receiving center']);
    if (lines.some(l => l.kind === 'adv')) rows.push(['adv', 'Selected → nearest CSC/TSC-level center']);
    groups.push({ title: 'Lines', lines: rows, note: 'Straight-line geometry. Not road routes, transfer pathways or referral relationships.'
      + (S.ui.overlays.includes('nearest') ? ' Thin grey lines: modeled nearest documented 24/7 EVT center for each listed hospital.' : '')
      + (S.ui.overlays.includes('rings') ? ' Teal circles: 50 / 100 mi straight-line radius around each documented 24/7 EVT center, not travel time.' : '') });
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
  if (S.stacks && S.stacks.size) {
    body.appendChild(el('div', { class: 'legend-group' }, [el('div', { class: 'legend-row' }, [
      el('span', { class: 'stack-badge', 'aria-hidden': 'true' }, el('span', { text: '3' })),
      el('span', { text: 'Markers overlapping at this zoom; click to choose, or zoom in' })])]));
  }
  const lg = $('#legend');
  const open = legendExpanded();
  lg.classList.toggle('collapsed', !open);
  const tg = $('#legend-toggle');
  tg.setAttribute('aria-expanded', String(open));
  tg.setAttribute('aria-label', open ? 'Collapse legend' : 'Expand legend');
}

// The saved legend choice, unless a fit has collapsed it for this view.
function legendExpanded() { return S.legendAuto === false ? false : !!S.prefs.legend; }

// States with a hospital stroke designation program (as scripts/build-dataset.py).
const STATE_PROGRAM_STATES = ['WA', 'ID', 'WY'];

// ------------------------------------------------------------------
// Selection + detail panel
// ------------------------------------------------------------------
function selectHospital(id, opts) {
  const h = S.byId.get(id);
  if (!h) return;
  const o = opts || {};
  if (o.source !== 'url') S.detailOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  // A new selection starts without the CSC/TSC-level line; a link may carry it.
  if (o.source !== 'url' && o.source !== 'url-keep-view') S.ui.advLine = false;
  S.ui.selected = id;
  S.fitShort = false;
  S.refitOnReveal = false;
  // Fill the panel before revealing it, so it never shows a placeholder title
  // or an empty body for a frame (the scheduled render repeats this harmlessly).
  renderDetail();
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
  syncInert();
  syncMapSize();
}

// On desktop the detail is a grid column, so opening or closing it resizes the
// map. Leaflet must learn the new size before any fit, or fitBounds works from
// the old width; done at once (not deferred) so a fit queued after it is right.
// pan:false keeps what is on screen where it is.
function syncMapSize() { if (S.map) S.map.invalidateSize({ pan: false }); }

// Is the detail panel covering the tool column (tablet) or the screen (phone)?
function detailCoversTools() { return !$('#detail').hidden && NARROW_Q.matches; }

// Whatever a panel or sheet covers is inert, so Tab and screen readers cannot
// reach controls hidden under it. On phones the bottom tab bar stays usable.
function syncInert() {
  const phone = MOBILE_Q.matches;
  const covered = detailCoversTools();
  const sheet = phone && document.body.classList.contains('sheet-open');
  $('#main').toggleAttribute('inert', phone && (covered || sheet));
  $('#sidebar').toggleAttribute('inert', covered && !phone);
  for (const p of $$('#sidebar > .panel')) p.toggleAttribute('inert', covered && phone);
}

function closeDetail(restore) {
  const d = $('#detail');
  if (d.hidden) return;
  d.hidden = true;
  document.body.classList.remove('detail-open');
  syncInert();
  const prevId = S.ui.selected;
  S.ui.selected = null;
  S.ui.advLine = false;
  S.fitShort = false;
  S.refitOnReveal = false;
  // A legend collapsed to make room for this selection's fit comes back.
  if (S.legendAuto === false) S.legendAuto = null;
  update();
  syncMapSize();
  if (restore !== false) {
    const opener = S.detailOpener;
    S.detailOpener = null;
    const openerId = opener && opener.dataset ? opener.dataset.id : null;
    // Resolve the target after the re-render: list rows are rebuilt, so the
    // element that opened the panel may have been replaced by an equivalent one.
    // Focus already placed somewhere else in the meantime stays where it is.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!focusLost() && !$('#detail').contains(document.activeElement)) return;
      let target = opener && document.contains(opener) && opener.offsetParent ? opener : null;
      const rowId = openerId || prevId;
      if (!target && rowId) target = $(`.result[data-id="${CSS.escape(rowId)}"]`);
      if (!target) target = $('#search');
      if (target) target.focus({ preventScroll: false });
    }));
  }
}

// Phones: put the hospital details away (not closed: the selection and its
// lines stay) and show the map, with a "Details: <name>" link in the status
// bar to come back. Focus moves to that link so it is not lost on <body>.
function minimizeDetailOnPhone(focusBack) { minimizeDetail(focusBack); }
function minimizeDetail(focusBack) {
  $('#detail').hidden = true;
  document.body.classList.remove('detail-open');
  document.body.classList.add('detail-minimized');
  if (MOBILE_Q.matches) setSheet(false); else syncInert();
  syncMapSize();
  renderStatus();
  if (S.refitOnReveal) fitConnections(false);
  if (focusBack === false) return;
  const back = $$('#map-status .link-btn').find(b => b.textContent.startsWith('Details: '));
  if (back) back.focus();
}

function fitConnections(closeOnMobile) {
  const h = S.byId.get(S.ui.selected);
  if (!h || !S.map || !isLocated(h)) return;
  S.refitOnReveal = false;
  if (closeOnMobile && MOBILE_Q.matches) minimizeDetailOnPhone();
  else if (mapPadding().cramped) {
    // Not enough clear map beside the panels (laptop/tablet widths). The
    // button puts the details away (selection kept, "Details:" link to
    // return); the automatic fit on selection keeps the details just opened.
    // Then, if still cramped, collapse the legend for this view without
    // changing the saved choice, so the endpoints are not fitted under it.
    if (closeOnMobile) {
      const d = $('#detail').getBoundingClientRect();
      const m = S.map.getContainer().getBoundingClientRect();
      if (!$('#detail').hidden && d.left < m.right && d.right > m.left) minimizeDetail(true);
    }
    if (mapPadding().cramped && legendExpanded()) { S.legendAuto = false; renderLegend(); }
  }
  const pts = [L.latLng(h.location.lat, h.location.lng)];
  for (const l of selectionLines()) pts.push(L.latLng(l.to.location.lat, l.to.location.lng));
  // On a phone the details cover the map while this fit is made: once they
  // are put away (and the status bar has its "Details:" link), fit again.
  S.refitOnReveal = MOBILE_Q.matches && !$('#detail').hidden;
  const setShort = (ok) => { if (S.fitShort !== !ok) { S.fitShort = !ok; renderStatus(); } };
  if (pts.length === 1) { setShort(true); S.map.setView(pts[0], Math.max(S.map.getZoom(), 10), { animate: !REDUCED_MOTION }); return; }
  fitPoints(pts, 11, setShort);
}

function claimRow(label, valueNodes, claim, extra) {
  const st = claim ? stOf(claim) : null;
  const meta = [];
  if (claim) {
    if (claim.effective) meta.push('effective ' + claim.effective);
    if (claim.expires) meta.push('expires ' + claim.expires);
    meta.push(claim.checked ? 'checked ' + claim.checked + (claim.method ? ' · ' + methodShort(claim.method) : '')
      : claim.method === 'prior-edition' ? 'carried from the previous edition · no claim-level check date' + (claim.editionAsOf ? ` (that edition is dated ${claim.editionAsOf})` : '')
        : claim.method ? methodShort(claim.method) + ' · no check date' : 'never checked');
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
    banner.appendChild(el('strong', { text: CAP_LABELS[cap] + (checked ? ` · oldest critical evidence checked ${checked}${age != null ? ` (${age} days before the ${S.meta.evidence_review_date} review)` : ''}`
      : h.derived.capabilityUndated ? ' · some evidence carried from the previous edition without a claim-level check date' : '') }));
    if (cap === 'unassessed') banner.appendChild(el('span', { text: 'No certification shown here means not checked — not that none exists. Confirm directly before relying on it.' }));
    if (cap === 'conflicting') banner.appendChild(el('span', { text: 'Credible sources disagree. Both are cited below; neither is shown as settled.' }));
    banner.appendChild(el('span', { text: eligText(elig) }));
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
  // Without a tier, the same words as the list badge and the comparison (tierText).
  dl.appendChild(claimRow('Tier shown on map', tier ? `${tier} — ${C.TIER_NAMES[tier]}` : isOOR(h) ? 'None shown (destination only)' : tierText(h), null,
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
  body.appendChild(el('p', { class: 'hint detail-disclaimer', text: 'Planning reference from public sources — not for clinical decisions, dispatch or patient routing. Confirm capability and availability with the hospital directly.' }));
  body.scrollTop = scrollTop;
}

function locMethod(m) {
  return { 'rule-based': 'two independent coordinate sources agree (see note)', 'cms-dataset': 'CMS-supplied coordinates (geocoding method not documented by CMS)', 'legacy-geocode': 'earlier-edition geocode (geocoder, query and match type not recorded)', 'city-centroid': 'town centre from the GeoNames gazetteer (approximate)', 'source-reported': 'coordinates stated by the cited source', 'manual-review': 'maintainer review against the cited source' }[m] || m;
}

function renderDetailActions(h) {
  const bar = $('#detail-actions');
  // The bar is rebuilt on every render: a focused action keeps focus on its
  // rebuilt twin instead of dropping to <body>.
  const focused = bar.contains(document.activeElement) ? document.activeElement.dataset.act : null;
  clear(bar);
  const inCmp = S.ui.compare.includes(h.id);
  if (isLocated(h) && S.map) {
    bar.appendChild(el('button', { type: 'button', class: 'btn', dataset: { act: 'fit' }, text: MOBILE_Q.matches ? 'Show on map' : 'Fit connections', on: { click: () => fitConnections(true) } }));
  }
  if (!isOOR(h) && C.canBeDestination(h)) {
    const isHub = S.ui.hub === h.id;
    bar.appendChild(el('button', { type: 'button', class: 'btn', dataset: { act: 'hub' }, 'aria-pressed': String(isHub), text: isHub ? 'My receiving center ✓' : 'Set as my receiving center', on: { click: () => setHub(isHub ? null : h.id, true) } }));
  }
  if (!isOOR(h)) {
    bar.appendChild(el('button', { type: 'button', class: 'btn', dataset: { act: 'compare' }, 'aria-pressed': String(inCmp), text: inCmp ? 'In comparison ✓' : 'Add to comparison', disabled: !inCmp && S.ui.compare.length >= C.MAX_COMPARE, on: { click: () => toggleCompare(h.id) } }));
  }
  if (hasAdvLine(h)) {
    bar.appendChild(el('button', { type: 'button', class: 'btn', dataset: { act: 'adv-line' }, 'aria-pressed': String(S.ui.advLine), text: S.ui.advLine ? 'Hide CSC/TSC-level line' : 'Show CSC/TSC-level line',
      on: { click: () => { S.ui.advLine = !S.ui.advLine; renderLines(); renderLegend(); renderDetailActions(h); scheduleUrlSave(); } } }));
  }
  bar.appendChild(el('button', { type: 'button', class: 'btn', dataset: { act: 'link' }, text: 'Copy link', on: { click: () => copyLink() } }));
  const again = focused && bar.querySelector(`[data-act="${focused}"]`);
  if (again && !again.disabled) again.focus({ preventScroll: true });
  else if (focused) $('#detail-title').focus({ preventScroll: true });
}

// A separate CSC/TSC-level line exists only when the nearest CSC/TSC-level
// center is another campus than the nearest documented 24/7 EVT center.
function hasAdvLine(h) {
  const a = h && isLocated(h) && S.access[h.id];
  return !!(a && a.advanced.status === 'ok' && (!a.evt247.dest || a.advanced.dest.id !== a.evt247.dest.id));
}

// Distances from or to a campus placed at a town centre are approximate: show
// them as "≈" whole miles and say why (the distance table keeps its own
// precision, see tableMiles).
function isApprox(...hs) { return hs.some(x => x && x.location && x.location.precision === 'city'); }
function milesText(miles, ...hs) { return isApprox(...hs) ? `≈${Math.round(miles)}` : C.formatMiles(miles); }
const APPROX_NOTE = 'Approximate: one end is placed at a town centre (no cited campus coordinates).';

function accessRow(kind, label, res, extraNote) {
  const lineCls = kind === 'evt' ? '' : kind === 'hub' ? 'hub' : 'adv';
  const dest = res && res.dest;
  let mi;
  let note = extraNote || '';
  if (!res) { mi = '—'; }
  else if (res.status === 'on-site') { mi = '0 mi'; note = (note ? note + ' ' : '') + (kind === 'hub' ? 'This is my receiving center.' : 'On site — no interfacility transfer for this destination class.'); }
  else if (res.status === 'ok') {
    const sel = S.byId.get(S.ui.selected);
    mi = milesText(res.miles, sel, dest) + ' mi';
    if (isApprox(sel, dest)) note = (note ? note + ' ' : '') + APPROX_NOTE;
  }
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
  // Transport scenario table for the nearest documented 24/7 EVT destination and my center.
  const dests = [];
  if (a.evt247.status === 'ok') dests.push(['Nearest documented 24/7 EVT', a.evt247.dest, a.evt247.miles]);
  if (hub && a.hub && a.hub.status === 'ok' && (!a.evt247.dest || a.evt247.dest.id !== hub.id)) dests.push(['My center', hub, a.hub.miles]);
  if (dests.length) {
    const p = C.transportParams(S.ui.transport);
    const tbl = el('table', { class: 'data scenario' });
    tbl.appendChild(el('caption', { text: 'Illustrative transfer scenario (minutes, departure → arrival at the receiving hospital)' }));
    tbl.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Leg' }), ...dests.map(d => el('th', { scope: 'col', class: 'num', text: d[0] }))])));
    const tb = el('tbody');
    tb.appendChild(el('tr', null, [el('th', { scope: 'row', text: `DIDO at this hospital (scenario input; includes activation and loading)` }), ...dests.map(() => el('td', { class: 'num', text: String(p.didoMin) }))]));
    for (const [mode, name] of [['ground', 'Ground ambulance (documented road network only)'], ['rotor', 'Rotor-wing (aircraft, weather and landing zone not assessed)'], ['fixed', 'Fixed-wing incl. ground legs (airport and landing access not assessed)']]) {
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
      + `Assumptions: ${assumptionsText(p)}. Not dispatch times; aircraft, weather and acceptance are not modelled; receiving-center treatment intervals are not included. Adjust in Explore → Transport scenario assumptions.` }));
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
      el('span', { class: 's-title' }, s.url && /^https?:\/\//i.test(s.url) && s.access !== 'inaccessible' ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title || s.url }) : (s.title || ev.src)),
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
  state: 'Asks: which Washington, Idaho and Wyoming campuses (the states with a hospital stroke designation program) have an unresolved or pending state level, or a state level that does not match their national tier? State levels and national certifications are different systems.',
};
// The map mode, scope and sort a preset sets, compared as text.
function presetView(ui) { return { mode: ui.mode, scope: ui.scope, include: ui.include.slice().sort().join(','), sort: ui.sort }; }
function applyPreset(key) {
  if (S.ui.preset === key) { clearPreset(); return; }
  // Remember the mode, scope and sort in effect before the first preset, and
  // what this one set, so clearing it can put them back (see clearPreset).
  const before = S.ui.preset && S.presetUndo ? S.presetUndo.before : presetView(S.ui);
  S.ui.preset = key;
  Object.assign(S.ui, { tiers: [], evt: false, evidence: [], basis: null, cah: null, system: null, evtMin: 0 });
  if (key === 'telestroke') { S.ui.scope = 'eligible'; S.ui.include = ['unknown']; S.ui.mode = 'evt-distance'; S.ui.sort = 'evt'; Object.assign(S.ui.review, { wGap: 30, wEvt: 50, wAdv: 20 }); }
  if (key === 'evt') { S.ui.scope = 'all'; S.ui.mode = 'capability'; S.ui.sort = 'tier'; }
  if (key === 'state') { S.ui.scope = 'all'; S.ui.mode = 'capability'; S.ui.sort = 'name'; }
  S.presetUndo = { before, set: presetView(S.ui) };
  syncControls();
  update();
  toast(`Preset: ${presetTitle(key)} — ${S.results.length} records`);
}
// Clearing a preset lifts its filter and puts back each of the mode, scope
// and sort it set to what it was before, unless that one was changed since.
// A preset that came with a link has nothing to put back.
function clearPreset() {
  const u = S.presetUndo;
  S.ui.preset = null;
  S.presetUndo = null;
  if (u) {
    const now = presetView(S.ui);
    const want = u.before;
    if (now.mode === u.set.mode && (want.mode !== 'hub-distance' || S.ui.hub)) S.ui.mode = want.mode;
    if (now.scope === u.set.scope) S.ui.scope = want.scope;
    if (now.include === u.set.include) S.ui.include = want.include ? want.include.split(',') : [];
    if (now.sort === u.set.sort && (want.sort !== 'hub' || S.ui.hub)) S.ui.sort = want.sort;
  }
  syncControls();
  update();
}

const TRANSPORT_FIELDS = [
  ['didoMin', 'DIDO at sending hospital (min)'], ['roadFactor', 'Road / straight-line factor'], ['groundMph', 'Ground speed (mph)'],
  ['groundHandoffMin', 'Ground handover at arrival (min)'],
  ['rotorMph', 'Rotor-wing speed (mph)'], ['rotorHandoffMin', 'Rotor-wing lift-off, pad and handover (min)'], ['rotorMaxMi', 'Rotor-wing range (mi)'],
  ['fixedMph', 'Fixed-wing speed (mph)'], ['fixedGroundLegsMin', 'Fixed-wing ground legs to and from airports (min)'], ['fixedHandoffMin', 'Fixed-wing taxi, loading and handover (min)'],
];
function assumptionsText(p) {
  return `ground = straight-line × ${p.roadFactor} at ${p.groundMph} mph + ${p.groundHandoffMin} min handover; ` +
    `rotor-wing ${p.rotorMph} mph + ${p.rotorHandoffMin} min, within ${p.rotorMaxMi} mi; ` +
    `fixed-wing ${p.fixedMph} mph + ${p.fixedGroundLegsMin} min ground legs + ${p.fixedHandoffMin} min handling (airport and landing access not assessed)`;
}
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
    // Capability evidence, strict: these four add up to the records.
    assessed: c(h => capOf(h) === 'assessed'),
    partlyAssessed: c(h => capOf(h) === 'partial'),
    unassessed: c(h => capOf(h) === 'unassessed'),
    conflicting: c(h => capOf(h) === 'conflicting'),
    advanced: c(h => C.isAdvancedCenter(h)),
    psc: c(h => tierOf(h) === 'PSC'),
    asr: c(h => tierOf(h) === 'ASR'),
    none: c(h => tierKey(h) === 'none'),
    partial: c(h => tierKey(h) === 'partial'),
    evt: c(h => C.hasDocumented247Evt(h)),
  };
}
const STAT_COLS = [['records', 'Records'], ['eligible', 'Analysis set'], ['excluded', 'Excluded'], ['unresolved', 'Unresolved'], ['unlocated', 'Not located'],
  ['assessed', 'Capability assessed'], ['partlyAssessed', 'Capability partly assessed'], ['unassessed', 'Capability not assessed'], ['conflicting', 'Capability evidence conflicting'], ['advanced', 'CSC/TSC-level'], ['psc', 'PSC'], ['asr', 'ASR'], ['none', 'None found'], ['partial', 'Partly assessed, no tier yet'], ['evt', '24/7 EVT documented']];

const STATE_TABLE_NOTE = '“Capability assessed” = every critical capability claim assessed; “partly assessed” = some still unknown. The four capability rows add up to Records. “None found” = national certification and state designation checked; none found in reviewed sources (other capability claims may still be unknown). “Partly assessed, no tier yet” = no tier shown while the national certification or state designation is still unknown. EVT overlaps the tiers.';

function summaryRecords(scope) {
  return scope === 'all' ? S.all.filter(h => !isOOR(h)) : S.results.filter(h => !isOOR(h));
}
function renderSummaryTables() {
  const wrap = $('#state-table');
  if (!wrap) return;
  const scope = S.ui.summaryScope;
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
  wrap.appendChild(el('p', { class: 'hint', text: STATE_TABLE_NOTE + ' CSC/TSC-level includes state levels shown on that tier.' }));

  const dwrap = $('#distance-table');
  clear(dwrap);
  const elig = recs.filter(h => eligOf(h) === 'eligible');
  const bins = C.DISTANCE_BINS.map(b => [b, elig.filter(h => C.distanceBin(S.access[h.id] && S.access[h.id].evt247) === b.key).length]);
  const unknown = elig.filter(h => C.distanceBin(S.access[h.id] && S.access[h.id].evt247) === 'unknown').length;
  const max = Math.max(1, ...bins.map(x => x[1]), unknown);
  const t2 = el('table', { class: 'data' });
  t2.appendChild(el('caption', { text: `Straight-line miles to nearest documented 24/7 EVT center — ${elig.length} records in the analysis set within this scope` }));
  t2.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Distance' }), el('th', { scope: 'col', class: 'num', text: 'Records' }), el('th', { scope: 'col' }, el('span', { class: 'visually-hidden', text: 'Bar (share of records)' }))])));
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
const REVIEW_FIELDS = [['wGap', 'Weight: documented capability-tier gap'], ['wEvt', 'Weight: miles to nearest documented 24/7 EVT'], ['wAdv', 'Weight: miles to nearest CSC/TSC-level'], ['wHub', 'Weight: miles to my center'], ['capMi', 'Distance cap (mi)'], ['desertMi', 'Flag beyond (mi) to documented 24/7 EVT']];
function buildReviewForm() {
  const f = $('#review-form');
  clear(f);
  f.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Candidates from' }), (() => {
    const s = el('select', { id: 'review-scope' }, [el('option', { value: 'results', text: 'Current results' }), el('option', { value: 'all', text: 'Whole analysis set' })]);
    s.value = S.ui.reviewScope;
    s.addEventListener('change', () => { S.ui.reviewScope = s.value; renderReview(); scheduleUrlSave(); });
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
  const pool = S.ui.reviewScope === 'all' ? S.all : S.results;
  return pool.filter(h => !isOOR(h));
}
function renderReview() {
  const res = C.accessReview(reviewInput(), S.access, S.ui.review, { hasHub: !!S.ui.hub });
  const sens = res.error ? {} : C.rankSensitivity(reviewInput(), S.access, S.ui.review, { hasHub: !!S.ui.hub });
  S.lastReview = res;
  const sum = $('#review-summary');
  if (res.error === 'all-weights-zero') {
    sum.textContent = `All weights are zero, so nothing is ranked; raise at least one weight. The verification shortlist (${res.shortlist.length}) does not depend on the weights and is still listed, by miles to the nearest documented 24/7 EVT center.`;
  } else {
    const beyond = res.ranked.concat(res.shortlist).filter(r => C.isNum(r.evtMi) && r.evtMi > res.params.desertMi).length;
    const pool = reviewInput();
    const unresolved = pool.filter(h => eligOf(h) === 'unknown').length;
    const cands = pool.filter(h => C.isReviewCandidate(h) && S.access[h.id]).length;
    sum.textContent = `Candidates from ${S.ui.reviewScope === 'all' ? 'the whole dataset' : 'current results'}: ${cands} campuses in the analysis set without on-site documented 24/7 EVT or a CSC/TSC-level tier. ` +
      `Of these, ${res.ranked.length} ranked (capability assessed) · ${res.shortlist.length} on the verification shortlist (capability not assessed, partly assessed or conflicting) · ${beyond} beyond ${res.params.desertMi} mi straight-line of a documented 24/7 EVT center.` +
      (unresolved ? ` ${unresolved} records in this scope have unresolved eligibility and are not ranked — see Needs verification.` : '');
  }
  renderReviewTable($('#rp-ranked'), res.ranked, sens, true);
  renderReviewTable($('#rp-short'), res.shortlist, {}, false);
  const rt = $('#rt-short');
  rt.textContent = `Verification shortlist (${res.shortlist.length})`;
  $('#rt-ranked').textContent = `Ranked — capability assessed (${res.ranked.length})`;
}
// The transfer modes the scenario model can describe to the nearest
// documented 24/7 EVT center: shown beside the score, never part of it.
function feasibilityText(r) {
  const a = r.access.evt247;
  return C.transferFeasibility(r.h, a.dest, a.miles, S.ui.transport).text;
}
function compLabel(c) {
  return { gap: 'Documented capability-tier gap (national certification or state level)', evt: 'Miles to nearest documented 24/7 EVT', adv: 'Miles to nearest CSC/TSC-level', hub: 'Miles to my center' }[c.key];
}
function renderReviewTable(container, rows, sens, ranked) {
  clear(container);
  if (!rows.length) { container.appendChild(el('p', { class: 'hint', text: ranked ? 'No ranked candidates in this scope.' : 'No candidates whose capability is not assessed, partly assessed or conflicting in this scope.' })); return; }
  const tbl = el('table', { class: 'data' });
  const head = ['#', 'Hospital', 'State', ranked ? 'Tier (basis)' : 'Capability', 'Mi to documented 24/7 EVT', 'Mi to CSC/TSC', S.ui.hub ? 'Mi to my center' : null, 'Score', ranked ? 'Rank range' : null,
    'Transfer scenario to nearest documented 24/7 EVT (not scored)', 'Evidence checked', 'Details'].filter(Boolean);
  tbl.appendChild(el('thead', null, el('tr', null, head.map(t => el('th', { scope: 'col', class: /Mi|Score|#|range/.test(t) ? 'num' : null, text: t })))));
  const tb = el('tbody');
  for (const r of rows) {
    const h = r.h;
    const why = el('tr', { hidden: true }, el('td', { colspan: String(head.length) }, el('ul', { class: 'why' }, r.comps.map(c =>
      el('li', { text: c.value == null ? `${compLabel(c)}: not available (${c.detail || 'unknown'}) — weight not used` : `${compLabel(c)}: component ${c.value.toFixed(2)} × weight ${c.weight} → ${c.points.toFixed(1)} points` })).concat([
      el('li', { text: `Nearest documented 24/7 EVT center: ${r.access.evt247.dest ? r.access.evt247.dest.name : '—'}; nearest CSC/TSC-level center: ${r.access.advanced.dest ? r.access.advanced.dest.name : '—'}.` }),
      el('li', { text: r.score == null ? 'No score: no weighted component has a value for this campus.' : 'Score = weighted mean of the components shown (0–100). Not an assessment of need, operations or feasibility.' }),
    ]))));
    const scoreTxt = r.score == null ? '—' : r.score.toFixed(0);
    const whyBtn = el('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false', text: 'Why?', 'aria-label': r.score == null ? `Why ${h.name} has no score` : `Why ${h.name} scores ${scoreTxt}` });
    whyBtn.addEventListener('click', () => { why.hidden = !why.hidden; whyBtn.setAttribute('aria-expanded', String(!why.hidden)); });
    const range = sens[h.id];
    const tierTxt = ranked ? tierText(h, true) : CAP_LABELS[capOf(h)];
    const cells = [
      el('td', { class: 'num' }, [String(r.rank), r.tied ? el('span', { class: 'rank-tie', text: ' =' }) : null]),
      el('td', null, el('button', { type: 'button', class: 'link-btn', text: h.name, on: { click: () => { $('#dlg-review').close(); selectHospital(h.id, { source: 'review' }); } } })),
      el('td', { text: h.state }),
      el('td', { text: tierTxt }),
      el('td', { class: 'num', text: C.formatMiles(r.evtMi) }),
      el('td', { class: 'num', text: C.formatMiles(r.advMi) }),
      S.ui.hub ? el('td', { class: 'num', text: C.formatMiles(r.access.hub && r.access.hub.miles) }) : null,
      el('td', { class: 'num', text: scoreTxt }),
      ranked ? el('td', { class: 'num', text: range ? (range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`) : '—' }) : null,
      el('td', { text: feasibilityText(r) }),
      el('td', { text: evidenceDateText(h) }),
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
// Distance table (current results)
// ------------------------------------------------------------------
// One row per hospital in the current results: nearest documented 24/7 EVT
// center, nearest CSC/TSC-level center and, once one is chosen, my center.
// 0 mi is a real value (on site). An unknown distance shows "—" with its
// reason and sorts last in either direction; it is never treated as 0.
function accessReason(r) {
  if (r && r.status === 'no-location') return 'Unknown: no verified map location';
  if (r && r.status === 'no-destination') return 'Unknown: no destination in this set';
  return 'Unknown';
}
// Every distance in the table keeps one decimal under 10 mi, approximate or
// not, so a sorted column reads in order and only on site shows a bare 0.
function tableMiles(mi, approx) { return (approx ? '≈' : '') + (mi < 10 ? mi.toFixed(1) : String(Math.round(mi))); }
function matrixMiles(r, h) {
  if (r && r.status === 'on-site') return { text: '0', value: 0 };
  if (r && r.status === 'ok' && C.isNum(r.miles)) { const approx = isApprox(h, r.dest); return { text: tableMiles(r.miles, approx), value: r.miles, approx }; }
  return { value: null, reason: accessReason(r) };
}
function matrixCenter(r) {
  // On site sorts before any center name.
  if (r && r.status === 'on-site') return { text: 'On site (0 mi)', value: '' };
  if (r && r.status === 'ok') return { text: r.dest.name + (isOOR(r.dest) ? ' (neighboring state)' : ''), value: r.dest.name };
  return { value: null, reason: accessReason(r) };
}
const TIER_CLASS_ORDER = { none: 4, partial: 5, conflicting: 6, unassessed: 7 };
// Headings show a short form (`short`, named in the caption beside them) on
// one line, so the sticky header row stays shallow on a phone; the spoken
// name continues it with the full wording (`more`). `label` is the name used
// in the sort announcement.
function matrixColumns(hub) {
  const acc = h => S.access[h.id];
  const cols = [
    { key: 'name', label: 'Hospital', get: h => ({ text: h.name, value: h.name }) },
    { key: 'state', label: 'State', get: h => ({ text: h.state, value: h.state }) },
    { key: 'tier', label: 'Tier shown (basis)', short: 'Tier', more: ' shown (basis)', wrap: true, get: h => ({ text: tierText(h), value: tierOf(h) ? TIER_ORDER[tierOf(h)] : TIER_CLASS_ORDER[tierKey(h)] ?? 8 }) },
    { key: 'evtCenter', label: 'Nearest documented 24/7 EVT center', short: 'EVT center', more: ': nearest documented 24/7 EVT center', wrap: true, get: h => matrixCenter(acc(h).evt247) },
    { key: 'evtMi', label: 'Mi to documented 24/7 EVT', short: 'EVT mi', more: ': straight-line miles to the nearest documented 24/7 EVT center', num: true, get: h => matrixMiles(acc(h).evt247, h) },
    { key: 'advCenter', label: 'Nearest CSC/TSC-level center', short: 'CSC/TSC center', more: ': nearest CSC/TSC-level center', wrap: true, get: h => matrixCenter(acc(h).advanced) },
    { key: 'advMi', label: 'Mi to CSC/TSC-level', short: 'CSC/TSC mi', more: ': straight-line miles to the nearest CSC/TSC-level center', num: true, get: h => matrixMiles(acc(h).advanced, h) },
  ];
  if (hub) {
    cols.push({ key: 'hubMi', label: 'Mi to my center', short: 'My center mi', more: ': straight-line miles to my center', num: true, get: h => matrixMiles(acc(h).hub, h) });
    cols.push({ key: 'diff', label: 'My center minus nearest documented 24/7 EVT (mi)', short: 'My center − EVT mi', more: ': my center minus the nearest documented 24/7 EVT center, in straight-line miles', num: true, get: h => {
      const d = C.hubDifferential(h, acc(h), S.ui.transport);
      if (d.status !== 'ok' || !C.isNum(d.miles)) return { value: null, reason: 'Unavailable: ' + (d.reason || 'distance unknown').replace(/^./, x => x.toLowerCase()) };
      const approx = isApprox(h, acc(h).evt247.dest, hub);
      return { text: (approx ? '≈' : '') + C.formatSignedMiles(d.miles) + (d.sameCenter ? ' (same center)' : ''), value: d.miles, approx };
    } });
  }
  return cols;
}
function matrixSorted(cols) {
  const col = cols.find(c => c.key === S.matrixSort.key) || cols[0];
  const dir = S.matrixSort.dir;
  const rows = S.results.filter(h => !isOOR(h)).map(h => ({ h, v: col.get(h).value }));
  const byName = (x, y) => x.h.name.localeCompare(y.h.name) || x.h.id.localeCompare(y.h.id);
  rows.sort((x, y) => {
    if (x.v == null || y.v == null) return x.v == null && y.v == null ? byName(x, y) : x.v == null ? 1 : -1;
    const c = typeof x.v === 'number' ? x.v - y.v : String(x.v).localeCompare(String(y.v));
    return c * dir || byName(x, y);
  });
  return rows.map(r => r.h);
}
function renderMatrix(focusKey) {
  const wrap = $('#matrix-table');
  clear(wrap);
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const cols = matrixColumns(hub);
  if (!cols.some(c => c.key === S.matrixSort.key)) S.matrixSort = { key: 'name', dir: 1 };
  const recs = matrixSorted(cols);
  // An empty table has nothing to export; a disabled button says so where a toast behind the modal could not.
  $('#matrix-export').disabled = !recs.length;
  const tbl = el('table', { class: 'data matrix' });
  tbl.appendChild(el('caption', { text: `Current results: ${recs.length} hospitals (${resultsScopeText()}). “EVT” = nearest documented 24/7 EVT center; “CSC/TSC” = nearest CSC/TSC-level center; mi = straight-line miles${hub ? '; my center: ' + hub.name : ''}.` }));
  const hr = el('tr');
  for (const c of cols) {
    const active = S.matrixSort.key === c.key;
    const btn = el('button', { type: 'button', class: 'th-sort', dataset: { sort: c.key } }, [el('span', { text: c.short || c.label }),
      c.more ? el('span', { class: 'visually-hidden', text: c.more }) : null,
      el('span', { class: 'sort-ind', 'aria-hidden': 'true', text: active ? (S.matrixSort.dir > 0 ? '▲' : '▼') : '' })]);
    btn.addEventListener('click', () => {
      S.matrixSort = { key: c.key, dir: active ? -S.matrixSort.dir : 1 };
      renderMatrix(c.key);
      $('#matrix-status').textContent = `Sorted by ${c.label}, ${S.matrixSort.dir > 0 ? 'ascending' : 'descending'}; unknown distances last.`;
    });
    hr.appendChild(el('th', { scope: 'col', class: c.num ? 'num' : null, 'aria-sort': active ? (S.matrixSort.dir > 0 ? 'ascending' : 'descending') : null }, btn));
  }
  tbl.appendChild(el('thead', null, hr));
  const tb = el('tbody');
  for (const h of recs) {
    const tr = el('tr');
    for (const c of cols) {
      if (c.key === 'name') {
        tr.appendChild(el('th', { scope: 'row' }, el('button', { type: 'button', class: 'link-btn', text: h.name,
          on: { click: () => { $('#dlg-matrix').close(); selectHospital(h.id, { source: 'matrix' }); } } })));
        continue;
      }
      const v = c.get(h);
      const cls = [c.num ? 'num' : null, c.wrap ? 'wrap' : null].filter(Boolean).join(' ') || null;
      if (v.text == null) { tr.appendChild(el('td', { class: cls, title: v.reason }, [el('span', { 'aria-hidden': 'true', text: '—' }), el('span', { class: 'visually-hidden', text: v.reason })])); continue; }
      tr.appendChild(el('td', { class: cls, title: v.approx ? APPROX_NOTE : null }, [v.text, v.approx ? el('span', { class: 'visually-hidden', text: ' (approximate: town-centre location)' }) : null]));
    }
    tb.appendChild(tr);
  }
  if (!recs.length) tb.appendChild(el('tr', null, el('td', { colspan: String(cols.length), text: 'No hospitals in the current results. Change the search or filters in Find.' })));
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
  syncMatrixScrollPadding();
  if (focusKey) { const b = wrap.querySelector(`.th-sort[data-sort="${focusKey}"]`); if (b) b.focus(); }
}
// A row or heading scrolled to on focus stops below the sticky header row and
// beside the sticky hospital column, never under them (app.css scroll-padding).
function syncMatrixScrollPadding() {
  const wrap = $('#matrix-table');
  const head = $('thead', wrap);
  const first = $('thead th', wrap);
  if (!head || !head.offsetParent) return;
  wrap.style.setProperty('--matrix-head', Math.ceil(head.getBoundingClientRect().height) + 'px');
  wrap.style.setProperty('--matrix-col', Math.ceil(first.getBoundingClientRect().width) + 'px');
}
// Chromium's focus scrolling leaves a control that is already partly in view
// where it is (horizontally, when 32 px or more show), so a heading half under
// the sticky hospital column, or cut off at the right edge, would stay so:
// bring the focused control fully into the area the sticky parts leave clear.
function revealInMatrix(e) {
  const wrap = $('#matrix-table');
  const t = e.target;
  const first = $('thead th', wrap);
  const head = $('thead', wrap);
  if (t === wrap || !first || !t.getBoundingClientRect) return;
  const w = wrap.getBoundingClientRect();
  const r = t.getBoundingClientRect();
  const inColumn = !!t.closest('th[scope="row"]') || first.contains(t);
  const stickyHead = getComputedStyle(head.querySelector('th:last-child')).position === 'sticky';
  const left = inColumn ? w.left + wrap.clientLeft : first.getBoundingClientRect().right;
  const right = w.left + wrap.clientLeft + wrap.clientWidth;
  const top = stickyHead && !head.contains(t) ? head.getBoundingClientRect().bottom : w.top + wrap.clientTop;
  const bottom = w.top + wrap.clientTop + wrap.clientHeight;
  if (r.left < left) wrap.scrollLeft -= left - r.left;
  else if (r.right > right) wrap.scrollLeft += Math.min(r.right - right, r.left - left);
  if (r.top < top) wrap.scrollTop -= top - r.top;
  else if (r.bottom > bottom) wrap.scrollTop += Math.min(r.bottom - bottom, r.top - top);
}
function openMatrix() {
  $('#matrix-status').textContent = '';
  renderMatrix();
  openDialog('dlg-matrix');
  syncMatrixScrollPadding();
}
function exportMatrixCsv() {
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const recs = matrixSorted(matrixColumns(hub));
  if (!recs.length) { toast('Nothing to export in this scope', 'warn'); return; }
  // Unknown is blank, on site is 0; the status columns say which. The same
  // columns whether or not my center is chosen; provenance in trailing
  // columns on every row, as in the main CSV, so the file stays one table.
  const mi = r => (r && C.isNum(r.miles) ? Number(r.miles.toFixed(1)) : '');
  const center = r => (r && r.status === 'on-site' ? 'on site' : r && r.status === 'ok' ? r.dest.name : '');
  const head = ['record_id', 'name', 'state', 'tier_shown', 'tier_basis', 'tier_class',
    'nearest_documented_24x7_evt_center', 'nearest_documented_24x7_evt_status', 'miles_to_nearest_documented_24x7_evt',
    'nearest_csc_tsc_level_center', 'nearest_csc_tsc_level_status', 'miles_to_nearest_csc_tsc_level',
    'my_center', 'my_center_record_id', 'my_center_status', 'miles_to_my_center', 'my_center_minus_nearest_documented_24x7_evt_miles',
    'distances_approximate', 'distance_metric', 'export_scope', 'data_version', 'evidence_review_date', 'exported_on', 'release'];
  const prov = ['straight-line (great-circle) miles', scopeDescription('results'), S.meta.data_version, S.meta.evidence_review_date, todayStr(), S.meta.release];
  const rows = [head];
  for (const h of recs) {
    const a = S.access[h.id];
    const d = hub ? C.hubDifferential(h, a, S.ui.transport) : null;
    rows.push([h.id, h.name, h.state, tierOf(h) || '', h.derived.tierBasis || '', tierKey(h) || '',
      center(a.evt247), a.evt247.status, mi(a.evt247), center(a.advanced), a.advanced.status, mi(a.advanced),
      hub ? hub.name : '', hub ? hub.id : '', hub && a.hub ? a.hub.status : 'none-chosen', hub ? mi(a.hub) : '',
      d && d.status === 'ok' && C.isNum(d.miles) ? Number(d.miles.toFixed(1)) : '',
      isApprox(h, a.evt247.dest, a.advanced.dest, hub) ? 'yes (a town-centre location is involved)' : ''].concat(prov));
  }
  download(C.toCsv(rows), `stroke-distance-table_${stamp()}.csv`, 'text/csv');
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
  // A comparison needs at least two hospitals; one can still be cleared.
  for (const b of ['#compare-open', '#compare-export']) $(b).disabled = n < 2;
  $('#compare-clear').disabled = !n;
  if (n === 1) list.appendChild(el('li', { class: 'hint', text: 'Add at least one more hospital to compare (up to ' + C.MAX_COMPARE + ').' }));
}
function compareFields() {
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const f = [
    ['Location', h => placeLine(h)],
    ['Status', h => valueClaimText(h.status, { active: 'Active', closed: 'Closed', merged: 'Merged' })],
    ['Analysis eligibility', h => eligText(h.derived.eligibility)],
    ['Health system', h => (h.system && h.system.value) || (h.system && h.system.state === 'independent' ? 'Independent' : 'Not documented')],
    ['Critical Access Hospital', h => stOf(h.cah) === 'affirmative' ? 'Yes' : stOf(h.cah) === 'negative' ? 'No' : C.CLAIM_LABELS[stOf(h.cah)]],
    ['National certification', h => `${nationalLabel(h)}${h.national && h.national.checked ? ' (checked ' + h.national.checked + ')' : ''}`],
    ['State designation', h => `${stateLabel(h)}${h.stateDesignation && h.stateDesignation.checked ? ' (checked ' + h.stateDesignation.checked + ')' : ''}`],
    ['Thrombectomy (EVT)', h => evtLabel(h)],
    ['Tier shown (basis)', h => tierText(h)],
    ['Oldest critical evidence (age)', h => evidenceDateText(h)],
    ['Nearest documented 24/7 EVT center in this dataset (straight-line)', h => accessText(S.access[h.id].evt247, h)],
    ['Nearest CSC/TSC-level (straight-line)', h => accessText(S.access[h.id].advanced, h)],
  ];
  if (hub) {
    f.push([`My center: ${hub.name}`, h => accessText(S.access[h.id].hub, h)]);
    f.push(['My center minus nearest documented 24/7 EVT', h => { const d = C.hubDifferential(h, S.access[h.id], S.ui.transport); return d.status === 'ok' ? `${C.formatSignedMiles(d.miles)} mi` + (d.sameCenter ? ' (same center)' : '') : 'Unavailable' + (d.reason ? ': ' + d.reason : ''); }]);
  }
  f.push(['Road network (ground model)', h => (h.roadNetwork && h.roadNetwork.value) || 'unknown']);
  f.push(['Location precision', h => h.location ? `${h.location.precision} (${h.location.method})` : 'Not located']);
  f.push(['Needs verification', h => (h.derived.needsVerification || []).map(c => NV_LABELS[c] || c).join('; ') || '—']);
  f.push(['Record id / CCN', h => `${h.id}${h.ccn && h.ccn.value ? ' / ' + h.ccn.value + (h.ccn.relation === 'shared' ? ' (shared)' : '') : ''}`]);
  return f;
}
// "Label: reason", without repeating the label when the reason already starts with it.
function eligText(e) {
  const label = ELIG_LABELS[e && e.value] || '';
  const reason = (e && e.reason) || '';
  if (!reason) return label;
  return reason.toLowerCase().startsWith(label.toLowerCase()) ? reason : `${label}: ${reason}`;
}
function claimSourceUrls(h) {
  const urls = [];
  for (const k of ['national', 'stateDesignation', 'evt', 'evt247']) {
    for (const ev of (h[k] && h[k].evidence) || []) { const s = sourceOf(ev.src); if (s && s.url && !urls.includes(s.url)) urls.push(s.url); }
  }
  return urls.join(' ');
}
function accessText(r, h) {
  if (!r) return '—';
  if (r.status === 'on-site') return 'On site (0 mi)';
  if (r.status === 'ok') return `${r.dest.name} — ${milesText(r.miles, h, r.dest)} mi${isApprox(h, r.dest) ? ' (approximate: town-centre location)' : ''}`;
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
// What the data actually holds about out-of-region destinations, for every
// surface that mentions them.
function neighborSentence() {
  const nb = S.all.filter(isOOR);
  if (!nb.length) return 'No receiving centers outside the five states are included, so a border hospital may have a closer center than the one named here.';
  return `${nb.length} receiving centers in neighboring states (${[...new Set(nb.map(h => h.state))].join(', ')}) are included as destinations only — squares on the map, never counted in the inventory — so border hospitals are not told the nearest center is farther than it is. They sit at town centres, so distances to them are approximate. Canadian centers are not included.`;
}

function renderDataPanel() {
  const m = S.meta;
  const c = m.counts;
  const dl = $('#data-overview');
  clear(dl);
  const kv = (k, v) => { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); };
  kv('Release', m.release);
  kv('Data version', m.data_version);
  kv('Evidence review', m.evidence_review_date + ' (claims checked in this review carry their own check date; carried-forward claims carry the previous edition’s date)');
  kv('CMS census reference', `${m.census_snapshot.as_of} snapshot`);
  kv('Facility records', `${c.records} (${Object.entries(c.by_state).map(([s, n]) => s + ' ' + n).join(', ')})`);
  kv('Analysis set', `${c.eligible} eligible · ${c.excluded} excluded · ${c.eligibility_unknown} unresolved`);
  kv('Not located', String(c.unlocated));
  kv('Capability evidence', `${c.capability.assessed} assessed · ${c.capability.partial} partly assessed · ${c.capability.unassessed} not assessed · ${c.capability.conflicting} conflicting (of ${c.records} records)`);
  kv('24/7 EVT documented', String(c.evt247_documented));
  kv('Neighboring-state destinations', String(c.neighbors));
  kv('Sources cited', String(Object.keys(m.sources).length));
  if (!S.storageOk) kv('Browser storage', 'Unavailable — preferences will not be remembered');

  const nv = {};
  for (const h of S.all) if (!isOOR(h)) for (const code of h.derived.needsVerification || []) nv[code] = (nv[code] || 0) + 1;
  const vb = $('#verify-breakdown');
  clear(vb);
  const inReg = S.all.filter(h => !isOOR(h));
  const open = inReg.filter(h => openItems(h).length).length;
  const notesOnly = inReg.filter(h => !openItems(h).length && (h.derived.needsVerification || []).length).length;
  vb.appendChild(el('p', { class: 'hint', text: `Whole dataset: ${open} of ${inReg.length} facility records have an open item to resolve (P1/P2). ` +
    `${notesOnly} more carry only precision notes (P3), such as coordinates or an address not yet verified to the campus. A record can appear under several reasons.` }));
  for (const [title, pri] of [['Open items (P1/P2)', p => p !== 'P3'], ['Precision notes (P3)', p => p === 'P3']]) {
    const rows = Object.entries(nv).filter(([code]) => pri(nvPriority(code))).sort((a, b) => nvPriority(a[0]).localeCompare(nvPriority(b[0])) || b[1] - a[1]);
    if (!rows.length) continue;
    vb.appendChild(el('h3', { class: 'sub-head', text: title }));
    const ul = el('ul', { class: 'checks nv-list' });
    for (const [code, n] of rows) {
      ul.appendChild(el('li', null, [el('span', { class: 'num', text: String(n) }), el('span', { text: `${NV_LABELS[code] || code} (${nvPriority(code)})` }),
        el('button', { type: 'button', class: 'link-btn', text: 'Show', 'aria-label': `Show the ${n} records: ${NV_LABELS[code] || code}`, on: { click: () => showNeedsVerification('nv:' + code) } })]));
    }
    vb.appendChild(ul);
  }

  renderCoverage();
  renderChecks();
}
// Show the whole worklist (or one reason on it), not a slice of it: clear every other filter.
function showNeedsVerification(filter) {
  const d = C.defaultUiState();
  Object.assign(S.ui, { q: '', state: 'ALL', system: null, basis: null, cah: null, evtMin: 0, include: d.include,
    evidence: [filter], scope: 'all', preset: null, tiers: [], evt: false });
  S.presetUndo = null;
  populateEvidenceSelect();
  syncControls(); update(); switchView('find', { sheet: true });
  const what = filter === 'needs-verification' ? 'have an open item to resolve' : `need verification: ${(NV_LABELS[filter.slice(3)] || filter).toLowerCase()}`;
  toast(`${S.results.length} records ${what} (whole dataset; other filters cleared)`);
}
// The Evidence filter offers each needs-verification reason present in the data.
function populateEvidenceSelect() {
  const sel = $('#f-evidence');
  if (!sel || !S.all) return;
  for (const g of $$('optgroup', sel)) g.remove();
  const nv = {};
  for (const h of S.all) if (!isOOR(h)) for (const code of h.derived.needsVerification || []) nv[code] = (nv[code] || 0) + 1;
  const grp = el('optgroup', { label: 'Needs verification — one reason' });
  for (const [code] of Object.entries(nv).sort((a, b) => nvPriority(a[0]).localeCompare(nvPriority(b[0])) || b[1] - a[1])) {
    // The live count is appended by renderCounts; the priority stays in the label.
    grp.appendChild(el('option', { value: 'nv:' + code, text: `${NV_LABELS[code] || code} · ${nvPriority(code)}` }));
  }
  sel.appendChild(grp);
}
function renderCoverage() {
  const wrap = $('#coverage');
  clear(wrap);
  const claims = [['national', 'National cert.'], ['stateDesignation', 'State designation'], ['evt', 'EVT'], ['evt247', '24/7 EVT'], ['ed', 'Emergency dept.'],
    ['cah', 'CAH'], ['status', 'Status'], ['address', 'Address'], ['system', 'System']];
  const recs = S.all.filter(h => !isOOR(h));
  const unassessed = (c) => !c || (!c.method && (c.state === 'unknown' || c.value === 'unknown' || (c.state == null && c.value == null) || c.status === 'unknown'));
  // Columns are the methods actually present, so every row adds up to the record count.
  const order = ['search-extract', 'nppes-api', 'cms-dataset', 'regulatory-inference', 'rule-based', 'manual-review', 'derived', 'prior-edition'];
  const present = new Set();
  for (const h of recs) for (const [k] of claims) { const c = h[k]; if (!unassessed(c)) present.add(c.method || 'unrecorded'); }
  const methods = order.filter(mm => present.has(mm)).concat([...present].filter(mm => !order.includes(mm)));
  const tbl = el('table', { class: 'data' });
  tbl.appendChild(el('caption', { text: `How each claim was last established — whole dataset, ${recs.length} WWAMI records. Each row adds up to ${recs.length}; "of which conflicting" is a subset.` }));
  tbl.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Claim' }),
    ...methods.map(mm => el('th', { scope: 'col', class: 'num', text: methodShort(mm) })),
    el('th', { scope: 'col', class: 'num', text: 'not assessed' }), el('th', { scope: 'col', class: 'num', text: 'total' }),
    el('th', { scope: 'col', class: 'num', text: 'of which conflicting' })])));
  const tb = el('tbody');
  for (const [k, label] of claims) {
    const cells = methods.map(mm => recs.filter(h => !unassessed(h[k]) && (h[k].method || 'unrecorded') === mm).length);
    const none = recs.filter(h => unassessed(h[k])).length;
    const conf = recs.filter(h => h[k] && (h[k].state === 'conflicting' || (k === 'address' && h[k].status === 'conflicting'))).length;
    tb.appendChild(el('tr', null, [el('th', { scope: 'row', text: label }), ...cells.map(n => el('td', { class: 'num', text: String(n) })),
      el('td', { class: 'num', text: String(none) }), el('td', { class: 'num', text: String(cells.reduce((a, b) => a + b, 0) + none) }),
      el('td', { class: 'num', text: String(conf) })]));
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
    // Carried-forward claims keep their edition's date (editionAsOf) instead
    // of a claim-level check date; they are counted under Needs verification.
    ['Every documented claim cites a source and a date (a check date, or the edition date for carried-forward claims)', recs.every(h => claimNames.every(k => !h[k] || !['affirmative', 'negative', 'conflicting', 'no-record-found'].includes(h[k].state) || ((h[k].evidence || []).length && (h[k].checked || (h[k].method === 'prior-edition' && h[k].editionAsOf)))))],
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
      '“Nearest” always names its destination set: documented 24/7 EVT centers, or CSC/TSC-level centers (national certification, or a state level shown on that tier). Destinations must be active, located campuses that are not excluded (closed, pediatric-only, or documented without a general ED), or listed neighboring-state centers.',
      'The nearest geometric destination is not necessarily the clinically appropriate or accepting destination.',
      neighborSentence(),
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
      'Score = weighted mean (0–100) of normalised components: documented capability-tier gap — national certification or state level, whichever sets the display tier (none found 1.0 · ASR 0.65 · PSC 0.35), straight-line miles to the nearest documented 24/7 EVT center, to the nearest CSC/TSC-level center, and optionally to my center, each capped and divided by the cap.',
      'Only campuses in the analysis set without on-site documented 24/7 EVT or a CSC/TSC-level tier are candidates. Campuses whose capability is not assessed, partly assessed or conflicting are never given a gap value; they appear on a separate verification shortlist, ordered by geography alone, whose membership does not depend on the weights.',
      'Ties (same score to 0.1) share a rank and are ordered by distance to EVT, then name. All-zero weights produce no ranking. Rank range shows sensitivity to each weight. Nothing about volumes, population, staffing, existing coverage or business opportunity is modelled.',
    ]),
    h2('Geography'), p(m.geography.note + ' Boundaries: ' + m.geography.boundaries + '.'),
    h2('CMS reference data'), p(`${m.census_snapshot.source}. ${m.census_snapshot.note}`),
    h2('Limits'),
    ul([
      'Primary registries (Joint Commission Quality Check, DNV certificate checker, WA DOH, Idaho TSE, data.cms.gov) could not be opened directly from the authoring environment in the October 2026 pass. Claims checked then were observed through web-search extracts of the cited pages or the NPPES API, and say so.',
      'Values carried forward from the previous edition keep that edition’s date (editionAsOf), not a claim-level check date; they are not re-verified by being carried forward.',
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
  appendAll(body, [tbl, el('p', { class: 'hint', text: 'Single-key shortcuts work only when focus is not in a text field, and can be turned off in Data & methods → Display. While they are on, “/” moves to the hospital search instead of the browser’s quick find; shortcuts with Ctrl, ⌘ or Alt, such as Ctrl/⌘+F, are left to the browser.' })]);
}

// ------------------------------------------------------------------
// Exports
// ------------------------------------------------------------------
function stamp() { return S.meta ? S.meta.data_version : ''; }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function download(content, filename, mime) {
  try {
    // A byte-order mark tells spreadsheet programs the CSV is UTF-8 (names
    // such as "Utqiaġvik" and en dashes otherwise open garbled).
    const body = mime === 'text/csv' && typeof content === 'string' && content.charCodeAt(0) !== 0xFEFF ? '\uFEFF' + content : content;
    const blob = content instanceof Blob ? content : new Blob([body], { type: mime + ';charset=utf-8' });
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
// The current results in words: their scope, the search text and the filters.
function resultsScopeText() {
  const parts = activeFilterParts();
  const q = C.tokenize(S.ui.q).length ? S.ui.q.replace(/\s+/g, ' ').trim() : '';
  return scopeLabel() + (q ? `; search: "${q}"` : '') + (parts.length ? '; filters: ' + parts.join(', ') : '');
}
function scopeDescription(scope) {
  return { compare: 'comparison set', selected: 'selected hospital', all: 'all facility records', results: 'current results (' + resultsScopeText() + ')' }[scope];
}
function claimSources(c) { return ((c && c.evidence) || []).map(e => { const s = sourceOf(e.src); return s && s.url ? s.url : e.src; }).filter((v, i, a) => a.indexOf(v) === i).join(' | '); }
const CSV_HEADER = ['record_id', 'name', 'state', 'city', 'county_derived', 'status', 'analysis_eligibility', 'eligibility_reason',
  'ccn', 'ccn_relation', 'health_system', 'governance', 'cah_state', 'ed_24x7_state',
  'national_state', 'national_body', 'national_program', 'national_tier', 'national_effective', 'national_expires', 'national_checked', 'national_method', 'national_sources',
  'state_designation_state', 'state_system', 'state_level', 'state_status', 'state_checked', 'state_method', 'state_sources',
  'evt_state', 'evt_checked', 'evt_method', 'evt_sources', 'evt_24x7_state', 'evt_24x7_basis', 'evt_24x7_checked', 'evt_24x7_method', 'evt_24x7_sources',
  'tier_shown', 'tier_basis', 'tier_class', 'capability_evidence', 'capability_oldest_critical_checked', 'capability_undated',
  'latitude', 'longitude', 'location_method', 'location_precision', 'road_network',
  'nearest_documented_24x7_evt_center', 'miles_to_nearest_documented_24x7_evt', 'nearest_csc_tsc_level_center', 'miles_to_nearest_csc_tsc_level',
  'my_center', 'miles_to_my_center', 'my_center_minus_nearest_documented_24x7_evt_miles', 'distances_approximate',
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
    stOf(h.evt), (h.evt && h.evt.checked) || '', (h.evt && h.evt.method) || '', claimSources(h.evt),
    stOf(h.evt247), (h.evt247 && h.evt247.basis) || '', (h.evt247 && h.evt247.checked) || '', (h.evt247 && h.evt247.method) || '', claimSources(h.evt247),
    tierOf(h) || '', h.derived.tierBasis || '', tierKey(h) || '', capOf(h), lastCheckedOf(h) || '', h.derived.capabilityUndated ? 'yes' : '',
    h.location ? h.location.lat : '', h.location ? h.location.lng : '', h.location ? h.location.method : '', h.location ? h.location.precision : '', (h.roadNetwork && h.roadNetwork.value) || 'unknown',
    a.evt247.dest ? a.evt247.dest.name : '', miles(a.evt247), a.advanced.dest ? a.advanced.dest.name : '', miles(a.advanced),
    hub ? hub.name : '', hub ? miles(a.hub) : '', diff && diff.status === 'ok' ? Number(diff.miles.toFixed(1)) : '',
    isApprox(h, a.evt247.dest, a.advanced.dest, hub) ? 'yes (a town-centre location is involved)' : '',
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
    my_center: S.ui.hub || null, include_neighbor_centers: S.ui.neighbors && S.all.some(isOOR), neighbor_centers_in_data: S.all.filter(isOOR).length, transport_assumptions: C.transportParams(S.ui.transport),
    records: recs.map(h => {
      const r = Object.assign({}, h);
      delete r.fields;
      const a = S.access[h.id];
      r.access = { nearest_documented_24x7_evt: a.evt247.dest ? { id: a.evt247.dest.id, name: a.evt247.dest.name, miles: a.evt247.miles, status: a.evt247.status } : { status: a.evt247.status },
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
  lines.push(`Generated ${todayStr()} · release ${m.release} · data ${m.data_version} · evidence review ${m.evidence_review_date} (claims checked in this review carry their own check date; carried-forward claims carry the previous edition’s date).`, '');
  lines.push('Public-source planning reference. Not for clinical decisions, dispatch or patient routing; not an official product of any health department or accreditor.', '');
  lines.push('## Scope', '');
  lines.push(`- Records in scope: **${recs.length}** — ${resultsScopeText()}.`);
  lines.push(`- My receiving center: ${hub ? hub.name + ' (' + placeLine(hub) + ')' : 'none chosen'}.`);
  const nbIn = S.ui.neighbors ? S.sets.evt247.filter(isOOR).length + '/' + S.sets.advanced.filter(isOOR).length : null;
  const nbText = !S.all.some(isOOR) ? ' (no out-of-region centers in the data)' : S.ui.neighbors ? ` (incl. ${nbIn.split('/')[0]} and ${nbIn.split('/')[1]} in neighboring states)` : ' (neighboring-state centers excluded)';
  lines.push(`- Destination sets: ${S.sets.evt247.length} documented 24/7 EVT centers; ${S.sets.advanced.length} CSC/TSC-level centers${nbText}. Distances are straight-line miles.`, '');
  lines.push('## By state (records in scope)', '');
  lines.push('| Measure | WA | AK | ID | MT | WY | All |', '|---|---:|---:|---:|---:|---:|---:|');
  const per = stateTableRows(recs).map(([, hs]) => stateStats(hs));
  const tot = stateStats(recs);
  for (const [k, label] of STAT_COLS) lines.push(`| ${label} | ${per.map(p => p[k]).join(' | ')} | ${tot[k]} |`);
  lines.push('', STATE_TABLE_NOTE, '');
  const res = C.accessReview(recs, S.access, S.ui.review, { hasHub: !!hub });
  lines.push('## Access review — public-data shortlist', '');
  if (res.error) {
    lines.push('All weights are zero; no ranking computed.', '');
    lines.push(`Verification shortlist (capability not assessed, partly assessed or conflicting; does not depend on the weights): ${res.shortlist.slice(0, 8).map(r => esc(r.h.name) + ' (' + r.h.state + ', ' + C.formatMiles(r.evtMi) + ' mi)').join('; ') || 'none'}.`, '');
  } else {
    const w = res.params;
    const cands = recs.filter(h => C.isReviewCandidate(h, S.access[h.id])).length;
    const unresolved = recs.filter(h => eligOf(h) === 'unknown').length;
    lines.push(`Candidates: ${cands} campuses in the analysis set without on-site documented 24/7 EVT or a CSC/TSC-level tier → ${res.ranked.length} ranked, ${res.shortlist.length} on the verification shortlist.` +
      (unresolved ? ` ${unresolved} records in scope have unresolved eligibility and are not ranked (see "Unknowns" below).` : ''), '');
    lines.push(`Weights: capability-tier gap ${w.wGap} (national certification or state level), miles to documented 24/7 EVT ${w.wEvt}, miles to CSC/TSC-level ${w.wAdv}${hub ? ', miles to my center ' + w.wHub : ''}; cap ${w.capMi} mi. Questions to investigate — not onboarding eligibility, feasibility or an outreach list.`, '');
    lines.push('| Rank | Hospital | State | Tier (basis) | Mi to documented 24/7 EVT | Score | Transfer scenario to nearest documented 24/7 EVT (not scored) | Evidence checked |', '|---:|---|---|---|---:|---:|---|---|');
    for (const r of res.ranked.slice(0, 10)) lines.push(`| ${r.rank}${r.tied ? '=' : ''} | ${esc(r.h.name)} | ${r.h.state} | ${tierText(r.h, true)} | ${C.formatMiles(r.evtMi)} | ${r.score.toFixed(0)} | ${feasibilityText(r)} | ${evidenceDateText(r.h)} |`);
    lines.push('', `Verification shortlist (capability not assessed, partly assessed or conflicting; ranked by geography only): ${res.shortlist.slice(0, 8).map(r => esc(r.h.name) + ' (' + r.h.state + ', ' + C.formatMiles(r.evtMi) + ' mi)').join('; ') || 'none'}.`, '');
  }
  const p = C.transportParams(S.ui.transport);
  lines.push('## Assumptions', '');
  lines.push(`- Transport scenarios (illustrative): DIDO ${p.didoMin} min; ${assumptionsText(p)}. Endpoint: arrival at the receiving hospital. Not dispatch times; no treatment-time targets are applied.`);
  lines.push('- Lines are straight-line geometry, not routes or referral relationships. Health-system affiliation does not imply telestroke or transfer agreements.', '');
  lines.push('## Unknowns and source coverage', '');
  const nv = {};
  for (const h of recs) for (const code of h.derived.needsVerification || []) nv[code] = (nv[code] || 0) + 1;
  for (const [code, n] of Object.entries(nv).sort((a, b) => b[1] - a[1])) lines.push(`- ${NV_LABELS[code] || code}: ${n}`);
  const methods = {};
  for (const h of recs) { const mm = (h.national && h.national.method) || 'not assessed'; methods[mm] = (methods[mm] || 0) + 1; }
  lines.push(`- National-certification claims by method: ${Object.entries(methods).map(([k, v]) => methodShort(k) + ' ' + v).join(', ')}.`);
  saveUrlNow();
  lines.push('', `Reproduce this view: ${location.href}`, `Dataset: hospitals.json ${m.data_version}.`);
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
  const hub = S.ui.hub && S.byId.get(S.ui.hub);
  const p = C.transportParams(S.ui.transport);
  const rows = [['field'].concat(hs.map(h => h.name))].concat(fields.map(([label, fn]) => [label].concat(hs.map(fn))));
  if (hub) rows.push(['my_center_minus_nearest_documented_24x7_evt_mi'].concat(hs.map(h => { const d = C.hubDifferential(h, S.access[h.id], S.ui.transport); return d.status === 'ok' && C.isNum(d.miles) ? Math.round(d.miles * 10) / 10 : ''; })));
  rows.push(['capability_sources'].concat(hs.map(claimSourceUrls)));
  const meta = (k, v) => rows.push([k].concat(hs.map(() => v)));
  meta('my_center', hub ? `${hub.name} (${hub.id})` : 'none chosen');
  meta('distance_metric', 'straight-line miles');
  meta('transport_assumptions', `DIDO ${p.didoMin} min; ${assumptionsText(p)} (illustrative)`);
  meta('data_version', S.meta.data_version);
  meta('evidence_review_date', S.meta.evidence_review_date);
  meta('exported_on', todayStr());
  meta('release', S.meta.release);
  download(C.toCsv(rows), `stroke-comparison_${stamp()}.csv`, 'text/csv');
}

// PNG: composed in a canvas from the visible tiles, the drawn lines and the
// markers (redrawn from the same glyph model), plus title, legend, scope and
// attribution. No external library is needed.
async function exportPng() {
  if (!S.map) { toast('Map unavailable — nothing to draw', 'warn'); return; }
  const size = S.map.getSize();
  const legendW = 280;
  const headH = 76;
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
      if (bm === 'muted' || bm === 'terrain') ctx.filter = effectiveTheme() === 'dark' ? 'invert(1) hue-rotate(180deg) saturate(.25) brightness(.85) contrast(.9)' : 'saturate(.25) contrast(.9) brightness(1.06)';
      else if (effectiveTheme() === 'dark') ctx.filter = 'invert(1) hue-rotate(180deg) saturate(.25) brightness(.85) contrast(.9)';
      for (const img of S.map.getContainer().querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded')) {
        const r = img.getBoundingClientRect();
        if (r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom) continue;
        const relief = !!img.closest('.relief-layer');
        ctx.globalAlpha = relief ? 0.4 : 1;
        ctx.globalCompositeOperation = relief ? 'multiply' : 'source-over';
        ctx.drawImage(img, r.left - rect.left, r.top - rect.top + headH, r.width, r.height);
        tiles++;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
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
      const label = lineLabel(l);
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
    const selH = S.ui.selected && S.byId.get(S.ui.selected);
    const hubH = S.ui.hub && S.byId.get(S.ui.hub);
    const who = [selH ? 'Selected: ' + selH.name : null, hubH ? 'My receiving center: ' + hubH.name : null].filter(Boolean).join(' · ');
    if (who) ctx.fillText(who.slice(0, 170), 14, 64);
    // Legend panel
    drawLegendPanel(ctx, size.x + 12, headH + 6, legendW - 24);
    // Footer
    ctx.fillStyle = cssVar('--text-2'); ctx.font = '11.5px system-ui, sans-serif';
    ctx.fillText(`Release ${S.meta.release} · data ${S.meta.data_version} · evidence review ${S.meta.evidence_review_date} · exported ${todayStr()} · ${location.origin}${location.pathname}`, 14, headH + size.y + 22);
    const relief = withTiles && tiles && currentBasemap() === 'terrain' ? 'Relief: USGS The National Map (3DEP). ' : '';
    ctx.fillText(`${withTiles && tiles ? 'Basemap © OpenStreetMap contributors. ' + relief : 'Basemap omitted. '}Straight-line distances; lines are not routes or referral relationships. Planning reference — not for clinical decisions.`, 14, headH + size.y + 40);
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
  if (m.dim) ctx.globalAlpha = 0.6;
  if (m.selected) { drawShape(ctx, 'circle', x, y, r + 6); ctx.strokeStyle = cssVar('--marker-halo'); ctx.lineWidth = 6; ctx.stroke(); }
  if (m.hub) { drawShape(ctx, 'circle', x, y, r + 5.5); ctx.strokeStyle = cssVar('--c-hub'); ctx.lineWidth = 2.5; ctx.stroke(); }
  if (m.evtRing) { drawShape(ctx, m.shape === 'diamond' ? 'circle' : m.shape, x, y, r + (m.hub ? 1.4 : 2.6)); ctx.strokeStyle = cssVar('--c-evt'); ctx.lineWidth = 3; ctx.stroke(); }
  drawShape(ctx, m.shape, x, y, r);
  ctx.fillStyle = m.hollow ? cssVar('--surface') : cssVar(m.fill);
  ctx.fill();
  ctx.setLineDash(m.dashed ? [2.6, 2] : []);
  ctx.strokeStyle = cssVar(m.stroke); ctx.lineWidth = m.hollow ? 2 : 1.6; ctx.stroke();
  ctx.setLineDash([]);
  if (m.dashOverlay) { drawShape(ctx, 'circle', x, y, r + 2.4); ctx.setLineDash([2.6, 2]); ctx.strokeStyle = cssVar('--c-unassessed-stroke'); ctx.lineWidth = 1.8; ctx.stroke(); ctx.setLineDash([]); }
  if (m.partialRing) {
    drawShape(ctx, 'circle', x, y, partialRingRadius(m)); ctx.setLineDash(PARTIAL_DOT.dash); ctx.lineCap = 'round';
    ctx.strokeStyle = cssVar('--c-partial'); ctx.lineWidth = PARTIAL_DOT.width; ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'butt';
  }
  ctx.restore();
}
function drawLegendPanel(ctx, x, y, w) {
  const base = LEGEND_GLYPH;
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
  // Selecting the text moves focus into the temporary textarea; give it back
  // afterwards, or focus drops to <body> when the textarea goes.
  const back = document.activeElement;
  let ta = null;
  try {
    ta = el('textarea', { value: text, readOnly: true });
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    return !!(document.execCommand && document.execCommand('copy'));
  } catch { return false; } finally {
    if (ta) ta.remove();
    if (back && back !== document.body && document.contains(back)) back.focus({ preventScroll: true });
  }
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
  // My center must be a campus that can be a destination (active, located, not
  // excluded). A link or saved choice naming anything else is set aside.
  const canHub = (id) => { const h = id && S.byId.get(id); return !!(h && !isOOR(h) && C.canBeDestination(h)); };
  if (S.ui.hub && !canHub(S.ui.hub)) { parsed.ignored.push('hub'); S.ui.hub = null; S.explicit.hub = false; }
  if (S.prefs.hub && !canHub(S.prefs.hub)) S.prefs.hub = null;
  if (!S.ui.hub && S.prefs.hub) S.ui.hub = S.prefs.hub;
  if (S.ui.mode === 'hub-distance' && !S.ui.hub) { S.ui.mode = 'capability'; parsed.ignored.push('mode'); }
  // Sorting by miles to my center needs a center (the sort option is disabled without one).
  if (S.ui.sort === 'hub' && !S.ui.hub) { S.ui.sort = 'relevance'; parsed.ignored.push('sort'); }
  if (parsed.legacy && parsed.legacy.includes('weights')) toast('This link is from an earlier version: access-review weights it left out were restored from that version’s defaults (40 to EVT, 20 to CSC/TSC-level).', 'warn', 6000);
  return parsed;
}
// Run once distances are known: adv=1 asks for the CSC/TSC-level line, and a
// selection without a separate CSC/TSC-level destination has none to draw, so
// the setting is dropped (and leaves the saved link) and reported.
function settleUrl(parsed) {
  if (S.ui.advLine && !hasAdvLine(S.byId.get(S.ui.selected))) { S.ui.advLine = false; parsed.ignored.push('adv'); }
  if (parsed.ignored.length) toast(`Some link settings were not recognised and were ignored (${parsed.ignored.slice(0, 4).join(', ')}${parsed.ignored.length > 4 ? '…' : ''})`, 'warn', 5000);
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
      // The link goes with the preset: focus moves to the preset's own button.
      el('button', { type: 'button', class: 'link-btn', text: 'Clear preset', on: { click: () => { const k = S.ui.preset; clearPreset(); focusFirst(`.preset[data-preset="${k}"]`); } } }),
      ui.preset === 'telestroke' ? el('button', { type: 'button', class: 'link-btn', text: 'Open access review', on: { click: openReview } }) : null]);
  }
  $('#summary-scope').value = ui.summaryScope;
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
  // Counts are located WWAMI records in each area (whole dataset, not the current results).
  const n = (key) => jumpRecords(key).length;
  const og1 = el('optgroup', { label: 'Regions (located records)' });
  sel.appendChild(og1);
  const region = (value, label) => og1.appendChild(el('option', { value, text: `${label} (${n(value)})` }));
  region('all', 'All five states');
  region('contig', 'Washington · Idaho · Montana · Wyoming');
  region('AK', 'Alaska');
  const og2 = el('optgroup', { label: 'States (located records)' });
  sel.appendChild(og2);
  for (const st of ['WA', 'ID', 'MT', 'WY']) og2.appendChild(el('option', { value: st, text: `${STATE_NAMES[st]} (${n(st)})` }));
  const og3 = el('optgroup', { label: 'Metro areas (located records)' });
  sel.appendChild(og3);
  for (const m of METRO) og3.appendChild(el('option', { value: m.key, text: `${m.label} (${n(m.key)})` }));
  void add;
}
function jumpRecords(key) {
  const inRegion = S.all.filter(h => !isOOR(h) && isLocated(h));
  if (key === 'all') return inRegion;
  if (key === 'contig') return inRegion.filter(h => h.state !== 'AK');
  if (['WA', 'AK', 'ID', 'MT', 'WY'].includes(key)) return inRegion.filter(h => h.state === key);
  const m = METRO.find(x => x.key === key);
  if (m) return inRegion.filter(h => C.haversineMi(m.lat, m.lng, h.location.lat, h.location.lng) <= m.mi);
  return [];
}
function jumpBounds(key) {
  const recs = jumpRecords(key);
  return recs.length ? dataBounds(recs) : null;
}
function jumpTo(key) {
  if (!S.map) return;
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
  // A view under the detail panel would open out of sight: put the details away first.
  if (detailCoversTools()) minimizeDetail(false);
  if (view === 'data') renderDataPanel();
  if (MOBILE_Q.matches && (!opts || opts.sheet !== false)) setSheet(view !== 'find' || (opts && opts.sheet === true));
  // A switch can hide or make inert what had focus (the phone detail sheet put
  // away by a shortcut, the map under a sheet): focus the active tab instead.
  const ae = document.activeElement;
  if (S.booted && (!ae || ae === document.body || !ae.getClientRects().length || ae.closest('[inert]'))) $('#tab-' + view).focus({ preventScroll: true });
  scheduleUrlSave();
  if (opts && opts.focus) requestAnimationFrame(() => { const n = $(opts.focus); if (n) n.focus(); });
}
function setSheet(open) {
  document.body.classList.toggle('sheet-open', !!open);
  const t = $('#sheet-toggle');
  t.setAttribute('aria-expanded', String(!!open));
  renderStatus();
  syncInert();
  measureSheetTop();
  syncMapSize();
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
  const applyQuery = () => { clearTimeout(timer); timer = null; S.ui.q = search.value.slice(0, 120); if (S.ui.sort !== 'relevance' && S.ui.q) S.ui.sort = 'relevance'; $('#sort').value = S.ui.sort; update(); };
  search.addEventListener('input', () => {
    $('#search-clear').hidden = !search.value;
    clearTimeout(timer);
    timer = setTimeout(applyQuery, 120);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer);
      timer = null;
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
      // Typing inside the debounce window leaves the list showing the previous
      // query, and the pending render would then remove the row given focus.
      // Apply the query and render the list now, then focus at once: a
      // deferred focus would drop a quick second ArrowDown.
      if (timer || search.value.slice(0, 120) !== S.ui.q) applyQuery();
      if (renderQueued) renderResults();
      const f = $('#results .result[tabindex="0"]') || $('#results .result');
      if (f) f.focus();
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
  $('#reset-filters').addEventListener('click', () => resetFilters(['#filters > summary', '#search']));

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
  $('#open-matrix').addEventListener('click', openMatrix);
  $('#matrix-table').addEventListener('focusin', revealInMatrix);
  $('#matrix-export').addEventListener('click', exportMatrixCsv);
  $('#transport-reset').addEventListener('click', () => { S.ui.transport = Object.assign({}, C.TRANSPORT_DEFAULTS); syncControls(); update(); toast('Transport assumptions reset'); });
  $('#summary-scope').addEventListener('change', e => { S.ui.summaryScope = e.target.value; renderSummaryTables(); scheduleUrlSave(); });

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
  $('#show-needs-verification').addEventListener('click', () => showNeedsVerification('needs-verification'));
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
  // Arrow keys on a closed select fire "change" in some browsers, so keyboard
  // movement only chooses; Enter or leaving the control applies it. A pointer
  // choice applies at once. The chosen place stays shown until the map is dragged.
  const jump = $('#jump');
  let jumpKeys = false; let jumped = '';
  const applyJump = () => { const v = jump.value; jumpKeys = false; if (v && v !== jumped) { jumped = v; jumpTo(v); } };
  jump.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) jumpKeys = true;
    else if (e.key === 'Enter') { e.preventDefault(); applyJump(); }
  });
  jump.addEventListener('change', () => { if (!jumpKeys) applyJump(); });
  jump.addEventListener('blur', () => { if (jumpKeys) applyJump(); });
  if (S.map) S.map.on('dragstart', () => { jump.value = ''; jumped = ''; });
  $('#legend-toggle').addEventListener('click', () => { S.prefs.legend = !legendExpanded(); S.legendAuto = null; S.prefs.legendChosen = true; savePrefs(); renderLegend(); });

  // Detail
  $('#detail-close').addEventListener('click', () => closeDetail(true));
  $('#detail').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDetail(true); } });

  bindDialogs();
  document.addEventListener('keydown', onGlobalKey);
  document.addEventListener('focusin', () => { if ($('#toasts').childElementCount) placeToasts(); });
  if (MOBILE_Q.addEventListener) MOBILE_Q.addEventListener('change', onLayoutChange);
  if (NARROW_Q.addEventListener) NARROW_Q.addEventListener('change', onLayoutChange);
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
// Keep Tab and reading order in step with the layout: on phones the view tabs
// sit at the bottom of the screen, so they come after the search and the map.
function placeViewTabs() {
  const nav = $('.view-tabs');
  if (!nav) return;
  if (MOBILE_Q.matches) { if (nav.previousElementSibling !== $('#main')) $('#main').after(nav); }
  else if (nav.nextElementSibling !== $('#panel-find')) $('#sidebar').insertBefore(nav, $('#panel-find'));
}
function onLayoutChange() {
  placeViewTabs();
  if (!MOBILE_Q.matches) document.body.classList.remove('sheet-open', 'detail-minimized');
  syncInert();
  measureSheetTop();
  if (S.map) setTimeout(() => S.map.invalidateSize(), 50);
}

function exportReviewCsv() {
  const res = S.lastReview || C.accessReview(reviewInput(), S.access, S.ui.review, { hasHub: !!S.ui.hub });
  // With every weight at zero nothing is ranked, but the shortlist still exports.
  const w = res.params;
  const head = ['list', 'rank', 'tied', 'record_id', 'name', 'state', 'tier_shown', 'tier_basis', 'capability_evidence', 'capability_oldest_critical_checked',
    'miles_to_nearest_documented_24x7_evt', 'nearest_documented_24x7_evt_center', 'miles_to_nearest_csc_tsc_level', 'miles_to_my_center',
    'points_gap', 'points_evt', 'points_adv', 'points_hub', 'score', 'transfer_scenario_to_nearest_documented_24x7_evt_not_scored', 'transport_assumptions',
    'w_gap', 'w_evt', 'w_adv', 'w_hub', 'cap_mi', 'candidate_scope', 'data_version'];
  const assumptions = assumptionsText(C.transportParams(S.ui.transport));
  const pts = (r, k) => { const c = r.comps.find(x => x.key === k); return c && c.points != null ? Number(c.points.toFixed(2)) : ''; };
  const rows = [head];
  for (const [list, arr] of [['ranked', res.ranked], ['verification-shortlist', res.shortlist]]) {
    for (const r of arr) rows.push([list, r.rank, r.tied ? 'yes' : '', r.h.id, r.h.name, r.h.state, tierOf(r.h) || '', r.h.derived.tierBasis || '', capOf(r.h), lastCheckedOf(r.h) || '',
      C.isNum(r.evtMi) ? Number(r.evtMi.toFixed(1)) : '', r.access.evt247.dest ? r.access.evt247.dest.name : '', C.isNum(r.advMi) ? Number(r.advMi.toFixed(1)) : '',
      r.access.hub && C.isNum(r.access.hub.miles) ? Number(r.access.hub.miles.toFixed(1)) : '',
      pts(r, 'gap'), pts(r, 'evt'), pts(r, 'adv'), pts(r, 'hub'), r.score == null ? '' : Number(r.score.toFixed(2)), feasibilityText(r), assumptions,
      w.wGap, w.wEvt, w.wAdv, S.ui.hub ? w.wHub : '', w.capMi,
      S.ui.reviewScope === 'all' ? 'whole analysis set' : 'current results', stamp()]);
  }
  download(C.toCsv(rows), `stroke-access-review_w${w.wGap}-${w.wEvt}-${w.wAdv}-${w.wHub}_cap${w.capMi}_${stamp()}.csv`, 'text/csv');
}

function onGlobalKey(e) {
  if (e.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return; // native dialog handles it
    if (S.map && S.map._popup && S.map.hasLayer(S.map._popup)) { S.map.closePopup(); $('#map').focus(); return; }
    if (!$('#detail').hidden) { e.preventDefault(); closeDetail(true); return; }
    if (MOBILE_Q.matches && document.body.classList.contains('sheet-open')) { setSheet(false); $('#sheet-toggle').focus(); return; }
    return;
  }
  if (!S.prefs.shortcuts) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const tag = (t && t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key;
  // Up to tablet widths the detail panel covers the tools (on a phone, the
  // map too); a shortcut that moves focus there first puts the details away so
  // focus never lands under the panel.
  const run = (fn) => {
    e.preventDefault();
    const lk = k.toLowerCase();
    const putAway = detailCoversTools() && k !== '?' && lk !== 'd' && !(lk === 'm' && !MOBILE_Q.matches);
    if (putAway) minimizeDetail(false);
    fn();
    // Putting the details away hid what had focus; a shortcut that moves no
    // focus itself (Shift+R) leaves it on the way back to them.
    if (putAway && focusLost()) focusFirst('#map-status [data-act="details"]', '#search', '#map');
  };
  if (k === '/') return run(() => { switchView('find'); $('#search').focus(); });
  if (k === '?') return run(() => openDialog('dlg-shortcuts'));
  if (k === 'R' && e.shiftKey) return run(() => resetFilters(['#map-status [data-act="details"]', '#search', '#map']));
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
  $('#provenance-text').textContent = `Release ${m.release} · data ${m.data_version} · evidence review ${m.evidence_review_date} (carried-forward claims keep the previous edition’s date) · CMS reference ${m.census_snapshot.as_of} · straight-line distances.`;
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
  const parsed = readUrl();
  // The footer's real height sets the map's bottom edge: measure it before the
  // map exists, so the first fits use the final map size.
  renderProvenance();
  const foot = $('#provenance');
  const setFooter = () => {
    const v = foot.offsetHeight + 'px';
    if (document.documentElement.style.getPropertyValue('--footer-real') === v) return false;
    document.documentElement.style.setProperty('--footer-real', v);
    return true;
  };
  if (foot) setFooter();
  const mapOk = initMap();
  populateSystems();
  populateEvidenceSelect();
  populateHubSelect();
  populateJump();
  buildTransportForm();
  buildMethods();
  buildShortcuts();
  placeViewTabs();
  // The footer wraps at narrow widths and larger text; the layout above it
  // follows its real height.
  if (foot && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (setFooter() && S.map) S.map.invalidateSize(); }).observe(foot);
  }
  // The status bar rewraps on a resize or rotation; the phone legend follows it.
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncStatusHeight).observe($('#map-status'));
  recomputeAccess();
  settleUrl(parsed);
  syncControls();
  // On phones a restored non-Find view is shown as the open sheet, so what it covers is inert.
  switchView(S.ui.view, { sheet: MOBILE_Q.matches && S.ui.view !== 'find' ? true : false });
  if (mapOk) {
    if (S.explicit.viewport) S.map.setView([S.ui.view_lat, S.ui.view_lng], S.ui.view_z);
    // No explicit view: show what the link filters to (a one-state filter fits
    // that state, Alaska included) before falling back to the contiguous states.
    else fitTo(S.ui.state !== 'ALL' ? jumpBounds(S.ui.state) : jumpBounds('contig'), 7);
  }
  S.booted = true;
  update();
  if (S.ui.selected) {
    const keepView = !!S.explicit.viewport;
    selectHospital(S.ui.selected, { source: keepView ? 'url-keep-view' : 'url', focusDetail: false });
    // Opening the detail column narrowed the map; apply the link's view to the final size.
    if (keepView && mapOk) S.map.setView([S.ui.view_lat, S.ui.view_lng], S.ui.view_z, { animate: false });
  }
  measureSheetTop();
  // Read-only handle for automated tests and console inspection; also a
  // readiness flag set after the first render.
  window.__strokeAtlas = S;
  requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = 'true'; }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
