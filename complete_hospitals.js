// =============================================================================
// Regional Hospital Stroke Capabilities — Complete Application
// =============================================================================

// ---------------------------------------------------------------------------
// State & Configuration
// ---------------------------------------------------------------------------
const CERT_COLORS = { CSC:'#dc2626', TSC:'#ea580c', PSC:'#f59e0b', ASR:'#84cc16' };
const UW_COLOR = '#3b82f6';
const OTHER_COLOR = '#6b7280';
const EVT_COLOR = '#10b981';

let HOSPITALS = [];
let map, tileLayer;
let markers = [];
let hospitalDistances = {};
let advancedCenters = [];
let evtCenters = [];

// Feature overlays
let uwNetworkLines = [];
let uwNetworkVisible = false;
let referralLines = [];
let referralLinesVisible = false;
let coverageCircles = [];
let coverageVisible = false;

// State
let activeFilters = { CSC:false, TSC:false, PSC:false, ASR:false, EVT:false, UW:false };
let darkMapMode = false;
let searchDebounceTimer = null;
let toolsMenuOpen = false;

// ---------------------------------------------------------------------------
// Toast Notification System
// ---------------------------------------------------------------------------
function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const colors = { info:'bg-indigo-600', success:'bg-emerald-600', warning:'bg-amber-500', error:'bg-red-600' };
    const el = document.createElement('div');
    el.className = `toast ${colors[type] || colors.info} text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium`;
    el.textContent = message;
    el.style.animationDuration = `0.3s, 0.3s`;
    el.style.animationDelay = `0s, ${(duration-300)/1000}s`;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
}

// ---------------------------------------------------------------------------
// Name Normalization (Title Case preserving acronyms)
// ---------------------------------------------------------------------------
const ACRONYMS = new Set(['AMC','UW','VA','CHI','DNV','CMS','OHSU','EIRMC','SW','NE','SE','NW','ST','DR','AVE','PO','FT','N','S','E','W']);
function toTitleCase(str) {
    if (!str) return str;
    return str.split(/\s+/).map(w => {
        const upper = w.toUpperCase();
        if (ACRONYMS.has(upper)) return upper;
        if (w.length <= 2) return upper;
        if (upper.includes('-')) return upper.split('-').map(p => p.charAt(0)+p.slice(1).toLowerCase()).join('-');
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
}

// ---------------------------------------------------------------------------
// City Extraction
// ---------------------------------------------------------------------------
function extractCity(hospital) {
    if (hospital.city) return hospital.city;
    // Try to parse city from address field if it contains city/state/zip
    const addr = hospital.address || '';
    const stateAbbr = hospital.state || '';
    // Pattern: "... CITY STATE ZIP"
    const regex = new RegExp(`([A-Za-z\\s]+)\\s+${stateAbbr}\\s+\\d{5}`, 'i');
    const match = addr.match(regex);
    if (match) return toTitleCase(match[1].trim());
    // Fallback: use zip-to-city rough mapping
    return '';
}

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------
fetch('complete_hospitals_geocoded.json')
    .then(r => r.json())
    .then(data => {
        HOSPITALS = data.filter(h => h.latitude && h.longitude).map(h => ({
            ...h,
            displayName: toTitleCase(h.name),
            city: extractCity(h),
        }));
        advancedCenters = HOSPITALS.filter(h => h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC');
        evtCenters = HOSPITALS.filter(h => h.hasELVO === true);
        preCalculateDistances();
        initializeMap();
        renderDashboard();
        toast(`Loaded ${HOSPITALS.length} hospitals`, 'success');
    })
    .catch(err => {
        console.error('Error loading data:', err);
        toast('Error loading hospital data. Refresh to retry.', 'error', 5000);
    });

// ---------------------------------------------------------------------------
// Map Initialization
// ---------------------------------------------------------------------------
function initializeMap() {
    map = L.map('map', { zoomControl: false }).setView([47.5, -120.5], 7);
    tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap, &copy; CARTO',
        maxZoom: 19, subdomains: 'abcd'
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Map legend as Leaflet control
    const LegendControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function() {
            const div = L.DomUtil.create('div', 'map-legend');
            const items = [
                ['#dc2626','CSC'],['#ea580c','TSC'],['#f59e0b','PSC'],['#84cc16','ASR'],
                ['#3b82f6','Partner'],['#10b981','EVT'],['#6b7280','Other']
            ];
            div.innerHTML = items.map(([c,l]) =>
                `<span class="entry"><span class="dot" style="background:${c}"></span>${l}</span>`
            ).join('');
            // Add cert info link
            div.innerHTML += '<span class="entry" style="cursor:pointer;color:#6366f1;font-weight:600;" onclick="showCertInfo()">?</span>';
            L.DomEvent.disableClickPropagation(div);
            return div;
        }
    });
    new LegendControl().addTo(map);

    applyFilters();
    loadStateFromURL();

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey && e.key === 'f') || (e.key === '/' && document.activeElement.tagName !== 'INPUT')) {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
        if (e.key === 'Escape') {
            closeAllModals();
            if (toolsMenuOpen) toggleToolsMenu();
        }
        if ((e.key === 'r' || e.key === 'R') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            resetAllFilters();
        }
    });

    // Search debounce
    const searchInput = document.getElementById('search-input');
    const mobileInput = document.getElementById('mobile-search-input');
    searchInput.addEventListener('input', () => { debouncedFilter(); if(mobileInput) mobileInput.value = searchInput.value; });
    if (mobileInput) mobileInput.addEventListener('input', () => { searchInput.value = mobileInput.value; debouncedFilter(); });
}

function debouncedFilter() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(applyFilters, 200);
}
function syncSearch(val) {
    document.getElementById('search-input').value = val;
    debouncedFilter();
}

// ---------------------------------------------------------------------------
// Marker Helpers
// ---------------------------------------------------------------------------
function getMarkerColor(h) {
    if (h.strokeCertificationType && CERT_COLORS[h.strokeCertificationType]) return CERT_COLORS[h.strokeCertificationType];
    if (h.uwPartner) return UW_COLOR;
    return OTHER_COLOR;
}
function getMarkerSize(h) {
    const sizes = { CSC:12, TSC:11, PSC:10, ASR:9 };
    return sizes[h.strokeCertificationType] || (h.uwPartner ? 9 : 7);
}

