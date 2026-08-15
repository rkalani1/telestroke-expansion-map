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
// Air (fixed-wing / rotor-wing air-medical): ~150 mph blended
// Road factor: haversine distance * 1.25 to approximate road network
const ROAD_FACTOR = 1.25;
const GROUND_MPH = 55;
const AIR_MPH = 150;
const AIR_OVERHEAD_MIN = 25;    // dispatch + takeoff + landing
const GROUND_OVERHEAD_MIN = 8;  // dispatch + load
const NEEDLE_TARGET_MIN = 60;    // AHA door-to-needle goal
const PUNCTURE_TARGET_MIN = 90;  // AHA door-to-puncture goal (transfer case)
const PUNCTURE_STRETCH_MIN = 120; // AHA "acceptable" stretch target
const DIDO_MIN = 30;             // assumed door-in-door-out at the sending site

// Palette keys map to CSS custom properties so palette toggling works
const CERT_NAMES = {
  CSC: 'Comprehensive Stroke Center',
  TSC: 'Thrombectomy-Capable Stroke Center',
  PSC: 'Primary Stroke Center',
  ASR: 'Acute Stroke Ready',
};

const MARKER_COLOR_VAR = {
  CSC: '--c-csc', TSC: '--c-tsc', PSC: '--c-psc', ASR: '--c-asr',
  EVT: '--c-evt', OTHER: '--c-other',
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
  distances: {},   // keyed by record id -> {nearestAdvanced, nearestEVT, ...}
  filtered: [],    // latest filter output
  activeFilters: { CSC: false, TSC: false, PSC: false, ASR: false, EVT: false, NONE: false, CENSUS: false },
  searchTerm: '',
  stateFilter: 'ALL',
  evtDistMin: 0,
  // Scenario-mode parameters for expansion-candidate scoring.
  // Weights are relative (normalized at compute time); thresholds in miles.
  // Adjusting these NEVER modifies hospitals.json — display-layer only.
  scenario: { wCert: 40, wEvt: 40, wAdv: 20, desertMi: 100, capMi: 200 },
  candidateSort: { col: 'score', asc: false },
  map: null,
  tileLayer: null,
  markers: [],
  overlays: { referral: [], coverage: [] },
  overlayVisible: { referral: false, coverage: false },
  darkMap: false,
  darkUI: false,
  cbPalette: false,
  toolsMenuOpen: false,
  activeHospitalIndex: 0,
  mapModeActive: false,
  mobilePanel: null,
  mobilePanelOpener: null,
  mobileTrapHandler: null,
  dashboardViewBeforeOpen: null,
  matrixSort: { col: 'name', asc: true },
  initialized: false,
  queryModeActive: false,
  queryPaths: [],
  queryPopup: null,
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

// Leaflet parses string tooltip/popup content as HTML — always hand it DOM
// nodes so dataset fields can never inject markup.
function tooltipNode(parts) {
  const span = el('span');
  for (const p of (Array.isArray(parts) ? parts : [parts])) {
    if (p == null) continue;
    span.appendChild(typeof p === 'string' ? document.createTextNode(p) : p);
  }
  return span;
}

// Keep-uppercase tokens. Street directionals and PO live here because
// titleCase also formats addresses — without them "2500 NE Sunset Blvd"
// becomes "2500 Ne Sunset Blvd".
const TITLE_ACRONYMS = new Set([
  'AMC', 'UW', 'VA', 'CHI', 'DNV', 'CMS', 'OHSU', 'EIRMC', 'ER', 'ICU', 'NICU',
  'ECU', 'ED', 'USA', 'US', 'CAH', 'PHS', 'SEARHC', 'HCA',
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'PO',
]);
// Lowercased when they are not the first word.
const TITLE_PARTICLES = new Set(['of', 'at', 'the', 'and', 'for', 'in', 'on']);

function titleCase(str) {
  if (!str) return '';
  // A blanket "uppercase anything <= 2 chars" rule shouted 32 of 236 facility
  // names — "ST Luke's", "Community Hospital OF Anaconda", "Big Horn CO
  // Memorial" — because it fired on ST, OF and CO. Directionals are handled by
  // the acronym set above instead.
  return str.split(/\s+/).map((w, i) => {
    const upper = w.toUpperCase();
    if (TITLE_ACRONYMS.has(upper)) return upper;
    const lower = w.toLowerCase();
    if (i > 0 && TITLE_PARTICLES.has(lower)) return lower;
    if (w.includes('-')) return w.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ').replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());
}

// Search normalization. A clinician types what they say, and the dataset spells
// it however CMS does: "st alphonsus" found nothing while "saint alphonsus"
// found two, and "st. pete's" found nothing despite that alias existing. A zero
// at 2am reads as "this hospital is not in the network", which is the wrong
// conclusion to hand someone.
function normalizeSearch(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[.'\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\bhosp\b/g, 'hospital')
    .replace(/\bmed\b/g, 'medical')
    .replace(/\bctr\b/g, 'center')
    .replace(/\bcentre\b/g, 'center')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesToken(haystack, token) {
  if (!token) return true;
  return haystack === token
    || haystack.startsWith(token + ' ')
    || haystack.includes(' ' + token);
}

// Relevance for the sidebar order while a search is active. Without it a query
// is ordered by certification tier, so the hospital the clinician typed can sit
// below a dozen higher-tier partial matches.
function searchRank(h, query, tokens) {
  const name = h.nameIndex || '';
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(' ' + query)) return 2;
  if (name.includes(query)) return 3;
  if (tokens.every(t => matchesToken(name, t))) return 4;
  return 5;
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
function bestTransportMinutes(mi, airOnly = false) {
  if (airOnly) return airMinutes(mi);
  // Ground wins only under ~18 mi. Air's 150 mph against an effective 44 mph
  // great-circle ground speed overtakes its 17-minute overhead head start
  // almost immediately, so "best" is a helicopter for most of this region.
  return Math.min(groundMinutes(mi), airMinutes(mi));
}

// Which mode "best" actually is, so a bare minute count never hides the fact
// that it assumes an air asset is available and flying.
function bestTransportMode(mi, airOnly = false) {
  if (airOnly) return 'air';
  return airMinutes(mi) < groundMinutes(mi) ? 'air' : 'ground';
}

function bestTransportText(mi, airOnly = false) {
  return `~${bestTransportMinutes(mi, airOnly)} min (${bestTransportMode(mi, airOnly)})`;
}

// Ground is not an option for records with no road connection; printing a
// plausible-looking ambulance time for them is worse than printing none.
function transportLine(mi, airOnly = false) {
  const ground = airOnly
    ? 'ground not feasible (no road connection)'
    : `~${groundMinutes(mi)} min ground`;
  return `${ground} / ~${airMinutes(mi)} min air (${formatMiles(mi)} mi)`;
}

// One source of truth for the door-to-puncture verdict, shared by the sentence
// and the bar beneath it — they previously used different thresholds against
// different quantities and disagreed for anything in the 91-120 min band.
function punctureStatus(totalMin) {
  if (totalMin <= PUNCTURE_TARGET_MIN) return { varName: '--status-ontarget', label: 'on target' };
  if (totalMin <= PUNCTURE_STRETCH_MIN) return { varName: '--status-stretch', label: 'stretch' };
  return { varName: '--status-over', label: 'over target' };
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
  state.meta.recordClasses = payload.record_classes || {};
  state.meta.censusSnapshot = payload.census_snapshot || null;
  state.hospitals = (payload.hospitals || [])
    .filter(h => h.latitude && h.longitude)
    .map(h => {
      const rec = { ...h, displayName: titleCase(h.name), isCensus: h.recordClass === 'acute-care-census' };
      // Search haystack is built once, not rebuilt per keystroke across 236
      // records. Includes the shorthand a clinician actually says out loud
      // ("Harborview", "HMC") plus county and health system.
      rec.nameIndex = normalizeSearch([rec.displayName, h.name, ...(h.aliases || [])].join(' '));
      rec.searchIndex = normalizeSearch([
        rec.displayName, h.name, ...(h.aliases || []),
        h.address, h.city, h.county, h.state, h.zip,
        h.healthSystem, h.strokeCertificationType, h.certifyingBody,
        h.stateDesignation?.label, h.hospitalType,
        h.hasELVO ? 'EVT thrombectomy' : '',
        rec.isCensus ? 'census not assessed' : '',
      ].filter(Boolean).join(' '));
      return rec;
    });
  // Census records carry no assessed stroke capability, so they can never be a
  // hub. Guarding here keeps them out of every nearest-centre calculation.
  advancedCenters = state.hospitals.filter(h => !h.isCensus
    && (h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC'));
  evtCenters = state.hospitals.filter(h => !h.isCensus && h.hasELVO === true);
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
      if (c.id === h.id) continue;
      const dist = haversineMi(h.latitude, h.longitude, c.latitude, c.longitude);
      if (dist < d.nearestAdvancedDistance) {
        d.nearestAdvancedDistance = dist;
        d.nearestAdvanced = c; d.nearestAdvancedName = c.displayName;
      }
    }
    for (const c of evtCenters) {
      if (c.id === h.id) continue;
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
    state.distances[h.id] = d;
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
  state.markerLayer = L.layerGroup().addTo(state.map);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  state.map.on('click', (e) => {
    if (!state.queryModeActive) return;

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    // Find nearest CSC/TSC
    let nearestAdvanced = null;
    let nearestAdvancedDist = Infinity;
    for (const c of advancedCenters) {
      const dist = haversineMi(lat, lng, c.latitude, c.longitude);
      if (dist < nearestAdvancedDist) {
        nearestAdvancedDist = dist;
        nearestAdvanced = c;
      }
    }

    // Find nearest EVT center
    let nearestEVT = null;
    let nearestEVTDist = Infinity;
    for (const c of evtCenters) {
      const dist = haversineMi(lat, lng, c.latitude, c.longitude);
      if (dist < nearestEVTDist) {
        nearestEVTDist = dist;
        nearestEVT = c;
      }
    }

    clearQueryPath();
    state.queryPaths = [];

    if (nearestAdvanced) {
      const pathCSC = L.polyline([[lat, lng], [nearestAdvanced.latitude, nearestAdvanced.longitude]], {
        color: '#4f46e5',
        weight: 2,
        opacity: 0.75,
        dashArray: '4,6'
      }).addTo(state.map);
      state.queryPaths.push(pathCSC);
    }
    if (nearestEVT && nearestEVT.id !== nearestAdvanced?.id) {
      const pathEVT = L.polyline([[lat, lng], [nearestEVT.latitude, nearestEVT.longitude]], {
        color: cssVar('--c-evt') || '#0d9488',
        weight: 2,
        opacity: 0.75,
        dashArray: '2,4'
      }).addTo(state.map);
      state.queryPaths.push(pathEVT);
    }

    const wrap = el('div', { style: { minWidth: '280px', fontSize: '12.5px' } });
    wrap.appendChild(el('h3', { style: { color: cssVar('--accent'), marginBottom: '8px' }, text: 'Custom Location Coverage' }));

    const info = el('div', { style: { lineHeight: '1.5' } });
    info.appendChild(el('div', { style: { marginBottom: '6px', color: cssVar('--text-muted'), fontSize: '11px' }, text: `Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}` }));

    if (nearestAdvanced) {
      const advBox = el('div', { style: { marginBottom: '8px', padding: '6px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' } });
      advBox.appendChild(el('strong', { text: 'Nearest CSC/TSC: ' }));
      const hopLink = el('button', {
        class: 'btn-inline-link',
        type: 'button',
        text: nearestAdvanced.displayName,
        onclick: () => {
          state.map.closePopup();
          panToHospital(nearestAdvanced.id);
          showHospitalDetail(nearestAdvanced);
        }
      });
      advBox.appendChild(hopLink);
      advBox.appendChild(el('br'));
      advBox.appendChild(document.createTextNode(`Distance: ${formatMiles(nearestAdvancedDist)} mi`));
      advBox.appendChild(el('br'));
      advBox.appendChild(document.createTextNode(`Est. Transport: ~${bestTransportMinutes(nearestAdvancedDist)} min (~${groundMinutes(nearestAdvancedDist)}m ground / ~${airMinutes(nearestAdvancedDist)}m air)`));
      info.appendChild(advBox);
    }

    if (nearestEVT) {
      const evtBox = el('div', { style: { padding: '6px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' } });
      evtBox.appendChild(el('strong', { text: 'Nearest EVT Center: ' }));
      const hopEVTLink = el('button', {
        class: 'btn-inline-link',
        type: 'button',
        text: nearestEVT.displayName,
        onclick: () => {
          state.map.closePopup();
          panToHospital(nearestEVT.id);
          showHospitalDetail(nearestEVT);
        }
      });
      evtBox.appendChild(hopEVTLink);
      evtBox.appendChild(el('br'));
      evtBox.appendChild(document.createTextNode(`Distance: ${formatMiles(nearestEVTDist)} mi`));
      evtBox.appendChild(el('br'));
      evtBox.appendChild(document.createTextNode(`Est. Transport: ~${bestTransportMinutes(nearestEVTDist)} min (~${groundMinutes(nearestEVTDist)}m ground / ~${airMinutes(nearestEVTDist)}m air)`));
      info.appendChild(evtBox);
    }

    const btnRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } });
    const fitViewBtn = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      style: { flex: 1, padding: '4px 8px', fontSize: '11px', textAlign: 'center', justifyContent: 'center' },
      text: '🔍 Fit View',
      onclick: () => {
        const boundsPoints = [[lat, lng]];
        if (nearestAdvanced) boundsPoints.push([nearestAdvanced.latitude, nearestAdvanced.longitude]);
        if (nearestEVT) boundsPoints.push([nearestEVT.latitude, nearestEVT.longitude]);
        state.map.fitBounds(L.latLngBounds(boundsPoints), { padding: [50, 50] });
      }
    });
    const exitBtn = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      style: { flex: 1, padding: '4px 8px', fontSize: '11px', textAlign: 'center', justifyContent: 'center' },
      text: 'Exit Query',
      onclick: () => {
        toggleQueryMode();
      }
    });
    btnRow.appendChild(fitViewBtn);
    btnRow.appendChild(exitBtn);

    wrap.appendChild(info);
    wrap.appendChild(btnRow);

    state.queryPopup = L.popup()
      .setLatLng(e.latlng)
      .setContent(wrap)
      .openOn(state.map);

    state.queryPopup.on('remove', () => {
      clearQueryPath();
    });
  });

  const LegendControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'map-legend');
      const items = [
        ['--c-csc', 'CSC', 'CSC'],
        ['--c-tsc', 'TSC', 'TSC'],
        ['--c-psc', 'PSC', 'PSC'],
        ['--c-asr', 'ASR', 'ASR'],
        ['--c-evt', 'EVT', 'EVT'],
      ];
      // Both remaining classes now have toggle pills, so every legend entry is
      // clickable — and "not assessed" gets its own hollow swatch matching the
      // marker style rather than being folded into a vague "Other".
      items.push(['--c-other', 'None', 'NONE']);
      items.push(['--c-census', 'Not assessed', 'CENSUS']);
      for (const [v, label, filterKey] of items) {
        const dot = el('span', { class: 'legend-dot', style: { background: cssVar(v) } });
        if (filterKey === 'CENSUS') {
          dot.style.background = 'transparent';
          dot.style.border = `2px dashed ${cssVar('--c-census')}`;
        }
        if (filterKey === 'EVT') {
          // No marker is ever solid teal — EVT is drawn as a ring around the
          // tier colour, so the key has to be a ring too.
          dot.style.background = cssVar('--surface-solid');
          dot.style.border = `3px solid ${cssVar('--c-evt')}`;
        }
        const entry = el('button', {
          class: 'entry-btn',
          type: 'button',
          'aria-label': `Toggle ${label} filter`,
          title: filterKey === 'CENSUS'
            ? 'Acute-care census records — stroke capability not assessed'
            : filterKey === 'NONE' ? 'Checked — no stroke certification on record' : undefined,
          onclick: () => togglePill(filterKey),
        }, [dot, document.createTextNode(label)]);
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
// An aria-label overrides the whole subtree for name computation, so the city,
// the tier badge, the "state only" qualifier, the "Not assessed" marker and the
// EVT badge were all silently dropped for screen-reader users. Compose the name
// from the same facts the row displays.
function rowAccessibleName(h) {
  const parts = [h.displayName];
  const place = [h.city, h.state].filter(Boolean).join(', ');
  if (place) parts.push(place);
  if (h.isCensus) {
    parts.push('stroke capability not assessed');
  } else if (h.strokeCertificationType) {
    parts.push(CERT_NAMES[h.strokeCertificationType] || h.strokeCertificationType);
    if (h.certificationBasis === 'state') {
      parts.push(`${h.stateDesignation ? h.stateDesignation.label : 'state designation'} only, no national accreditation`);
    }
  } else {
    parts.push('no certification on record');
  }
  parts.push(h.hasELVO ? '24/7 thrombectomy' : (h.isCensus ? '' : 'no 24/7 thrombectomy'));
  return parts.filter(Boolean).join(', ');
}

function markerColor(h) {
  if (h.isCensus) return cssVar('--c-census');
  if (h.strokeCertificationType && MARKER_COLOR_VAR[h.strokeCertificationType]) {
    return cssVar(MARKER_COLOR_VAR[h.strokeCertificationType]);
  }
  return cssVar('--c-other');
}
function markerSize(h) {
  if (h.isCensus) return 5;
  const sizes = { CSC: 14, TSC: 12, PSC: 10, ASR: 8 };
  return sizes[h.strokeCertificationType] || 7;
}

function defaultMarkerStyle(h) {
  // Census records render hollow so "capability unknown" never reads as a
  // filled marker whose colour implies an assessed tier.
  if (h.isCensus) {
    return {
      fillColor: cssVar('--surface'),
      color: cssVar('--c-census'),
      weight: 2,
      opacity: 1,
      fillOpacity: 1,
      dashArray: '2,2',
    };
  }
  // 24/7 thrombectomy gets its own channel. Tier colour was an accidental proxy
  // for 18 of the 22 EVT centres, but the four PSC-tier ones were pixel-
  // identical to the 41 PSCs without it — and those rural regional centres are
  // exactly what a fly-past-the-nearest-hospital decision turns on.
  return {
    fillColor: markerColor(h),
    color: h.hasELVO ? cssVar('--c-evt') : 'white',
    weight: h.hasELVO ? 4 : 2,
    opacity: 1,
    fillOpacity: 0.85,
    dashArray: null,
  };
}

// Markers are created once per hospital and reused across every filter
// change / analysis view — only style + layer membership change afterwards.
// Popup content builds lazily on open instead of 132× per re-render.
function buildMarkerCache() {
  state.markerCache = new Map();
  for (const h of state.hospitals) {
    const marker = L.circleMarker([h.latitude, h.longitude], {
      radius: markerSize(h), ...defaultMarkerStyle(h),
    });
    marker.bindPopup(() => buildPopupContent(h), { maxWidth: 320 });
    marker.on('click', (e) => {
      if (e.originalEvent) e.originalEvent.stopPropagation();
      panToHospital(h.id);
      showHospitalDetail(h);
    });
    marker.on('mouseover', () => {
      const item = document.querySelector(`.hospital-item[data-cms="${h.id}"]`);
      if (item) item.classList.add('hover-highlight');
      highlightMarker(h.id, true);
    });
    marker.on('mouseout', () => {
      const item = document.querySelector(`.hospital-item[data-cms="${h.id}"]`);
      if (item) item.classList.remove('hover-highlight');
      highlightMarker(h.id, false);
    });
    marker.hospitalId = h.id;
    state.markerCache.set(h.id, marker);
  }
}

function showMarker(h, style, radius) {
  const marker = state.markerCache.get(h.id);
  if (!marker) return;
  delete marker._originalStyle; // reset hover-highlight baseline
  marker.setStyle(style);
  marker.setRadius(radius);
  state.markerLayer.addLayer(marker);
  state.markers.push(marker);
}

function renderMarkers(hospitals) {
  state.markerLayer.clearLayers();
  state.markers = [];
  for (const h of hospitals) {
    showMarker(h, defaultMarkerStyle(h), markerSize(h));
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
  if (h.address) line('Address:', `${titleCase(h.address)}`);
  line('', [h.city, h.state, h.zip].filter(Boolean).join(', '));
  if (h.hospitalType) {
    line('Facility:', [h.hospitalType, h.beds ? `${h.beds} beds` : null].filter(Boolean).join(' · '));
  }
  if (h.isCensus) {
    const warn = el('strong', { style: { color: cssVar('--c-census') }, text: 'Stroke capability not assessed' });
    meta.appendChild(warn);
    meta.appendChild(document.createElement('br'));
    meta.appendChild(el('span', { style: { fontSize: '11px', color: cssVar('--text-muted') },
      text: 'Census record — no certification on file does not mean none exists.' }));
    meta.appendChild(document.createElement('br'));
  } else if (h.strokeCertificationType) {
    line('Certification:', `${CERT_NAMES[h.strokeCertificationType]} (${h.strokeCertificationType})`);
    line(h.certificationBasis === 'state' ? 'State designation:' : 'Certifying body:',
      h.stateDesignation && h.certificationBasis === 'state'
        ? h.stateDesignation.label
        : h.certifyingBody);
    if (h.certificationBasis === 'state') {
      meta.appendChild(el('span', { style: { fontSize: '11px', color: cssVar('--text-muted') },
        text: 'State designation only — no national accreditation on record.' }));
      meta.appendChild(document.createElement('br'));
    }
  } else {
    line('Certification:', 'None on record (checked)');
  }
  if (h.hasELVO) {
    const s = el('strong', { style: { color: cssVar('--c-evt') }, text: '24/7 Thrombectomy (EVT)' });
    meta.appendChild(s); meta.appendChild(document.createElement('br'));
  }

  const d = state.distances[h.id];
  // The nearest thrombectomy centre is the question this tool exists to answer
  // fastest; it used to require opening the modal and scrolling inside it.
  if (d && Number.isFinite(d.nearestEVTDistance)) {
    meta.appendChild(document.createElement('br'));
    if (d.nearestEVTDistance === 0) {
      const s = el('strong', { style: { color: cssVar('--c-evt') }, text: '24/7 EVT on site' });
      meta.appendChild(s);
      meta.appendChild(document.createElement('br'));
    } else {
      line(d.nearestAdvanced && d.nearestEVT && d.nearestAdvanced.id === d.nearestEVT.id
        ? 'Nearest CSC/TSC + EVT:' : 'Nearest EVT:', d.nearestEVTName);
      meta.appendChild(document.createTextNode(
        `${transportLine(d.nearestEVTDistance, h.airOnly)} · best ${bestTransportText(d.nearestEVTDistance, h.airOnly)}`));
      meta.appendChild(document.createElement('br'));
    }
  }
  const sameTarget = d && d.nearestEVT && d.nearestAdvanced && d.nearestEVT.id === d.nearestAdvanced.id;
  if (d && !sameTarget && d.nearestAdvancedDistance > 0 && Number.isFinite(d.nearestAdvancedDistance)) {
    meta.appendChild(document.createElement('br'));
    line('Nearest CSC/TSC:', d.nearestAdvancedName);
    const miles = d.nearestAdvancedDistance;
    meta.appendChild(document.createTextNode(transportLine(miles, h.airOnly)));
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
  // Every token must match somewhere, rather than one contiguous run — so
  // "alphonsus nampa" finds the record whose name interleaves the two.
  const searchTokens = normalizeSearch(state.searchTerm).split(' ').filter(Boolean);

  const filtered = state.hospitals.filter(h => {
    // Tokens match at word boundaries. A bare substring test let the one-letter
    // token in "St V" match any record containing a "v" anywhere, turning a
    // 2-result query into 30.
    if (searchTokens.length && !searchTokens.every(t => matchesToken(h.searchIndex, t))) return false;
    if (state.stateFilter !== 'ALL' && h.state !== state.stateFilter) return false;
    if (state.evtDistMin > 0) {
      const dist = state.distances[h.id]?.nearestEVTDistance || 0;
      if (!Number.isFinite(dist) || dist < state.evtDistMin || dist === 0) return false;
    }
    if (anyPill) {
      let pass = false;
      if (state.activeFilters.CSC && h.strokeCertificationType === 'CSC') pass = true;
      if (state.activeFilters.TSC && h.strokeCertificationType === 'TSC') pass = true;
      if (state.activeFilters.PSC && h.strokeCertificationType === 'PSC') pass = true;
      if (state.activeFilters.ASR && h.strokeCertificationType === 'ASR') pass = true;
      if (state.activeFilters.EVT && h.hasELVO) pass = true;
      // "None" means we checked and found no certification. Census records were
      // never checked, so they answer to their own pill instead.
      if (state.activeFilters.NONE && !h.strokeCertificationType && !h.isCensus) pass = true;
      if (state.activeFilters.CENSUS && h.isCensus) pass = true;
      if (!pass) return false;
    }
    return true;
  });
  state.filtered = filtered;
  state.searchNormalized = searchTokens.join(' ');
  state.searchTokens = searchTokens;

  renderMarkers(filtered);
  renderList(filtered);
  renderStatus(filtered);
  renderDashboard(filtered);
  renderClearButton();
  scheduleURLSave();

  // Zoom to fit when a meaningful subset is active
  const meaningful = anyPill || state.stateFilter !== 'ALL' || searchTokens.length > 0 || state.evtDistMin > 0;
  if (!skipZoom && meaningful && filtered.length > 0 && filtered.length < state.hospitals.length) {
    const bounds = L.latLngBounds(filtered.map(h => [h.latitude, h.longitude]));
    const dashboardOpen = window.innerWidth > 768 && !$('#dashboard')?.classList.contains('collapsed');
    state.map.fitBounds(bounds, dashboardOpen
      ? {
          paddingTopLeft: [Math.min(380, Math.round(window.innerWidth * 0.34)), 48],
          paddingBottomRight: [Math.min(340, Math.round(window.innerWidth * 0.31)), 48],
          maxZoom: 10
        }
      : { padding: [48, 48], maxZoom: 10 });
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
  state.scenario = { ...SCENARIO_DEFAULTS };
  syncScenarioControls();
  if ($('#candidates-modal')?.classList.contains('active')) renderCandidates();
  clearOverlays();
  state.map.setView(MAP_CENTER, MAP_ZOOM);
  applyFilters({ skipZoom: true });
  toast('All filters cleared');
}

function clearSearchOnly() {
  state.searchTerm = '';
  $('#search-input').value = '';
  const mobileSearch = $('#mobile-search-input');
  if (mobileSearch) mobileSearch.value = '';
  applyFilters({ skipZoom: true });
  if (state.filtered.length) {
    const bounds = L.latLngBounds(state.filtered.map(h => [h.latitude, h.longitude]));
    state.map.fitBounds(bounds, { padding: [48, 48], maxZoom: MAP_ZOOM });
  } else {
    state.map.setView(MAP_CENTER, MAP_ZOOM);
  }
  mobileSearch?.focus();
}

function renderClearButton() {
  const any = Object.values(state.activeFilters).some(v => v)
    || state.stateFilter !== 'ALL' || state.evtDistMin > 0 || state.searchTerm;
  $('#clear-btn').classList.toggle('hidden', !any);
  // Previously shown only when a query was present, and bound to clearSearchOnly
  // — so with a stale pill on, clearing the query reproduced the same empty
  // result and the cause stayed hidden behind an unopened drawer.
  const mobileClear = $('#mobile-clear-search');
  if (mobileClear) {
    mobileClear.classList.toggle('hidden', !any);
    const otherFilters = any && !(state.searchTerm && Object.values(state.activeFilters).every(v => !v)
      && state.stateFilter === 'ALL' && state.evtDistMin === 0);
    mobileClear.textContent = otherFilters ? 'Clear all' : 'Clear';
    mobileClear.dataset.clearAll = otherFilters ? 'true' : 'false';
  }
}

// ------------------------------------------------------------------
// Sidebar list
// ------------------------------------------------------------------
function renderStatus(filtered) {
  $('#status-bar').textContent = `Showing ${filtered.length} of ${state.hospitals.length} hospitals`;
  $('#list-count').textContent = filtered.length;
  const mobileStatus = $('#mobile-search-status');
  if (mobileStatus) {
    const query = state.searchTerm.trim();
    mobileStatus.textContent = filtered.length === 0
      ? `No hospitals match “${query || 'these filters'}”.`
      : query
        ? `${filtered.length} ${filtered.length === 1 ? 'hospital' : 'hospitals'} match “${query}”.`
        : `${filtered.length} of ${state.hospitals.length} records shown.`;
    mobileStatus.classList.toggle('is-empty', filtered.length === 0);
  }
}

function renderList(filtered) {
  const list = $('#hospital-list');
  const previouslyActive = document.activeElement?.dataset?.cms || null;
  clear(list);
  if (filtered.length === 0) {
    state.activeHospitalIndex = 0;
    list.appendChild(el('div', { class: 'empty-state', role: 'listitem', text: 'No hospitals match your filters. Try clearing filters.' }));
    return;
  }
  const order = { CSC: 0, TSC: 1, PSC: 2, ASR: 3 };
  const q = state.searchNormalized || '';
  const tokens = state.searchTokens || [];
  const sorted = [...filtered].sort((a, b) => {
    if (q) {
      const ra = searchRank(a, q, tokens);
      const rb = searchRank(b, q, tokens);
      if (ra !== rb) return ra - rb;
    }
    const oa = order[a.strokeCertificationType] ?? 4;
    const ob = order[b.strokeCertificationType] ?? 4;
    return oa - ob || a.displayName.localeCompare(b.displayName);
  });
  const preservedIndex = previouslyActive
    ? sorted.findIndex(h => h.id === previouslyActive)
    : state.activeHospitalIndex;
  state.activeHospitalIndex = Math.max(0, Math.min(sorted.length - 1, preservedIndex >= 0 ? preservedIndex : 0));

  sorted.forEach((h, index) => {
    const color = markerColor(h);
    const location = [h.city, h.state].filter(Boolean).join(', ');
    const badges = el('div', { class: 'badges' });
    if (h.isCensus) {
      badges.appendChild(el('span', { class: 'badge badge-CENSUS', text: 'Not assessed' }));
    } else if (h.strokeCertificationType) {
      badges.appendChild(el('span', { class: `badge badge-${h.strokeCertificationType}`, text: h.strokeCertificationType }));
      // A state-only designation is marked so the tier badge is never mistaken
      // for national accreditation at list-scan speed.
      if (h.certificationBasis === 'state') {
        badges.appendChild(el('span', {
          class: 'badge badge-STATE',
          text: h.stateDesignation ? h.stateDesignation.label : 'state only',
          title: 'State designation only — no national accreditation on record',
        }));
      }
    }
    if (h.hasELVO) badges.appendChild(el('span', { class: 'badge badge-EVT', text: 'EVT' }));


    const content = el('div', { style: { flex: 1, minWidth: 0 } }, [
      el('div', { class: 'name', text: h.displayName }),
      el('div', { class: 'meta', text: location + (h.zip ? ' ' + h.zip : '') }),
      badges,
    ]);
    const item = el('button', {
      class: 'hospital-item', type: 'button', tabindex: index === state.activeHospitalIndex ? '0' : '-1',
      'aria-label': rowAccessibleName(h), dataset: { cms: h.id, index: String(index) },
    }, [
      el('span', { class: 'dot', 'aria-hidden': 'true', style: { background: color } }),
      content,
    ]);
    // Matches the map-marker behaviour. Previously a list click only panned the
    // map, so the full record was reachable only by then hunting for the marker.
    item.addEventListener('click', () => { panToHospital(h.id); showHospitalDetail(h); });
    item.addEventListener('mouseenter', () => highlightMarker(h.id, true));
    item.addEventListener('mouseleave', () => highlightMarker(h.id, false));
    item.addEventListener('focus', () => {
      state.activeHospitalIndex = index;
      $$('.hospital-item').forEach((button, buttonIndex) => {
        button.tabIndex = buttonIndex === index ? 0 : -1;
      });
    });
    item.addEventListener('keydown', (event) => {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const buttons = $$('.hospital-item');
      if (!buttons.length) return;
      let next = index;
      if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, index + 1);
      if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      state.activeHospitalIndex = next;
      buttons.forEach((button, buttonIndex) => { button.tabIndex = buttonIndex === next ? 0 : -1; });
      buttons[next].focus();
    });
    // The container is role="list" — each entry needs listitem semantics
    list.appendChild(el('div', { role: 'listitem' }, [item]));
  });
}

function panToHospital(id) {
  const h = state.hospitals.find(x => x.id === id);
  if (!h) return;
  state.map.setView([h.latitude, h.longitude], 12);
  const marker = state.markers.find(m => m.hospitalId === id);
  if (marker) marker.openPopup();
  $$('.hospital-item').forEach(e => e.classList.remove('highlighted'));
  const item = document.querySelector(`.hospital-item[data-cms="${id}"]`);
  if (item) { item.classList.add('highlighted'); item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  // Auto-close mobile sidebar on selection
  if (window.innerWidth <= 768) {
    closeMobilePanel('sidebar');
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
  const censusCount = state.hospitals.filter(h => h.isCensus).length;
  const none = state.hospitals.length - counts.CSC - counts.TSC - counts.PSC - counts.ASR - censusCount;
  const total = state.hospitals.length;
  const segs = [
    { label: 'CSC', count: counts.CSC, color: cssVar('--c-csc') },
    { label: 'TSC', count: counts.TSC, color: cssVar('--c-tsc') },
    { label: 'PSC', count: counts.PSC, color: cssVar('--c-psc') },
    { label: 'ASR', count: counts.ASR, color: cssVar('--c-asr') },
    { label: 'None', count: none, color: cssVar('--c-other') || '#d1d5db' },
    { label: 'Not assessed', count: censusCount, color: cssVar('--c-census') },
  ];
  // The ring must account for every record, or it reads as a complete picture
  // of a dataset it only partly covers.
  const canvasEl = $('#donut-chart');
  if (canvasEl) {
    canvasEl.setAttribute('aria-label',
      'Certification distribution across ' + total + ' hospitals: '
      + segs.filter(s => s.count > 0).map(s => `${s.count} ${s.label}`).join(', '));
  }
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
    const censusCount = hs.filter(h => h.isCensus).length;
    const none = hs.length - buckets.CSC - buckets.TSC - buckets.PSC - buckets.ASR - censusCount;
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
    if (none > 0) track.appendChild(el('span', { style: { width: widthPct(none), background: cssVar('--c-other') || '#d1d5db' }, title: `None: ${none}` }));
    if (censusCount > 0) track.appendChild(el('span', { style: { width: widthPct(censusCount), background: cssVar('--c-census') }, title: `Not assessed: ${censusCount}` }));
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
  const desertMi = state.scenario.desertMi;
  const metrics = [
    { label: 'No certification (checked)', value: src.filter(h => !h.strokeCertificationType && !h.isCensus).length, color: '#ef4444' },
    { label: 'Capability not assessed', value: src.filter(h => h.isCensus).length, color: cssVar('--c-census') },
    { label: `EVT desert (>${desertMi} mi)`, value: src.filter(h => (state.distances[h.id]?.nearestEVTDistance || 0) > desertMi).length, color: '#f59e0b' },
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
    const d = state.distances[h.id]?.nearestEVTDistance;
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
    const color = i >= 4 ? cssVar('--c-csc') : i >= 3 ? cssVar('--c-psc') : cssVar('--c-evt');
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
function buildTargetProgressBar(totalTime) {
  const maxMin = Math.round(PUNCTURE_STRETCH_MIN * 1.25);
  const fillPct = Math.min((totalTime / maxMin) * 100, 100);
  const goalPct = (PUNCTURE_TARGET_MIN / maxMin) * 100;
  const color = cssVar(punctureStatus(totalTime).varName);
  
  const track = el('div', { class: 'puncture-timeline' });
  const fill = el('div', {
    class: 'puncture-timeline-fill',
    style: { width: `${fillPct}%`, background: color }
  });
  
  const tick = el('div', {
    class: 'puncture-timeline-tick',
    style: { left: `${goalPct}%` }
  });
  const tickLabel = el('span', {
    class: 'puncture-timeline-tick-label',
    style: { left: `${goalPct}%` },
    text: `${PUNCTURE_TARGET_MIN}m target`
  });
  
  const valLabel = el('span', {
    class: 'puncture-timeline-val-label',
    style: { left: `${fillPct}%`, color: color },
    text: `${totalTime} min`
  });
  
  track.appendChild(fill);
  track.appendChild(valLabel);
  track.appendChild(tick);
  track.appendChild(tickLabel);
  return track;
}

function clearFocusedPath() {
  if (state.focusedPath) {
    state.map.removeLayer(state.focusedPath);
    state.focusedPath = null;
  }
}

function highlightMarker(id, highlight) {
  const marker = state.markers.find(m => m.hospitalId === id);
  if (!marker) return;
  if (highlight) {
    if (!marker._originalStyle) {
      marker._originalStyle = {
        color: marker.options.color,
        weight: marker.options.weight,
        radius: marker.options.radius,
        fillOpacity: marker.options.fillOpacity,
      };
    }
    marker.setStyle({
      color: cssVar('--accent') || '#4f46e5',
      weight: 4,
      fillOpacity: 1,
    });
    marker.setRadius(marker._originalStyle.radius + 3);
    marker.bringToFront();
  } else {
    if (marker._originalStyle) {
      marker.setStyle(marker._originalStyle);
      marker.setRadius(marker._originalStyle.radius);
    }
  }
}

function clearQueryPath() {
  if (state.queryPaths) {
    for (const p of state.queryPaths) state.map.removeLayer(p);
    state.queryPaths = [];
  }
}

function toggleQueryMode() {
  toggleToolsMenu();
  state.queryModeActive = !state.queryModeActive;
  const mapContainer = $('#map');
  if (state.queryModeActive) {
    mapContainer.classList.add('query-cursor');
    toast('Location query active. Click anywhere on the map to analyze stroke coverage.', 'info', 4000);
  } else {
    mapContainer.classList.remove('query-cursor');
    toast('Location query deactivated.');
    if (state.queryPopup) {
      state.map.closePopup(state.queryPopup);
      state.queryPopup = null;
    }
    clearQueryPath();
  }
}

function showHospitalDetail(h) {
  $('#detail-title').textContent = h.displayName;
  const content = $('#hospital-detail-content');
  clear(content);

  const certNames = CERT_NAMES;

  // Data-provenance banner. A clinician must be able to tell in one glance
  // whether this record's stroke capability was actually checked.
  const banner = el('div', {
    class: h.isCensus ? 'detail-banner detail-banner-census' : 'detail-banner detail-banner-verified',
  });
  if (h.isCensus) {
    banner.appendChild(el('strong', { text: 'Stroke capability not assessed. ' }));
    banner.appendChild(document.createTextNode(
      'This facility comes from the CMS acute-care census so that every hospital in the '
      + 'region is findable. No certification on file here means unknown, not none — confirm '
      + 'capability directly before making a transfer decision on it.'));
  } else {
    banner.appendChild(el('strong', { text: 'Stroke capability verified. ' }));
    banner.appendChild(document.createTextNode(
      `Certification cross-checked against primary sources${h.lastVerified ? ` (last verified ${h.lastVerified})` : ''}.`));
  }
  content.appendChild(banner);

  // Location
  const loc = el('div', { class: 'detail-section detail-facility' });
  loc.appendChild(el('h3', { text: 'Facility' }));
  const locKV = el('div');
  const kv = (label, val) => {
    if (val == null || val === '') return;
    const row = el('div', { class: 'kv' });
    row.appendChild(el('dt', { text: label }));
    row.appendChild(el('dd', { text: ' ' + val }));
    locKV.appendChild(row);
  };
  if (h.healthSystem) kv('Health system:', h.healthSystem);
  kv('Facility type:', [h.hospitalType, h.beds ? `${h.beds} beds` : null].filter(Boolean).join(' · '));
  kv('Ownership:', h.ownership);
  if (h.address) kv('Address:', titleCase(h.address));
  kv('City:', h.city + (h.cityConfidence === 'coordinate-derived' ? ' (derived from coordinates)' : ''));
  kv('County:', h.county);
  kv('State/ZIP:', `${h.state} ${h.zip || ''}`.trim());
  // A synthetic identifier must never be presented as a real CMS number.
  if (h.cmsId && h.facilityIdType === 'ccn') {
    kv('CMS CCN:', h.cmsId);
  } else if (h.facilityIdType === 'shared-ccn') {
    kv('CMS CCN:', `${h.cmsId} (shared — provider-based campus)`);
  } else {
    kv('CMS CCN:', 'None — not a Medicare-certified provider');
  }
  kv('Coordinates:', `${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}`
    + (h.geocodePrecision === 'approximate' ? ' (approximate)' : ''));
  if (h.aliases?.length) kv('Also known as:', h.aliases.join(' · '));
  loc.appendChild(locKV);
  if (h.cmsIdNote) {
    loc.appendChild(el('p', { class: 'detail-note', text: h.cmsIdNote }));
  }
  content.appendChild(loc);

  // Capabilities
  const cap = el('div', { class: 'detail-section detail-capabilities' });
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
  let stateOnlyNote = null;
  let capabilityNote = null;
  if (h.isCensus) {
    row('Certification:', 'Not assessed', cssVar('--c-census'));
    row('24/7 thrombectomy:', 'Unknown', cssVar('--c-census'));
  } else {
    if (h.strokeCertificationType) {
      row('Tier shown:', `${certNames[h.strokeCertificationType]} (${h.strokeCertificationType})`);
    } else {
      row('Tier shown:', 'None on record', '#dc2626');
    }
    // National accreditation and a state designation are different things, and
    // conflating them is the single easiest way to over-read a rural site's
    // capability. Show them on separate rows, always.
    if (h.nationalCertification) {
      row('National certification:', `${h.nationalCertification.body} — ${h.nationalCertification.tier}`);
    } else {
      row('National certification:', 'None on record', '#dc2626');
    }
    if (h.stateDesignation) {
      row('State designation:', h.stateDesignation.label);
    }
    // The tier definition answers the on-call question directly ("ASR = rapid
    // assessment, stabilisation, IV thrombolysis, teleneurology 24/7, transfer
    // protocols") and previously cost closing this record to go find it.
    const tierDef = state.meta?.certDefs?.[h.strokeCertificationType];
    if (tierDef) {
      const clause = tierDef.split('\u2014').slice(1).join('\u2014').trim() || tierDef;
      capabilityNote = clause;
    }
    if (h.certificationBasis === 'state') {
      stateOnlyNote = `The ${h.strokeCertificationType} tier above is this app's mapping of a state `
        + 'designation onto the national tier ladder. It is not a Joint Commission, DNV, ACHC '
        + 'or CIHQ certification.';
    }
    row('24/7 thrombectomy:', h.hasELVO ? 'Yes' : 'No', h.hasELVO ? cssVar('--c-evt') : undefined);
    if (h.certificationDetails) row('Details:', h.certificationDetails);
  }
  cap.appendChild(capKV);
  if (capabilityNote) cap.appendChild(el('p', { class: 'detail-note', text: capabilityNote }));
  if (h.hasELVO && state.meta?.certDefs?.EVT) {
    cap.appendChild(el('p', { class: 'detail-note', text: state.meta.certDefs.EVT }));
  }
  if (stateOnlyNote) cap.appendChild(el('p', { class: 'detail-note', text: stateOnlyNote }));
  content.appendChild(cap);

  // Clear any existing path overlay and draw a new one if appropriate
  clearFocusedPath();
  const d = state.distances[h.id] || {};
  if (d.nearestAdvancedDistance > 0 && Number.isFinite(d.nearestAdvancedDistance)) {
    const target = d.nearestAdvanced;
    const pathColor = h.airOnly ? cssVar('--c-evt') : '#4f46e5';
    state.focusedPath = L.polyline(
      [[h.latitude, h.longitude], [target.latitude, target.longitude]],
      {
        color: pathColor,
        weight: 3,
        opacity: 0.85,
        dashArray: h.airOnly ? '4,8' : undefined,
      }
    ).addTo(state.map);
    state.focusedPath.bindTooltip(
      tooltipNode(`${h.displayName} to CSC/TSC (${target.displayName}): ${formatMiles(d.nearestAdvancedDistance)} mi (~${bestTransportMinutes(d.nearestAdvancedDistance, h.airOnly)} min best)`),
      { sticky: true }
    );

    const dist = el('div', { class: 'detail-section detail-transport' });
    dist.appendChild(el('h3', { text: 'Transport Analysis' }));
    const tbl = el('div');
    const dCSC = d.nearestAdvancedDistance;

    const fitBtn = el('button', {
      class: 'btn-fit-view',
      type: 'button',
      text: '🔍 Fit View',
      onclick: () => {
        closeModal('hospital-detail-modal');
        if (state.focusedPath) {
          state.map.fitBounds(state.focusedPath.getBounds(), { padding: [50, 50] });
        } else {
          state.map.setView([h.latitude, h.longitude], 11);
        }
      }
    });

    const hopBtn = el('button', {
      class: 'btn-inline-link',
      type: 'button',
      text: d.nearestAdvancedName,
      onclick: () => {
        panToHospital(target.id);
        showHospitalDetail(target);
      }
    });

    // When the nearest CSC/TSC is also the nearest EVT centre — the common case
    // — two identical rows just cost vertical space on a phone.
    const advIsEVT = d.nearestEVT && d.nearestAdvanced && d.nearestEVT.id === d.nearestAdvanced.id;
    tbl.appendChild(el('div', { class: 'kv' }, [
      el('dt', { text: advIsEVT ? 'Nearest CSC/TSC + EVT:' : 'Nearest CSC/TSC:' }),
      el('dd', {}, [
        document.createTextNode(' '),
        hopBtn,
        document.createTextNode(` (${formatMiles(dCSC)} mi) `),
        fitBtn
      ]),
    ]));

    const groundText = h.airOnly
      ? 'Not feasible (no road connection)'
      : `~${groundMinutes(dCSC)} min`;

    tbl.appendChild(el('div', { class: 'kv' }, [
      el('dt', { text: 'Ground transfer:' }),
      el('dd', { text: ` ${groundText}  ·  Air: ~${airMinutes(dCSC)} min  ·  Best: ${bestTransportText(dCSC, h.airOnly)}` }),
    ]));

    if (!advIsEVT && Number.isFinite(d.nearestEVTDistance) && d.nearestEVTDistance > 0) {
      const evtTarget = d.nearestEVT;
      const fitEVTBtn = el('button', {
        class: 'btn-fit-view',
        type: 'button',
        text: '🔍 Fit View',
        onclick: () => {
          closeModal('hospital-detail-modal');
          clearFocusedPath();
          const color = h.airOnly ? cssVar('--c-evt') : '#4f46e5';
          state.focusedPath = L.polyline(
            [[h.latitude, h.longitude], [evtTarget.latitude, evtTarget.longitude]],
            {
              color: color,
              weight: 3,
              opacity: 0.85,
              dashArray: h.airOnly ? '4,8' : undefined,
            }
          ).addTo(state.map);
          state.focusedPath.bindTooltip(
            tooltipNode(`${h.displayName} to EVT (${evtTarget.displayName}): ${formatMiles(d.nearestEVTDistance)} mi (~${bestTransportMinutes(d.nearestEVTDistance, h.airOnly)} min best)`),
            { sticky: true }
          );
          state.map.fitBounds(state.focusedPath.getBounds(), { padding: [50, 50] });
        }
      });

      const hopEVTBtn = el('button', {
        class: 'btn-inline-link',
        type: 'button',
        text: d.nearestEVTName,
        onclick: () => {
          panToHospital(evtTarget.id);
          showHospitalDetail(evtTarget);
        }
      });

      tbl.appendChild(el('div', { class: 'kv' }, [
        el('dt', { text: 'Nearest EVT:' }),
        el('dd', {}, [
          document.createTextNode(' '),
          hopEVTBtn,
          document.createTextNode(` (${formatMiles(d.nearestEVTDistance)} mi)  ·  ${transportLine(d.nearestEVTDistance, h.airOnly)}  ·  best ${bestTransportText(d.nearestEVTDistance, h.airOnly)} `),
          fitEVTBtn
        ]),
      ]));
    }

    // Thrombectomy happens at an EVT centre, which is not always the nearest
    // CSC/TSC — 22 sites are EVT-capable but only 18 hold CSC/TSC. Measuring
    // this window to the nearest CSC/TSC inflated it for 59 records, by up to
    // 109 minutes: Cheyenne Regional read 173 min via a distant CSC while
    // Banner Wyoming, 141 mi away, is the actual thrombectomy destination.
    const onSiteEVT = d.nearestEVTDistance === 0;
    const punctureTarget = Number.isFinite(d.nearestEVTDistance) ? d.nearestEVT : d.nearestAdvanced;
    const punctureMi = Number.isFinite(d.nearestEVTDistance) ? d.nearestEVTDistance : dCSC;

    const goldenNote = el('div', { class: 'kv' });
    if (onSiteEVT) {
      goldenNote.appendChild(el('dt', { text: 'Thrombectomy:' }));
      const dd = el('dd');
      const span = el('span', { text: ' On site — no interfacility transfer required.' });
      span.style.color = cssVar('--c-evt');
      span.style.fontWeight = '600';
      dd.appendChild(span);
      goldenNote.appendChild(dd);
      tbl.appendChild(goldenNote);
    } else {
      goldenNote.appendChild(el('dt', { text: 'Est. time to EVT-centre arrival:' }));
      const ddNote = el('dd');
      const bestMin = bestTransportMinutes(punctureMi, h.airOnly);
      const totalMin = bestMin + DIDO_MIN;
      const status = punctureStatus(totalMin);
      const note = el('span', {
        text: ` ${bestMin} min transport (${bestTransportMode(punctureMi, h.airOnly)}) + ${DIDO_MIN} min DIDO`
          + ` \u2248 ${totalMin} min to arrival at ${punctureTarget ? punctureTarget.displayName : 'the nearest EVT centre'}`
          + ` \u2014 ${status.label} against the AHA ${PUNCTURE_TARGET_MIN} min door-to-puncture goal`,
      });
      note.style.color = cssVar(status.varName);
      note.style.fontWeight = '600';
      ddNote.appendChild(note);
      goldenNote.appendChild(ddNote);
      tbl.appendChild(goldenNote);

      // AHA timeline progress bar
      tbl.appendChild(buildTargetProgressBar(totalMin));
    }

    // The modal is the only surface that renders a colour-coded AHA verdict and
    // a progress bar, and it previously carried no statement of what the numbers
    // assume. Keep this inside the section so it survives scrolling.
    dist.appendChild(tbl);
    dist.appendChild(el('p', {
      class: 'detail-note',
      text: `Straight-line planning estimate. Ground assumes great-circle \u00d7 ${ROAD_FACTOR} at `
        + `${GROUND_MPH} mph + ${GROUND_OVERHEAD_MIN} min overhead; air assumes ${AIR_MPH} mph + `
        + `${AIR_OVERHEAD_MIN} min dispatch, takeoff and landing, and that an air asset is `
        + `available and flying. DIDO is a flat ${DIDO_MIN} min placeholder, not this site's `
        + `measured figure. The total reaches arrival at the receiving centre \u2014 it does not `
        + `include their arrival-to-groin interval, so true door-to-puncture is longer. `
        + `Confirm with dispatch and the receiving centre.`,
    }));
    content.appendChild(dist);
  }

  // Nearby hospitals
  const nearbySect = el('div', { class: 'detail-section detail-nearby' });
  nearbySect.appendChild(el('h3', { text: 'Nearby Hospitals (5 closest)' }));
  const nearby = state.hospitals
    .filter(n => n.id !== h.id)
    .map(n => ({ ...n, dist: haversineMi(h.latitude, h.longitude, n.latitude, n.longitude) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);
  for (const n of nearby) {
    const left = el('span');
    left.appendChild(el('span', { text: n.displayName }));
    // Without this badge an unassessed neighbour is indistinguishable from one
    // that was checked and found to hold no certification.
    if (n.isCensus) {
      left.appendChild(document.createTextNode(' '));
      left.appendChild(el('span', { class: 'badge badge-CENSUS', text: 'Not assessed' }));
    } else if (n.strokeCertificationType) {
      left.appendChild(document.createTextNode(' '));
      left.appendChild(el('span', { class: `badge badge-${n.strokeCertificationType}`, text: n.strokeCertificationType }));
    }
    if (n.hasELVO) {
      left.appendChild(document.createTextNode(' '));
      left.appendChild(el('span', { class: 'badge badge-EVT', text: 'EVT' }));
    }
    const rowEl = el('button', {
      class: 'nearby-row-btn',
      type: 'button',
      'aria-label': `${rowAccessibleName(n)}, ${formatMiles(n.dist)} miles away`,
      onclick: () => {
        panToHospital(n.id);
        showHospitalDetail(n);
      }
    }, [
      left,
      el('span', { style: { color: cssVar('--text-muted'), whiteSpace: 'nowrap', marginLeft: '8px' }, text: `${formatMiles(n.dist)} mi` }),
    ]);
    nearbySect.appendChild(rowEl);
  }
  content.appendChild(nearbySect);

  // Data sources
  if (h.dataSources?.length) {
    const srcSect = el('div', { class: 'detail-sources', style: { fontSize: '11px', color: cssVar('--text-muted'), paddingTop: '8px', borderTop: '1px solid var(--border)' } });
    srcSect.appendChild(el('strong', { text: 'Data sources: ' }));
    srcSect.appendChild(document.createTextNode(h.dataSources.join('; ')));
    // This record's own provenance, not the file's. Stamping the dataset-wide
    // verification date here put "last verified 2026-07-04" beneath a 2023 CMS
    // snapshot on all 101 census records, which were never verified at all.
    srcSect.appendChild(document.createElement('br'));
    if (h.lastVerified) {
      srcSect.appendChild(el('strong', { text: 'Capability last verified: ' }));
      srcSect.appendChild(document.createTextNode(h.lastVerified));
    } else {
      srcSect.appendChild(el('strong', { text: 'Capability never verified. ' }));
      srcSect.appendChild(document.createTextNode(
        state.meta?.censusSnapshot?.as_of
          ? `Facility identity from the ${state.meta.censusSnapshot.as_of} CMS census snapshot.`
          : 'Facility identity from the CMS acute-care census.'));
    }
    content.appendChild(srcSect);
  }

  openModal('hospital-detail-modal');
}

// ------------------------------------------------------------------
// Modals
// ------------------------------------------------------------------
function handleModalTab(e, modalNode) {
  const focusables = Array.from(modalNode.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.key === 'Tab') {
    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }
}

function openModal(id) {
  const m = $('#' + id);
  if (!m) return;
  if (m.classList.contains('active')) {
    // Re-entrant open (hopping between hospitals inside the detail modal).
    // Keep the early return so _previousActive survives and traps do not stack,
    // but focus still has to move: showHospitalDetail clears the content node
    // out from under the focused button, which drops activeElement to <body>
    // and lets the next Tab walk the background page.
    const heading = m.querySelector('.modal-header h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
    return;
  }
  m.removeAttribute('inert');
  m.setAttribute('aria-hidden', 'false');
  m.classList.add('active');
  m._previousActive = document.activeElement;
  const focusables = Array.from(m.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (focusables.length > 0) {
    focusables[0].focus();
  }
  m._focusTrapHandler = (e) => {
    if (e.key === 'Tab') {
      handleModalTab(e, m);
    }
  };
  m.addEventListener('keydown', m._focusTrapHandler);
  document.body.style.overflow = 'hidden';
}

// Restore focus after a modal closes. When the modal was opened from the page
// body (keyboard shortcut), there is nothing meaningful to restore to — park
// focus on the tools FAB rather than stranding it inside the hidden overlay.
function restoreModalFocus(m) {
  const prev = m._previousActive;
  m._previousActive = null;
  if (prev && typeof prev.focus === 'function' && prev !== document.body
      && document.contains(prev) && !m.contains(prev)) {
    prev.focus();
    return;
  }
  if (m.contains(document.activeElement)) {
    const fab = $('#tools-fab');
    if (fab) fab.focus();
    else document.activeElement.blur();
  }
}

function deactivateModal(m) {
  m.classList.remove('active');
  if (m.id === 'hospital-detail-modal') {
    clearFocusedPath();
  }
  if (m._focusTrapHandler) {
    m.removeEventListener('keydown', m._focusTrapHandler);
    m._focusTrapHandler = null;
  }
  restoreModalFocus(m);
  m.setAttribute('aria-hidden', 'true');
  m.setAttribute('inert', '');
}

function closeModal(id) {
  const m = id ? $('#' + id) : document.querySelector('.modal-overlay.active');
  if (!m) return;
  deactivateModal(m);
  if (!document.querySelector('.modal-overlay.active')) document.body.style.overflow = '';
}

function closeAllModals() {
  $$('.modal-overlay.active').forEach(deactivateModal);
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
  fab.setAttribute('aria-label', state.toolsMenuOpen ? 'Close tools menu' : 'Open tools menu');
  fab.setAttribute('title', state.toolsMenuOpen ? 'Close tools menu' : 'Tools & analysis');
  fab.textContent = state.toolsMenuOpen ? '×' : '⚙';
  fab.dataset.state = state.toolsMenuOpen ? 'open' : 'closed';
  const shortcut = $('#shortcut-tools');
  if (shortcut) shortcut.setAttribute('aria-expanded', String(state.toolsMenuOpen));
  if (state.toolsMenuOpen) {
    requestAnimationFrame(() => menu.querySelector('button')?.focus());
  } else if (menu.contains(document.activeElement)) {
    fab.focus();
  }
}

// ------------------------------------------------------------------
// Analysis overlays
// ------------------------------------------------------------------
function clearOverlays() {
  clearFocusedPath();
  for (const l of state.overlays.referral) state.map.removeLayer(l);
  for (const l of state.overlays.coverage) state.map.removeLayer(l);
  state.overlays = { referral: [], coverage: [] };
  state.overlayVisible = { referral: false, coverage: false };
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
    const d = state.distances[h.id];
    if (!d?.nearestAdvanced || !Number.isFinite(d.nearestAdvancedDistance)) continue;
    const dist = d.nearestAdvancedDistance;
    const color = dist < 50 ? cssVar('--c-evt') : dist <= 100 ? cssVar('--c-psc') : dist <= 150 ? cssVar('--c-tsc') : cssVar('--c-csc');
    const line = L.polyline(
      [[h.latitude, h.longitude], [d.nearestAdvanced.latitude, d.nearestAdvanced.longitude]],
      { color, weight: dist > 100 ? 2 : 1, opacity: 0.45, dashArray: '5,8' }
    ).addTo(state.map);
    line.bindTooltip(
      tooltipNode([
        el('strong', { text: h.displayName }),
        ' to CSC/TSC (',
        el('strong', { text: d.nearestAdvanced.displayName }),
        ')',
        el('br'),
        `Distance: ${formatMiles(dist)} mi (~${bestTransportMinutes(dist, h.airOnly)} min best)`,
      ]),
      { sticky: true }
    );
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
    c50.bindTooltip(tooltipNode(`50 mi buffer around ${c.displayName}`), { sticky: true });

    const c100 = L.circle([c.latitude, c.longitude], {
      radius: 100 * 1609.34, color: cssVar('--c-psc'), fillColor: cssVar('--c-psc'),
      fillOpacity: 0.03, weight: 1, opacity: 0.25, dashArray: '5,5',
    }).addTo(state.map);
    c100.bindTooltip(tooltipNode(`100 mi buffer around ${c.displayName}`), { sticky: true });

    state.overlays.coverage.push(c50, c100);
  }
  state.overlayVisible.coverage = true;
  toast('Coverage: solid 50 mi, dashed 100 mi from EVT centers');
}

function showDistanceMap() {
  toggleToolsMenu();
  state.markerLayer.clearLayers();
  state.markers = [];
  for (const h of state.hospitals) {
    const d = state.distances[h.id]?.nearestAdvancedDistance ?? Infinity;
    let color;
    if (!Number.isFinite(d) || d === 0) color = markerColor(h);
    else if (d < 50) color = cssVar('--c-evt');
    else if (d <= 100) color = cssVar('--c-psc');
    else color = cssVar('--c-csc');
    showMarker(h, { fillColor: color, color: 'white', weight: 2, opacity: 1, fillOpacity: 0.85 }, markerSize(h));
  }
  const under = state.hospitals.filter(h => {
    const d = state.distances[h.id]?.nearestAdvancedDistance;
    return d > 0 && d < 50 && Number.isFinite(d);
  }).length;
  const mid = state.hospitals.filter(h => {
    const d = state.distances[h.id]?.nearestAdvancedDistance;
    return d >= 50 && d <= 100;
  }).length;
  const over = state.hospitals.filter(h => {
    const d = state.distances[h.id]?.nearestAdvancedDistance;
    return d > 100 && Number.isFinite(d);
  }).length;
  toast(`CSC/TSC distance: ${under} <50mi · ${mid} 50-100mi · ${over} >100mi`);
}

function showEVTDeserts() {
  toggleToolsMenu();
  state.markerLayer.clearLayers();
  state.markers = [];
  const desertMi = state.scenario.desertMi;
  let desertCount = 0;
  for (const h of state.hospitals) {
    const d = state.distances[h.id]?.nearestEVTDistance ?? Infinity;
    const isEVT = h.hasELVO;
    const isDesert = !isEVT && d > desertMi && Number.isFinite(d);
    if (isDesert) desertCount++;
    const color = isEVT ? cssVar('--c-evt') : isDesert ? cssVar('--c-csc') : cssVar('--c-other');
    const size = isEVT ? 12 : isDesert ? 10 : 6;
    showMarker(h, {
      fillColor: color,
      color: isDesert ? '#991b1b' : 'white',
      weight: isDesert ? 3 : 2, opacity: 1, fillOpacity: isDesert ? 0.9 : (isEVT ? 0.85 : 0.55),
    }, size);
  }
  toast(`${desertCount} hospitals >${desertMi} mi from 24/7 thrombectomy`, 'warning', 4000);
}

function showZeroCapability() {
  toggleToolsMenu();
  state.markerLayer.clearLayers();
  state.markers = [];
  let n = 0;
  for (const h of state.hospitals) {
    const zero = !h.strokeCertificationType && !h.isCensus;
    if (zero) n++;
    const color = zero ? cssVar('--c-csc') : markerColor(h);
    showMarker(h, {
      fillColor: color,
      color: zero ? '#991b1b' : 'white', weight: zero ? 3 : 2,
      opacity: 1, fillOpacity: zero ? 0.9 : 0.55,
    }, zero ? 11 : markerSize(h));
  }
  toast(`${n} hospitals checked and found uncertified (census records excluded)`, 'warning');
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
    distCSC: (a, b) => (state.distances[a.id]?.nearestAdvancedDistance ?? Infinity) - (state.distances[b.id]?.nearestAdvancedDistance ?? Infinity),
    distEVT: (a, b) => (state.distances[a.id]?.nearestEVTDistance ?? Infinity) - (state.distances[b.id]?.nearestEVTDistance ?? Infinity),
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
    ['name', 'Hospital'], ['state', 'State'], ['cert', 'Cert'],
    [null, 'Nearest CSC/TSC'], ['distCSC', 'mi'], [null, 'Nearest EVT'], ['distEVT', 'mi'],
  ];
  for (const [key, label] of cols) {
    const th = el('th');
    if (key) {
      const active = state.matrixSort.col === key;
      th.setAttribute('aria-sort', active ? (state.matrixSort.asc ? 'ascending' : 'descending') : 'none');
      // Same pattern as the candidates table: native button, refocused after re-render
      const btn = el('button', {
        class: 'th-sort-btn', type: 'button',
        text: label + (active ? (state.matrixSort.asc ? ' ▲' : ' ▼') : ''),
        'aria-label': `Sort by ${label}`,
        dataset: { sortKey: key },
      });
      btn.addEventListener('click', () => {
        if (state.matrixSort.col === key) state.matrixSort.asc = !state.matrixSort.asc;
        else { state.matrixSort.col = key; state.matrixSort.asc = true; }
        renderDistanceMatrix();
        const fresh = document.querySelector(`#distance-matrix-content .th-sort-btn[data-sort-key="${key}"]`);
        if (fresh) fresh.focus();
      });
      th.appendChild(btn);
    } else {
      th.textContent = label;
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow); table.appendChild(thead);
  const tbody = el('tbody');
  for (const h of sorted) {
    const d = state.distances[h.id] || {};
    const tr = el('tr');
    const dCSC = d.nearestAdvancedDistance > 0 && Number.isFinite(d.nearestAdvancedDistance) ? d.nearestAdvancedDistance.toFixed(0) : '—';
    const dEVT = d.nearestEVTDistance > 0 && Number.isFinite(d.nearestEVTDistance) ? d.nearestEVTDistance.toFixed(0) : '—';
    tr.appendChild(el('td', { text: h.displayName }));
    tr.appendChild(el('td', { text: h.state }));
    // Without this an unassessed record shows the same em-dash as one checked
    // and found uncertified.
    tr.appendChild(el('td', {
      text: h.isCensus ? 'not assessed' : (h.strokeCertificationType || '—'),
      class: h.isCensus ? 'matrix-unassessed' : undefined,
    }));

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
  const assumptions = [`Planning estimates — great-circle x ${ROAD_FACTOR} road factor; `
    + `${GROUND_MPH} mph ground + ${GROUND_OVERHEAD_MIN} min overhead; `
    + `${AIR_MPH} mph air + ${AIR_OVERHEAD_MIN} min overhead. Not dispatch times.`];
  const rows = [assumptions, ['Hospital', 'State', 'City', 'Certification', 'Certifying Body',
    'Air-only access', 'Nearest CSC/TSC', 'Distance CSC/TSC (mi)', 'CSC/TSC ground min', 'CSC/TSC air min',
    'Nearest EVT', 'Distance EVT (mi)', 'EVT ground min', 'EVT air min']];
  for (const h of state.hospitals) {
    const d = state.distances[h.id] || {};
    const dA = Number.isFinite(d.nearestAdvancedDistance) && d.nearestAdvancedDistance > 0 ? d.nearestAdvancedDistance : '';
    const dE = Number.isFinite(d.nearestEVTDistance) && d.nearestEVTDistance > 0 ? d.nearestEVTDistance : '';
    rows.push([
      h.displayName, h.state, h.city || '',
      h.isCensus ? 'Not assessed' : (h.strokeCertificationType || 'None'),
      h.certifyingBody || '',
      h.airOnly ? 'Yes' : 'No',
      d.nearestAdvancedName || '',
      dA === '' ? '' : dA.toFixed(1),
      dA === '' ? '' : (h.airOnly ? 'N/A' : groundMinutes(dA)),
      dA === '' ? '' : airMinutes(dA),
      d.nearestEVTName || '',
      dE === '' ? '' : dE.toFixed(1),
      dE === '' ? '' : (h.airOnly ? 'N/A' : groundMinutes(dE)),
      dE === '' ? '' : airMinutes(dE),
    ]);
  }
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(csv, `stroke_distance_matrix_${dateStr()}.csv`, 'text/csv');
  toast('Distance matrix exported', 'success');
}

// ------------------------------------------------------------------
// Expansion-candidate scoring (planning heuristic — display layer only)
// ------------------------------------------------------------------
// The score NEVER asserts anything about a hospital beyond what the
// public dataset records. It combines three transparent need signals,
// each normalized 0–1, under user-adjustable scenario weights:
//   certGap — certification tier on record (None 1.0 · ASR 0.65 · PSC 0.35)
//   evtGap  — miles to nearest 24/7 EVT center, capped at scenario.capMi
//   advGap  — miles to nearest CSC/TSC, capped at scenario.capMi
// Records flagged air-only get a flat +8 for transport fragility.
// Hospitals that are themselves EVT-capable or CSC/TSC are hubs, not
// telestroke spoke candidates, and are excluded from the ranking.
const SCENARIO_DEFAULTS = { wCert: 40, wEvt: 40, wAdv: 20, desertMi: 100, capMi: 200 };
// Valid ranges match the sliders in index.html — URL params are clamped to
// these so a hand-edited link can never poison the math (e.g. capMi 0 → NaN)
// or desync the slider knob from the label.
const SCENARIO_RANGES = { wCert: [0, 100], wEvt: [0, 100], wAdv: [0, 100], desertMi: [50, 200], capMi: [100, 300] };
const CERT_GAP_WEIGHT = { ASR: 0.65, PSC: 0.35 };
const AIR_ONLY_BONUS = 8;

function certGapValue(h) {
  if (!h.strokeCertificationType) return 1.0;
  return CERT_GAP_WEIGHT[h.strokeCertificationType] ?? 0;
}

function computeCandidates() {
  const { wCert, wEvt, wAdv } = state.scenario;
  const capMi = Math.max(1, state.scenario.capMi); // belt-and-suspenders vs division by zero
  const wSum = (wCert + wEvt + wAdv) || 1;
  const out = [];
  for (const h of state.hospitals) {
    // Scoring a facility whose stroke capability was never assessed would invent
    // a certification gap out of missing data.
    if (h.isCensus) continue;
    if (h.hasELVO) continue;
    if (h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC') continue;
    const d = state.distances[h.id] || {};
    const evtMi = Number.isFinite(d.nearestEVTDistance) ? d.nearestEVTDistance : capMi;
    const advMi = Number.isFinite(d.nearestAdvancedDistance) ? d.nearestAdvancedDistance : capMi;
    const certGap = certGapValue(h);
    const evtGap = Math.min(evtMi, capMi) / capMi;
    const advGap = Math.min(advMi, capMi) / capMi;
    const pts = {
      cert: (wCert * certGap) / wSum * 100,
      evt: (wEvt * evtGap) / wSum * 100,
      adv: (wAdv * advGap) / wSum * 100,
      air: h.airOnly ? AIR_ONLY_BONUS : 0,
    };
    const score = Math.min(100, pts.cert + pts.evt + pts.adv + pts.air);
    out.push({ h, d, score, pts, evtMi, advMi });
  }
  out.sort((a, b) => b.score - a.score || a.h.displayName.localeCompare(b.h.displayName));
  out.forEach((c, i) => { c.rank = i + 1; });
  return out;
}

function candidateReasons(c) {
  const { h, d, pts, evtMi, advMi } = c;
  const reasons = [];
  if (!h.strokeCertificationType) {
    reasons.push(`No national stroke certification on record (+${pts.cert.toFixed(0)} pts)`);
  } else {
    const tierNames = { ASR: 'Acute Stroke Ready', PSC: 'Primary Stroke Center' };
    reasons.push(`Certification tier on record: ${h.strokeCertificationType} — ${tierNames[h.strokeCertificationType] || ''} (+${pts.cert.toFixed(0)} pts)`);
  }
  if (Number.isFinite(evtMi) && evtMi > 0) {
    const gTxt = h.airOnly ? 'ground not feasible' : `~${groundMinutes(evtMi)} min ground`;
    reasons.push(`${formatMiles(evtMi)} mi to nearest 24/7 EVT (${d.nearestEVTName || 'n/a'}) — ${gTxt} / ~${airMinutes(evtMi)} min air (+${pts.evt.toFixed(0)} pts)`);
  }
  if (Number.isFinite(advMi) && advMi > 0) {
    reasons.push(`${formatMiles(advMi)} mi to nearest CSC/TSC (${d.nearestAdvancedName || 'n/a'}) (+${pts.adv.toFixed(0)} pts)`);
  }
  if (h.airOnly) {
    reasons.push(`Air-only access flagged in dataset (+${AIR_ONLY_BONUS} pts)`);
  }
  if (evtMi > state.scenario.desertMi) {
    reasons.push(`Beyond the ${state.scenario.desertMi}-mi EVT-desert threshold for this scenario`);
  }
  return reasons;
}

function openExpansionCandidates() {
  if (state.toolsMenuOpen) toggleToolsMenu();
  syncScenarioControls();
  renderCandidates();
  openModal('candidates-modal');
}

function syncScenarioControls() {
  const s = state.scenario;
  const set = (id, v) => {
    const input = $('#' + id);
    if (input) input.value = String(v);
    const label = $('#' + id + '-val');
    if (label) label.textContent = String(v);
  };
  set('w-cert', s.wCert); set('w-evt', s.wEvt); set('w-adv', s.wAdv);
  set('desert-mi', s.desertMi); set('cap-mi', s.capMi);
  updateDesertLabel();
}

function scenarioIsDefault() {
  return Object.keys(SCENARIO_DEFAULTS).every(k => state.scenario[k] === SCENARIO_DEFAULTS[k]);
}

let candidatesLiveTimer = null;
function announceCandidatesSummary(text) {
  const live = $('#candidates-live');
  if (!live) return;
  clearTimeout(candidatesLiveTimer);
  candidatesLiveTimer = setTimeout(() => { live.textContent = text; }, 500);
}

// The static tools-menu label must track the scenario threshold
function updateDesertLabel() {
  const btn = $('#tool-evt-deserts');
  if (btn) btn.textContent = `EVT deserts (>${state.scenario.desertMi} mi)`;
}

function renderCandidates() {
  const container = $('#candidates-content');
  if (!container) return;
  const candidates = computeCandidates();

  // Column sort (rank order is always score-descending; sorting re-orders rows only)
  const sortFns = {
    rank: (a, b) => a.rank - b.rank,
    name: (a, b) => a.h.displayName.localeCompare(b.h.displayName),
    state: (a, b) => a.h.state.localeCompare(b.h.state) || a.rank - b.rank,
    cert: (a, b) => (a.h.strokeCertificationType || 'ZZ').localeCompare(b.h.strokeCertificationType || 'ZZ') || a.rank - b.rank,
    evtMi: (a, b) => a.evtMi - b.evtMi,
    advMi: (a, b) => a.advMi - b.advMi,
    score: (a, b) => a.score - b.score,
  };
  const { col, asc } = state.candidateSort;
  const fn = sortFns[col] || sortFns.score;
  const rows = [...candidates].sort((a, b) => asc ? fn(a, b) : fn(b, a));

  const summary = $('#candidates-summary');
  if (summary) {
    const deserts = candidates.filter(c => c.evtMi > state.scenario.desertMi).length;
    const text =
      `${candidates.length} candidate sites (non-EVT, non-CSC/TSC) · ${deserts} beyond ${state.scenario.desertMi} mi of 24/7 EVT` +
      (scenarioIsDefault() ? ' · default scenario' : ' · custom scenario');
    summary.textContent = text; // visible summary updates immediately
    announceCandidatesSummary(text); // screen-reader announcement debounced (slider drags fire dozens of updates)
  }

  clear(container);
  const wrap = el('div', { class: 'matrix-wrap' });
  const table = el('table', { class: 'matrix-table candidates-table' });
  const thead = el('thead');
  const headerRow = el('tr');
  const cols = [
    ['rank', '#'], ['name', 'Hospital'], ['state', 'ST'], ['cert', 'Cert'],
    ['evtMi', 'EVT mi'], ['advMi', 'CSC/TSC mi'], ['score', 'Score'], [null, ''],
  ];
  for (const [key, label] of cols) {
    const th = el('th');
    if (key) {
      const active = col === key;
      th.setAttribute('aria-sort', active ? (asc ? 'ascending' : 'descending') : 'none');
      // Native <button> inside the th: keyboard-activatable, announced as
      // interactive by screen readers, and refocusable after the re-render.
      const btn = el('button', {
        class: 'th-sort-btn', type: 'button',
        text: label + (active ? (asc ? ' ▲' : ' ▼') : ''),
        'aria-label': `Sort by ${label}`,
        dataset: { sortKey: key },
      });
      btn.addEventListener('click', () => {
        if (state.candidateSort.col === key) state.candidateSort.asc = !state.candidateSort.asc;
        else state.candidateSort = { col: key, asc: key === 'name' || key === 'state' || key === 'cert' || key === 'rank' };
        renderCandidates();
        // The table was rebuilt — put keyboard focus back on this column's button
        const fresh = document.querySelector(`#candidates-content .th-sort-btn[data-sort-key="${key}"]`);
        if (fresh) fresh.focus();
      });
      th.appendChild(btn);
    } else {
      th.textContent = label;
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const c of rows) {
    const { h } = c;
    const tr = el('tr');
    tr.appendChild(el('td', { class: 'num', text: String(c.rank) }));
    tr.appendChild(el('td', { text: h.displayName }));
    tr.appendChild(el('td', { text: h.state }));
    tr.appendChild(el('td', { text: h.strokeCertificationType || '—' }));
    tr.appendChild(el('td', { class: 'num', text: formatMiles(c.evtMi) }));
    tr.appendChild(el('td', { class: 'num', text: formatMiles(c.advMi) }));
    const scoreTd = el('td', { class: 'num score-cell' });
    const bar = el('span', { class: 'score-bar', 'aria-hidden': 'true' });
    bar.appendChild(el('span', { class: 'score-bar-fill', style: { width: `${c.score.toFixed(0)}%` } }));
    scoreTd.appendChild(bar);
    scoreTd.appendChild(el('span', { text: c.score.toFixed(0) }));
    tr.appendChild(scoreTd);

    const actionTd = el('td');
    const whyBtn = el('button', {
      class: 'btn-inline-link', type: 'button', text: 'Why?',
      'aria-expanded': 'false', 'aria-label': `Why ${h.displayName} ranks #${c.rank}`,
    });
    actionTd.appendChild(whyBtn);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);

    const whyTr = el('tr', { class: 'why-row', hidden: true });
    const whyTd = el('td', { colSpan: cols.length });
    const ul = el('ul', { class: 'why-list' });
    for (const r of candidateReasons(c)) ul.appendChild(el('li', { text: r }));
    whyTd.appendChild(ul);
    const showBtn = el('button', {
      class: 'btn btn-secondary btn-small', type: 'button', text: 'Show on map',
      onclick: () => {
        closeModal('candidates-modal');
        panToHospital(h.id);
        showHospitalDetail(h);
        // Candidates are ranked from the full dataset; active filters may hide this marker
        if (!state.filtered.some(x => x.id === h.id)) {
          toast(`${h.displayName} is hidden by the current filters — showing details without a marker`, 'warning', 4500);
        }
      },
    });
    whyTd.appendChild(showBtn);
    whyTr.appendChild(whyTd);
    tbody.appendChild(whyTr);

    whyBtn.addEventListener('click', () => {
      const open = !whyTr.hidden;
      whyTr.hidden = open;
      whyBtn.setAttribute('aria-expanded', String(!open));
    });
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function exportCandidatesCSV() {
  const candidates = computeCandidates();
  const s = state.scenario;
  const rows = [[
    'Rank', 'Hospital', 'City', 'State', 'Certification', 'Certifying Body',
    'Nearest EVT', 'EVT mi', 'EVT ground min', 'EVT air min',
    'Nearest CSC/TSC', 'CSC/TSC mi', 'Air-only', 'Cert pts', 'EVT-dist pts', 'CSC/TSC-dist pts', 'Score',
  ]];
  for (const c of candidates) {
    const { h, d } = c;
    rows.push([
      c.rank, h.displayName, h.city || '', h.state,
      h.strokeCertificationType || 'None', h.certifyingBody || '',
      d.nearestEVTName || '', c.evtMi.toFixed(1),
      h.airOnly ? 'N/A' : groundMinutes(c.evtMi), airMinutes(c.evtMi),
      d.nearestAdvancedName || '', c.advMi.toFixed(1),
      h.airOnly ? 'Yes' : 'No',
      c.pts.cert.toFixed(1), c.pts.evt.toFixed(1), c.pts.adv.toFixed(1), c.score.toFixed(1),
    ]);
  }
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(csv, `expansion_candidates_w${s.wCert}-${s.wEvt}-${s.wAdv}_cap${s.capMi}_${dateStr()}.csv`, 'text/csv');
  toast(`${candidates.length} candidates exported (weights ${s.wCert}/${s.wEvt}/${s.wAdv})`, 'success');
}

function resetScenario() {
  state.scenario = { ...SCENARIO_DEFAULTS };
  syncScenarioControls();
  renderCandidates();
  saveStateToURL();
  toast('Scenario reset to defaults');
}

function bindScenarioControls() {
  const bind = (id, key) => {
    const input = $('#' + id);
    if (!input) return;
    input.addEventListener('input', () => {
      state.scenario[key] = parseInt(input.value, 10) || 0;
      const label = $('#' + id + '-val');
      if (label) label.textContent = input.value;
      renderCandidates();
      if (key === 'desertMi') {
        updateDesertLabel();
        renderGapMetrics(state.filtered); // dashboard "EVT desert" metric tracks the threshold
      }
      scheduleURLSave();
    });
  };
  bind('w-cert', 'wCert'); bind('w-evt', 'wEvt'); bind('w-adv', 'wAdv');
  bind('desert-mi', 'desertMi'); bind('cap-mi', 'capMi');
  const resetBtn = $('#scenario-reset');
  if (resetBtn) resetBtn.addEventListener('click', resetScenario);
  const exportBtn = $('#candidates-export-csv');
  if (exportBtn) exportBtn.addEventListener('click', exportCandidatesCSV);
}

// ------------------------------------------------------------------
// Data QA panel (computed live from the loaded dataset)
// ------------------------------------------------------------------
function buildDataQA() {
  const container = $('#data-qa-body');
  if (!container) return;
  clear(container);
  const hs = state.hospitals;
  const total = hs.length;

  // Provenance
  const prov = el('div', { class: 'cert-card neutral' });
  prov.appendChild(el('h4', { text: 'Provenance' }));
  const provList = el('div', { class: 'qa-kv' });
  const kvRow = (label, val) => {
    const row = el('div', { class: 'metric-row' });
    row.appendChild(el('span', { class: 'label', text: label }));
    row.appendChild(el('span', { class: 'value', text: val }));
    provList.appendChild(row);
  };
  kvRow('Data version', state.meta?.version || '—');
  kvRow('Last verified', state.meta?.verified || '—');
  kvRow('Schema', state.meta?.schema || '—');
  kvRow('Records', String(total));
  prov.appendChild(provList);
  prov.appendChild(el('p', { style: { marginTop: '6px', fontSize: '11px' }, text:
    'Public-source planning reference. Not for clinical decision-making, live transfer routing, or dispatch — and not an official state Department of Health product.' }));
  container.appendChild(prov);

  // Completeness
  const comp = el('div', { class: 'cert-card neutral' });
  comp.appendChild(el('h4', { text: 'Field completeness' }));
  const compTable = el('table', { class: 'qa-table' });
  const headTr = el('tr');
  for (const t of ['Field', 'Populated', 'Missing']) headTr.appendChild(el('th', { text: t }));
  compTable.appendChild(headTr);
  const fields = [
    ['strokeCertificationType', 'National certification tier'],
    ['certifyingBody', 'Certifying body'],
    ['certificationDetails', 'Certification details'],
    ['latitude', 'Coordinates'],
    ['cmsId', 'CMS CCN'],
    ['county', 'County'],
    ['beds', 'Bed count'],
  ];
  for (const [f, label] of fields) {
    const missing = hs.filter(h => h[f] == null || h[f] === '').length;
    const tr = el('tr');
    tr.appendChild(el('td', { text: label }));
    tr.appendChild(el('td', { class: 'num', text: String(total - missing) }));
    const missTd = el('td', { class: missing > 0 ? 'num qa-warn' : 'num', text: String(missing) });
    tr.appendChild(missTd);
    compTable.appendChild(tr);
  }
  comp.appendChild(compTable);
  comp.appendChild(el('p', { style: { marginTop: '6px', fontSize: '11px' }, text:
    'Completeness is reported over every mapped record, including acute-care census records whose '
    + 'stroke capability has not been assessed — for those, a missing certification tier means '
    + 'unknown, not none. For assessed records a missing tier is a real finding, not a data error. '
    + 'A missing CMS CCN is correct for facilities that are not Medicare-certified providers.' }));
  container.appendChild(comp);

  // Integrity checks (mirrors METHODOLOGY.md §7 / scripts/verify-data.py)
  const integ = el('div', { class: 'cert-card neutral' });
  integ.appendChild(el('h4', { text: 'Integrity checks (run live in your browser)' }));
  const ids = new Set(hs.map(h => h.id));
  const assessedRecords = hs.filter(h => !h.isCensus);
  const ccns = hs.filter(h => h.facilityIdType === 'ccn' && h.cmsId).map(h => h.cmsId);
  const checks = [
    ['Every record id unique', ids.size === total, `${ids.size}/${total}`],
    ['Every own CMS CCN unique', new Set(ccns).size === ccns.length, `${new Set(ccns).size}/${ccns.length}`],
    ['Every record geocoded', hs.every(h => Number.isFinite(h.latitude) && Number.isFinite(h.longitude)), ''],
    ['Every CSC/TSC has 24/7 EVT', assessedRecords.filter(h => h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC').every(h => h.hasELVO === true), ''],
    ['Every certified hospital has a certifying body', assessedRecords.filter(h => h.strokeCertificationType).every(h => h.certifyingBody), ''],
    ['No census record asserts a certification', hs.filter(h => h.isCensus).every(h => !h.strokeCertificationType && h.hasELVO === false), ''],
    ['Every assessed hospital has a populated city', assessedRecords.every(h => h.city), ''],
  ];
  for (const [label, pass, detail] of checks) {
    const row = el('div', { class: 'metric-row' });
    row.appendChild(el('span', { class: 'label', text: label + (detail ? ` (${detail})` : '') }));
    row.appendChild(el('span', { class: pass ? 'value qa-pass' : 'value qa-fail', text: pass ? '✓ pass' : '✗ FAIL' }));
    integ.appendChild(row);
  }
  container.appendChild(integ);

  // Assumptions
  const assume = el('div', { class: 'cert-card neutral' });
  assume.appendChild(el('h4', { text: 'Model assumptions' }));
  const ul = el('ul', { style: { paddingLeft: '16px', fontSize: '12px', lineHeight: '1.6' } });
  for (const t of [
    `Distances are great-circle (haversine); road distance approximated as haversine × ${ROAD_FACTOR}.`,
    `Ground transfer: ${GROUND_MPH} mph blended + ${GROUND_OVERHEAD_MIN} min dispatch/load overhead.`,
    `Air transfer: ${AIR_MPH} mph blended + ${AIR_OVERHEAD_MIN} min dispatch/takeoff/landing overhead.`,
    'Expansion-candidate scores are planning heuristics computed in the browser from the fields above; they do not assess clinical operations, staffing, case volume, or telestroke contract status, and never modify the source dataset.',
    'No population weighting: a coverage gap in a sparsely populated area affects fewer people than the same gap near a metro area.',
  ]) ul.appendChild(el('li', { text: t }));
  assume.appendChild(ul);
  container.appendChild(assume);

  // Sources
  const src = el('div', { class: 'cert-card neutral' });
  src.appendChild(el('h4', { text: `Primary sources (verified ${state.meta?.verified || '—'})` }));
  const srcUl = el('ul', { style: { paddingLeft: '16px', fontSize: '12px', lineHeight: '1.6' } });
  for (const s of (state.meta?.sources || [])) srcUl.appendChild(el('li', { text: s }));
  src.appendChild(srcUl);
  const links = el('p', { style: { marginTop: '8px', fontSize: '12px' } });
  const mLink = el('a', { href: 'https://github.com/rkalani1/telestroke-expansion-map/blob/main/METHODOLOGY.md', target: '_blank', rel: 'noopener', text: 'Full methodology' });
  links.appendChild(mLink);
  links.appendChild(document.createTextNode(' · '));
  const rLink = el('a', { href: 'https://github.com/rkalani1/telestroke-expansion-map', target: '_blank', rel: 'noopener', text: 'Source repository' });
  links.appendChild(rLink);
  src.appendChild(links);
  if (state.meta?.coverage) {
    src.appendChild(el('p', { style: { marginTop: '6px', fontSize: '12px', fontStyle: 'italic' }, text: state.meta.coverage }));
  }
  container.appendChild(src);
}

function openDataQA() {
  if (state.toolsMenuOpen) toggleToolsMenu();
  buildDataQA();
  openModal('data-qa-modal');
}

// ------------------------------------------------------------------
// Executive summary
// ------------------------------------------------------------------
function generateExecutiveSummary() {
  if (state.toolsMenuOpen) toggleToolsMenu();
  const total = state.hospitals.length;
  const by = {
    CSC: state.hospitals.filter(h => h.strokeCertificationType === 'CSC').length,
    TSC: state.hospitals.filter(h => h.strokeCertificationType === 'TSC').length,
    PSC: state.hospitals.filter(h => h.strokeCertificationType === 'PSC').length,
    ASR: state.hospitals.filter(h => h.strokeCertificationType === 'ASR').length,
  };
  const certified = by.CSC + by.TSC + by.PSC + by.ASR;
  const censusCount = state.hospitals.filter(h => h.isCensus).length;
  const assessed = total - censusCount;
  const noCert = assessed - certified;
  const zero = state.hospitals.filter(h => !h.strokeCertificationType && !h.isCensus).length;
  const evt = state.hospitals.filter(h => h.hasELVO).length;
  const desertMi = state.scenario.desertMi;
  const deserts = state.hospitals.filter(h => (state.distances[h.id]?.nearestEVTDistance || 0) > desertMi).length;
  // `d > 0` is a *display* convention elsewhere (suppress a zero in favour of an
  // em dash). Used as an access filter it excluded all 18 CSC/TSC hospitals —
  // the sites with the best possible access — from the within-60-min counts
  // while leaving them in the denominator.
  const roadAccessible = state.hospitals.filter(h => !h.airOnly).length;
  const ground60 = state.hospitals.filter(h => {
    const d = state.distances[h.id]?.nearestAdvancedDistance;
    return !h.airOnly && Number.isFinite(d) && groundMinutes(d) <= 60;
  }).length;
  const air60 = state.hospitals.filter(h => {
    const d = state.distances[h.id]?.nearestAdvancedDistance;
    return Number.isFinite(d) && airMinutes(d) <= 60;
  }).length;

  const byState = (s) => {
    const hs = state.hospitals.filter(h => h.state === s);
    return {
      total: hs.length,
      assessed: hs.filter(h => !h.isCensus).length,
      cert: hs.filter(h => h.strokeCertificationType).length,
      evt: hs.filter(h => h.hasELVO).length,
    };
  };

  // Active-view context (filters) — only included when a filter is applied
  const activeFilterParts = [];
  const pillsOn = Object.entries(state.activeFilters).filter(([, v]) => v).map(([k]) => k);
  if (pillsOn.length) activeFilterParts.push(`tiers: ${pillsOn.join('/')}`);
  if (state.stateFilter !== 'ALL') activeFilterParts.push(`state: ${state.stateFilter}`);
  if (state.evtDistMin > 0) activeFilterParts.push(`≥${state.evtDistMin} mi from EVT`);
  if (state.searchTerm) activeFilterParts.push(`search: "${state.searchTerm}"`);

  // Top expansion candidates under the current scenario
  const sc = state.scenario;
  const topCandidates = computeCandidates().slice(0, 10);

  const lines = [
    'REGIONAL HOSPITAL STROKE CAPABILITIES — EXECUTIVE SUMMARY',
    `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Data last verified: ${state.meta?.verified || 'unknown'}  ·  Schema ${state.meta?.schema}  ·  Version ${state.meta?.version}`,
    '',
    'DATASET SCOPE',
    `  Coverage: WWAMI region (WA, AK, ID, MT, WY)`,
    `  Hospitals tracked: ${total}`,
    `    - stroke capability verified: ${assessed}`,
    `    - acute-care census only (capability NOT assessed): ${censusCount}`,
    `  Percentages below are over the ${assessed} records whose capability was assessed.`,
    '',
    'CERTIFICATION DISTRIBUTION (assessed records only)',
    `  CSC (Comprehensive):      ${by.CSC}`,
    `  TSC (Thrombectomy-Capable): ${by.TSC}`,
    `  PSC (Primary):            ${by.PSC}`,
    `  ASR (Acute Stroke Ready): ${by.ASR}`,
    `  No certification on record: ${noCert} (${assessed ? (noCert/assessed*100).toFixed(1) : '0.0'}%)`,
    `  EVT-capable (24/7 thrombectomy): ${evt}`,
    '',
    'TRANSPORT & ACCESS',
    `  Within 60-min ground transfer of CSC/TSC: ${ground60} of ${roadAccessible} road-accessible (${roadAccessible ? (ground60/roadAccessible*100).toFixed(1) : '0.0'}%)`,
    `  Within 60-min air transfer of CSC/TSC:    ${air60} (${total ? (air60/total*100).toFixed(1) : '0.0'}%)`,
    `  Both counts include hospitals that are themselves a CSC/TSC (transfer time 0).`,
    `  EVT deserts (>${desertMi} mi to nearest 24/7 thrombectomy): ${deserts} (${total ? (deserts/total*100).toFixed(1) : '0.0'}%)`,
    `  Transport figures cover all ${total} mapped hospitals — geometry is known even where capability is not.`,
    ...(activeFilterParts.length ? [
      '',
      'ACTIVE VIEW',
      `  Filters: ${activeFilterParts.join('  ·  ')}`,
      `  Hospitals shown: ${state.filtered.length} of ${total}`,
    ] : []),
    '',
    `TOP EXPANSION CANDIDATES (planning heuristic — weights cert ${sc.wCert} / EVT-dist ${sc.wEvt} / CSC-TSC-dist ${sc.wAdv}, cap ${sc.capMi} mi)`,
    ...topCandidates.map(c =>
      `  ${String(c.rank).padStart(2)}. ${c.h.displayName} (${c.h.state})  ·  ${c.h.strokeCertificationType || 'no cert'}  ·  ${formatMiles(c.evtMi)} mi to EVT  ·  score ${c.score.toFixed(0)}`),
    `  Scores rank need signals from the public dataset (certification tier on record,`,
    `  distance to EVT and CSC/TSC). They do not assess clinical operations or staffing.`,
    '',
    'BY STATE',
    ...['WA','AK','ID','MT','WY'].map(s => {
      const r = byState(s);
      return `  ${s}: ${r.total} hospitals  ·  assessed: ${r.assessed}  ·  certified: ${r.cert}  ·  EVT: ${r.evt}`;
    }),
    '',
    'METHODS — TRANSPORT ESTIMATES',
    `  Distances: great-circle (haversine). Road-distance approximated as haversine × ${ROAD_FACTOR}.`,
    `  Ground transfer time: road distance ÷ ${GROUND_MPH} mph + ${GROUND_OVERHEAD_MIN} min dispatch/load overhead.`,
    `  Air transfer time: great-circle ÷ ${AIR_MPH} mph + ${AIR_OVERHEAD_MIN} min dispatch/takeoff/landing overhead.`,
    `  These are order-of-magnitude estimates for planning only — not a substitute for live dispatch or regional air-medical protocols.`,
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
function printExecutiveSummary() {
  // Print stylesheet swaps from map-print to a one-page summary layout.
  // Cleanup only on afterprint — a timer could strip the class while the
  // dialog is still open on browsers where window.print() returns immediately
  // (iOS Safari). If afterprint never fires the class is inert on screen.
  document.body.classList.add('printing-exec');
  const cleanup = () => {
    document.body.classList.remove('printing-exec');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

// ------------------------------------------------------------------
// Exports
// ------------------------------------------------------------------
function exportHospitalsCSV() {
  toggleToolsMenu();
  // Export respects the active filters — what you see is what you get
  const src = state.filtered;
  const isSubset = src.length < state.hospitals.length;
  if (src.length === 0) { toast('No hospitals match the current filters — nothing to export', 'warning'); return; }
  const rows = [[`Planning estimates — great-circle x ${ROAD_FACTOR} road factor; ${GROUND_MPH} mph ground `
    + `+ ${GROUND_OVERHEAD_MIN} min overhead; ${AIR_MPH} mph air + ${AIR_OVERHEAD_MIN} min overhead. `
    + `Not dispatch times. "Not assessed" means stroke capability was never checked, not that none exists.`],
    ['Name', 'Aliases', 'Address', 'City', 'County', 'State', 'ZIP', 'Latitude', 'Longitude',
    'Record class', 'Stroke data status', 'Tier shown', 'Certification basis', 'National certification',
    'State designation', 'Certifying Body', 'Certification Details', 'EVT (24/7)',
    'Facility type', 'Beds', 'Health system',
    'Nearest EVT (mi)', 'Nearest CSC/TSC (mi)', 'Record id', 'CMS CCN', 'Sources']];
  for (const h of src) {
    const d = state.distances[h.id] || {};
    rows.push([
      h.displayName, (h.aliases || []).join(' | '), h.address ? titleCase(h.address) : '',
      h.city || '', h.county || '', h.state, h.zip || '',
      h.latitude, h.longitude,
      h.recordClass || '', h.strokeDataStatus || '',
      h.isCensus ? 'Not assessed' : (h.strokeCertificationType || 'None'),
      h.certificationBasis || '',
      h.nationalCertification ? `${h.nationalCertification.body} ${h.nationalCertification.tier}` : '',
      h.stateDesignation ? h.stateDesignation.label : '',
      h.certifyingBody || '', h.certificationDetails || '',
      h.isCensus ? 'Unknown' : (h.hasELVO ? 'Yes' : 'No'),
      h.hospitalType || '', h.beds ?? '', h.healthSystem || '',
      Number.isFinite(d.nearestEVTDistance) ? d.nearestEVTDistance.toFixed(1) : '',
      Number.isFinite(d.nearestAdvancedDistance) ? d.nearestAdvancedDistance.toFixed(1) : '',
      h.id, h.cmsId || '',
      (h.dataSources || []).join('; '),
    ]);
  }
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(csv, `stroke_hospitals${isSubset ? '_filtered' : ''}_${dateStr()}.csv`, 'text/csv');
  toast(`${src.length} of ${state.hospitals.length} hospitals exported${isSubset ? ' (filtered view)' : ''}`, 'success');
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
    }).catch(() => {});
    if (!window.html2canvas) { toast('Failed to load export library', 'error'); return; }
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
// Debounced wrapper — Safari throttles history.replaceState, and slider
// drags / search keystrokes can fire dozens of state changes per second.
let urlSaveTimer = null;
function scheduleURLSave() {
  clearTimeout(urlSaveTimer);
  urlSaveTimer = setTimeout(saveStateToURL, 300);
}

function saveStateToURL() {
  if (!state.map) return;
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
  // Scenario parameters (only when they differ from defaults)
  const scenarioKeys = [['wCert', 'wc'], ['wEvt', 'we'], ['wAdv', 'wa'], ['desertMi', 'dm'], ['capMi', 'cap']];
  for (const [k, short] of scenarioKeys) {
    if (state.scenario[k] !== SCENARIO_DEFAULTS[k]) params.append(short, String(state.scenario[k]));
  }
  history.replaceState(null, '', '?' + params.toString());
}
function loadStateFromURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.toString()) return;
  // Read whatever saveStateToURL writes. A hardcoded list silently dropped the
  // CENSUS pill, and the trailing applyFilters -> scheduleURLSave then rewrote
  // the address bar without it, so the recipient could not even see the loss.
  for (const k of Object.keys(state.activeFilters)) {
    if (p.has(k.toLowerCase())) {
      state.activeFilters[k] = true;
      const pill = document.querySelector(`.pill[data-filter="${k}"]`);
      if (pill) pill.setAttribute('aria-pressed', 'true');
    }
  }
  if (p.has('state')) { state.stateFilter = p.get('state'); $('#filter-state').value = state.stateFilter; }
  if (p.has('evtdist')) { state.evtDistMin = parseInt(p.get('evtdist'), 10) || 0; $('#filter-evt-distance').value = String(state.evtDistMin); $('#evt-dist-label').textContent = String(state.evtDistMin); }
  if (p.has('q')) {
    state.searchTerm = p.get('q');
    $('#search-input').value = state.searchTerm;
    // Under 768px the mobile box is the visible one; leaving it blank made a
    // shared ?q= link look like an unexplained empty result.
    const mobileSearch = $('#mobile-search-input');
    if (mobileSearch) mobileSearch.value = state.searchTerm;
  }
  if (p.has('dark')) { state.darkUI = true; document.documentElement.classList.add('dark'); }
  if (p.has('cb')) { state.cbPalette = true; document.documentElement.classList.add('cb'); }
  for (const [k, short] of [['wCert', 'wc'], ['wEvt', 'we'], ['wAdv', 'wa'], ['desertMi', 'dm'], ['capMi', 'cap']]) {
    if (p.has(short)) {
      const v = parseInt(p.get(short), 10);
      const [lo, hi] = SCENARIO_RANGES[k];
      if (Number.isFinite(v)) state.scenario[k] = Math.min(hi, Math.max(lo, v));
    }
  }
  syncScenarioControls();
  if (p.has('lat') && p.has('lng') && p.has('z')) {
    const lat = parseFloat(p.get('lat'));
    const lng = parseFloat(p.get('lng'));
    const z = parseInt(p.get('z'), 10);
    // Hand-edited URLs must not throw mid-boot
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(z)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      state.map.setView([lat, lng], z);
    }
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
  const link = el('button', { class: 'provenance-link', type: 'button', text: 'methods' });
  link.addEventListener('click', () => openModal('cert-info-modal'));
  bar.appendChild(link);
  bar.appendChild(document.createTextNode(' · '));
  const counts = `${state.hospitals.length} hospitals across WA · AK · ID · MT · WY`;
  bar.appendChild(document.createTextNode(counts));
}

// ------------------------------------------------------------------
// Responsive panels, map keyboard mode, and workspace shortcuts
// ------------------------------------------------------------------
function setDrawerBackgroundInert(activePanel, inert) {
  const selectors = ['#map', '#sidebar', '#dashboard', '#tools-fab', '#tools-menu', '#provenance-bar', '.mobile-bar'];
  selectors.forEach(selector => {
    const node = $(selector);
    if (!node || node === activePanel) return;
    if (inert) {
      node.dataset.drawerWasInert = node.hasAttribute('inert') ? '1' : '0';
      node.setAttribute('inert', '');
      node.dataset.drawerInert = '1';
    } else if (node.dataset.drawerInert === '1') {
      if (node.dataset.drawerWasInert !== '1') node.removeAttribute('inert');
      delete node.dataset.drawerInert;
      delete node.dataset.drawerWasInert;
    }
  });
}

function handleDrawerKeys(event, panel) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeMobilePanel(panel.id);
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = Array.from(panel.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(node => !node.hidden && node.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openMobilePanel(id, opener, focusTarget) {
  if (window.innerWidth > 768) return;
  if (state.mobilePanel && state.mobilePanel !== id) closeMobilePanel(state.mobilePanel, false);
  const panel = $('#' + id);
  if (!panel) return;
  state.mobilePanel = id;
  state.mobilePanelOpener = opener || document.activeElement;
  panel.classList.add('mobile-open');
  panel.removeAttribute('inert');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-hidden', 'false');
  setDrawerBackgroundInert(panel, true);
  const trigger = id === 'sidebar' ? $('#mobile-sidebar-btn') : $('#mobile-dash-btn');
  trigger?.setAttribute('aria-expanded', 'true');
  const handler = event => handleDrawerKeys(event, panel);
  state.mobileTrapHandler = handler;
  panel.addEventListener('keydown', handler);
  // focusTarget lets a caller land somewhere more useful than the Close button
  // — opening the drawer from a search should put the user on the results.
  requestAnimationFrame(() => {
    const el = (typeof focusTarget === 'function' ? focusTarget() : null)
      || panel.querySelector('.mobile-close, button, input, select');
    el?.focus();
  });
}

function closeMobilePanel(id, restoreFocus = true) {
  const panel = $('#' + id);
  if (!panel) return;
  panel.classList.remove('mobile-open');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('inert', '');
  if (state.mobileTrapHandler) panel.removeEventListener('keydown', state.mobileTrapHandler);
  state.mobileTrapHandler = null;
  setDrawerBackgroundInert(panel, false);
  const trigger = id === 'sidebar' ? $('#mobile-sidebar-btn') : $('#mobile-dash-btn');
  trigger?.setAttribute('aria-expanded', 'false');
  const opener = state.mobilePanelOpener;
  state.mobilePanel = null;
  state.mobilePanelOpener = null;
  if (restoreFocus && opener && document.contains(opener)) opener.focus();
}

function configureResponsivePanels() {
  const mobile = window.innerWidth <= 768;
  const sidebar = $('#sidebar');
  const dashboard = $('#dashboard');
  if (mobile) {
    if (!sidebar.classList.contains('mobile-open')) {
      sidebar.setAttribute('aria-hidden', 'true');
      sidebar.setAttribute('inert', '');
    }
    if (!dashboard.classList.contains('mobile-open')) {
      dashboard.setAttribute('aria-hidden', 'true');
      dashboard.setAttribute('inert', '');
    }
  } else {
    if (state.mobilePanel) closeMobilePanel(state.mobilePanel, false);
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    sidebar.removeAttribute('aria-hidden');
    sidebar.removeAttribute('inert');
    dashboard.removeAttribute('role');
    dashboard.removeAttribute('aria-modal');
    dashboard.removeAttribute('inert');
    dashboard.setAttribute('aria-hidden', String(dashboard.classList.contains('collapsed')));
  }
}

function fitMapBesideDashboard() {
  const visible = state.filtered.length ? state.filtered : state.hospitals;
  if (!visible.length) return;
  const bounds = L.latLngBounds(visible.map(h => [h.latitude, h.longitude]));
  state.map.fitBounds(bounds, {
    paddingTopLeft: [Math.min(380, Math.round(window.innerWidth * 0.34)), 48],
    paddingBottomRight: [Math.min(340, Math.round(window.innerWidth * 0.31)), 48],
    maxZoom: 9
  });
}

function setDashboardOpen(open, opener = null) {
  const dashboard = $('#dashboard');
  if (window.innerWidth <= 768) {
    if (open) openMobilePanel('dashboard', opener);
    else closeMobilePanel('dashboard');
    return;
  }
  if (open) {
    if (dashboard.classList.contains('collapsed')) {
      const center = state.map.getCenter();
      state.dashboardViewBeforeOpen = { center: [center.lat, center.lng], zoom: state.map.getZoom() };
    }
    dashboard.classList.remove('collapsed');
    dashboard.setAttribute('aria-hidden', 'false');
    localStorage.setItem('stroke-dashboard', 'open');
    requestAnimationFrame(fitMapBesideDashboard);
  } else {
    dashboard.classList.add('collapsed');
    dashboard.setAttribute('aria-hidden', 'true');
    localStorage.setItem('stroke-dashboard', 'closed');
    if (state.dashboardViewBeforeOpen) {
      state.map.setView(state.dashboardViewBeforeOpen.center, state.dashboardViewBeforeOpen.zoom);
      state.dashboardViewBeforeOpen = null;
    }
  }
  $('#mobile-dash-btn')?.setAttribute('aria-expanded', String(open));
  $('#shortcut-dashboard')?.setAttribute('aria-expanded', String(open));
}

function initializeDashboardState() {
  const shouldOpen = localStorage.getItem('stroke-dashboard') === 'open';
  $('#dashboard').classList.toggle('collapsed', !shouldOpen);
  $('#dashboard').setAttribute('aria-hidden', String(!shouldOpen));
  $('#shortcut-dashboard')?.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) requestAnimationFrame(fitMapBesideDashboard);
}

function setMapMode(active) {
  state.mapModeActive = Boolean(active);
  const mapNode = $('#map');
  mapNode.classList.toggle('map-mode-active', state.mapModeActive);
  if (state.mapModeActive) {
    mapNode.setAttribute('role', 'application');
    mapNode.setAttribute('aria-label', 'Interactive regional hospital map. Arrow keys pan; plus and minus zoom. Press Escape to return to page navigation.');
    toast('Map keyboard mode on · press Escape to leave', 'info');
  } else {
    mapNode.removeAttribute('role');
    mapNode.setAttribute('aria-label', 'Regional hospital stroke capabilities map');
    toast('Map keyboard mode off', 'info');
  }
}

function focusHospitalList() {
  const item = $$('.hospital-item')[state.activeHospitalIndex] || $('.hospital-item');
  item?.focus();
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
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.filtered && state.filtered.length === 1) {
        const h = state.filtered[0];
        panToHospital(h.id);
        showHospitalDetail(h);
      }
    }
  });
  if (mobileSearch) {
    mobileSearch.addEventListener('input', (e) => {
      onSearchInput(e.target.value);
      search.value = e.target.value;
    });
    mobileSearch.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // Enter used to do nothing unless the query happened to match exactly one
      // hospital. Everything else dead-ended: the results render into
      // #hospital-list, which lives in a drawer that is translated off-screen
      // and inert until the user taps the hamburger.
      if (!state.filtered || state.filtered.length === 0) return;
      if (state.filtered.length === 1) {
        const h = state.filtered[0];
        panToHospital(h.id);
        showHospitalDetail(h);
        return;
      }
      openMobilePanel('sidebar', mobileSearch,
        () => $$('.hospital-item')[state.activeHospitalIndex] || $('.hospital-item'));
    });
  }

  // The result count is the only feedback a mobile search gives, so make it the
  // way through to the results rather than a dead label.
  const mobileStatusEl = $('#mobile-search-status');
  if (mobileStatusEl) {
    mobileStatusEl.addEventListener('click', () => {
      if (state.filtered && state.filtered.length) {
        openMobilePanel('sidebar', mobileStatusEl,
          () => $$('.hospital-item')[state.activeHospitalIndex] || $('.hospital-item'));
      }
    });
  }

  // Clear
  $('#clear-btn').addEventListener('click', resetAll);
  $('#mobile-clear-search').addEventListener('click', (e) => {
    if (e.currentTarget.dataset.clearAll === 'true') resetAll();
    else clearSearchOnly();
  });

  // Tools FAB
  $('#tools-fab').addEventListener('click', toggleToolsMenu);

  // Tool buttons
    $('#tool-candidates').addEventListener('click', openExpansionCandidates);
    $('#tool-data-qa').addEventListener('click', openDataQA);
    $('#tool-referral').addEventListener('click', toggleReferralPathways);
    $('#tool-distance-map').addEventListener('click', showDistanceMap);
    $('#tool-evt-deserts').addEventListener('click', showEVTDeserts);
    $('#tool-zero-cap').addEventListener('click', showZeroCapability);
    $('#tool-coverage').addEventListener('click', toggleCoverageOverlay);
    $('#tool-query-location').addEventListener('click', toggleQueryMode);
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
  $('#dash-close').addEventListener('click', () => setDashboardOpen(false));

  // Mobile toggles
  $('#mobile-sidebar-btn').addEventListener('click', (event) => openMobilePanel('sidebar', event.currentTarget));
  $('#mobile-dash-btn').addEventListener('click', (event) => setDashboardOpen(true, event.currentTarget));
  $('#sidebar-close-mobile').addEventListener('click', () => closeMobilePanel('sidebar'));
  $('#dashboard-close-mobile').addEventListener('click', () => setDashboardOpen(false));

  // Visible landmark shortcuts
  $('#shortcut-map').addEventListener('click', () => {
    if (state.mobilePanel) closeMobilePanel(state.mobilePanel, false);
    $('#map').focus();
  });
  $('#shortcut-list').addEventListener('click', focusHospitalList);
  $('#shortcut-dashboard').addEventListener('click', (event) => {
    if (window.innerWidth <= 768 && state.mobilePanel === 'sidebar') closeMobilePanel('sidebar', false);
    setDashboardOpen(
      $('#dashboard').classList.contains('collapsed') || window.innerWidth <= 768,
      window.innerWidth <= 768 ? $('#mobile-dash-btn') : event.currentTarget
    );
  });
  $('#shortcut-tools').addEventListener('click', () => {
    if (window.innerWidth <= 768 && state.mobilePanel === 'sidebar') closeMobilePanel('sidebar', false);
    if (!state.toolsMenuOpen) toggleToolsMenu();
    else $('#tools-menu').querySelector('button')?.focus();
  });

  $('#map').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !state.mapModeActive) {
      event.preventDefault();
      setMapMode(true);
    } else if (event.key === 'Escape' && state.mapModeActive) {
      event.preventDefault();
      event.stopPropagation();
      setMapMode(false);
      $('#map').focus();
    }
  }, true);

  // Modal close buttons + overlay click
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.closeModal; if (id) closeModal(id); else closeAllModals();
  }));
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
    if (state.toolsMenuOpen && !e.target.closest('#tools-menu') && !e.target.closest('#tools-fab') && !e.target.closest('#shortcut-tools')) toggleToolsMenu();
  });



  // Export buttons inside modals
  $('#matrix-export-csv').addEventListener('click', exportDistanceMatrixCSV);
  $('#exec-copy').addEventListener('click', copyExecutiveSummary);
  $('#exec-download').addEventListener('click', downloadExecutiveSummary);
  $('#exec-print').addEventListener('click', printExecutiveSummary);

  // Scenario controls in the candidates modal
  bindScenarioControls();

  // Keyboard shortcuts (when focus is NOT in an input)
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      if (state.mapModeActive) {
        setMapMode(false);
        $('#map').focus();
        return;
      }
      if (state.mobilePanel) {
        closeMobilePanel(state.mobilePanel);
        return;
      }
      closeAllModals();
      if (state.toolsMenuOpen) toggleToolsMenu();
      if (state.queryModeActive) toggleQueryMode();
      return;
    }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); $('#search-input').focus(); return;
    }
    // Never shadow browser/OS shortcuts (Ctrl+R reload, Cmd+D bookmark, …)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // With a dialog open these moved focus and state behind the overlay, and
    // once focus left the modal node its keydown-bound trap could never fire
    // again. e/q/? additionally stacked a second overlay with a second trap.
    if (document.querySelector('.modal-overlay.active')) return;
    if (e.key === '/') { e.preventDefault(); $('#search-input').focus(); }
    // `r` is deliberately not a bare single key. The hospital list is a roving-
    // tabindex list of buttons, so arrow-keying it leaves focus on a button
    // where one stray keypress wiped every filter, the scenario weights and the
    // map view, with no undo and no history entry to go back to.
    if (e.key === 'R' && e.shiftKey) resetAll();
    if (e.key === 'd' || e.key === 'D') toggleDarkUI();
    if (e.key === 'e' || e.key === 'E') openExpansionCandidates();
    if (e.key === 'q' || e.key === 'Q') openDataQA();
    if (e.key === 'l' || e.key === 'L') focusHospitalList();
    if (e.key === 'm' || e.key === 'M') $('#map').focus();
    if (e.key === 'g' || e.key === 'G') setDashboardOpen(true, document.activeElement);
    if (e.key === 't' || e.key === 'T') {
      if (!state.toolsMenuOpen) toggleToolsMenu();
      else $('#tools-menu').querySelector('button')?.focus();
    }
    if (e.key === '?') openModal('cert-info-modal');
  });

  window.addEventListener('resize', configureResponsivePanels);

  // Map moveend -> update URL
  if (state.map) {
    state.map.on('moveend zoomend', scheduleURLSave);
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
  intro.appendChild(el('p', { style: { marginTop: '6px' }, text: 'This map is a public-source planning reference — not clinical routing guidance, and not an official state Department of Health product.' }));
  container.appendChild(intro);

  // The two record classes are the first thing a reader needs, because every
  // count and every blank certification on this map depends on which one applies.
  const classes = el('div', { class: 'cert-card neutral' });
  classes.appendChild(el('h4', { text: 'Two classes of record' }));
  const assessedN = state.hospitals.filter(h => !h.isCensus).length;
  const censusN = state.hospitals.filter(h => h.isCensus).length;
  const classRow = (title, body) => {
    const p = el('p', { style: { margin: '4px 0' } });
    p.appendChild(el('strong', { text: title + ': ' }));
    p.appendChild(document.createTextNode(body));
    classes.appendChild(p);
  };
  classRow(`Stroke capability (${assessedN})`,
    'Certification verified against primary sources. No certification shown here means checked '
    + 'and none found.');
  classRow(`Not assessed (${censusN})`,
    'Facility identity from the CMS acute-care census, included so every hospital in the region '
    + 'is findable. Stroke capability has not been checked — no certification shown means '
    + 'unknown, not none. These records are excluded from all certification statistics and from '
    + 'expansion-candidate scoring, but still get full transport analysis.');
  container.appendChild(classes);

  // State designation vs national accreditation.
  const stateOnly = state.hospitals.filter(h => h.certificationBasis === 'state').length;
  const basis = el('div', { class: 'cert-card neutral' });
  basis.appendChild(el('h4', { text: 'National certification vs. state designation' }));
  basis.appendChild(el('p', { text:
    `${stateOnly} of the ${assessedN} assessed hospitals display a tier derived from a state `
    + 'stroke designation (Washington ECS, Idaho TSE) with no national accreditation on record. '
    + 'For those, the CSC/TSC/PSC/ASR tier is this app\u2019s mapping of a state level onto the '
    + 'national ladder \u2014 not a Joint Commission, DNV, ACHC or CIHQ finding. They are marked '
    + 'with a dashed state badge in the list, and their detail view names both the national status '
    + 'and the state designation separately.' }));
  container.appendChild(basis);

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
    buildMarkerCache();
    bindEvents();
    buildCertInfo();
    loadStateFromURL();
    applyFilters({ skipZoom: true });
    initializeDashboardState();
    configureResponsivePanels();
    state.initialized = true;
    toast(`Loaded ${state.hospitals.length} hospitals`, 'success');
  } catch (err) {
    console.error('Boot failed:', err);
    reportBootFailure(err);
  }
}

