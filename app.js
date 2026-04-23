/* ========================================================================
   Regional Hospital Stroke Capabilities — Application
   ------------------------------------------------------------------------
   Pure static SPA. Loads hospitals.json, renders Leaflet map + sidebar
   list + dashboard + analysis tools. Safe DOM construction (no innerHTML
   with raw data), accessible, keyboard-friendly, responsive.
   ======================================================================== */

'use strict';

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const DATA_URL = 'hospitals.json';
const MAP_CENTER = [47.5, -120.5];
const MAP_ZOOM = 7;

// Transport speed assumptions (for door-to-door estimates)
// Ground ambulance: ~55 mph rural, use ~60 mph blended effective
// Air (fixed-wing / helicopter LifeFlight): ~150 mph blended
// Road factor: haversine distance * 1.25 to approximate road network
const ROAD_FACTOR = 1.25;
const GROUND_MPH = 55;
const AIR_MPH = 150;
const AIR_OVERHEAD_MIN = 25;    // dispatch + takeoff + landing
const GROUND_OVERHEAD_MIN = 8;  // dispatch + load
const NEEDLE_TARGET_MIN = 60;   // AHA door-to-needle goal
const PUNCTURE_TARGET_MIN = 90; // AHA door-to-puncture goal (transfer case)

// Palette keys map to CSS custom properties so palette toggling works
const MARKER_COLOR_VAR = {
  CSC: '--c-csc', TSC: '--c-tsc', PSC: '--c-psc', ASR: '--c-asr',
  EVT: '--c-evt', UW: '--c-partner', OTHER: '--c-other',
};
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#666';
}

// ------------------------------------------------------------------
// Module-level state
// ------------------------------------------------------------------
const state = {
  meta: null,
  hospitals: [],
  distances: {},   // keyed by cmsId -> {nearestAdvanced, nearestEVT, ...}
  filtered: [],    // latest filter output
  activeFilters: { CSC: false, TSC: false, PSC: false, ASR: false, EVT: false, UW: false },
  searchTerm: '',
  stateFilter: 'ALL',
  evtDistMin: 0,
  map: null,
  tileLayer: null,
  markers: [],
  overlays: { partner: [], referral: [], coverage: [] },
  overlayVisible: { partner: false, referral: false, coverage: false },
  darkMap: false,
  darkUI: false,
  cbPalette: false,
  toolsMenuOpen: false,
  matrixSort: { col: 'name', asc: true },
  initialized: false,
};

// Cache advanced/EVT center lists
let advancedCenters = [];
let evtCenters = [];

// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') { /* never accept raw html here */ throw new Error('el(): use text or appendChild'); }
    else if (k === 'onclick') node.addEventListener('click', v);
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('aria-') || k === 'role' || k === 'tabindex') node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function titleCase(str) {
  if (!str) return '';
  const ACR = new Set(['AMC','UW','VA','CHI','DNV','CMS','OHSU','EIRMC','MT','ER','ICU','NICU','ECU','ED','USA','US']);
  return str.split(/\s+/).map(w => {
    const upper = w.toUpperCase();
    if (ACR.has(upper)) return upper;
    if (w.length <= 2) return upper;
    if (w.includes('-')) return w.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ').replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());
}

function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function groundMinutes(mi) {
  // approximate road distance as haversine * ROAD_FACTOR; add overhead
  return Math.round((mi * ROAD_FACTOR) / GROUND_MPH * 60 + GROUND_OVERHEAD_MIN);
}
function airMinutes(mi) {
  return Math.round(mi / AIR_MPH * 60 + AIR_OVERHEAD_MIN);
}
function bestTransportMinutes(mi) {
  // Under ~80 miles, ground usually wins after overhead; above, air wins.
  return Math.min(groundMinutes(mi), airMinutes(mi));
}

function formatMiles(mi) {
  if (!Number.isFinite(mi) || mi <= 0) return '—';
  return mi < 10 ? mi.toFixed(1) : Math.round(mi).toString();
}

function dateStr() { return new Date().toISOString().split('T')[0]; }

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ------------------------------------------------------------------
// Toast notifications
// ------------------------------------------------------------------
function toast(message, type = 'info', duration = 2800) {
  const container = $('#toast-container');
  if (!container) return;
  const node = el('div', { class: `toast ${type}`, role: 'status', 'aria-live': 'polite', text: message });
  container.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; }, duration - 300);
  setTimeout(() => node.remove(), duration);
}

// ------------------------------------------------------------------
// Data loading + pre-calc
// ------------------------------------------------------------------
async function loadData() {
  let payload;
  try {
    const resp = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    payload = await resp.json();
  } catch (err) {
    console.error('Data load failed:', err);
    toast('Failed to load hospital data. Check console.', 'error', 5000);
    throw err;
  }
  state.meta = {
    schema: payload.schema_version,
    version: payload.data_version,
    verified: payload.last_verified,
    sources: payload.primary_sources || [],
    coverage: payload.coverage_note,
    certDefs: payload.certification_definitions,
    bodies: payload.certifying_bodies,
  };
  state.hospitals = (payload.hospitals || [])
    .filter(h => h.latitude && h.longitude)
    .map(h => ({
      ...h,
      displayName: titleCase(h.name),
    }));
  advancedCenters = state.hospitals.filter(h => h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC');
  evtCenters = state.hospitals.filter(h => h.hasELVO === true);
  preCalculateDistances();
  updateProvenance();
}

function preCalculateDistances() {
  for (const h of state.hospitals) {
    const d = {
      nearestAdvanced: null, nearestAdvancedDistance: Infinity, nearestAdvancedName: '',
      nearestEVT: null, nearestEVTDistance: Infinity, nearestEVTName: '',
    };
    for (const c of advancedCenters) {
      if (c.cmsId === h.cmsId) continue;
      const dist = haversineMi(h.latitude, h.longitude, c.latitude, c.longitude);
      if (dist < d.nearestAdvancedDistance) {
        d.nearestAdvancedDistance = dist;
        d.nearestAdvanced = c; d.nearestAdvancedName = c.displayName;
      }
    }
    for (const c of evtCenters) {
      if (c.cmsId === h.cmsId) continue;
      const dist = haversineMi(h.latitude, h.longitude, c.latitude, c.longitude);
      if (dist < d.nearestEVTDistance) {
        d.nearestEVTDistance = dist;
        d.nearestEVT = c; d.nearestEVTName = c.displayName;
      }
    }
    // Self-referencing records: if this IS a CSC/TSC or EVT, distance to itself = 0
    if (h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC') {
      d.nearestAdvancedDistance = 0; d.nearestAdvanced = h; d.nearestAdvancedName = h.displayName;
    }
    if (h.hasELVO) {
      d.nearestEVTDistance = 0; d.nearestEVT = h; d.nearestEVTName = h.displayName;
    }
    state.distances[h.cmsId] = d;
  }
}

// ------------------------------------------------------------------
// Map init
// ------------------------------------------------------------------
function initMap() {
  state.map = L.map('map', {
    zoomControl: false, worldCopyJump: false,
    minZoom: 4, maxZoom: 16, preferCanvas: true,
  }).setView(MAP_CENTER, MAP_ZOOM);

  setTileLayer(state.darkMap);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  const LegendControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'map-legend');
      const items = [
        ['--c-csc','CSC'], ['--c-tsc','TSC'], ['--c-psc','PSC'], ['--c-asr','ASR'],
        ['--c-partner','Partner'], ['--c-evt','EVT'], ['--c-other','Other'],
      ];
      for (const [v, label] of items) {
        const entry = el('span', { class: 'entry' }, [
          el('span', { class: 'legend-dot', style: { background: cssVar(v) } }),
          document.createTextNode(label),
        ]);
        div.appendChild(entry);
      }
      const info = el('button', { class: 'info-link', type: 'button', 'aria-label': 'Certification info', text: '?' });
      info.addEventListener('click', () => openModal('cert-info-modal'));
      div.appendChild(info);
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  new LegendControl().addTo(state.map);
}
function setTileLayer(dark) {
  if (state.tileLayer) state.map.removeLayer(state.tileLayer);
  const url = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  state.tileLayer = L.tileLayer(url, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19, subdomains: 'abcd',
  }).addTo(state.map);
}

// ------------------------------------------------------------------
// Marker rendering
// ------------------------------------------------------------------
function markerColor(h) {
  if (h.strokeCertificationType && MARKER_COLOR_VAR[h.strokeCertificationType]) {
    return cssVar(MARKER_COLOR_VAR[h.strokeCertificationType]);
  }
  if (h.uwPartner) return cssVar('--c-partner');
  return cssVar('--c-other');
}
function markerSize(h) {
  const sizes = { CSC: 12, TSC: 11, PSC: 10, ASR: 9 };
  return sizes[h.strokeCertificationType] || (h.uwPartner ? 9 : 7);
}