// ---------------------------------------------------------------------------
// Core Filtering & Rendering
// ---------------------------------------------------------------------------
function applyFilters() {
    clearFeatureOverlays();
    const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
    const stateFilter = document.getElementById('filter-state').value;
    const evtDistFilter = parseInt(document.getElementById('filter-evt-distance').value) || 0;
    const anyPillActive = Object.values(activeFilters).some(v => v);

    const filtered = HOSPITALS.filter(h => {
        // Search: name, address, city, state, cert type
        if (searchTerm) {
            const haystack = [h.name, h.displayName, h.address, h.city, h.state, h.strokeCertificationType || '', h.certifyingBody || ''].join(' ').toLowerCase();
            if (!haystack.includes(searchTerm)) return false;
        }
        // State filter
        if (stateFilter !== 'ALL' && h.state !== stateFilter) return false;
        // EVT distance filter
        if (evtDistFilter > 0) {
            const dist = hospitalDistances[h.cmsId]?.nearestEVTDistance || 0;
            if (dist <= evtDistFilter || dist === Infinity || dist === 0) return false;
        }
        // Pill filters (OR logic)
        if (anyPillActive) {
            let pass = false;
            if (activeFilters.CSC && h.strokeCertificationType === 'CSC') pass = true;
            if (activeFilters.TSC && h.strokeCertificationType === 'TSC') pass = true;
            if (activeFilters.PSC && h.strokeCertificationType === 'PSC') pass = true;
            if (activeFilters.ASR && h.strokeCertificationType === 'ASR') pass = true;
            if (activeFilters.EVT && h.hasELVO) pass = true;
            if (activeFilters.UW && h.uwPartner) pass = true;
            if (!pass) return false;
        }
        return true;
    });

    renderMarkers(filtered);
    updateHospitalList(filtered);
    updateStatusBar(filtered);
    updateDashboardStats(filtered);
    updateClearButton();

    // Auto-zoom to filtered results
    if ((stateFilter !== 'ALL' || anyPillActive || searchTerm) && filtered.length > 0 && filtered.length < HOSPITALS.length) {
        const bounds = L.latLngBounds(filtered.map(h => [h.latitude, h.longitude]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }
}

function renderMarkers(filtered) {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    filtered.forEach(hospital => {
        const color = getMarkerColor(hospital);
        const size = getMarkerSize(hospital);
        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size, fillColor: color, color: 'white', weight: 2, opacity: 1, fillOpacity: 0.8
        });
        marker.bindPopup(buildPopup(hospital));
        marker.on('click', () => showHospitalDetail(hospital));
        marker.hospitalData = hospital;
        marker.addTo(map);
        markers.push(marker);
    });
}

function buildPopup(h) {
    const color = getMarkerColor(h);
    const certNames = { CSC:'Comprehensive Stroke Center', TSC:'Thrombectomy-Capable', PSC:'Primary Stroke Center', ASR:'Acute Stroke Ready' };
    let html = `<div style="font-family:sans-serif;min-width:280px;">`;
    html += `<h3 style="font-size:15px;font-weight:700;margin-bottom:6px;color:${color};">${h.displayName}</h3>`;
    html += `<div style="font-size:12px;line-height:1.6;">`;
    html += `<strong>Address:</strong> ${h.address}${h.city ? ', '+h.city : ''}, ${h.state} ${h.zip || ''}<br>`;
    if (h.strokeCertificationType) {
        html += `<strong>Certification:</strong> ${certNames[h.strokeCertificationType] || h.strokeCertificationType} (${h.strokeCertificationType})<br>`;
        if (h.certifyingBody) html += `<strong>Certifying Body:</strong> ${h.certifyingBody}<br>`;
    }
    if (h.hasELVO) html += `<strong style="color:${EVT_COLOR};">24/7 Thrombectomy (EVT)</strong><br>`;
    if (h.uwPartner) html += `<strong style="color:${UW_COLOR};">&#10003; Telestroke Partner</strong><br>`;

    // Transfer time to nearest CSC (not just Harborview)
    const dist = hospitalDistances[h.cmsId];
    if (dist && dist.nearestAdvancedDistance > 0 && dist.nearestAdvancedDistance < Infinity) {
        const d = dist.nearestAdvancedDistance;
        const ground = Math.round(d / 60 * 60 / 5) * 5;
        const air = Math.round(d / 150 * 60 / 5) * 5;
        html += `<br><strong>Nearest CSC/TSC:</strong> ${toTitleCase(dist.nearestAdvancedName)}<br>`;
        html += `~${ground} min ground / ~${air} min air (${d.toFixed(0)} mi)<br>`;
        html += `<span style="font-size:10px;color:#9ca3af;">60 mph ground, 150 mph air estimates</span>`;
    }
    html += `</div></div>`;
    return html;
}

// ---------------------------------------------------------------------------
// Status Bar & Hospital List
// ---------------------------------------------------------------------------
function updateStatusBar(filtered) {
    const el = document.getElementById('status-bar');
    el.textContent = `Showing ${filtered.length} of ${HOSPITALS.length} hospitals`;
    document.getElementById('list-count').textContent = filtered.length;
}

function updateClearButton() {
    const anyActive = Object.values(activeFilters).some(v => v) ||
        document.getElementById('filter-state').value !== 'ALL' ||
        parseInt(document.getElementById('filter-evt-distance').value) > 0 ||
        document.getElementById('search-input').value.trim() !== '';
    document.getElementById('clear-btn').classList.toggle('hidden', !anyActive);
}

function updateHospitalList(filtered) {
    const list = document.getElementById('hospital-list');
    if (filtered.length === 0) {
        list.innerHTML = '<div class="px-4 py-8 text-center text-sm text-gray-400">No hospitals match your filters</div>';
        return;
    }
    // Sort: CSC first, then TSC, PSC, ASR, UW, others
    const order = { CSC:0, TSC:1, PSC:2, ASR:3 };
    const sorted = [...filtered].sort((a, b) => {
        const oa = order[a.strokeCertificationType] ?? (a.uwPartner ? 4 : 5);
        const ob = order[b.strokeCertificationType] ?? (b.uwPartner ? 4 : 5);
        return oa - ob || a.displayName.localeCompare(b.displayName);
    });

    list.innerHTML = sorted.map(h => {
        const color = getMarkerColor(h);
        const loc = [h.city, h.state].filter(Boolean).join(', ') || h.state;
        let badges = '';
        if (h.strokeCertificationType) badges += `<span class="badge" style="background:${CERT_COLORS[h.strokeCertificationType]}20;color:${CERT_COLORS[h.strokeCertificationType]};">${h.strokeCertificationType}</span>`;
        if (h.hasELVO) badges += `<span class="badge" style="background:${EVT_COLOR}20;color:${EVT_COLOR};">EVT</span>`;
        if (h.uwPartner) badges += `<span class="badge" style="background:${UW_COLOR}20;color:${UW_COLOR};">Partner</span>`;
        return `<div class="hospital-item" onclick="panToHospital('${h.cmsId}')" data-cms="${h.cmsId}">
            <span class="dot" style="background:${color};"></span>
            <div class="flex-1 min-w-0">
                <div class="name truncate">${h.displayName}</div>
                <div class="meta">${loc}${h.zip ? ' ' + h.zip : ''}</div>
                <div class="badges">${badges}</div>
            </div>
        </div>`;
    }).join('');
}