// A failed boot used to leave the page on "Loading…" indefinitely with only a
// console message — indistinguishable from a slow network to anyone not
// looking at devtools. Say what broke, on screen, with a way to retry.
function reportBootFailure(err) {
  const missingMapLib = typeof window.L === 'undefined';
  const status = $('#status-bar');
  if (status) status.textContent = 'Could not load — see message on the map.';
  const mobileStatus = $('#mobile-search-status');
  if (mobileStatus) mobileStatus.textContent = 'Could not load hospital data.';

  const mapEl = $('#map');
  if (!mapEl || mapEl.querySelector('.boot-error')) return;
  const box = el('div', { class: 'boot-error', role: 'alert' });
  box.appendChild(el('h2', { text: 'This page could not start' }));
  box.appendChild(el('p', {
    text: missingMapLib
      ? 'The mapping library did not load. This usually means the network is blocking '
        + 'part of the page — some hospital and corporate networks do.'
      : 'The hospital dataset could not be loaded.',
  }));
  box.appendChild(el('p', { class: 'boot-error-detail', text: String(err && err.message || err) }));
  box.appendChild(el('button', {
    class: 'btn btn-primary', type: 'button', text: 'Retry',
    onclick: () => window.location.reload(),
  }));
  mapEl.appendChild(box);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