function renderMarkers(hospitals) {
  for (const m of state.markers) state.map.removeLayer(m);
  state.markers = [];
  for (const h of hospitals) {
    const marker = L.circleMarker([h.latitude, h.longitude], {
      radius: markerSize(h),
      fillColor: markerColor(h),
      color: 'white',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85,
    });
    marker.bindPopup(buildPopupContent(h), { maxWidth: 320 });
    marker.on('click', () => showHospitalDetail(h));
    marker.hospitalId = h.cmsId;
    marker.addTo(state.map);
    state.markers.push(marker);
  }
}

// Builds a DOM node for the popup (safe from XSS — uses textContent).
function buildPopupContent(h) {
  const wrap = el('div', { style: { minWidth: '260px' } });
  wrap.appendChild(el('h3', { style: { color: markerColor(h) }, text: h.displayName }));
  const meta = el('div', { style: { fontSize: '12px', lineHeight: '1.55' } });
  const line = (label, val) => {
    if (val == null || val === '') return;
    const b = el('strong', { text: label + ' ' });
    meta.appendChild(b);
    meta.appendChild(document.createTextNode(val));
    meta.appendChild(document.createElement('br'));
  };
  line('Address:', `${titleCase(h.address)}`);
  line('', [h.city, h.state, h.zip].filter(Boolean).join(', '));
  if (h.strokeCertificationType) {
    const certNames = { CSC: 'Comprehensive Stroke Center', TSC: 'Thrombectomy-Capable Stroke Center', PSC: 'Primary Stroke Center', ASR: 'Acute Stroke Ready' };
    line('Certification:', `${certNames[h.strokeCertificationType]} (${h.strokeCertificationType})`);
    if (h.certifyingBody) line('Certifying body:', h.certifyingBody);
  }
  if (h.hasELVO) {
    const s = el('strong', { style: { color: cssVar('--c-evt') }, text: '24/7 Thrombectomy (EVT)' });
    meta.appendChild(s); meta.appendChild(document.createElement('br'));
  }
  if (h.uwPartner) {
    const s = el('strong', { style: { color: cssVar('--c-partner') }, text: '✓ Telestroke Partner' });
    meta.appendChild(s); meta.appendChild(document.createElement('br'));
  }
  const d = state.distances[h.cmsId];
  if (d && d.nearestAdvancedDistance > 0 && Number.isFinite(d.nearestAdvancedDistance)) {
    meta.appendChild(document.createElement('br'));
    line('Nearest CSC/TSC:', d.nearestAdvancedName);
    const miles = d.nearestAdvancedDistance;
    meta.appendChild(document.createTextNode(`~${groundMinutes(miles)} min ground / ~${airMinutes(miles)} min air (${formatMiles(miles)} mi)`));
    meta.appendChild(document.createElement('br'));
    meta.appendChild(el('span', { style: { fontSize: '10px', color: '#9ca3af' }, text: `${GROUND_MPH} mph ground + ${ROAD_FACTOR}× road factor; ${AIR_MPH} mph air; +overhead` }));
  }
  wrap.appendChild(meta);
  return wrap;
}

// ------------------------------------------------------------------
// Filtering
// ------------------------------------------------------------------
function applyFilters(opts = {}) {
  const { skipZoom = false } = opts;
  clearOverlays();
  const anyPill = Object.values(state.activeFilters).some(v => v);
  const search = state.searchTerm.toLowerCase().trim();

  const filtered = state.hospitals.filter(h => {
    if (search) {
      const hay = [
        h.name, h.displayName, h.address, h.city, h.state, h.zip,
        h.strokeCertificationType || '', h.certifyingBody || '',
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (state.stateFilter !== 'ALL' && h.state !== state.stateFilter) return false;
    if (state.evtDistMin > 0) {
      const dist = state.distances[h.cmsId]?.nearestEVTDistance || 0;
      if (!Number.isFinite(dist) || dist < state.evtDistMin || dist === 0) return false;
    }
    if (anyPill) {
      let pass = false;
      if (state.activeFilters.CSC && h.strokeCertificationType === 'CSC') pass = true;
      if (state.activeFilters.TSC && h.strokeCertificationType === 'TSC') pass = true;
      if (state.activeFilters.PSC && h.strokeCertificationType === 'PSC') pass = true;
      if (state.activeFilters.ASR && h.strokeCertificationType === 'ASR') pass = true;
      if (state.activeFilters.EVT && h.hasELVO) pass = true;
      if (state.activeFilters.UW && h.uwPartner) pass = true;
      if (!pass) return false;
    }
    return true;
  });
  state.filtered = filtered;

  renderMarkers(filtered);
  renderList(filtered);
  renderStatus(filtered);
  renderDashboard(filtered);
  renderClearButton();

  // Zoom to fit when a meaningful subset is active
  const meaningful = anyPill || state.stateFilter !== 'ALL' || search || state.evtDistMin > 0;
  if (!skipZoom && meaningful && filtered.length > 0 && filtered.length < state.hospitals.length) {
    const bounds = L.latLngBounds(filtered.map(h => [h.latitude, h.longitude]));
    state.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 10 });
  }
}

function togglePill(key) {
  state.activeFilters[key] = !state.activeFilters[key];
  const pill = document.querySelector(`.pill[data-filter="${key}"]`);
  if (pill) pill.setAttribute('aria-pressed', String(state.activeFilters[key]));
  applyFilters();
}

function resetAll() {
  for (const k of Object.keys(state.activeFilters)) state.activeFilters[k] = false;
  for (const p of $$('.pill')) p.setAttribute('aria-pressed', 'false');
  state.searchTerm = '';
  state.stateFilter = 'ALL';
  state.evtDistMin = 0;
  $('#search-input').value = '';
  const ms = $('#mobile-search-input'); if (ms) ms.value = '';
  $('#filter-state').value = 'ALL';
  $('#filter-evt-distance').value = '0';
  $('#evt-dist-label').textContent = '0';
  clearOverlays();
  state.map.setView(MAP_CENTER, MAP_ZOOM);
  applyFilters({ skipZoom: true });
  toast('All filters cleared');
}

function renderClearButton() {
  const any = Object.values(state.activeFilters).some(v => v)
    || state.stateFilter !== 'ALL' || state.evtDistMin > 0 || state.searchTerm;
  $('#clear-btn').classList.toggle('hidden', !any);
}

// ------------------------------------------------------------------
// Sidebar list
// ------------------------------------------------------------------
function renderStatus(filtered) {
  $('#status-bar').textContent = `Showing ${filtered.length} of ${state.hospitals.length} hospitals`;
  $('#list-count').textContent = filtered.length;
}

function renderList(filtered) {
  const list = $('#hospital-list');
  clear(list);
  if (filtered.length === 0) {
    list.appendChild(el('div', { class: 'empty-state', text: 'No hospitals match your filters. Try clearing filters.' }));
    return;
  }
  const order = { CSC: 0, TSC: 1, PSC: 2, ASR: 3 };
  const sorted = [...filtered].sort((a, b) => {
    const oa = order[a.strokeCertificationType] ?? (a.uwPartner ? 4 : 5);
    const ob = order[b.strokeCertificationType] ?? (b.uwPartner ? 4 : 5);
    return oa - ob || a.displayName.localeCompare(b.displayName);
  });
  for (const h of sorted) {
    const color = markerColor(h);
    const location = [h.city, h.state].filter(Boolean).join(', ');
    const badges = el('div', { class: 'badges' });
    if (h.strokeCertificationType) {
      badges.appendChild(el('span', { class: `badge badge-${h.strokeCertificationType}`, text: h.strokeCertificationType }));
    }
    if (h.hasELVO) badges.appendChild(el('span', { class: 'badge badge-EVT', text: 'EVT' }));
    if (h.uwPartner) badges.appendChild(el('span', { class: 'badge badge-UW', text: 'Partner' }));

    const content = el('div', { style: { flex: 1, minWidth: 0 } }, [
      el('div', { class: 'name', text: h.displayName }),
      el('div', { class: 'meta', text: location + (h.zip ? ' ' + h.zip : '') }),
      badges,
    ]);
    const item = el('button', {
      class: 'hospital-item', type: 'button', 'aria-label': `Focus ${h.displayName}`, dataset: { cms: h.cmsId },
    }, [
      el('span', { class: 'dot', style: { background: color } }),
      content,
    ]);
    item.addEventListener('click', () => panToHospital(h.cmsId));
    list.appendChild(item);
  }
}