function panToHospital(cmsId) {
    const h = HOSPITALS.find(h => h.cmsId === cmsId);
    if (!h) return;
    map.setView([h.latitude, h.longitude], 12);
    const marker = markers.find(m => m.hospitalData?.cmsId === cmsId);
    if (marker) marker.openPopup();
    // Highlight in list
    document.querySelectorAll('.hospital-item').forEach(el => el.classList.remove('highlighted'));
    const item = document.querySelector(`.hospital-item[data-cms="${cmsId}"]`);
    if (item) { item.classList.add('highlighted'); item.scrollIntoView({ block: 'nearest' }); }
}

// ---------------------------------------------------------------------------
// Filter Controls
// ---------------------------------------------------------------------------
function toggleFilter(filterKey) {
    activeFilters[filterKey] = !activeFilters[filterKey];
    // Update pill visual
    const pill = document.querySelector(`.pill[data-filter="${filterKey}"]`);
    if (pill) pill.classList.toggle(`active-${filterKey.toLowerCase()}`);
    applyFilters();
}

function resetAllFilters() {
    Object.keys(activeFilters).forEach(k => activeFilters[k] = false);
    document.querySelectorAll('.pill').forEach(p => {
        p.className = 'pill'; // Remove all active-* classes
    });
    document.getElementById('filter-state').value = 'ALL';
    document.getElementById('filter-evt-distance').value = 0;
    document.getElementById('evt-dist-label').textContent = '0';
    document.getElementById('search-input').value = '';
    const mobile = document.getElementById('mobile-search-input');
    if (mobile) mobile.value = '';
    clearFeatureOverlays();
    applyFilters();
    map.setView([47.5, -120.5], 7);
    toast('All filters reset');
}