function panToHospital(cmsId) {
  const h = state.hospitals.find(x => x.cmsId === cmsId);
  if (!h) return;
  state.map.setView([h.latitude, h.longitude], 12);
  const marker = state.markers.find(m => m.hospitalId === cmsId);
  if (marker) marker.openPopup();
  $$('.hospital-item').forEach(e => e.classList.remove('highlighted'));
  const item = document.querySelector(`.hospital-item[data-cms="${cmsId}"]`);
  if (item) { item.classList.add('highlighted'); item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  // Auto-close mobile sidebar on selection
  if (window.innerWidth <= 768) {
    $('#sidebar').classList.remove('mobile-open');
  }
}

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
function renderDashboard(filtered) {
  drawDonut();
  drawStateBars();
  renderGapMetrics(filtered);
  drawHistogram();
}
function drawDonut() {
  const canvas = $('#donut-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 180 * dpr; canvas.height = 180 * dpr;
  canvas.style.width = '180px'; canvas.style.height = '180px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cx = 90, cy = 90, r = 65, lw = 26;
  ctx.clearRect(0, 0, 180, 180);

  const counts = {
    CSC: state.hospitals.filter(h => h.strokeCertificationType === 'CSC').length,
    TSC: state.hospitals.filter(h => h.strokeCertificationType === 'TSC').length,
    PSC: state.hospitals.filter(h => h.strokeCertificationType === 'PSC').length,
    ASR: state.hospitals.filter(h => h.strokeCertificationType === 'ASR').length,
  };
  const none = state.hospitals.length - counts.CSC - counts.TSC - counts.PSC - counts.ASR;
  const total = state.hospitals.length;
  const segs = [
    { label: 'CSC', count: counts.CSC, color: cssVar('--c-csc') },
    { label: 'TSC', count: counts.TSC, color: cssVar('--c-tsc') },
    { label: 'PSC', count: counts.PSC, color: cssVar('--c-psc') },
    { label: 'ASR', count: counts.ASR, color: cssVar('--c-asr') },
    { label: 'None', count: none, color: '#d1d5db' },
  ];
  let angle = -Math.PI / 2;
  for (const s of segs) {
    if (s.count === 0) continue;
    const sweep = (s.count / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.strokeStyle = s.color; ctx.lineWidth = lw; ctx.lineCap = 'butt';
    ctx.stroke();
    angle += sweep;
  }
  ctx.fillStyle = cssVar('--text-primary') || '#111827';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(total), cx, cy - 6);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = cssVar('--text-muted') || '#6b7280';
  ctx.fillText('hospitals', cx, cy + 14);
}
function drawStateBars() {
  const container = $('#state-bars');
  if (!container) return;
  clear(container);
  const states = ['WA', 'AK', 'ID', 'MT', 'WY'];
  const maxCount = Math.max(...states.map(s => state.hospitals.filter(h => h.state === s).length), 1);
  for (const s of states) {
    const hs = state.hospitals.filter(h => h.state === s);
    const buckets = {
      CSC: hs.filter(h => h.strokeCertificationType === 'CSC').length,
      TSC: hs.filter(h => h.strokeCertificationType === 'TSC').length,
      PSC: hs.filter(h => h.strokeCertificationType === 'PSC').length,
      ASR: hs.filter(h => h.strokeCertificationType === 'ASR').length,
    };
    const none = hs.length - buckets.CSC - buckets.TSC - buckets.PSC - buckets.ASR;
    const track = el('div', { class: 'bar-track' });
    const widthPct = (v) => (v / maxCount * 100).toFixed(2) + '%';
    const addSeg = (count, cssVarName, title) => {
      if (count === 0) return;
      track.appendChild(el('span', { style: { width: widthPct(count), background: cssVar(cssVarName) }, title }));
    };
    addSeg(buckets.CSC, '--c-csc', `CSC: ${buckets.CSC}`);
    addSeg(buckets.TSC, '--c-tsc', `TSC: ${buckets.TSC}`);
    addSeg(buckets.PSC, '--c-psc', `PSC: ${buckets.PSC}`);
    addSeg(buckets.ASR, '--c-asr', `ASR: ${buckets.ASR}`);
    if (none > 0) track.appendChild(el('span', { style: { width: widthPct(none), background: '#d1d5db' }, title: `None: ${none}` }));
    const row = el('div', { class: 'state-bar' }, [
      el('span', { class: 'label', text: s }),
      track,
      el('span', { class: 'total', text: String(hs.length) }),
    ]);
    container.appendChild(row);
  }
}
function renderGapMetrics(filtered) {
  const container = $('#gap-metrics');
  if (!container) return;
  clear(container);
  const src = filtered || state.hospitals;
  const metrics = [
    { label: 'No certification', value: src.filter(h => !h.strokeCertificationType).length, color: '#ef4444' },
    { label: 'Not a partner', value: src.filter(h => !h.uwPartner).length, color: '#6b7280' },
    { label: 'EVT desert (>100 mi)', value: src.filter(h => (state.distances[h.cmsId]?.nearestEVTDistance || 0) > 100).length, color: '#f59e0b' },
    { label: 'Zero capability', value: src.filter(h => !h.strokeCertificationType && !h.uwPartner).length, color: '#dc2626' },
    { label: 'EVT-capable', value: src.filter(h => h.hasELVO).length, color: '#10b981' },
  ];
  for (const m of metrics) {
    container.appendChild(el('div', { class: 'metric-row' }, [
      el('span', { class: 'label', text: m.label }),
      el('span', { class: 'value', style: { color: m.color }, text: String(m.value) }),
    ]));
  }
}
function drawHistogram() {
  const canvas = $('#histogram-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 248 * dpr; canvas.height = 110 * dpr;
  canvas.style.width = '248px'; canvas.style.height = '110px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, 248, 110);

  const buckets = [0, 25, 50, 75, 100, 150, 300];
  const labels = ['0-25', '25-50', '50-75', '75-100', '100-150', '150+'];
  const counts = new Array(labels.length).fill(0);
  for (const h of state.hospitals) {
    const d = state.distances[h.cmsId]?.nearestEVTDistance;
    if (!d || !Number.isFinite(d) || d === 0) continue;
    for (let i = 0; i < buckets.length - 1; i++) {
      if (d >= buckets[i] && d < buckets[i+1]) { counts[i]++; break; }
    }
    if (d >= buckets[buckets.length - 1]) counts[counts.length - 1]++;
  }
  const maxCount = Math.max(...counts, 1);
  const barW = 34, gap = 4, baseY = 84, maxH = 65;
  const startX = 10;
  for (let i = 0; i < counts.length; i++) {
    const x = startX + i * (barW + gap);
    const h = (counts[i] / maxCount) * maxH;
    const color = i >= 4 ? '#ef4444' : i >= 3 ? '#f59e0b' : '#10b981';
    ctx.fillStyle = color;
    ctx.fillRect(x, baseY - h, barW, h);
    if (counts[i] > 0) {
      ctx.fillStyle = cssVar('--text-primary') || '#111827';
      ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(counts[i]), x + barW / 2, baseY - h - 3);
    }
    ctx.fillStyle = cssVar('--text-muted') || '#9ca3af';
    ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, baseY + 12);
  }
  ctx.fillStyle = cssVar('--text-muted') || '#9ca3af';
  ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('miles to nearest EVT', 130, baseY + 24);
}

// ------------------------------------------------------------------
// Hospital detail modal
// ------------------------------------------------------------------
function showHospitalDetail(h) {
  $('#detail-title').textContent = h.displayName;
  const content = $('#hospital-detail-content');
  clear(content);

  const certNames = { CSC: 'Comprehensive Stroke Center', TSC: 'Thrombectomy-Capable Stroke Center', PSC: 'Primary Stroke Center', ASR: 'Acute Stroke Ready' };

  // Location
  const loc = el('div', { class: 'detail-section' });
  loc.appendChild(el('h3', { text: 'Location' }));
  const locKV = el('div');
  const kv = (label, val) => {
    if (val == null || val === '') return;
    const row = el('div', { class: 'kv' });
    row.appendChild(el('dt', { text: label }));
    row.appendChild(el('dd', { text: ' ' + val }));
    locKV.appendChild(row);
  };
  kv('Address:', titleCase(h.address));
  kv('City:', h.city);
  kv('State/ZIP:', `${h.state} ${h.zip || ''}`.trim());
  kv('CMS ID:', h.cmsId);
  kv('Coordinates:', `${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}`);
  loc.appendChild(locKV);
  content.appendChild(loc);

  // Capabilities
  const cap = el('div', { class: 'detail-section' });
  cap.appendChild(el('h3', { text: 'Stroke Capabilities' }));
  const capKV = el('div');
  const row = (label, text, color) => {
    const r = el('div', { class: 'kv' });
    r.appendChild(el('dt', { text: label }));
    const dd = el('dd');
    const span = el('span', { text: ' ' + text });
    if (color) span.style.color = color;
    if (color) span.style.fontWeight = '600';
    dd.appendChild(span);
    r.appendChild(dd); capKV.appendChild(r);
  };
  if (h.strokeCertificationType) {
    row('Certification:', `${certNames[h.strokeCertificationType]} (${h.strokeCertificationType})`);
    if (h.certifyingBody) row('Certifying body:', h.certifyingBody);
    if (h.certificationDetails) row('Details:', h.certificationDetails);
  } else {
    row('Certification:', 'None', '#dc2626');
  }
  row('EVT (24/7 thrombectomy):', h.hasELVO ? 'Yes' : 'No', h.hasELVO ? cssVar('--c-evt') : undefined);
  row('Telestroke partner:', h.uwPartner ? 'Yes' : 'No', h.uwPartner ? cssVar('--c-partner') : undefined);
  cap.appendChild(capKV);
  content.appendChild(cap);

  // Distance + transport-time analysis
  const d = state.distances[h.cmsId] || {};
  if (d.nearestAdvancedDistance > 0 && Number.isFinite(d.nearestAdvancedDistance)) {
    const dist = el('div', { class: 'detail-section' });
    dist.appendChild(el('h3', { text: 'Transport Analysis' }));
    const tbl = el('div');
    const dCSC = d.nearestAdvancedDistance;
    tbl.appendChild(el('div', { class: 'kv' }, [
      el('dt', { text: 'Nearest CSC/TSC:' }),
      el('dd', { text: ` ${d.nearestAdvancedName} (${formatMiles(dCSC)} mi)` }),
    ]));
    tbl.appendChild(el('div', { class: 'kv' }, [
      el('dt', { text: 'Ground transfer:' }),
      el('dd', { text: ` ~${groundMinutes(dCSC)} min  ·  Air: ~${airMinutes(dCSC)} min  ·  Best: ~${bestTransportMinutes(dCSC)} min` }),
    ]));
    if (Number.isFinite(d.nearestEVTDistance) && d.nearestEVTDistance > 0) {
      tbl.appendChild(el('div', { class: 'kv' }, [
        el('dt', { text: 'Nearest EVT:' }),
        el('dd', { text: ` ${d.nearestEVTName} (${formatMiles(d.nearestEVTDistance)} mi)  ·  Best transport: ~${bestTransportMinutes(d.nearestEVTDistance)} min` }),
      ]));
    }
    // Door-in-door-out context
    const goldenNote = el('div', { class: 'kv' });
    goldenNote.appendChild(el('dt', { text: 'Door-to-puncture window:' }));
    const ddNote = el('dd');
    const bestMin = bestTransportMinutes(dCSC);
    const fits60 = bestMin <= 60;
    const color = fits60 ? cssVar('--c-evt') : bestMin <= 120 ? cssVar('--c-tsc') : cssVar('--c-csc');
    const note = el('span', { text: ` ${bestMin} min transport + 30 min DIDO ≈ ${bestMin + 30} min total to puncture (AHA target ${PUNCTURE_TARGET_MIN} min)` });
    note.style.color = color; note.style.fontWeight = '600';
    ddNote.appendChild(note);
    goldenNote.appendChild(ddNote); tbl.appendChild(goldenNote);

    dist.appendChild(tbl);
    content.appendChild(dist);
  }

  // Nearby hospitals
  const nearbySect = el('div', { class: 'detail-section' });
  nearbySect.appendChild(el('h3', { text: 'Nearby Hospitals (5 closest)' }));
  const nearby = state.hospitals
    .filter(n => n.cmsId !== h.cmsId)
    .map(n => ({ ...n, dist: haversineMi(h.latitude, h.longitude, n.latitude, n.longitude) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);
  for (const n of nearby) {
    const left = el('span');
    left.appendChild(el('span', { text: n.displayName }));
    if (n.strokeCertificationType) {
      left.appendChild(document.createTextNode(' '));
      left.appendChild(el('span', { class: `badge badge-${n.strokeCertificationType}`, text: n.strokeCertificationType }));
    }
    if (n.hasELVO) {
      left.appendChild(document.createTextNode(' '));
      left.appendChild(el('span', { class: 'badge badge-EVT', text: 'EVT' }));
    }
    const rowEl = el('div', { class: 'nearby-row' }, [
      left,
      el('span', { style: { color: cssVar('--text-muted'), whiteSpace: 'nowrap', marginLeft: '8px' }, text: `${formatMiles(n.dist)} mi` }),
    ]);
    nearbySect.appendChild(rowEl);
  }
  content.appendChild(nearbySect);

  // Data sources
  if (h.dataSources?.length) {
    const srcSect = el('div', { style: { fontSize: '11px', color: cssVar('--text-muted'), paddingTop: '8px', borderTop: '1px solid var(--border)' } });
    srcSect.appendChild(el('strong', { text: 'Data sources: ' }));
    srcSect.appendChild(document.createTextNode(h.dataSources.join('; ')));
    if (state.meta?.verified) {
      srcSect.appendChild(document.createElement('br'));
      srcSect.appendChild(el('strong', { text: 'Last verified: ' }));
      srcSect.appendChild(document.createTextNode(state.meta.verified));
    }
    content.appendChild(srcSect);
  }

  openModal('hospital-detail-modal');
}

// ------------------------------------------------------------------
// Modals
// ------------------------------------------------------------------
function openModal(id) {
  const m = $('#' + id);
  if (!m) return;
  m.classList.add('active');
  // Focus first focusable element
  const first = m.querySelector('button, [tabindex="0"], input, select, textarea');
  if (first) first.focus();
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const m = id ? $('#' + id) : document.querySelector('.modal-overlay.active');
  if (!m) return;
  m.classList.remove('active');
  // Restore body scroll only if no other modal open
  if (!document.querySelector('.modal-overlay.active')) document.body.style.overflow = '';
}
function closeAllModals() {
  $$('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  document.body.style.overflow = '';
}

// ------------------------------------------------------------------
// Tools menu
// ------------------------------------------------------------------
function toggleToolsMenu() {
  const menu = $('#tools-menu');
  const fab = $('#tools-fab');
  state.toolsMenuOpen = !state.toolsMenuOpen;
  menu.hidden = !state.toolsMenuOpen;
  fab.setAttribute('aria-expanded', String(state.toolsMenuOpen));
}

// ------------------------------------------------------------------
// Analysis overlays
// ------------------------------------------------------------------
function clearOverlays() {
  for (const l of state.overlays.partner) state.map.removeLayer(l);
  for (const l of state.overlays.referral) state.map.removeLayer(l);
  for (const l of state.overlays.coverage) state.map.removeLayer(l);
  state.overlays = { partner: [], referral: [], coverage: [] };
  state.overlayVisible = { partner: false, referral: false, coverage: false };
}

function togglePartnerNetwork() {
  toggleToolsMenu();
  if (state.overlayVisible.partner) {
    for (const l of state.overlays.partner) state.map.removeLayer(l);
    state.overlays.partner = []; state.overlayVisible.partner = false;
    toast('Partner network removed');
    return;
  }
  const harborview = state.hospitals.find(h => /HARBORVIEW/.test(h.name));
  if (!harborview) { toast('Hub (Harborview) not in dataset', 'warning'); return; }
  const partners = state.hospitals.filter(h => h.uwPartner && h.cmsId !== harborview.cmsId);
  for (const p of partners) {
    const line = L.polyline([[p.latitude, p.longitude], [harborview.latitude, harborview.longitude]], {
      color: cssVar('--c-partner'), weight: 2, opacity: 0.55, dashArray: '5,8',
    }).addTo(state.map);
    state.overlays.partner.push(line);
  }
  state.overlayVisible.partner = true;
  toast(`${partners.length} telestroke partners linked to hub`);
}

function toggleReferralPathways() {
  toggleToolsMenu();
  if (state.overlayVisible.referral) {
    for (const l of state.overlays.referral) state.map.removeLayer(l);
    state.overlays.referral = []; state.overlayVisible.referral = false;
    toast('Referral pathways removed');
    return;
  }
  let n = 0;
  for (const h of state.hospitals) {
    if (h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC') continue;
    const d = state.distances[h.cmsId];
    if (!d?.nearestAdvanced || !Number.isFinite(d.nearestAdvancedDistance)) continue;
    const dist = d.nearestAdvancedDistance;
    const color = dist < 50 ? cssVar('--c-evt') : dist <= 100 ? cssVar('--c-psc') : dist <= 150 ? cssVar('--c-tsc') : cssVar('--c-csc');
    const line = L.polyline(
      [[h.latitude, h.longitude], [d.nearestAdvanced.latitude, d.nearestAdvanced.longitude]],
      { color, weight: dist > 100 ? 2 : 1, opacity: 0.45, dashArray: '5,8' }
    ).addTo(state.map);
    state.overlays.referral.push(line);
    n++;
  }
  state.overlayVisible.referral = true;
  toast(`${n} referral pathways shown (green <50mi → red >150mi)`);
}

function toggleCoverageOverlay() {
  toggleToolsMenu();
  if (state.overlayVisible.coverage) {
    for (const c of state.overlays.coverage) state.map.removeLayer(c);
    state.overlays.coverage = []; state.overlayVisible.coverage = false;
    toast('Coverage overlay removed');
    return;
  }
  for (const c of evtCenters) {
    const c50 = L.circle([c.latitude, c.longitude], {
      radius: 50 * 1609.34, color: cssVar('--c-evt'), fillColor: cssVar('--c-evt'),
      fillOpacity: 0.06, weight: 1, opacity: 0.35,
    }).addTo(state.map);
    const c100 = L.circle([c.latitude, c.longitude], {
      radius: 100 * 1609.34, color: cssVar('--c-psc'), fillColor: cssVar('--c-psc'),
      fillOpacity: 0.03, weight: 1, opacity: 0.25, dashArray: '5,5',
    }).addTo(state.map);
    state.overlays.coverage.push(c50, c100);
  }
  state.overlayVisible.coverage = true;
  toast('Coverage: solid 50 mi, dashed 100 mi from EVT centers');
}

function showDistanceMap() {
  toggleToolsMenu();
  for (const m of state.markers) state.map.removeLayer(m);
  state.markers = [];
  for (const h of state.hospitals) {
    const d = state.distances[h.cmsId]?.nearestAdvancedDistance ?? Infinity;
    let color;
    if (!Number.isFinite(d) || d === 0) color = markerColor(h);
    else if (d < 50) color = cssVar('--c-evt');
    else if (d <= 100) color = cssVar('--c-psc');
    else color = cssVar('--c-csc');
    const marker = L.circleMarker([h.latitude, h.longitude], {
      radius: markerSize(h), fillColor: color, color: 'white', weight: 2, opacity: 1, fillOpacity: 0.85,
    });
    marker.bindPopup(buildPopupContent(h));
    marker.on('click', () => showHospitalDetail(h));
    marker.hospitalId = h.cmsId;
    marker.addTo(state.map);
    state.markers.push(marker);
  }
  const under = state.hospitals.filter(h => {
    const d = state.distances[h.cmsId]?.nearestAdvancedDistance;
    return d > 0 && d < 50 && Number.isFinite(d);
  }).length;
  const mid = state.hospitals.filter(h => {
    const d = state.distances[h.cmsId]?.nearestAdvancedDistance;
    return d >= 50 && d <= 100;
  }).length;
  const over = state.hospitals.filter(h => {
    const d = state.distances[h.cmsId]?.nearestAdvancedDistance;
    return d > 100 && Number.isFinite(d);
  }).length;
  toast(`CSC/TSC distance: ${under} <50mi · ${mid} 50-100mi · ${over} >100mi`);
}

function showEVTDeserts() {
  toggleToolsMenu();
  for (const m of state.markers) state.map.removeLayer(m);
  state.markers = [];
  let desertCount = 0;
  for (const h of state.hospitals) {
    const d = state.distances[h.cmsId]?.nearestEVTDistance ?? Infinity;
    const isEVT = h.hasELVO;
    const isDesert = !isEVT && d > 100 && Number.isFinite(d);
    if (isDesert) desertCount++;
    const color = isEVT ? cssVar('--c-evt') : isDesert ? cssVar('--c-csc') : cssVar('--c-other');
    const size = isEVT ? 12 : isDesert ? 10 : 6;
    const marker = L.circleMarker([h.latitude, h.longitude], {
      radius: size, fillColor: color,
      color: isDesert ? '#991b1b' : 'white',
      weight: isDesert ? 3 : 2, opacity: 1, fillOpacity: isDesert ? 0.9 : (isEVT ? 0.85 : 0.55),
    });
    marker.bindPopup(buildPopupContent(h));
    marker.on('click', () => showHospitalDetail(h));
    marker.hospitalId = h.cmsId;
    marker.addTo(state.map);
    state.markers.push(marker);
  }
  toast(`${desertCount} hospitals >100 mi from 24/7 thrombectomy`, 'warning', 4000);
}

function showZeroCapability() {
  toggleToolsMenu();
  for (const m of state.markers) state.map.removeLayer(m);
  state.markers = [];
  let n = 0;
  for (const h of state.hospitals) {
    const zero = !h.strokeCertificationType && !h.uwPartner;
    if (zero) n++;
    const color = zero ? cssVar('--c-csc') : markerColor(h);
    const marker = L.circleMarker([h.latitude, h.longitude], {
      radius: zero ? 11 : markerSize(h), fillColor: color,
      color: zero ? '#991b1b' : 'white', weight: zero ? 3 : 2,
      opacity: 1, fillOpacity: zero ? 0.9 : 0.55,
    });
    marker.bindPopup(buildPopupContent(h));
    marker.on('click', () => showHospitalDetail(h));
    marker.hospitalId = h.cmsId;
    marker.addTo(state.map);
    state.markers.push(marker);
  }
  toast(`${n} zero-capability hospitals highlighted`, 'warning');
}

// ------------------------------------------------------------------
// Expansion scoring
// ------------------------------------------------------------------
function openExpansionModal() {
  toggleToolsMenu();
  recalcExpansion();
  openModal('expansion-modal');
}
function recalcExpansion() {
  const w = {
    noCert: +$('#w-noCert').value || 0,
    notUW: +$('#w-notUW').value || 0,
    farCSC: +$('#w-farCSC').value || 0,
    farEVT: +$('#w-farEVT').value || 0,
    hasLow: +$('#w-hasLow').value || 0,
  };
  const scored = state.hospitals.map(h => {
    const d = state.distances[h.cmsId] || {};
    let s = 0;
    if (!h.strokeCertificationType) s += w.noCert;
    if (!h.uwPartner) s += w.notUW;
    if ((d.nearestAdvancedDistance || 0) > 75) s += w.farCSC;
    if ((d.nearestEVTDistance || 0) > 100) s += w.farEVT;
    if (h.strokeCertificationType === 'ASR' || h.strokeCertificationType === 'PSC') s += w.hasLow;
    return { h, s, dA: d.nearestAdvancedDistance || Infinity, dE: d.nearestEVTDistance || Infinity };
  }).sort((a, b) => b.s - a.s);

  const top = scored.slice(0, 25);
  const container = $('#expansion-candidates-content');
  clear(container);
  if (top.length === 0) {
    container.appendChild(el('div', { class: 'empty-state', text: 'No candidates.' }));
    return;
  }
  top.forEach((item, i) => {
    const tier = item.s >= 6 ? 'sc-high' : item.s >= 3 ? 'sc-mid' : 'sc-low';
    const bg = item.s >= 6 ? '#dc2626' : item.s >= 3 ? '#f59e0b' : '#10b981';
    const card = el('div', { class: `candidate ${tier}` }, [
      el('div', { class: 'candidate-head' }, [
        el('span', { class: 'candidate-name', text: `${i + 1}. ${item.h.displayName}` }),
        el('span', { class: 'candidate-score', style: { background: bg }, text: `Score: ${item.s}` }),
      ]),
      el('div', { class: 'candidate-meta', text:
        `${item.h.state}  ·  ${item.h.city || '—'}  ·  Cert: ${item.h.strokeCertificationType || 'None'}  ·  Partner: ${item.h.uwPartner ? 'Yes' : 'No'}  ·  ` +
        `CSC/TSC: ${Number.isFinite(item.dA) ? formatMiles(item.dA) + ' mi' : 'N/A'}  ·  EVT: ${Number.isFinite(item.dE) ? formatMiles(item.dE) + ' mi' : 'N/A'}`
      }),
    ]);
    card.addEventListener('click', () => {
      closeModal('expansion-modal');
      panToHospital(item.h.cmsId);
    });
    card.style.cursor = 'pointer';
    container.appendChild(card);
  });
}

// ------------------------------------------------------------------
// Distance matrix
// ------------------------------------------------------------------
function openDistanceMatrix() {
  toggleToolsMenu();
  renderDistanceMatrix();
  openModal('distance-matrix-modal');
}

function renderDistanceMatrix() {
  const sortFns = {
    name: (a, b) => a.displayName.localeCompare(b.displayName),
    state: (a, b) => a.state.localeCompare(b.state) || a.displayName.localeCompare(b.displayName),
    cert: (a, b) => (a.strokeCertificationType || 'ZZZ').localeCompare(b.strokeCertificationType || 'ZZZ'),
    distCSC: (a, b) => (state.distances[a.cmsId]?.nearestAdvancedDistance ?? Infinity) - (state.distances[b.cmsId]?.nearestAdvancedDistance ?? Infinity),
    distEVT: (a, b) => (state.distances[a.cmsId]?.nearestEVTDistance ?? Infinity) - (state.distances[b.cmsId]?.nearestEVTDistance ?? Infinity),
  };
  const fn = sortFns[state.matrixSort.col] || sortFns.name;
  const sorted = [...state.hospitals].sort((a, b) => state.matrixSort.asc ? fn(a, b) : fn(b, a));
  const container = $('#distance-matrix-content');
  clear(container);
  const wrap = el('div', { class: 'matrix-wrap' });
  const table = el('table', { class: 'matrix-table' });
  const thead = el('thead');
  const headerRow = el('tr');
  const cols = [
    ['name', 'Hospital'], ['state', 'State'], ['cert', 'Cert'], [null, 'Partner'],
    [null, 'Nearest CSC/TSC'], ['distCSC', 'mi'], [null, 'Nearest EVT'], ['distEVT', 'mi'],
  ];
  for (const [key, label] of cols) {
    const th = el('th', { text: label });
    if (key) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        if (state.matrixSort.col === key) state.matrixSort.asc = !state.matrixSort.asc;
        else { state.matrixSort.col = key; state.matrixSort.asc = true; }
        renderDistanceMatrix();
      });
      if (state.matrixSort.col === key) {
        th.appendChild(document.createTextNode(state.matrixSort.asc ? ' ▲' : ' ▼'));
      }
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow); table.appendChild(thead);
  const tbody = el('tbody');
  for (const h of sorted) {
    const d = state.distances[h.cmsId] || {};
    const tr = el('tr');
    const dCSC = d.nearestAdvancedDistance > 0 && Number.isFinite(d.nearestAdvancedDistance) ? d.nearestAdvancedDistance.toFixed(0) : '—';
    const dEVT = d.nearestEVTDistance > 0 && Number.isFinite(d.nearestEVTDistance) ? d.nearestEVTDistance.toFixed(0) : '—';
    tr.appendChild(el('td', { text: h.displayName }));
    tr.appendChild(el('td', { text: h.state }));
    tr.appendChild(el('td', { text: h.strokeCertificationType || '—' }));
    tr.appendChild(el('td', { style: { textAlign: 'center' }, text: h.uwPartner ? '✓' : '' }));
    tr.appendChild(el('td', { text: d.nearestAdvancedName || '—' }));
    tr.appendChild(el('td', { class: 'num', text: dCSC }));
    tr.appendChild(el('td', { text: d.nearestEVTName || '—' }));
    tr.appendChild(el('td', { class: 'num', text: dEVT }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody); wrap.appendChild(table);
  container.appendChild(wrap);
}

function exportDistanceMatrixCSV() {
  const rows = [['Hospital', 'State', 'City', 'Certification', 'Certifying Body', 'Telestroke Partner', 'Nearest CSC/TSC', 'Distance CSC/TSC (mi)', 'Ground min', 'Air min', 'Nearest EVT', 'Distance EVT (mi)']];
  for (const h of state.hospitals) {
    const d = state.distances[h.cmsId] || {};
    const dA = Number.isFinite(d.nearestAdvancedDistance) && d.nearestAdvancedDistance > 0 ? d.nearestAdvancedDistance : '';
    const dE = Number.isFinite(d.nearestEVTDistance) && d.nearestEVTDistance > 0 ? d.nearestEVTDistance : '';
    rows.push([
      h.displayName, h.state, h.city || '', h.strokeCertificationType || 'None', h.certifyingBody || '',
      h.uwPartner ? 'Yes' : 'No', d.nearestAdvancedName || '',
      dA === '' ? '' : dA.toFixed(1),
      dA === '' ? '' : groundMinutes(dA),
      dA === '' ? '' : airMinutes(dA),
      d.nearestEVTName || '',
      dE === '' ? '' : dE.toFixed(1),
    ]);
  }
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(csv, `stroke_distance_matrix_${dateStr()}.csv`, 'text/csv');
  toast('Distance matrix exported', 'success');
}

// ------------------------------------------------------------------
// Executive summary
// ------------------------------------------------------------------
function generateExecutiveSummary() {
  toggleToolsMenu();
  const total = state.hospitals.length;
  const by = {
    CSC: state.hospitals.filter(h => h.strokeCertificationType === 'CSC').length,
    TSC: state.hospitals.filter(h => h.strokeCertificationType === 'TSC').length,
    PSC: state.hospitals.filter(h => h.strokeCertificationType === 'PSC').length,
    ASR: state.hospitals.filter(h => h.strokeCertificationType === 'ASR').length,
  };
  const certified = by.CSC + by.TSC + by.PSC + by.ASR;
  const noCert = total - certified;
  const uw = state.hospitals.filter(h => h.uwPartner).length;
  const evt = state.hospitals.filter(h => h.hasELVO).length;
  const deserts = state.hospitals.filter(h => (state.distances[h.cmsId]?.nearestEVTDistance || 0) > 100).length;
  const zero = state.hospitals.filter(h => !h.strokeCertificationType && !h.uwPartner).length;
  const ground60 = state.hospitals.filter(h => {
    const d = state.distances[h.cmsId]?.nearestAdvancedDistance;
    return Number.isFinite(d) && d > 0 && groundMinutes(d) <= 60;
  }).length;
  const air60 = state.hospitals.filter(h => {
    const d = state.distances[h.cmsId]?.nearestAdvancedDistance;
    return Number.isFinite(d) && d > 0 && airMinutes(d) <= 60;
  }).length;

  const byState = (s) => {
    const hs = state.hospitals.filter(h => h.state === s);
    return {
      total: hs.length,
      cert: hs.filter(h => h.strokeCertificationType).length,
      uw: hs.filter(h => h.uwPartner).length,
      evt: hs.filter(h => h.hasELVO).length,
    };
  };

  const lines = [
    'REGIONAL HOSPITAL STROKE CAPABILITIES — EXECUTIVE SUMMARY',
    `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Data last verified: ${state.meta?.verified || 'unknown'}  ·  Schema ${state.meta?.schema}  ·  Version ${state.meta?.version}`,
    '',
    'DATASET SCOPE',
    `  Coverage: WWAMI region (WA, AK, ID, MT, WY)`,
    `  Hospitals tracked: ${total}`,
    `  Note: Dataset is scoped to UW Medicine telestroke planning; includes all verified national stroke-certified hospitals and UW telestroke partners.`,
    '',
    'CERTIFICATION DISTRIBUTION',
    `  CSC (Comprehensive):      ${by.CSC}`,
    `  TSC (Thrombectomy-Capable): ${by.TSC}`,
    `  PSC (Primary):            ${by.PSC}`,
    `  ASR (Acute Stroke Ready): ${by.ASR}`,
    `  No national certification: ${noCert} (${(noCert/total*100).toFixed(1)}%)`,
    `  EVT-capable (24/7 thrombectomy): ${evt}`,
    '',
    'TELESTROKE NETWORK',
    `  Telestroke partners: ${uw} (${(uw/total*100).toFixed(1)}%)`,
    `  Zero-capability hospitals (no certification AND not a partner): ${zero}`,
    '',
    'TRANSPORT & ACCESS',
    `  Hospitals within 60-min ground transfer of CSC/TSC: ${ground60} (${(ground60/total*100).toFixed(1)}%)`,
    `  Hospitals within 60-min air transfer of CSC/TSC:    ${air60} (${(air60/total*100).toFixed(1)}%)`,
    `  EVT deserts (>100 mi to nearest 24/7 thrombectomy): ${deserts} (${(deserts/total*100).toFixed(1)}%)`,
    '',
    'BY STATE',
    ...['WA','AK','ID','MT','WY'].map(s => {
      const r = byState(s);
      return `  ${s}: ${r.total} hospitals  ·  certified: ${r.cert}  ·  partners: ${r.uw}  ·  EVT: ${r.evt}`;
    }),
    '',
    'METHODS — TRANSPORT ESTIMATES',
    `  Distances: great-circle (haversine). Road-distance approximated as haversine × ${ROAD_FACTOR}.`,
    `  Ground transfer time: road distance ÷ ${GROUND_MPH} mph + ${GROUND_OVERHEAD_MIN} min dispatch/load overhead.`,
    `  Air transfer time: great-circle ÷ ${AIR_MPH} mph + ${AIR_OVERHEAD_MIN} min dispatch/takeoff/landing overhead.`,
    `  These are order-of-magnitude estimates for planning only — not a substitute for live dispatch or OHSU/LifeFlight protocols.`,
    '',
    'DATA SOURCES',
    ...(state.meta?.sources || []).map(s => `  • ${s}`),
    '',
    '— End of summary —',
  ];
  $('#executive-summary-content').textContent = lines.join('\n');
  openModal('executive-summary-modal');
}

function copyExecutiveSummary() {
  const text = $('#executive-summary-content').textContent;
  navigator.clipboard?.writeText(text)
    .then(() => toast('Copied to clipboard', 'success'))
    .catch(() => toast('Copy failed — select & copy manually', 'error'));
}
function downloadExecutiveSummary() {
  downloadBlob($('#executive-summary-content').textContent, `stroke_executive_summary_${dateStr()}.txt`, 'text/plain');
  toast('Summary downloaded', 'success');
}

// ------------------------------------------------------------------
// Exports
// ------------------------------------------------------------------
function exportHospitalsCSV() {
  toggleToolsMenu();
  const rows = [['Name', 'Address', 'City', 'State', 'ZIP', 'Latitude', 'Longitude', 'Cert', 'Certifying Body', 'Certification Details', 'EVT (24/7)', 'Telestroke Partner', 'CMS ID', 'Sources']];
  for (const h of state.hospitals) {
    rows.push([
      h.displayName, titleCase(h.address), h.city || '', h.state, h.zip || '',
      h.latitude, h.longitude,
      h.strokeCertificationType || 'None', h.certifyingBody || '', h.certificationDetails || '',
      h.hasELVO ? 'Yes' : 'No', h.uwPartner ? 'Yes' : 'No', h.cmsId,
      (h.dataSources || []).join('; '),
    ]);
  }
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(csv, `stroke_hospitals_${dateStr()}.csv`, 'text/csv');
  toast('Hospital data exported', 'success');
}

async function exportMapPNG() {
  toggleToolsMenu();
  toast('Preparing map image…');
  if (!window.html2canvas) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.integrity = 'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA==';
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script);
    }).catch(() => { toast('Failed to load export library', 'error'); return; });
  }
  // Hide UI chrome during render
  const toHide = ['#sidebar', '#dashboard', '#tools-fab', '#tools-menu', '.mobile-bar', '.toast-container', '.provenance-bar'];
  const saved = toHide.map(sel => { const el = document.querySelector(sel); return el ? { el, display: el.style.display } : null; }).filter(Boolean);
  for (const s of saved) s.el.style.display = 'none';
  try {
    const canvas = await window.html2canvas(document.getElementById('map'), { useCORS: true, allowTaint: true, scale: window.devicePixelRatio || 1 });
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height + 80;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = '#111827'; ctx.font = `bold ${16 * (out.width/960).toFixed(2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Regional Hospital Stroke Capabilities — WA · AK · ID · MT · WY', out.width / 2, canvas.height + 28);
    ctx.fillStyle = '#6b7280';
    ctx.font = `${12 * (out.width/960).toFixed(2)}px system-ui, sans-serif`;
    ctx.fillText(`${new Date().toLocaleDateString('en-US')}  ·  Data verified ${state.meta?.verified || ''}  ·  github.com/rkalani1/telestroke-expansion-map`, out.width / 2, canvas.height + 54);
    out.toBlob(blob => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `telestroke_map_${dateStr()}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast('Map exported as PNG', 'success');
    });
  } catch (err) {
    console.error(err);
    toast('Map export failed', 'error');
  } finally {
    for (const s of saved) s.el.style.display = s.display;
  }
}

// ------------------------------------------------------------------
// Themes + palette
// ------------------------------------------------------------------
function toggleDarkMap() {
  toggleToolsMenu();
  state.darkMap = !state.darkMap;
  setTileLayer(state.darkMap);
  toast(state.darkMap ? 'Dark tiles' : 'Light tiles');
}
function toggleDarkUI() {
  state.darkUI = !state.darkUI;
  document.documentElement.classList.toggle('dark', state.darkUI);
  localStorage.setItem('stroke-dark', String(state.darkUI));
  toast(state.darkUI ? 'Dark mode on' : 'Light mode on');
  // Re-render to pick up new colors
  drawDonut(); drawStateBars(); drawHistogram();
}
function togglePalette() {
  state.cbPalette = !state.cbPalette;
  document.documentElement.classList.toggle('cb', state.cbPalette);
  localStorage.setItem('stroke-cb', String(state.cbPalette));
  toast(state.cbPalette ? 'Colour-blind palette on' : 'Default palette');
  applyFilters({ skipZoom: true });
  drawDonut(); drawStateBars(); drawHistogram();
}

// ------------------------------------------------------------------
// URL state
// ------------------------------------------------------------------
function saveStateToURL() {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state.activeFilters)) if (v) params.append(k.toLowerCase(), '1');
  if (state.stateFilter !== 'ALL') params.append('state', state.stateFilter);
  if (state.evtDistMin > 0) params.append('evtdist', String(state.evtDistMin));
  if (state.searchTerm) params.append('q', state.searchTerm);
  const c = state.map.getCenter();
  params.append('lat', c.lat.toFixed(4));
  params.append('lng', c.lng.toFixed(4));
  params.append('z', state.map.getZoom());
  if (state.darkUI) params.append('dark', '1');
  if (state.cbPalette) params.append('cb', '1');
  history.replaceState(null, '', '?' + params.toString());
}
function loadStateFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.toString()) return;
  for (const k of ['CSC','TSC','PSC','ASR','EVT','UW']) {
    if (p.has(k.toLowerCase())) {
      state.activeFilters[k] = true;
      const pill = document.querySelector(`.pill[data-filter="${k}"]`);
      if (pill) pill.setAttribute('aria-pressed', 'true');
    }
  }
  if (p.has('state')) { state.stateFilter = p.get('state'); $('#filter-state').value = state.stateFilter; }
  if (p.has('evtdist')) { state.evtDistMin = parseInt(p.get('evtdist'), 10) || 0; $('#filter-evt-distance').value = String(state.evtDistMin); $('#evt-dist-label').textContent = String(state.evtDistMin); }
  if (p.has('q')) { state.searchTerm = p.get('q'); $('#search-input').value = state.searchTerm; }
  if (p.has('dark')) { state.darkUI = true; document.documentElement.classList.add('dark'); }
  if (p.has('cb')) { state.cbPalette = true; document.documentElement.classList.add('cb'); }
  if (p.has('lat') && p.has('lng') && p.has('z')) {
    state.map.setView([parseFloat(p.get('lat')), parseFloat(p.get('lng'))], parseInt(p.get('z'), 10));
  }
  applyFilters({ skipZoom: true });
}
function shareCurrentView() {
  toggleToolsMenu();
  saveStateToURL();
  navigator.clipboard?.writeText(window.location.href)
    .then(() => toast('Shareable URL copied', 'success'))
    .catch(() => toast('URL is in the address bar', 'warning'));
}