// ---------------------------------------------------------------------------
// Distance Pre-Calculation
// ---------------------------------------------------------------------------
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function preCalculateDistances() {
    HOSPITALS.forEach(h => {
        hospitalDistances[h.cmsId] = {
            nearestAdvanced: null, nearestAdvancedDistance: Infinity, nearestAdvancedName: '',
            nearestEVT: null, nearestEVTDistance: Infinity, nearestEVTName: ''
        };
        advancedCenters.forEach(c => {
            if (c.cmsId === h.cmsId) return;
            const d = calculateDistance(h.latitude, h.longitude, c.latitude, c.longitude);
            if (d < hospitalDistances[h.cmsId].nearestAdvancedDistance) {
                hospitalDistances[h.cmsId].nearestAdvancedDistance = d;
                hospitalDistances[h.cmsId].nearestAdvanced = c;
                hospitalDistances[h.cmsId].nearestAdvancedName = c.name;
            }
        });
        evtCenters.forEach(c => {
            if (c.cmsId === h.cmsId) return;
            const d = calculateDistance(h.latitude, h.longitude, c.latitude, c.longitude);
            if (d < hospitalDistances[h.cmsId].nearestEVTDistance) {
                hospitalDistances[h.cmsId].nearestEVTDistance = d;
                hospitalDistances[h.cmsId].nearestEVT = c;
                hospitalDistances[h.cmsId].nearestEVTName = c.name;
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Dashboard Charts
// ---------------------------------------------------------------------------
function renderDashboard() {
    renderDonutChart();
    renderStateBars();
    renderGapMetrics();
    renderHistogram();
}

function updateDashboardStats(filtered) {
    // Update gap metrics with filtered data
    renderGapMetrics(filtered);
}

function renderDonutChart() {
    const canvas = document.getElementById('donut-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = 90, cy = 90, r = 65, lw = 28;
    ctx.clearRect(0, 0, 180, 180);

    const counts = {
        CSC: HOSPITALS.filter(h => h.strokeCertificationType === 'CSC').length,
        TSC: HOSPITALS.filter(h => h.strokeCertificationType === 'TSC').length,
        PSC: HOSPITALS.filter(h => h.strokeCertificationType === 'PSC').length,
        ASR: HOSPITALS.filter(h => h.strokeCertificationType === 'ASR').length,
        None: HOSPITALS.filter(h => !h.strokeCertificationType).length,
    };
    const total = HOSPITALS.length;
    const segments = [
        { label:'CSC', count:counts.CSC, color:'#dc2626' },
        { label:'TSC', count:counts.TSC, color:'#ea580c' },
        { label:'PSC', count:counts.PSC, color:'#f59e0b' },
        { label:'ASR', count:counts.ASR, color:'#84cc16' },
        { label:'None', count:counts.None, color:'#d1d5db' },
    ];

    let angle = -Math.PI / 2;
    segments.forEach(seg => {
        if (seg.count === 0) return;
        const sweep = (seg.count / total) * 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle, angle + sweep);
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = lw;
        ctx.lineCap = 'butt';
        ctx.stroke();
        angle += sweep;
    });

    // Center text
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total, cx, cy - 6);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('hospitals', cx, cy + 12);

    // Small legend below
    ctx.font = '9px sans-serif';
    const legendY = 170;
    let lx = 10;
    segments.forEach(seg => {
        if (seg.count === 0) return;
        ctx.fillStyle = seg.color;
        ctx.fillRect(lx, legendY, 8, 8);
        ctx.fillStyle = '#6b7280';
        ctx.fillText(`${seg.label}:${seg.count}`, lx + 10, legendY + 7);
        lx += ctx.measureText(`${seg.label}:${seg.count}`).width + 18;
    });
}

function renderStateBars() {
    const container = document.getElementById('state-bars');
    if (!container) return;
    const states = ['WA','AK','ID','MT','WY'];
    const maxCount = Math.max(...states.map(s => HOSPITALS.filter(h => h.state === s).length));

    container.innerHTML = states.map(s => {
        const all = HOSPITALS.filter(h => h.state === s);
        const csc = all.filter(h => h.strokeCertificationType === 'CSC').length;
        const tsc = all.filter(h => h.strokeCertificationType === 'TSC').length;
        const psc = all.filter(h => h.strokeCertificationType === 'PSC').length;
        const asr = all.filter(h => h.strokeCertificationType === 'ASR').length;
        const none = all.length - csc - tsc - psc - asr;
        const pct = (v) => (v / maxCount * 100).toFixed(1);

        return `<div class="flex items-center gap-2 mb-1.5">
            <span class="text-[11px] font-semibold text-gray-600 w-6">${s}</span>
            <div class="flex-1 h-4 bg-gray-100 rounded overflow-hidden flex">
                ${csc ? `<div style="width:${pct(csc)}%;background:#dc2626;" title="CSC: ${csc}"></div>` : ''}
                ${tsc ? `<div style="width:${pct(tsc)}%;background:#ea580c;" title="TSC: ${tsc}"></div>` : ''}
                ${psc ? `<div style="width:${pct(psc)}%;background:#f59e0b;" title="PSC: ${psc}"></div>` : ''}
                ${asr ? `<div style="width:${pct(asr)}%;background:#84cc16;" title="ASR: ${asr}"></div>` : ''}
                ${none ? `<div style="width:${pct(none)}%;background:#e5e7eb;" title="None: ${none}"></div>` : ''}
            </div>
            <span class="text-[10px] text-gray-400 w-6 text-right">${all.length}</span>
        </div>`;
    }).join('');
}

function renderGapMetrics(filtered) {
    const container = document.getElementById('gap-metrics');
    if (!container) return;
    const src = filtered || HOSPITALS;
    const noCert = src.filter(h => !h.strokeCertificationType).length;
    const notUW = src.filter(h => !h.uwPartner).length;
    const evtDeserts = src.filter(h => (hospitalDistances[h.cmsId]?.nearestEVTDistance || 0) > 100).length;
    const zeroCapability = src.filter(h => !h.strokeCertificationType && !h.uwPartner).length;
    const evtCount = src.filter(h => h.hasELVO).length;

    container.innerHTML = [
        { label: 'No certification', value: noCert, color: '#ef4444' },
        { label: 'Not partner', value: notUW, color: '#6b7280' },
        { label: 'EVT deserts (>100mi)', value: evtDeserts, color: '#f59e0b' },
        { label: 'Zero capability', value: zeroCapability, color: '#dc2626' },
        { label: 'EVT-capable', value: evtCount, color: '#10b981' },
    ].map(m => `<div class="metric-row"><span class="label">${m.label}</span><span class="value" style="color:${m.color}">${m.value}</span></div>`).join('');
}

function renderHistogram() {
    const canvas = document.getElementById('histogram-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 248, 100);

    const buckets = [0, 25, 50, 75, 100, 150, 300];
    const labels = ['0-25', '25-50', '50-75', '75-100', '100-150', '150+'];
    const counts = new Array(labels.length).fill(0);

    HOSPITALS.forEach(h => {
        const d = hospitalDistances[h.cmsId]?.nearestEVTDistance;
        if (!d || d === Infinity || d === 0) return; // Skip EVT centers themselves
        for (let i = 0; i < buckets.length - 1; i++) {
            if (d >= buckets[i] && d < buckets[i+1]) { counts[i]++; break; }
        }
    });

    const maxCount = Math.max(...counts, 1);
    const barW = 34, gap = 4, baseY = 82, maxH = 65;
    const startX = 10;

    counts.forEach((c, i) => {
        const x = startX + i * (barW + gap);
        const h = (c / maxCount) * maxH;
        const color = i >= 4 ? '#ef4444' : i >= 3 ? '#f59e0b' : '#10b981';
        ctx.fillStyle = color;
        ctx.fillRect(x, baseY - h, barW, h);
        // Count on top
        if (c > 0) {
            ctx.fillStyle = '#374151';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(c, x + barW/2, baseY - h - 3);
        }
        // Label below
        ctx.fillStyle = '#9ca3af';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], x + barW/2, baseY + 10);
    });

    // Axis label
    ctx.fillStyle = '#9ca3af';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('miles', 130, baseY + 20);
}

// ---------------------------------------------------------------------------
// Hospital Detail Modal
// ---------------------------------------------------------------------------
function showHospitalDetail(hospital) {
    const h = hospital;
    const dist = hospitalDistances[h.cmsId] || {};
    document.getElementById('detail-title').textContent = h.displayName;

    let html = '';
    // Location
    html += `<div class="bg-gray-50 p-3 rounded-lg mb-3 text-sm leading-relaxed">
        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-1">Location</h3>
        <strong>Address:</strong> ${h.address}<br>
        ${h.city ? `<strong>City:</strong> ${h.city}<br>` : ''}
        <strong>State/ZIP:</strong> ${h.state} ${h.zip || ''}<br>
        <strong>CMS ID:</strong> ${h.cmsId}
    </div>`;

    // Capabilities
    const certNames = { CSC:'Comprehensive Stroke Center', TSC:'Thrombectomy-Capable', PSC:'Primary Stroke Center', ASR:'Acute Stroke Ready' };
    html += `<div class="bg-gray-50 p-3 rounded-lg mb-3 text-sm leading-relaxed">
        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-1">Stroke Capabilities</h3>`;
    if (h.strokeCertificationType) {
        html += `<strong>Certification:</strong> ${certNames[h.strokeCertificationType]} (${h.strokeCertificationType})<br>`;
        if (h.certifyingBody) html += `<strong>Certifying Body:</strong> ${h.certifyingBody}<br>`;
        if (h.certificationDetails) html += `<strong>Details:</strong> ${h.certificationDetails}<br>`;
    } else {
        html += `<strong>Certification:</strong> <span class="text-red-500">None</span><br>`;
    }
    html += `<strong>EVT Capability:</strong> ${h.hasELVO ? '<span class="text-emerald-600 font-semibold">Yes &mdash; 24/7 Thrombectomy</span>' : 'No'}<br>`;
    html += `<strong>Partner:</strong> ${h.uwPartner ? '<span class="text-blue-600 font-semibold">Yes</span>' : 'No'}`;
    html += `</div>`;

    // Distance analysis
    if (dist.nearestAdvancedDistance > 0 && dist.nearestAdvancedDistance < Infinity) {
        const dAdv = dist.nearestAdvancedDistance;
        const dEVT = dist.nearestEVTDistance;
        html += `<div class="bg-gray-50 p-3 rounded-lg mb-3 text-sm leading-relaxed">
            <h3 class="text-xs font-semibold text-gray-400 uppercase mb-1">Distance Analysis</h3>
            <strong>Nearest CSC/TSC:</strong> ${toTitleCase(dist.nearestAdvancedName)} (${dAdv.toFixed(1)} mi)<br>
            <strong>Ground transfer:</strong> ~${Math.round(dAdv/60*60/5)*5} min &nbsp; <strong>Air:</strong> ~${Math.round(dAdv/150*60/5)*5} min<br>`;
        if (dEVT > 0 && dEVT < Infinity) {
            html += `<strong>Nearest EVT:</strong> ${toTitleCase(dist.nearestEVTName)} (${dEVT.toFixed(1)} mi)`;
        }
        html += `</div>`;
    }

    // Nearby hospitals
    const nearby = HOSPITALS
        .filter(n => n.cmsId !== h.cmsId)
        .map(n => ({ ...n, dist: calculateDistance(h.latitude, h.longitude, n.latitude, n.longitude) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

    html += `<div class="bg-gray-50 p-3 rounded-lg mb-3 text-sm">
        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-1">Nearby Hospitals</h3>
        <div class="space-y-1.5">`;
    nearby.forEach(n => {
        const certBadge = n.strokeCertificationType ? `<span class="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded" style="background:${CERT_COLORS[n.strokeCertificationType]}20;color:${CERT_COLORS[n.strokeCertificationType]};">${n.strokeCertificationType}</span>` : '';
        html += `<div class="flex items-center justify-between">
            <span class="text-xs">${toTitleCase(n.name)} ${certBadge}${n.hasELVO ? ' <span class="text-emerald-600 text-[9px] font-bold">EVT</span>':''}</span>
            <span class="text-[10px] text-gray-400 whitespace-nowrap ml-2">${n.dist.toFixed(0)} mi</span>
        </div>`;
    });
    html += `</div></div>`;

    // Data sources
    if (h.dataSources?.length) {
        html += `<div class="text-[11px] text-gray-400 pt-2 border-t"><strong>Sources:</strong> ${h.dataSources.join(', ')}</div>`;
    }

    document.getElementById('hospital-detail-content').innerHTML = html;
    openModal('hospital-detail-modal');
}

// ---------------------------------------------------------------------------
// Modal Management
// ---------------------------------------------------------------------------
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}
function showCertInfo() { openModal('cert-info-modal'); }
function closeCertInfo() { closeModal('cert-info-modal'); }

// Close modal when clicking overlay
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ---------------------------------------------------------------------------
// Tools Menu
// ---------------------------------------------------------------------------
function toggleToolsMenu() {
    const menu = document.getElementById('tools-menu');
    toolsMenuOpen = !toolsMenuOpen;
    menu.classList.toggle('hidden');
    const fab = document.getElementById('tools-fab');
    fab.style.transform = toolsMenuOpen ? 'rotate(90deg)' : '';
}

// Close tools menu when clicking elsewhere
document.addEventListener('click', e => {
    if (toolsMenuOpen && !e.target.closest('#tools-menu') && !e.target.closest('#tools-fab')) {
        toggleToolsMenu();
    }
});

// ---------------------------------------------------------------------------
// Dashboard & Sidebar Toggle
// ---------------------------------------------------------------------------
function toggleDashboard() {
    document.getElementById('dashboard').classList.toggle('collapsed');
}
function toggleMobileSidebar() {
    document.getElementById('sidebar').classList.toggle('mobile-open');
}
function toggleMobileDashboard() {
    document.getElementById('dashboard').classList.toggle('mobile-open');
}

// ---------------------------------------------------------------------------
// Analysis Tools
// ---------------------------------------------------------------------------
function clearFeatureOverlays() {
    uwNetworkLines.forEach(l => map.removeLayer(l)); uwNetworkLines = []; uwNetworkVisible = false;
    referralLines.forEach(l => map.removeLayer(l)); referralLines = []; referralLinesVisible = false;
    coverageCircles.forEach(c => map.removeLayer(c)); coverageCircles = []; coverageVisible = false;
}

// Partner Network
function toggleUWPartnerNetwork() {
    toggleToolsMenu();
    if (uwNetworkVisible) {
        uwNetworkLines.forEach(l => map.removeLayer(l)); uwNetworkLines = []; uwNetworkVisible = false;
        toast('Partner network lines removed');
        return;
    }
    const harborview = HOSPITALS.find(h => h.name.includes('HARBORVIEW'));
    if (!harborview) return;
    const partners = HOSPITALS.filter(h => h.uwPartner);
    partners.forEach(h => {
        const line = L.polyline([[h.latitude,h.longitude],[harborview.latitude,harborview.longitude]], {
            color: UW_COLOR, weight: 2, opacity: 0.5, dashArray: '5,10'
        }).addTo(map);
        uwNetworkLines.push(line);
    });
    uwNetworkVisible = true;
    toast(`${partners.length} partners connected to hub`);
}

// Referral Pathways
function toggleReferralPathways() {
    toggleToolsMenu();
    if (referralLinesVisible) {
        referralLines.forEach(l => map.removeLayer(l)); referralLines = []; referralLinesVisible = false;
        toast('Referral pathways removed');
        return;
    }
    let count = 0;
    HOSPITALS.forEach(h => {
        if (h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC') return;
        const dist = hospitalDistances[h.cmsId];
        if (!dist?.nearestAdvanced || dist.nearestAdvancedDistance === Infinity) return;
        const d = dist.nearestAdvancedDistance;
        const color = d < 50 ? '#10b981' : d <= 100 ? '#f59e0b' : d <= 150 ? '#ea580c' : '#dc2626';
        const line = L.polyline([[h.latitude,h.longitude],[dist.nearestAdvanced.latitude,dist.nearestAdvanced.longitude]], {
            color, weight: d > 100 ? 2 : 1, opacity: 0.4, dashArray: '5,10'
        }).addTo(map);
        referralLines.push(line);
        count++;
    });
    referralLinesVisible = true;
    toast(`${count} referral pathways shown (green <50mi, yellow 50-100mi, orange 100-150mi, red >150mi)`);
}

// CSC/TSC Distance Map
function showNearestAdvancedCenter() {
    toggleToolsMenu();
    markers.forEach(m => map.removeLayer(m)); markers = [];
    HOSPITALS.forEach(h => {
        const dist = hospitalDistances[h.cmsId]?.nearestAdvancedDistance || Infinity;
        let color;
        if (dist === Infinity || dist === 0) color = '#dc2626';
        else if (dist < 50) color = '#10b981';
        else if (dist <= 100) color = '#f59e0b';
        else color = '#ef4444';
        const marker = L.circleMarker([h.latitude,h.longitude], {
            radius: getMarkerSize(h), fillColor: color, color: 'white', weight: 2, opacity: 1, fillOpacity: 0.9
        });
        marker.bindPopup(buildPopup(h));
        marker.on('click', () => showHospitalDetail(h));
        marker.hospitalData = h;
        marker.addTo(map);
        markers.push(marker);
    });
    const under50 = HOSPITALS.filter(h => { const d = hospitalDistances[h.cmsId]?.nearestAdvancedDistance; return d > 0 && d < 50 && d < Infinity; }).length;
    const mid = HOSPITALS.filter(h => { const d = hospitalDistances[h.cmsId]?.nearestAdvancedDistance; return d >= 50 && d <= 100; }).length;
    const over = HOSPITALS.filter(h => { const d = hospitalDistances[h.cmsId]?.nearestAdvancedDistance; return d > 100 && d < Infinity; }).length;
    toast(`CSC/TSC Distance: ${under50} <50mi, ${mid} 50-100mi, ${over} >100mi`);
}

// EVT Deserts
function identifyEVTDeserts() {
    toggleToolsMenu();
    markers.forEach(m => map.removeLayer(m)); markers = [];
    let desertCount = 0;
    HOSPITALS.forEach(h => {
        const dist = hospitalDistances[h.cmsId]?.nearestEVTDistance || Infinity;
        const isEVT = h.hasELVO;
        const isDesert = !isEVT && dist > 100;
        if (isDesert) desertCount++;
        const color = isEVT ? EVT_COLOR : isDesert ? '#ef4444' : OTHER_COLOR;
        const size = isEVT ? 12 : isDesert ? 10 : 7;
        const marker = L.circleMarker([h.latitude,h.longitude], {
            radius: size, fillColor: color, color: isDesert ? '#dc2626' : 'white',
            weight: isDesert ? 3 : 2, opacity: 1, fillOpacity: isDesert ? 0.9 : 0.6
        });
        marker.bindPopup(buildPopup(h));
        marker.on('click', () => showHospitalDetail(h));
        marker.hospitalData = h;
        marker.addTo(map);
        markers.push(marker);
    });
    toast(`${desertCount} hospitals are >100mi from 24/7 thrombectomy (EVT)`, 'warning');
}

// Zero-Capability Hospitals
function highlightZeroCapability() {
    toggleToolsMenu();
    markers.forEach(m => map.removeLayer(m)); markers = [];
    let zeroCount = 0;
    HOSPITALS.forEach(h => {
        const isZero = !h.strokeCertificationType && !h.uwPartner;
        if (isZero) zeroCount++;
        const color = isZero ? '#dc2626' : getMarkerColor(h);
        const marker = L.circleMarker([h.latitude,h.longitude], {
            radius: isZero ? 11 : getMarkerSize(h), fillColor: color,
            color: isZero ? '#991b1b' : 'white', weight: isZero ? 3 : 2,
            opacity: 1, fillOpacity: isZero ? 0.9 : 0.5
        });
        marker.bindPopup(buildPopup(h));
        marker.on('click', () => showHospitalDetail(h));
        marker.hospitalData = h;
        marker.addTo(map);
        markers.push(marker);
    });
    toast(`${zeroCount} hospitals with zero stroke capability highlighted`, 'warning');
}

// Coverage Overlay (50mi and 100mi circles around EVT centers)
function toggleCoverageOverlay() {
    toggleToolsMenu();
    if (coverageVisible) {
        coverageCircles.forEach(c => map.removeLayer(c)); coverageCircles = []; coverageVisible = false;
        toast('Coverage overlay removed');
        return;
    }
    evtCenters.forEach(c => {
        const circle50 = L.circle([c.latitude, c.longitude], {
            radius: 50 * 1609.34, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.06, weight: 1, opacity: 0.3
        }).addTo(map);
        const circle100 = L.circle([c.latitude, c.longitude], {
            radius: 100 * 1609.34, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.03, weight: 1, opacity: 0.2, dashArray: '5,5'
        }).addTo(map);
        coverageCircles.push(circle50, circle100);
    });
    coverageVisible = true;
    toast(`Coverage overlay: green = 50mi, amber dashed = 100mi from EVT centers`);
}

// Expansion Candidates
function rankExpansionCandidates() {
    toggleToolsMenu();
    recalcExpansion();
    openModal('expansion-modal');
}

function recalcExpansion() {
    const weights = {
        noCert: parseInt(document.getElementById('w-noCert').value) || 0,
        notUW: parseInt(document.getElementById('w-notUW').value) || 0,
        farCSC: parseInt(document.getElementById('w-farCSC').value) || 0,
        farEVT: parseInt(document.getElementById('w-farEVT').value) || 0,
        hasLow: parseInt(document.getElementById('w-hasLow').value) || 0,
    };
    const scored = HOSPITALS.map(h => {
        const d = hospitalDistances[h.cmsId] || {};
        let score = 0;
        if (!h.strokeCertificationType) score += weights.noCert;
        if (!h.uwPartner) score += weights.notUW;
        if ((d.nearestAdvancedDistance || 0) > 75) score += weights.farCSC;
        if ((d.nearestEVTDistance || 0) > 100) score += weights.farEVT;
        if (h.strokeCertificationType === 'ASR' || h.strokeCertificationType === 'PSC') score += weights.hasLow;
        return { hospital: h, score, distAdv: d.nearestAdvancedDistance || Infinity, distEVT: d.nearestEVTDistance || Infinity };
    }).sort((a, b) => b.score - a.score);

    const top20 = scored.slice(0, 20);
    document.getElementById('expansion-candidates-content').innerHTML = top20.map((item, i) => {
        const h = item.hospital;
        const sc = item.score >= 6 ? '#ef4444' : item.score >= 4 ? '#f59e0b' : '#10b981';
        return `<div class="bg-gray-50 p-3 mb-2 rounded-lg border-l-4" style="border-color:${sc};">
            <div class="flex items-center justify-between mb-1">
                <span class="text-sm font-bold text-gray-800">${i+1}. ${h.displayName}</span>
                <span class="text-xs font-bold text-white px-2 py-0.5 rounded" style="background:${sc};">Score: ${item.score}</span>
            </div>
            <div class="text-xs text-gray-500">
                ${h.state} | Cert: ${h.strokeCertificationType || 'None'} | Partner: ${h.uwPartner ? 'Yes' : 'No'}<br>
                CSC/TSC: ${item.distAdv < Infinity ? item.distAdv.toFixed(0)+' mi' : 'N/A'} |
                EVT: ${item.distEVT < Infinity ? item.distEVT.toFixed(0)+' mi' : 'N/A'}
            </div>
        </div>`;
    }).join('');
}

// ---------------------------------------------------------------------------
// Distance Matrix
// ---------------------------------------------------------------------------
let matrixSortCol = 'name';
let matrixSortAsc = true;

function showDistanceMatrix() {
    toggleToolsMenu();
    renderDistanceMatrix();
    openModal('distance-matrix-modal');
}

function renderDistanceMatrix() {
    const sortFns = {
        name: (a,b) => a.displayName.localeCompare(b.displayName),
        state: (a,b) => a.state.localeCompare(b.state) || a.displayName.localeCompare(b.displayName),
        cert: (a,b) => (a.strokeCertificationType||'ZZZ').localeCompare(b.strokeCertificationType||'ZZZ'),
        distCSC: (a,b) => (hospitalDistances[a.cmsId]?.nearestAdvancedDistance||Infinity) - (hospitalDistances[b.cmsId]?.nearestAdvancedDistance||Infinity),
        distEVT: (a,b) => (hospitalDistances[a.cmsId]?.nearestEVTDistance||Infinity) - (hospitalDistances[b.cmsId]?.nearestEVTDistance||Infinity),
    };
    const sorted = [...HOSPITALS].sort((a,b) => {
        const fn = sortFns[matrixSortCol] || sortFns.name;
        return matrixSortAsc ? fn(a,b) : fn(b,a);
    });

    const arrow = (col) => matrixSortCol === col ? (matrixSortAsc ? ' &#9650;' : ' &#9660;') : ' &#8597;';
    let html = `<table class="w-full border-collapse text-xs">
        <thead><tr class="bg-indigo-600 text-white">
            <th class="p-2 text-left cursor-pointer" onclick="sortMatrix('name')">Hospital${arrow('name')}</th>
            <th class="p-2 text-left cursor-pointer" onclick="sortMatrix('state')">State${arrow('state')}</th>
            <th class="p-2 text-left cursor-pointer" onclick="sortMatrix('cert')">Cert${arrow('cert')}</th>
            <th class="p-2 text-center">UW</th>
            <th class="p-2 text-left">Nearest CSC/TSC</th>
            <th class="p-2 text-right cursor-pointer" onclick="sortMatrix('distCSC')">Dist${arrow('distCSC')}</th>
            <th class="p-2 text-left">Nearest EVT</th>
            <th class="p-2 text-right cursor-pointer" onclick="sortMatrix('distEVT')">Dist${arrow('distEVT')}</th>
        </tr></thead><tbody>`;

    sorted.forEach((h, i) => {
        const d = hospitalDistances[h.cmsId] || {};
        const dCSC = d.nearestAdvancedDistance > 0 && d.nearestAdvancedDistance < Infinity ? d.nearestAdvancedDistance.toFixed(0) : '-';
        const dEVT = d.nearestEVTDistance > 0 && d.nearestEVTDistance < Infinity ? d.nearestEVTDistance.toFixed(0) : '-';
        const bg = i % 2 ? 'bg-gray-50' : '';
        html += `<tr class="${bg} border-b border-gray-100">
            <td class="p-2">${h.displayName}</td>
            <td class="p-2">${h.state}</td>
            <td class="p-2">${h.strokeCertificationType || '-'}</td>
            <td class="p-2 text-center">${h.uwPartner ? '&#10003;' : ''}</td>
            <td class="p-2">${d.nearestAdvancedName ? toTitleCase(d.nearestAdvancedName) : '-'}</td>
            <td class="p-2 text-right">${dCSC}</td>
            <td class="p-2">${d.nearestEVTName ? toTitleCase(d.nearestEVTName) : '-'}</td>
            <td class="p-2 text-right">${dEVT}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('distance-matrix-content').innerHTML = html;
}

function sortMatrix(col) {
    if (matrixSortCol === col) matrixSortAsc = !matrixSortAsc;
    else { matrixSortCol = col; matrixSortAsc = true; }
    renderDistanceMatrix();
}

function exportDistanceMatrixToCSV() {
    let csv = 'Hospital Name,State,Certification,Partner,Nearest CSC/TSC,Distance to CSC (mi),Nearest EVT,Distance to EVT (mi)\n';
    HOSPITALS.forEach(h => {
        const d = hospitalDistances[h.cmsId] || {};
        const dCSC = d.nearestAdvancedDistance > 0 && d.nearestAdvancedDistance < Infinity ? d.nearestAdvancedDistance.toFixed(1) : '';
        const dEVT = d.nearestEVTDistance > 0 && d.nearestEVTDistance < Infinity ? d.nearestEVTDistance.toFixed(1) : '';
        csv += `"${h.displayName}","${h.state}","${h.strokeCertificationType||'None'}","${h.uwPartner?'Yes':'No'}","${toTitleCase(d.nearestAdvancedName||'')}","${dCSC}","${toTitleCase(d.nearestEVTName||'')}","${dEVT}"\n`;
    });
    downloadBlob(csv, `distance_matrix_${dateStr()}.csv`, 'text/csv');
    toast('Distance matrix exported to CSV');
}

// ---------------------------------------------------------------------------
// Executive Summary
// ---------------------------------------------------------------------------
function generateExecutiveSummary() {
    toggleToolsMenu();
    const total = HOSPITALS.length;
    const uw = HOSPITALS.filter(h => h.uwPartner).length;
    const certified = HOSPITALS.filter(h => h.strokeCertificationType).length;
    const csc = HOSPITALS.filter(h => h.strokeCertificationType==='CSC').length;
    const tsc = HOSPITALS.filter(h => h.strokeCertificationType==='TSC').length;
    const psc = HOSPITALS.filter(h => h.strokeCertificationType==='PSC').length;
    const asr = HOSPITALS.filter(h => h.strokeCertificationType==='ASR').length;
    const noCert = total - certified;
    const evtDeserts = HOSPITALS.filter(h => (hospitalDistances[h.cmsId]?.nearestEVTDistance||0)>100).length;
    const zeroCap = HOSPITALS.filter(h => !h.strokeCertificationType && !h.uwPartner).length;

    const byState = (s) => {
        const all = HOSPITALS.filter(h => h.state === s);
        return { total: all.length, cert: all.filter(h=>h.strokeCertificationType).length, uw: all.filter(h=>h.uwPartner).length };
    };

    let text = `TELESTROKE NETWORK EXPANSION SUMMARY
Generated: ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}

CURRENT NETWORK STATUS:
- Total Regional Hospitals: ${total}
- Partners: ${uw} (${(uw/total*100).toFixed(1)}%)
- Stroke-Certified: ${certified} (${(certified/total*100).toFixed(1)}%)

CERTIFICATION BREAKDOWN:
- CSC (Comprehensive): ${csc}
- TSC (Thrombectomy-Capable): ${tsc}
- PSC (Primary): ${psc}
- ASR (Acute Stroke Ready): ${asr}
- No certification: ${noCert}

SERVICE GAPS:
- Not in network: ${total-uw} (${((total-uw)/total*100).toFixed(1)}%)
- >100mi from EVT: ${evtDeserts} (${(evtDeserts/total*100).toFixed(1)}%)
- Zero-capability (no cert + not partner): ${zeroCap}

BY STATE:
`;
    ['WA','AK','ID','MT','WY'].forEach(s => {
        const d = byState(s);
        text += `- ${s}: ${d.total} hospitals (certified: ${d.cert}, partners: ${d.uw})\n`;
    });

    document.getElementById('executive-summary-content').textContent = text;
    openModal('executive-summary-modal');
    toast('Executive summary generated');
}

function copyExecutiveSummary() {
    navigator.clipboard.writeText(document.getElementById('executive-summary-content').textContent)
        .then(() => toast('Copied to clipboard', 'success'))
        .catch(() => toast('Copy failed', 'error'));
}

function downloadExecutiveSummary() {
    downloadBlob(document.getElementById('executive-summary-content').textContent, `executive_summary_${dateStr()}.txt`, 'text/plain');
    toast('Summary downloaded');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function exportToCSV() {
    toggleToolsMenu();
    let csv = 'Hospital Name,Address,City,State,ZIP,Latitude,Longitude,Certification,Certifying Body,EVT,Partner\n';
    HOSPITALS.forEach(h => {
        csv += `"${h.displayName}","${h.address}","${h.city||''}","${h.state}","${h.zip||''}",${h.latitude},${h.longitude},"${h.strokeCertificationType||'None'}","${h.certifyingBody||''}","${h.hasELVO?'Yes':'No'}","${h.uwPartner?'Yes':'No'}"\n`;
    });
    downloadBlob(csv, `stroke_hospitals_${dateStr()}.csv`, 'text/csv');
    toast('Exported to CSV', 'success');
}

function exportMapToPNG() {
    toggleToolsMenu();
    toast('Preparing map export...');
    // Lazy-load html2canvas
    if (!window.html2canvas) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => doMapExport();
        script.onerror = () => toast('Failed to load export library', 'error');
        document.head.appendChild(script);
    } else {
        doMapExport();
    }
}

function doMapExport() {
    const sidebar = document.getElementById('sidebar');
    const dashboard = document.getElementById('dashboard');
    const fab = document.getElementById('tools-fab');
    sidebar.style.display = 'none'; dashboard.style.display = 'none'; fab.style.display = 'none';

    html2canvas(document.getElementById('map'), { useCORS: true, allowTaint: true }).then(canvas => {
        sidebar.style.display = ''; dashboard.style.display = ''; fab.style.display = '';
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = canvas.width; finalCanvas.height = canvas.height + 60;
        const ctx = finalCanvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        ctx.drawImage(canvas, 0, 0);
        ctx.fillStyle = '#1f2937'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
        ctx.fillText('Regional Hospital Stroke Capabilities', finalCanvas.width/2, canvas.height+25);
        ctx.font = '12px Arial'; ctx.fillStyle = '#6b7280';
        ctx.fillText(`WA, AK, ID, MT, WY — ${new Date().toLocaleDateString('en-US')}`, finalCanvas.width/2, canvas.height+45);
        finalCanvas.toBlob(blob => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `telestroke_map_${dateStr()}.png`;
            link.click();
            toast('Map exported as PNG', 'success');
        });
    }).catch(() => {
        sidebar.style.display = ''; dashboard.style.display = ''; fab.style.display = '';
        toast('Map export failed', 'error');
    });
}

// ---------------------------------------------------------------------------
// Dark Map Toggle
// ---------------------------------------------------------------------------
function toggleDarkMap() {
    toggleToolsMenu();
    darkMapMode = !darkMapMode;
    map.removeLayer(tileLayer);
    const url = darkMapMode
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    tileLayer = L.tileLayer(url, { attribution: '&copy; OpenStreetMap, &copy; CARTO', maxZoom: 19, subdomains: 'abcd' }).addTo(map);
    toast(darkMapMode ? 'Dark map enabled' : 'Light map enabled');
}

// ---------------------------------------------------------------------------
// URL State Persistence
// ---------------------------------------------------------------------------
function saveStateToURL() {
    const params = new URLSearchParams();
    Object.entries(activeFilters).forEach(([k,v]) => { if(v) params.append(k.toLowerCase(), '1'); });
    const st = document.getElementById('filter-state').value;
    if (st !== 'ALL') params.append('state', st);
    const center = map.getCenter();
    params.append('lat', center.lat.toFixed(4));
    params.append('lng', center.lng.toFixed(4));
    params.append('z', map.getZoom());
    history.pushState(null, '', '?' + params.toString());
}

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    if (params.toString() === '') return;
    ['CSC','TSC','PSC','ASR','EVT','UW'].forEach(k => {
        if (params.has(k.toLowerCase())) {
            activeFilters[k] = true;
            const pill = document.querySelector(`.pill[data-filter="${k}"]`);
            if (pill) pill.classList.add(`active-${k.toLowerCase()}`);
        }
    });
    if (params.has('state')) document.getElementById('filter-state').value = params.get('state');
    if (params.has('lat') && params.has('lng') && params.has('z')) {
        map.setView([parseFloat(params.get('lat')), parseFloat(params.get('lng'))], parseInt(params.get('z')));
    }
    applyFilters();
}

function shareCurrentView() {
    toggleToolsMenu();
    saveStateToURL();
    navigator.clipboard.writeText(window.location.href)
        .then(() => toast('Shareable URL copied to clipboard', 'success'))
        .catch(() => toast('Copy failed — URL is in address bar', 'warning'));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}
function dateStr() { return new Date().toISOString().split('T')[0]; }