// ------------------------------------------------------------------
// Provenance bar + cert info modal content
// ------------------------------------------------------------------
function updateProvenance() {
  const bar = $('#provenance-bar');
  if (!bar || !state.meta) return;
  clear(bar);
  bar.appendChild(document.createTextNode(`Data v${state.meta.version} · verified ${state.meta.verified} · `));
  const link = el('a', { role: 'button', tabindex: '0', text: 'methods' });
  link.addEventListener('click', () => openModal('cert-info-modal'));
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openModal('cert-info-modal'); });
  bar.appendChild(link);
  bar.appendChild(document.createTextNode(' · '));
  const counts = `${state.hospitals.length} hospitals across WA · AK · ID · MT · WY`;
  bar.appendChild(document.createTextNode(counts));
}

// ------------------------------------------------------------------
// Event binding
// ------------------------------------------------------------------
function bindEvents() {
  // Pills
  for (const p of $$('.pill')) {
    p.addEventListener('click', () => togglePill(p.dataset.filter));
  }
  // State filter
  $('#filter-state').addEventListener('change', (e) => {
    state.stateFilter = e.target.value;
    applyFilters();
  });
  // EVT distance slider
  const slider = $('#filter-evt-distance');
  slider.addEventListener('input', (e) => {
    state.evtDistMin = parseInt(e.target.value, 10) || 0;
    $('#evt-dist-label').textContent = String(state.evtDistMin);
    applyFilters();
  });
  // Search
  const search = $('#search-input');
  const mobileSearch = $('#mobile-search-input');
  let searchTimer = null;
  function onSearchInput(val) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchTerm = val;
      applyFilters({ skipZoom: state.searchTerm.length < 2 });
    }, 180);
  }
  search.addEventListener('input', (e) => {
    onSearchInput(e.target.value);
    if (mobileSearch) mobileSearch.value = e.target.value;
  });
  if (mobileSearch) mobileSearch.addEventListener('input', (e) => {
    onSearchInput(e.target.value);
    search.value = e.target.value;
  });

  // Clear
  $('#clear-btn').addEventListener('click', resetAll);

  // Tools FAB
  $('#tools-fab').addEventListener('click', toggleToolsMenu);

  // Tool buttons
  $('#tool-partner').addEventListener('click', togglePartnerNetwork);
  $('#tool-referral').addEventListener('click', toggleReferralPathways);
  $('#tool-distance-map').addEventListener('click', showDistanceMap);
  $('#tool-evt-deserts').addEventListener('click', showEVTDeserts);
  $('#tool-zero-cap').addEventListener('click', showZeroCapability);
  $('#tool-coverage').addEventListener('click', toggleCoverageOverlay);
  $('#tool-expansion').addEventListener('click', openExpansionModal);
  $('#tool-matrix').addEventListener('click', openDistanceMatrix);
  $('#tool-exec-summary').addEventListener('click', generateExecutiveSummary);
  $('#tool-export-csv').addEventListener('click', exportHospitalsCSV);
  $('#tool-export-png').addEventListener('click', exportMapPNG);
  $('#tool-share').addEventListener('click', shareCurrentView);
  $('#tool-dark-map').addEventListener('click', toggleDarkMap);
  $('#tool-dark-ui').addEventListener('click', toggleDarkUI);
  $('#tool-palette').addEventListener('click', togglePalette);
  $('#tool-cert-info').addEventListener('click', () => { toggleToolsMenu(); openModal('cert-info-modal'); });
  $('#tool-reset').addEventListener('click', () => { toggleToolsMenu(); resetAll(); });

  // Dashboard collapse
  $('#dash-close').addEventListener('click', () => $('#dashboard').classList.toggle('collapsed'));

  // Mobile toggles
  $('#mobile-sidebar-btn').addEventListener('click', () => $('#sidebar').classList.toggle('mobile-open'));
  $('#mobile-dash-btn').addEventListener('click', () => $('#dashboard').classList.toggle('mobile-open'));
  $('#sidebar-close-mobile').addEventListener('click', () => $('#sidebar').classList.remove('mobile-open'));
  $('#dashboard-close-mobile').addEventListener('click', () => $('#dashboard').classList.remove('mobile-open'));

  // Modal close buttons + overlay click
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.closeModal; if (id) closeModal(id); else closeAllModals();
  }));
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
    if (state.toolsMenuOpen && !e.target.closest('#tools-menu') && !e.target.closest('#tools-fab')) toggleToolsMenu();
  });

  // Expansion recalc
  for (const id of ['w-noCert','w-notUW','w-farCSC','w-farEVT','w-hasLow']) {
    $('#' + id).addEventListener('change', recalcExpansion);
    $('#' + id).addEventListener('input', recalcExpansion);
  }

  // Export buttons inside modals
  $('#matrix-export-csv').addEventListener('click', exportDistanceMatrixCSV);
  $('#exec-copy').addEventListener('click', copyExecutiveSummary);
  $('#exec-download').addEventListener('click', downloadExecutiveSummary);

  // Keyboard shortcuts (when focus is NOT in an input)
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') { closeAllModals(); if (state.toolsMenuOpen) toggleToolsMenu(); return; }
    if (inField) return;
    if (e.key === '/' || (e.ctrlKey && e.key === 'f')) { e.preventDefault(); $('#search-input').focus(); }
    if (e.key === 'r' || e.key === 'R') resetAll();
    if (e.key === 'd' || e.key === 'D') toggleDarkUI();
    if (e.key === '?') openModal('cert-info-modal');
  });

  // Map moveend -> update URL
  let urlTimer = null;
  if (state.map) {
    state.map.on('moveend zoomend', () => {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(saveStateToURL, 400);
    });
  }
}

// ------------------------------------------------------------------
// Build cert info modal (built once from metadata)
// ------------------------------------------------------------------
function buildCertInfo() {
  const container = $('#cert-info-body');
  if (!container || !state.meta?.certDefs) return;
  clear(container);

  const intro = el('div', { class: 'modal-section' });
  intro.appendChild(el('h3', { text: 'Stroke Certification Levels' }));
  intro.appendChild(el('p', { text: 'Four tiered national certifications exist in the United States. All have equivalent clinical benchmarks across certifying bodies, with minor terminology differences.' }));
  container.appendChild(intro);

  const cards = [
    ['CSC', 'csc'], ['TSC', 'tsc'], ['PSC', 'psc'], ['ASR', 'asr'], ['EVT', 'evt'],
  ];
  for (const [key, cls] of cards) {
    const def = state.meta.certDefs[key];
    if (!def) continue;
    const card = el('div', { class: `cert-card ${cls}` });
    card.appendChild(el('h4', { text: `${key} — ${def.split('—')[0].trim()}` }));
    card.appendChild(el('p', { text: def }));
    container.appendChild(card);
  }

  const bodies = el('div', { class: 'cert-card neutral' });
  bodies.appendChild(el('h4', { text: 'Certifying Bodies' }));
  for (const [name, desc] of Object.entries(state.meta.bodies || {})) {
    const row = el('p', { style: { margin: '3px 0' } });
    row.appendChild(el('strong', { text: name + ': ' }));
    row.appendChild(document.createTextNode(desc));
    bodies.appendChild(row);
  }
  container.appendChild(bodies);

  const methods = el('div', { class: 'cert-card neutral' });
  methods.appendChild(el('h4', { text: 'Transport-Time Methodology' }));
  methods.appendChild(el('p', { text: `Great-circle distances × ${ROAD_FACTOR} for ground road approximation. Ground: ${GROUND_MPH} mph + ${GROUND_OVERHEAD_MIN} min overhead. Air: ${AIR_MPH} mph + ${AIR_OVERHEAD_MIN} min overhead. These are planning estimates only; actual transfer times vary with weather, traffic, staffing, and specific helicopter/fixed-wing assets.` }));
  container.appendChild(methods);

  const sources = el('div', { class: 'cert-card neutral' });
  sources.appendChild(el('h4', { text: `Data Sources (last verified ${state.meta.verified})` }));
  const ul = el('ul', { style: { paddingLeft: '16px', marginTop: '4px' } });
  for (const s of state.meta.sources) ul.appendChild(el('li', { style: { fontSize: '12px' }, text: s }));
  sources.appendChild(ul);
  if (state.meta.coverage) {
    sources.appendChild(el('p', { style: { marginTop: '8px', fontSize: '12px', fontStyle: 'italic' }, text: state.meta.coverage }));
  }
  container.appendChild(sources);
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
async function boot() {
  // Pre-apply persisted UI preferences
  if (localStorage.getItem('stroke-dark') === 'true') {
    state.darkUI = true; document.documentElement.classList.add('dark');
  }
  if (localStorage.getItem('stroke-cb') === 'true') {
    state.cbPalette = true; document.documentElement.classList.add('cb');
  }
  try {
    await loadData();
    initMap();
    bindEvents();
    buildCertInfo();
    loadStateFromURL();
    applyFilters({ skipZoom: true });
    state.initialized = true;
    toast(`Loaded ${state.hospitals.length} hospitals`, 'success');
  } catch (err) {
    console.error('Boot failed:', err);
    toast('Boot error — check console', 'error', 6000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
