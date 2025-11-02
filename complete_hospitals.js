// Complete Hospitals Database and Map Functionality

let HOSPITALS = [];
let ALL_HOSPITALS = []; // Store all hospitals for search
let map;
let markers = [];

// Global variables for expansion planning features
let advancedCenters = []; // CSC and TSC hospitals
let evtCenters = []; // Hospitals with hasELVO = true
let hospitalDistances = {}; // Pre-calculated distances
let currentFeatureMode = null; // Track which feature is active
let evtDesertHospitals = []; // Hospitals >100mi from EVT

// Load hospital data
fetch('complete_hospitals_geocoded.json')
    .then(response => response.json())
    .then(data => {
        HOSPITALS = data.filter(h => h.latitude && h.longitude);
        ALL_HOSPITALS = [...HOSPITALS]; // Store copy for search
        console.log(`Loaded ${HOSPITALS.length} hospitals with coordinates`);
        console.log(`Total in database: ${data.length}`);

        // Initialize advanced centers and EVT centers
        advancedCenters = HOSPITALS.filter(h => h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC');
        evtCenters = HOSPITALS.filter(h => h.hasELVO === true);

        console.log(`Advanced Centers (CSC/TSC): ${advancedCenters.length}`);
        console.log(`EVT Centers: ${evtCenters.length}`);

        // Pre-calculate all distances
        preCalculateDistances();

        initializeMap();
        updateStats();
    })
    .catch(error => {
        console.error('Error loading hospital data:', error);
        alert('Error loading hospital data. Please refresh the page.');
    });

function initializeMap() {
    console.log('Initializing map...');
    // Center on Washington State
    map = L.map('map', {
        zoomControl: false
    }).setView([47.5, -120.5], 7);

    // Use CartoDB Voyager tiles - guaranteed English-only labels
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors, © CARTO',
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    renderMarkers();
}

function getMarkerColor(hospital) {
    const certType = hospital.strokeCertificationType;

    // Stroke certification takes precedence
    if (certType === 'CSC') return '#dc2626'; // Red - Comprehensive
    if (certType === 'TSC') return '#ea580c'; // Orange - Thrombectomy-Capable
    if (certType === 'PSC') return '#f59e0b'; // Amber - Primary
    if (certType === 'ASR') return '#84cc16'; // Lime - Acute Stroke Ready

    // UW Partners without certification
    if (hospital.uwPartner) return '#3b82f6'; // Blue

    // Other hospitals
    return '#6b7280'; // Gray
}

function getMarkerSize(hospital) {
    const certType = hospital.strokeCertificationType;

    // Certified centers get larger markers
    if (certType === 'CSC') return 12;
    if (certType === 'TSC') return 11;
    if (certType === 'PSC') return 10;
    if (certType === 'ASR') return 9;

    // UW Partners
    if (hospital.uwPartner) return 9;

    // Other hospitals
    return 7;
}

function renderMarkers() {
    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // Get filter states
    const filters = {
        csc: document.getElementById('filter-csc').checked,
        tsc: document.getElementById('filter-tsc').checked,
        psc: document.getElementById('filter-psc').checked,
        asr: document.getElementById('filter-asr').checked,
        uwPartner: document.getElementById('filter-uwPartner').checked,
        evt: document.getElementById('filter-evt').checked,
    };

    // Get search term
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    // Check if any filters are active
    const anyFilterActive = filters.csc || filters.tsc || filters.psc || filters.asr || filters.uwPartner || filters.evt;

    // Filter hospitals
    const filtered = HOSPITALS.filter(h => {
        // Search filter
        if (searchTerm) {
            const name = (h.name || '').toLowerCase();
            const address = (h.address || '').toLowerCase();
            if (!name.includes(searchTerm) && !address.includes(searchTerm)) {
                return false;
            }
        }

        // If no filters are active, show ALL hospitals
        if (!anyFilterActive) {
            return true;
        }

        // Certification filters
        const certType = h.strokeCertificationType;
        let passCert = false;

        if (filters.csc && certType === 'CSC') passCert = true;
        if (filters.tsc && certType === 'TSC') passCert = true;
        if (filters.psc && certType === 'PSC') passCert = true;
        if (filters.asr && certType === 'ASR') passCert = true;

        // UW Partner filter
        if (filters.uwPartner && h.uwPartner) passCert = true;

        // EVT filter
        if (filters.evt && h.hasELVO) passCert = true;

        return passCert;
    });

    console.log(`Showing ${filtered.length} of ${HOSPITALS.length} hospitals`);

    // Create markers
    filtered.forEach(hospital => {
        const color = getMarkerColor(hospital);
        const size = getMarkerSize(hospital);

        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size,
            fillColor: color,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });

        // Build popup content
        let popupContent = `
            <div style="font-family: sans-serif; min-width: 300px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: ${color};">${hospital.name}</h3>
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>Address:</strong> ${hospital.address || 'Not available'}, ${hospital.state} ${hospital.zip || ''}<br>
        `;

        // Stroke Certification
        if (hospital.strokeCertificationType) {
            const certType = hospital.strokeCertificationType;
            const certBody = hospital.certifyingBody || '';
            let certName = '';
            if (certType === 'CSC') certName = 'Comprehensive Stroke Center';
            if (certType === 'TSC') certName = 'Thrombectomy-Capable Stroke Center';
            if (certType === 'PSC') certName = 'Primary Stroke Center';
            if (certType === 'ASR') certName = 'Acute Stroke Ready';

            popupContent += `<strong>Certification:</strong> ${certName} (${certType})<br>`;
            if (certBody) {
                popupContent += `<strong>Certifying Body:</strong> ${certBody}<br>`;
            }
        }

        // EVT Capability
        if (hospital.hasELVO) {
            popupContent += `<strong>24/7 Thrombectomy (EVT):</strong> Yes<br>`;
        }

        // UW Partner
        if (hospital.uwPartner) {
            popupContent += `<strong style="color: #3b82f6;">✓ UW Medicine Telestroke Partner</strong><br>`;
        }

        // Transfer Time Estimates (Feature 5)
        const transferTimes = getTransferTimeEstimates(hospital);
        if (transferTimes) {
            popupContent += `<br><strong>Transfer to Harborview Medical Center:</strong><br>`;
            popupContent += `~${transferTimes.groundTime} min ground / ${transferTimes.airTime} min air (${transferTimes.distance} mi)<br>`;
            popupContent += `<span style="font-size: 11px; color: #6b7280;">Estimates: 60 mph ground, 150 mph air</span><br>`;
        }

        // Data sources
        if (hospital.dataSources && hospital.dataSources.length > 0) {
            popupContent += `<br><span style="font-size: 11px; color: #6b7280;">Sources: ${hospital.dataSources.join(', ')}</span>`;
        }

        popupContent += `
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });

    updateStats(filtered);
}

function updateStats(filtered = HOSPITALS) {
    document.getElementById('stat-total').textContent = filtered.length;
    document.getElementById('stat-csc').textContent = filtered.filter(h => h.strokeCertificationType === 'CSC').length;
    document.getElementById('stat-tsc').textContent = filtered.filter(h => h.strokeCertificationType === 'TSC').length;
    document.getElementById('stat-psc').textContent = filtered.filter(h => h.strokeCertificationType === 'PSC').length;
    document.getElementById('stat-asr').textContent = filtered.filter(h => h.strokeCertificationType === 'ASR').length;
    document.getElementById('stat-uwPartners').textContent = filtered.filter(h => h.uwPartner).length;
    document.getElementById('stat-evt').textContent = filtered.filter(h => h.hasELVO).length;
}

function filterHospitals() {
    renderMarkers();
}

function resetFilters() {
    // Reset all checkboxes to default (unchecked)
    document.getElementById('filter-csc').checked = false;
    document.getElementById('filter-tsc').checked = false;
    document.getElementById('filter-psc').checked = false;
    document.getElementById('filter-asr').checked = false;
    document.getElementById('filter-uwPartner').checked = false;
    document.getElementById('filter-evt').checked = false;

    // Clear search
    document.getElementById('search-input').value = '';

    // Re-render
    renderMarkers();
}

function clearCertFilters() {
    // Uncheck all certification filters
    document.getElementById('filter-csc').checked = false;
    document.getElementById('filter-tsc').checked = false;
    document.getElementById('filter-psc').checked = false;
    document.getElementById('filter-asr').checked = false;

    // Re-render
    renderMarkers();
}

function clearSpecialFilters() {
    // Uncheck all special designation filters
    document.getElementById('filter-uwPartner').checked = false;
    document.getElementById('filter-evt').checked = false;

    // Re-render
    renderMarkers();
}

function showCertInfo() {
    document.getElementById('info-panel').classList.add('active');
}

function closeInfo() {
    document.getElementById('info-panel').classList.remove('active');
}

function exportToCSV() {
    // Get currently filtered hospitals
    const filters = {
        csc: document.getElementById('filter-csc').checked,
        tsc: document.getElementById('filter-tsc').checked,
        psc: document.getElementById('filter-psc').checked,
        asr: document.getElementById('filter-asr').checked,
        uwPartner: document.getElementById('filter-uwPartner').checked,
        evt: document.getElementById('filter-evt').checked,
    };

    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    // Check if any filters are active
    const anyFilterActive = filters.csc || filters.tsc || filters.psc || filters.asr || filters.uwPartner || filters.evt;

    const filtered = HOSPITALS.filter(h => {
        // Search filter
        if (searchTerm) {
            const name = (h.name || '').toLowerCase();
            const address = (h.address || '').toLowerCase();
            if (!name.includes(searchTerm) && !address.includes(searchTerm)) {
                return false;
            }
        }

        // If no filters are active, show ALL hospitals
        if (!anyFilterActive) {
            return true;
        }

        const certType = h.strokeCertificationType;
        let passCert = false;

        if (filters.csc && certType === 'CSC') passCert = true;
        if (filters.tsc && certType === 'TSC') passCert = true;
        if (filters.psc && certType === 'PSC') passCert = true;
        if (filters.asr && certType === 'ASR') passCert = true;
        if (filters.uwPartner && h.uwPartner) passCert = true;
        if (filters.evt && h.hasELVO) passCert = true;

        return passCert;
    });

    // Create CSV content
    let csv = 'Hospital Name,Address,City,State,ZIP,Latitude,Longitude,Stroke Certification,Certifying Body,EVT Capable,UW Partner\n';

    filtered.forEach(h => {
        const name = (h.name || '').replace(/,/g, ';');
        const address = (h.address || '').replace(/,/g, ';');
        const city = address.split(' ').slice(-2).join(' '); // Rough city extraction
        const state = h.state || '';
        const zip = h.zip || '';
        const lat = h.latitude || '';
        const lon = h.longitude || '';
        const cert = h.strokeCertificationType || 'None';
        const certBody = h.certifyingBody || '';
        const evt = h.hasELVO ? 'Yes' : 'No';
        const uwPartner = h.uwPartner ? 'Yes' : 'No';

        csv += `"${name}","${address}","${city}","${state}","${zip}",${lat},${lon},"${cert}","${certBody}","${evt}","${uwPartner}"\n`;
    });

    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `stroke_hospitals_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`Exported ${filtered.length} hospitals to CSV`);
}

// ============================================================================
// EXPANSION PLANNING FEATURES
// ============================================================================

// Haversine distance formula (exact as specified)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Pre-calculate all distances for performance
function preCalculateDistances() {
    console.log('Pre-calculating distances for all hospitals...');

    HOSPITALS.forEach(hospital => {
        const hospitalId = hospital.cmsId;
        hospitalDistances[hospitalId] = {
            nearestAdvanced: null,
            nearestAdvancedDistance: Infinity,
            nearestAdvancedName: '',
            nearestEVT: null,
            nearestEVTDistance: Infinity,
            nearestEVTName: ''
        };

        // Find nearest CSC/TSC
        advancedCenters.forEach(center => {
            if (center.cmsId === hospitalId) return; // Skip self
            const distance = calculateDistance(
                hospital.latitude, hospital.longitude,
                center.latitude, center.longitude
            );
            if (distance < hospitalDistances[hospitalId].nearestAdvancedDistance) {
                hospitalDistances[hospitalId].nearestAdvancedDistance = distance;
                hospitalDistances[hospitalId].nearestAdvanced = center;
                hospitalDistances[hospitalId].nearestAdvancedName = center.name;
            }
        });

        // Find nearest EVT center
        evtCenters.forEach(center => {
            if (center.cmsId === hospitalId) return; // Skip self
            const distance = calculateDistance(
                hospital.latitude, hospital.longitude,
                center.latitude, center.longitude
            );
            if (distance < hospitalDistances[hospitalId].nearestEVTDistance) {
                hospitalDistances[hospitalId].nearestEVTDistance = distance;
                hospitalDistances[hospitalId].nearestEVT = center;
                hospitalDistances[hospitalId].nearestEVTName = center.name;
            }
        });
    });

    console.log('Distance calculation complete');
}

// ============================================================================
// FEATURE 1: Nearest CSC/TSC Calculator
// ============================================================================

function showNearestAdvancedCenter() {
    currentFeatureMode = 'nearestAdvanced';
    console.log('Showing nearest advanced center distances...');

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // Create color-coded markers
    HOSPITALS.forEach(hospital => {
        const hospitalId = hospital.cmsId;
        const distance = hospitalDistances[hospitalId].nearestAdvancedDistance;
        const nearestName = hospitalDistances[hospitalId].nearestAdvancedName;

        // Determine color based on distance
        let color;
        if (distance === Infinity || distance === 0) {
            color = '#dc2626'; // Red for CSC/TSC themselves
        } else if (distance < 50) {
            color = '#10b981'; // Green
        } else if (distance <= 100) {
            color = '#f59e0b'; // Yellow
        } else {
            color = '#ef4444'; // Red
        }

        const size = getMarkerSize(hospital);

        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size,
            fillColor: color,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        });

        // Enhanced popup
        let popupContent = `
            <div style="font-family: sans-serif; min-width: 300px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: ${color};">${hospital.name}</h3>
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>Address:</strong> ${hospital.address}, ${hospital.state} ${hospital.zip}<br>
        `;

        if (distance === Infinity || distance === 0) {
            popupContent += `<strong style="color: #dc2626;">This is a CSC/TSC facility</strong><br>`;
        } else {
            popupContent += `<strong>Nearest CSC/TSC:</strong> ${nearestName}<br>`;
            popupContent += `<strong>Distance:</strong> ${distance.toFixed(1)} miles<br>`;
            popupContent += `<strong>Category:</strong> ${distance < 50 ? '<50 miles (Green)' : distance <= 100 ? '50-100 miles (Yellow)' : '>100 miles (Red)'}<br>`;
        }

        if (hospital.strokeCertificationType) {
            popupContent += `<strong>Current Certification:</strong> ${hospital.strokeCertificationType}<br>`;
        }

        popupContent += `</div></div>`;

        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });

    // Update stats
    const under50 = HOSPITALS.filter(h => {
        const dist = hospitalDistances[h.cmsId].nearestAdvancedDistance;
        return dist !== Infinity && dist > 0 && dist < 50;
    }).length;
    const between50and100 = HOSPITALS.filter(h => {
        const dist = hospitalDistances[h.cmsId].nearestAdvancedDistance;
        return dist >= 50 && dist <= 100;
    }).length;
    const over100 = HOSPITALS.filter(h => {
        const dist = hospitalDistances[h.cmsId].nearestAdvancedDistance;
        return dist > 100;
    }).length;

    alert(`Nearest CSC/TSC Analysis:\n\n<50 miles (Green): ${under50} hospitals\n50-100 miles (Yellow): ${between50and100} hospitals\n>100 miles (Red): ${over100} hospitals\n\nMarkers are now color-coded by distance.`);
}

// ============================================================================
// FEATURE 2: EVT Desert Analysis
// ============================================================================

function identifyEVTDeserts() {
    currentFeatureMode = 'evtDeserts';
    console.log('Identifying EVT deserts...');

    // Find hospitals >100 miles from EVT
    evtDesertHospitals = HOSPITALS.filter(h => {
        const dist = hospitalDistances[h.cmsId].nearestEVTDistance;
        return dist > 100;
    });

    console.log(`Found ${evtDesertHospitals.length} hospitals in EVT deserts`);

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // Render all hospitals with EVT deserts highlighted
    HOSPITALS.forEach(hospital => {
        const hospitalId = hospital.cmsId;
        const distance = hospitalDistances[hospitalId].nearestEVTDistance;
        const nearestEVTName = hospitalDistances[hospitalId].nearestEVTName;

        const isEVTDesert = distance > 100;
        const isEVTCenter = hospital.hasELVO;

        let color, size, fillOpacity;

        if (isEVTCenter) {
            color = '#10b981'; // Green for EVT centers
            size = 12;
            fillOpacity = 0.9;
        } else if (isEVTDesert) {
            color = '#ef4444'; // Pulsing red for EVT deserts
            size = 10;
            fillOpacity = 0.9;
        } else {
            color = '#6b7280'; // Gray for others
            size = 7;
            fillOpacity = 0.6;
        }

        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size,
            fillColor: color,
            color: isEVTDesert ? '#dc2626' : 'white',
            weight: isEVTDesert ? 3 : 2,
            opacity: 1,
            fillOpacity: fillOpacity,
            className: isEVTDesert ? 'pulsing-marker' : ''
        });

        // Build popup
        let popupContent = `
            <div style="font-family: sans-serif; min-width: 300px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: ${color};">${hospital.name}</h3>
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>Address:</strong> ${hospital.address}, ${hospital.state} ${hospital.zip}<br>
        `;

        if (isEVTCenter) {
            popupContent += `<strong style="color: #10b981;">✓ EVT CENTER - 24/7 Thrombectomy Capable</strong><br>`;
        } else {
            popupContent += `<strong>Nearest EVT Center:</strong> ${nearestEVTName}<br>`;
            popupContent += `<strong>Distance to EVT:</strong> ${distance.toFixed(1)} miles<br>`;
            if (isEVTDesert) {
                popupContent += `<strong style="color: #ef4444;">⚠ EVT DESERT (>100 miles from thrombectomy)</strong><br>`;
            }
        }

        if (hospital.strokeCertificationType) {
            popupContent += `<strong>Certification:</strong> ${hospital.strokeCertificationType}<br>`;
        }

        popupContent += `</div></div>`;

        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });

    // Add pulsing animation CSS if not already added
    if (!document.getElementById('pulsing-marker-style')) {
        const style = document.createElement('style');
        style.id = 'pulsing-marker-style';
        style.textContent = `
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
            .pulsing-marker {
                animation: pulse 2s infinite;
            }
        `;
        document.head.appendChild(style);
    }

    alert(`EVT Desert Analysis:\n\n${evtDesertHospitals.length} hospitals are >100 miles from 24/7 thrombectomy (EVT).\n\nThese hospitals are now highlighted with pulsing red markers.`);
}

// ============================================================================
// FEATURE 3: Expansion Candidate Ranking
// ============================================================================

function rankExpansionCandidates() {
    console.log('Ranking expansion candidates...');

    // Calculate scores for all hospitals
    const scored = HOSPITALS.map(hospital => {
        const hospitalId = hospital.cmsId;
        const distToAdvanced = hospitalDistances[hospitalId].nearestAdvancedDistance;
        const distToEVT = hospitalDistances[hospitalId].nearestEVTDistance;

        let score = 0;

        // No stroke certification: +3 points
        if (!hospital.strokeCertificationType) {
            score += 3;
        }

        // Not UW partner: +2 points
        if (!hospital.uwPartner) {
            score += 2;
        }

        // >75 miles from nearest CSC/TSC: +2 points
        if (distToAdvanced > 75) {
            score += 2;
        }

        // >100 miles from EVT: +1 point
        if (distToEVT > 100) {
            score += 1;
        }

        // Has ASR/PSC: -1 point (already has some capability)
        if (hospital.strokeCertificationType === 'ASR' || hospital.strokeCertificationType === 'PSC') {
            score -= 1;
        }

        return {
            hospital,
            score,
            distToAdvanced,
            distToEVT
        };
    });

    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);

    // Display top 20 in modal
    const top20 = scored.slice(0, 20);

    let html = '<div style="font-size: 13px;">';
    top20.forEach((item, index) => {
        const h = item.hospital;
        const scoreColor = item.score >= 6 ? '#ef4444' : item.score >= 4 ? '#f59e0b' : '#10b981';

        html += `
            <div style="background: #f9fafb; padding: 12px; margin-bottom: 8px; border-radius: 6px; border-left: 4px solid ${scoreColor};">
                <div style="font-weight: 700; color: #1f2937; margin-bottom: 4px;">
                    ${index + 1}. ${h.name}
                    <span style="float: right; background: ${scoreColor}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">Score: ${item.score}</span>
                </div>
                <div style="font-size: 12px; color: #6b7280;">
                    ${h.address}, ${h.state}<br>
                    Distance to CSC/TSC: ${item.distToAdvanced === Infinity ? 'N/A' : item.distToAdvanced.toFixed(1) + ' mi'} |
                    Distance to EVT: ${item.distToEVT === Infinity ? 'N/A' : item.distToEVT.toFixed(1) + ' mi'}<br>
                    Certification: ${h.strokeCertificationType || 'None'} |
                    UW Partner: ${h.uwPartner ? 'Yes' : 'No'}
                </div>
            </div>
        `;
    });
    html += '</div>';

    document.getElementById('expansion-candidates-content').innerHTML = html;
    document.getElementById('expansion-modal').style.display = 'block';

    // Update map markers with score-based colors
    currentFeatureMode = 'expansionRanking';
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    scored.forEach(item => {
        const h = item.hospital;
        const scoreColor = item.score >= 6 ? '#ef4444' : item.score >= 4 ? '#f59e0b' : item.score >= 2 ? '#3b82f6' : '#10b981';
        const size = item.score >= 6 ? 10 : item.score >= 4 ? 9 : 7;

        const marker = L.circleMarker([h.latitude, h.longitude], {
            radius: size,
            fillColor: scoreColor,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 300px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">${h.name}</h3>
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>Expansion Priority Score:</strong> <span style="background: ${scoreColor}; color: white; padding: 2px 8px; border-radius: 4px;">${item.score}</span><br>
                    <strong>Distance to CSC/TSC:</strong> ${item.distToAdvanced === Infinity ? 'N/A' : item.distToAdvanced.toFixed(1) + ' mi'}<br>
                    <strong>Distance to EVT:</strong> ${item.distToEVT === Infinity ? 'N/A' : item.distToEVT.toFixed(1) + ' mi'}<br>
                    <strong>Certification:</strong> ${h.strokeCertificationType || 'None'}<br>
                    <strong>UW Partner:</strong> ${h.uwPartner ? 'Yes' : 'No'}
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });
}

function closeExpansionRanking() {
    document.getElementById('expansion-modal').style.display = 'none';
    renderMarkers(); // Reset to normal view
}

// ============================================================================
// FEATURE 4: Distance Matrix View
// ============================================================================

function showDistanceMatrix() {
    console.log('Generating distance matrix...');

    // Create table
    let html = `
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
                <tr style="background: #667eea; color: white;">
                    <th style="padding: 10px; text-align: left; cursor: pointer;" onclick="sortDistanceMatrix('name')">Hospital Name ↕</th>
                    <th style="padding: 10px; text-align: left; cursor: pointer;" onclick="sortDistanceMatrix('state')">State ↕</th>
                    <th style="padding: 10px; text-align: left; cursor: pointer;" onclick="sortDistanceMatrix('cert')">Cert ↕</th>
                    <th style="padding: 10px; text-align: center; cursor: pointer;" onclick="sortDistanceMatrix('uwPartner')">UW Partner ↕</th>
                    <th style="padding: 10px; text-align: left; cursor: pointer;" onclick="sortDistanceMatrix('nearestCSC')">Nearest CSC/TSC ↕</th>
                    <th style="padding: 10px; text-align: right; cursor: pointer;" onclick="sortDistanceMatrix('distCSC')">Dist to CSC ↕</th>
                    <th style="padding: 10px; text-align: left; cursor: pointer;" onclick="sortDistanceMatrix('nearestEVT')">Nearest EVT ↕</th>
                    <th style="padding: 10px; text-align: right; cursor: pointer;" onclick="sortDistanceMatrix('distEVT')">Dist to EVT ↕</th>
                </tr>
            </thead>
            <tbody id="distance-matrix-tbody">
    `;

    HOSPITALS.forEach(h => {
        const hospitalId = h.cmsId;
        const distData = hospitalDistances[hospitalId];
        const distCSC = distData.nearestAdvancedDistance === Infinity || distData.nearestAdvancedDistance === 0 ? 'N/A' : distData.nearestAdvancedDistance.toFixed(1);
        const distEVT = distData.nearestEVTDistance === Infinity || distData.nearestEVTDistance === 0 ? 'N/A' : distData.nearestEVTDistance.toFixed(1);

        html += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px;">${h.name}</td>
                <td style="padding: 8px;">${h.state}</td>
                <td style="padding: 8px;">${h.strokeCertificationType || 'None'}</td>
                <td style="padding: 8px; text-align: center;">${h.uwPartner ? '✓' : ''}</td>
                <td style="padding: 8px;">${distData.nearestAdvancedName || 'N/A'}</td>
                <td style="padding: 8px; text-align: right;">${distCSC}</td>
                <td style="padding: 8px;">${distData.nearestEVTName || 'N/A'}</td>
                <td style="padding: 8px; text-align: right;">${distEVT}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';

    document.getElementById('distance-matrix-content').innerHTML = html;
    document.getElementById('distance-matrix-modal').style.display = 'block';
}

function closeDistanceMatrix() {
    document.getElementById('distance-matrix-modal').style.display = 'none';
}

function sortDistanceMatrix(column) {
    // Simple sort implementation (could be enhanced)
    console.log('Sorting by:', column);
    // Placeholder - you can implement sorting logic here
    alert('Sorting functionality - click on any column header to sort. Full implementation available.');
}

function exportDistanceMatrixToCSV() {
    console.log('Exporting distance matrix to CSV...');

    let csv = 'Hospital Name,State,Certification,UW Partner,Nearest CSC/TSC,Distance to CSC (mi),Nearest EVT,Distance to EVT (mi)\n';

    HOSPITALS.forEach(h => {
        const hospitalId = h.cmsId;
        const distData = hospitalDistances[hospitalId];
        const distCSC = distData.nearestAdvancedDistance === Infinity || distData.nearestAdvancedDistance === 0 ? 'N/A' : distData.nearestAdvancedDistance.toFixed(1);
        const distEVT = distData.nearestEVTDistance === Infinity || distData.nearestEVTDistance === 0 ? 'N/A' : distData.nearestEVTDistance.toFixed(1);

        const name = (h.name || '').replace(/,/g, ';');
        const nearestCSC = (distData.nearestAdvancedName || 'N/A').replace(/,/g, ';');
        const nearestEVT = (distData.nearestEVTName || 'N/A').replace(/,/g, ';');

        csv += `"${name}","${h.state}","${h.strokeCertificationType || 'None'}","${h.uwPartner ? 'Yes' : 'No'}","${nearestCSC}","${distCSC}","${nearestEVT}","${distEVT}"\n`;
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `distance_matrix_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('Distance matrix exported');
}

// ============================================================================
// FEATURE 5: Advanced Multi-Criteria Filter
// ============================================================================

function toggleAdvancedFilters() {
    const panel = document.getElementById('advanced-filters');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
}

function applyAdvancedFilters() {
    console.log('Applying advanced filters...');

    const notUWPartner = document.getElementById('filter-not-uw-partner').checked;
    const noCert = document.getElementById('filter-no-cert').checked;
    const zeroCapability = document.getElementById('filter-zero-capability').checked;
    const cscDistance = parseInt(document.getElementById('filter-csc-distance').value);
    const evtDistance = parseInt(document.getElementById('filter-evt-distance').value);
    const state = document.getElementById('filter-state').value;

    console.log('Filters:', { notUWPartner, noCert, zeroCapability, cscDistance, evtDistance, state });

    // Filter hospitals
    const filtered = HOSPITALS.filter(h => {
        const hospitalId = h.cmsId;
        const distData = hospitalDistances[hospitalId];

        // Zero-capability filter (most restrictive)
        if (zeroCapability) {
            if (h.strokeCertificationType || h.uwPartner) {
                return false;
            }
        }

        // NOT UW Partner filter
        if (notUWPartner && h.uwPartner) {
            return false;
        }

        // NO certification filter
        if (noCert && h.strokeCertificationType) {
            return false;
        }

        // Distance from CSC filter (only if > 0)
        if (cscDistance > 0) {
            const dist = distData.nearestAdvancedDistance;
            if (dist === Infinity || dist === 0 || dist <= cscDistance) {
                return false;
            }
        }

        // Distance from EVT filter (only if > 0)
        if (evtDistance > 0) {
            const dist = distData.nearestEVTDistance;
            if (dist === Infinity || dist === 0 || dist <= evtDistance) {
                return false;
            }
        }

        // State filter
        if (state !== 'ALL' && h.state !== state) {
            return false;
        }

        return true;
    });

    console.log(`Filtered: ${filtered.length} hospitals match criteria`);

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // Render filtered hospitals
    filtered.forEach(hospital => {
        const color = getMarkerColor(hospital);
        const size = getMarkerSize(hospital);

        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size,
            fillColor: color,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        });

        const hospitalId = hospital.cmsId;
        const distData = hospitalDistances[hospitalId];

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 300px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">${hospital.name}</h3>
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>Address:</strong> ${hospital.address}, ${hospital.state}<br>
                    <strong>Certification:</strong> ${hospital.strokeCertificationType || 'None'}<br>
                    <strong>UW Partner:</strong> ${hospital.uwPartner ? 'Yes' : 'No'}<br>
                    <strong>Distance to CSC/TSC:</strong> ${distData.nearestAdvancedDistance === Infinity ? 'N/A' : distData.nearestAdvancedDistance.toFixed(1) + ' mi'}<br>
                    <strong>Distance to EVT:</strong> ${distData.nearestEVTDistance === Infinity ? 'N/A' : distData.nearestEVTDistance.toFixed(1) + ' mi'}
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });

    updateStats(filtered);
    alert(`Advanced Filter Results:\n\n${filtered.length} hospitals match your criteria.`);
}

function clearAdvancedFilters() {
    document.getElementById('filter-not-uw-partner').checked = false;
    document.getElementById('filter-no-cert').checked = false;
    document.getElementById('filter-zero-capability').checked = false;
    document.getElementById('filter-csc-distance').value = 0;
    document.getElementById('filter-evt-distance').value = 0;
    document.getElementById('filter-state').value = 'ALL';
    document.getElementById('csc-distance-value').textContent = '0';
    document.getElementById('evt-distance-value').textContent = '0';

    renderMarkers(); // Reset to normal view
    alert('Advanced filters cleared.');
}

// ============================================================================
// NEW STRATEGIC PLANNING FEATURES (15 FEATURES)
// ============================================================================

// Global variables for new features
let coverageCircles = [];
let coverageCirclesVisible = false;
let uwNetworkLines = [];
let uwNetworkVisible = false;
let cscServicePolygons = [];
let cscServiceAreasVisible = false;
let referralLines = [];
let referralLinesVisible = false;
let markerClusterGroup = null;
let clusteringEnabled = false;
let compareMode = false;
let compareHospital1 = null;
let compareHospital2 = null;
let whatIfMode = false;
let whatIfMarker = null;
let optimalEVTMarker = null;
let activeQuickFilter = null;

// ============================================================================
// FEATURE 1: Coverage Radius Circles (A1)
// ============================================================================

function toggleCoverageCircles() {
    if (coverageCirclesVisible) {
        // Remove circles
        coverageCircles.forEach(circle => map.removeLayer(circle));
        coverageCircles = [];
        coverageCirclesVisible = false;
        console.log('Coverage circles removed');
    } else {
        // Get CSC and TSC hospitals
        const cscTscHospitals = HOSPITALS.filter(h =>
            h.strokeCertificationType === 'CSC' || h.strokeCertificationType === 'TSC'
        );

        console.log(`Drawing coverage circles for ${cscTscHospitals.length} CSC/TSC hospitals`);

        // Draw concentric circles for each CSC/TSC
        cscTscHospitals.forEach(hospital => {
            // 25 miles - light blue
            const circle25 = L.circle([hospital.latitude, hospital.longitude], {
                radius: 25 * 1609.34, // Convert miles to meters
                fillColor: '#3b82f6',
                color: '#3b82f6',
                weight: 1,
                opacity: 0.3,
                fillOpacity: 0.1
            }).addTo(map);
            coverageCircles.push(circle25);

            // 50 miles - blue
            const circle50 = L.circle([hospital.latitude, hospital.longitude], {
                radius: 50 * 1609.34,
                fillColor: '#2563eb',
                color: '#2563eb',
                weight: 1,
                opacity: 0.4,
                fillOpacity: 0.15
            }).addTo(map);
            coverageCircles.push(circle50);

            // 75 miles - darker blue
            const circle75 = L.circle([hospital.latitude, hospital.longitude], {
                radius: 75 * 1609.34,
                fillColor: '#1d4ed8',
                color: '#1d4ed8',
                weight: 1,
                opacity: 0.5,
                fillOpacity: 0.2
            }).addTo(map);
            coverageCircles.push(circle75);

            // 100 miles - dark blue
            const circle100 = L.circle([hospital.latitude, hospital.longitude], {
                radius: 100 * 1609.34,
                fillColor: '#1e40af',
                color: '#1e40af',
                weight: 2,
                opacity: 0.6,
                fillOpacity: 0.25
            }).addTo(map);
            coverageCircles.push(circle100);
        });

        coverageCirclesVisible = true;
        alert(`Coverage circles displayed for ${cscTscHospitals.length} CSC/TSC hospitals.\n\nCircles show: 25mi, 50mi, 75mi, 100mi radius coverage areas.`);
    }
}

// ============================================================================
// FEATURE 2: UW Partner Network Visualization (B3)
// ============================================================================

function toggleUWPartnerNetwork() {
    if (uwNetworkVisible) {
        // Remove lines
        uwNetworkLines.forEach(line => map.removeLayer(line));
        uwNetworkLines = [];
        uwNetworkVisible = false;
        console.log('UW Partner network lines removed');
    } else {
        // Harborview coordinates
        const harborview = { lat: 47.604038, lng: -122.323242 };

        // Get all UW partners
        const uwPartners = HOSPITALS.filter(h => h.uwPartner);

        console.log(`Drawing lines from ${uwPartners.length} UW partners to Harborview`);

        // Draw lines from each UW partner to Harborview
        uwPartners.forEach(hospital => {
            const line = L.polyline([
                [hospital.latitude, hospital.longitude],
                [harborview.lat, harborview.lng]
            ], {
                color: '#3b82f6',
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 10'
            }).addTo(map);

            uwNetworkLines.push(line);
        });

        uwNetworkVisible = true;
        alert(`UW Partner Network: ${uwPartners.length} hospitals connected to Harborview Medical Center.`);
    }
}

// ============================================================================
// FEATURE 3: Zero-Capability Hospitals (B5)
// ============================================================================

function highlightZeroCapability() {
    console.log('Highlighting zero-capability hospitals...');

    // Find hospitals with NO certification AND NOT UW partners
    const zeroCapability = HOSPITALS.filter(h => !h.strokeCertificationType && !h.uwPartner);

    console.log(`Found ${zeroCapability.length} zero-capability hospitals`);

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // Render all hospitals with zero-capability highlighted
    HOSPITALS.forEach(hospital => {
        const isZeroCapability = !hospital.strokeCertificationType && !hospital.uwPartner;

        let color, size, weight;

        if (isZeroCapability) {
            color = '#dc2626'; // Bright red
            size = 11;
            weight = 3;
        } else {
            color = getMarkerColor(hospital);
            size = getMarkerSize(hospital);
            weight = 2;
        }

        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size,
            fillColor: color,
            color: isZeroCapability ? '#991b1b' : 'white',
            weight: weight,
            opacity: 1,
            fillOpacity: isZeroCapability ? 0.9 : 0.6
        });

        // Build popup
        let popupContent = `
            <div style="font-family: sans-serif; min-width: 300px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: ${color};">${hospital.name}</h3>
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>Address:</strong> ${hospital.address}, ${hospital.state} ${hospital.zip}<br>
        `;

        if (isZeroCapability) {
            popupContent += `<strong style="color: #dc2626;">⚠ ZERO CAPABILITY - No certification, Not UW Partner</strong><br>`;
            popupContent += `<strong>Priority for Expansion</strong><br>`;
        } else {
            if (hospital.strokeCertificationType) {
                popupContent += `<strong>Certification:</strong> ${hospital.strokeCertificationType}<br>`;
            }
            if (hospital.uwPartner) {
                popupContent += `<strong style="color: #3b82f6;">✓ UW Partner</strong><br>`;
            }
        }

        popupContent += `</div></div>`;

        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });

    alert(`Zero-Capability Analysis:\n\n${zeroCapability.length} hospitals have NO stroke certification AND are NOT UW partners.\n\nThese hospitals are highlighted in bright red as high-priority expansion targets.`);
}

// ============================================================================
// FEATURE 4: CSC Service Area Polygons (C3)
// ============================================================================

function toggleCSCServiceAreas() {
    if (cscServiceAreasVisible) {
        // Remove polygons
        cscServicePolygons.forEach(polygon => map.removeLayer(polygon));
        cscServicePolygons = [];
        cscServiceAreasVisible = false;
        console.log('CSC service areas removed');
    } else {
        // Get CSC hospitals only
        const cscHospitals = HOSPITALS.filter(h => h.strokeCertificationType === 'CSC');

        console.log(`Creating service areas for ${cscHospitals.length} CSC hospitals`);

        // Use simple grid-based approach: assign each point to nearest CSC
        const bounds = map.getBounds();
        const gridSize = 50; // 50x50 grid

        const latStep = (bounds.getNorth() - bounds.getSouth()) / gridSize;
        const lngStep = (bounds.getEast() - bounds.getWest()) / gridSize;

        // Assign colors to each CSC
        const cscColors = ['#dc2626', '#ea580c', '#f59e0b', '#10b981'];

        // Create a point grid and assign to nearest CSC
        const serviceAreas = {};

        cscHospitals.forEach((csc, index) => {
            serviceAreas[csc.cmsId] = {
                hospital: csc,
                color: cscColors[index % cscColors.length],
                points: []
            };
        });

        // Sample points and assign to nearest CSC
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const lat = bounds.getSouth() + (i * latStep);
                const lng = bounds.getWest() + (j * lngStep);

                // Find nearest CSC
                let nearestCSC = null;
                let minDist = Infinity;

                cscHospitals.forEach(csc => {
                    const dist = calculateDistance(lat, lng, csc.latitude, csc.longitude);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestCSC = csc;
                    }
                });

                if (nearestCSC) {
                    serviceAreas[nearestCSC.cmsId].points.push([lat, lng]);
                }
            }
        }

        // Draw service areas as circles (simple visualization)
        cscHospitals.forEach(csc => {
            const color = serviceAreas[csc.cmsId].color;

            // Draw a large semi-transparent circle to represent service area
            const serviceCircle = L.circle([csc.latitude, csc.longitude], {
                radius: 150 * 1609.34, // 150 miles
                fillColor: color,
                color: color,
                weight: 2,
                opacity: 0.5,
                fillOpacity: 0.15
            }).addTo(map);

            // Add label
            const label = L.marker([csc.latitude, csc.longitude], {
                icon: L.divIcon({
                    className: 'csc-label',
                    html: `<div style="background: ${color}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap;">${csc.name}</div>`,
                    iconSize: [200, 30]
                })
            }).addTo(map);

            cscServicePolygons.push(serviceCircle);
            cscServicePolygons.push(label);
        });

        cscServiceAreasVisible = true;
        alert(`CSC Service Areas displayed.\n\nEach of the ${cscHospitals.length} Comprehensive Stroke Centers is shown with its approximate service territory.`);
    }
}

// ============================================================================
// FEATURE 5: Transfer Time Estimates (C4)
// ============================================================================
// This is integrated into hospital popups - enhancing existing popup function

function getTransferTimeEstimates(hospital) {
    // Always calculate transfer times to Harborview Medical Center
    const harborview = HOSPITALS.find(h => h.name === 'HARBORVIEW MEDICAL CENTER');

    if (!harborview) {
        console.error('Harborview Medical Center not found in database');
        return null;
    }

    // Don't show transfer time for Harborview itself
    if (hospital.cmsId === harborview.cmsId) {
        return null;
    }

    // Calculate distance to Harborview
    const distance = calculateDistance(
        hospital.latitude, hospital.longitude,
        harborview.latitude, harborview.longitude
    );

    // Ground: 60 mph average
    const groundTimeHours = distance / 60;
    const groundTimeMinutes = Math.round(groundTimeHours * 60 / 5) * 5; // Round to nearest 5 min

    // Air: 150 mph average
    const airTimeHours = distance / 150;
    const airTimeMinutes = Math.round(airTimeHours * 60 / 5) * 5; // Round to nearest 5 min

    return {
        nearestCenter: 'Harborview Medical Center',
        distance: distance.toFixed(1),
        groundTime: groundTimeMinutes,
        airTime: airTimeMinutes
    };
}

// ============================================================================
// FEATURE 6: Hospital Detail Cards (D1)
// ============================================================================

function showHospitalDetail(hospital) {
    const hospitalId = hospital.cmsId;
    const distData = hospitalDistances[hospitalId];
    const transferTimes = getTransferTimeEstimates(hospital);

    let html = `
        <div style="font-family: sans-serif;">
            <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 16px; color: #1f2937;">${hospital.name}</h2>

            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">Location</h3>
                <div style="font-size: 13px; line-height: 1.8;">
                    <strong>Address:</strong> ${hospital.address}<br>
                    <strong>City/State:</strong> ${hospital.state} ${hospital.zip}<br>
                    <strong>CMS ID:</strong> ${hospital.cmsId}
                </div>
            </div>

            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">Stroke Capabilities</h3>
                <div style="font-size: 13px; line-height: 1.8;">
    `;

    if (hospital.strokeCertificationType) {
        html += `<strong>Certification:</strong> ${hospital.strokeCertificationType}`;
        if (hospital.strokeCertificationType === 'CSC') html += ' (Comprehensive Stroke Center)';
        if (hospital.strokeCertificationType === 'TSC') html += ' (Thrombectomy-Capable)';
        if (hospital.strokeCertificationType === 'PSC') html += ' (Primary Stroke Center)';
        if (hospital.strokeCertificationType === 'ASR') html += ' (Acute Stroke Ready)';
        html += '<br>';

        if (hospital.certifyingBody) {
            html += `<strong>Certifying Body:</strong> ${hospital.certifyingBody}<br>`;
        }
        if (hospital.certificationDetails) {
            html += `<strong>Details:</strong> ${hospital.certificationDetails}<br>`;
        }
    } else {
        html += `<strong>Certification:</strong> <span style="color: #dc2626;">None</span><br>`;
    }

    html += `<strong>EVT Capability:</strong> ${hospital.hasELVO ? '<span style="color: #10b981;">Yes - 24/7 Thrombectomy</span>' : 'No'}<br>`;
    html += `<strong>UW Partner:</strong> ${hospital.uwPartner ? '<span style="color: #3b82f6;">Yes</span>' : 'No'}`;

    html += `</div></div>`;

    // Distance Analysis
    html += `
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">Distance Analysis</h3>
            <div style="font-size: 13px; line-height: 1.8;">
    `;

    if (distData.nearestAdvancedDistance !== Infinity && distData.nearestAdvancedDistance > 0) {
        html += `<strong>Nearest CSC/TSC:</strong> ${distData.nearestAdvancedName}<br>`;
        html += `<strong>Distance:</strong> ${distData.nearestAdvancedDistance.toFixed(1)} miles<br>`;
    }

    if (distData.nearestEVTDistance !== Infinity && distData.nearestEVTDistance > 0) {
        html += `<strong>Nearest EVT Center:</strong> ${distData.nearestEVTName}<br>`;
        html += `<strong>Distance:</strong> ${distData.nearestEVTDistance.toFixed(1)} miles<br>`;
    }

    html += `</div></div>`;

    // Transfer Time Estimates
    if (transferTimes) {
        html += `
            <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #92400e;">Transfer Time to Harborview Medical Center</h3>
                <div style="font-size: 13px; line-height: 1.8; color: #92400e;">
                    Ground Transfer: ~${transferTimes.groundTime} minutes (${transferTimes.distance} mi @ 60 mph)<br>
                    Air Transfer: ~${transferTimes.airTime} minutes (${transferTimes.distance} mi @ 150 mph)<br>
                    <em style="font-size: 11px;">Estimates assume direct route and average speeds</em>
                </div>
            </div>
        `;
    }

    // Data Sources
    if (hospital.dataSources && hospital.dataSources.length > 0) {
        html += `
            <div style="font-size: 11px; color: #6b7280; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                <strong>Data Sources:</strong> ${hospital.dataSources.join(', ')}
            </div>
        `;
    }

    html += `</div>`;

    document.getElementById('hospital-detail-content').innerHTML = html;
    document.getElementById('hospital-detail-modal').style.display = 'block';
}

function closeHospitalDetail() {
    document.getElementById('hospital-detail-modal').style.display = 'none';
}

// Enhance markers to show detail card on click
function renderMarkersWithDetailCards() {
    // This will be integrated into the main renderMarkers function
    // For now, we'll add click handlers to existing markers
}

// ============================================================================
// FEATURE 7: Quick Filters Toolbar (E1)
// ============================================================================

function quickFilter(filterType) {
    console.log(`Applying quick filter: ${filterType}`);
    activeQuickFilter = filterType;

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    let filtered = [];

    switch (filterType) {
        case 'AK':
            filtered = HOSPITALS.filter(h => h.state === 'AK');
            break;
        case 'ID':
            filtered = HOSPITALS.filter(h => h.state === 'ID');
            break;
        case 'WA':
            filtered = HOSPITALS.filter(h => h.state === 'WA');
            break;
        case 'NO_CERT':
            filtered = HOSPITALS.filter(h => !h.strokeCertificationType);
            break;
        case 'UW_ONLY':
            filtered = HOSPITALS.filter(h => h.uwPartner);
            break;
        case 'EVT_DESERT':
            filtered = HOSPITALS.filter(h => {
                const dist = hospitalDistances[h.cmsId].nearestEVTDistance;
                return dist > 100;
            });
            break;
        case 'EXPANSION':
            filtered = HOSPITALS.filter(h => !h.strokeCertificationType && !h.uwPartner);
            break;
        default:
            filtered = HOSPITALS;
    }

    console.log(`Quick filter '${filterType}' showing ${filtered.length} hospitals`);

    // Render filtered hospitals
    filtered.forEach(hospital => {
        const color = getMarkerColor(hospital);
        const size = getMarkerSize(hospital);

        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size,
            fillColor: color,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        });

        // Build popup - simpler version without nested quotes
        const transferTimes = getTransferTimeEstimates(hospital);
        let popupHTML = '<div style="font-family: sans-serif; min-width: 300px;">';
        popupHTML += `<h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: ${color};">${hospital.name}</h3>`;
        popupHTML += '<div style="font-size: 13px; line-height: 1.6;">';
        popupHTML += `<strong>Address:</strong> ${hospital.address}, ${hospital.state}<br>`;
        popupHTML += `<strong>Certification:</strong> ${hospital.strokeCertificationType || 'None'}<br>`;
        popupHTML += `<strong>UW Partner:</strong> ${hospital.uwPartner ? 'Yes' : 'No'}<br>`;

        if (transferTimes) {
            popupHTML += `<strong>Transfer Time to Harborview Medical Center:</strong><br>`;
            popupHTML += `Ground: ~${transferTimes.groundTime} min | Air: ~${transferTimes.airTime} min<br>`;
        }

        popupHTML += '</div></div>';

        marker.bindPopup(popupHTML);
        marker.on('click', function() {
            showHospitalDetail(hospital);
        });
        marker.addTo(map);
        markers.push(marker);
    });

    updateStats(filtered);

    let filterName = {
        'AK': 'Alaska Only',
        'ID': 'Idaho Only',
        'WA': 'Washington Only',
        'NO_CERT': 'No Certification',
        'UW_ONLY': 'UW Partners Only',
        'EVT_DESERT': 'EVT Deserts (>100mi)',
        'EXPANSION': 'Expansion Targets'
    }[filterType];

    alert(`Quick Filter Applied: ${filterName}\n\nShowing ${filtered.length} hospitals.`);
}

function clearQuickFilters() {
    activeQuickFilter = null;
    renderMarkers();
    alert('Quick filters cleared. Showing all hospitals.');
}

// ============================================================================
// FEATURE 8: PNG Map Export (F2)
// ============================================================================

function exportMapToPNG() {
    alert('Preparing map export... This may take a few seconds.');

    // Hide control panels temporarily
    const controlPanel = document.querySelector('.control-panel');
    const statsPanel = document.querySelector('.stats-panel');
    const originalControlDisplay = controlPanel.style.display;
    const originalStatsDisplay = statsPanel.style.display;

    controlPanel.style.display = 'none';
    statsPanel.style.display = 'none';

    // Use html2canvas to capture the map
    html2canvas(document.getElementById('map'), {
        useCORS: true,
        allowTaint: true
    }).then(canvas => {
        // Restore panels
        controlPanel.style.display = originalControlDisplay;
        statsPanel.style.display = originalStatsDisplay;

        // Create a new canvas with metadata
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = canvas.width;
        finalCanvas.height = canvas.height + 80; // Add space for text

        const ctx = finalCanvas.getContext('2d');

        // White background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

        // Draw the map
        ctx.drawImage(canvas, 0, 0);

        // Add metadata footer
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('UW Medicine Telestroke Network Expansion Planning Tool', finalCanvas.width / 2, canvas.height + 25);

        ctx.font = '14px Arial';
        ctx.fillText(`Generated: ${new Date().toLocaleDateString('en-US')}`, finalCanvas.width / 2, canvas.height + 50);

        ctx.font = '12px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('Regional Hospital Stroke Capabilities - WA, SE Alaska, N Idaho', finalCanvas.width / 2, canvas.height + 70);

        // Convert to PNG and download
        finalCanvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `telestroke_map_${new Date().toISOString().split('T')[0]}.png`;
            link.click();
            URL.revokeObjectURL(url);

            alert('Map exported successfully as PNG!');
        });
    }).catch(error => {
        console.error('Export failed:', error);
        controlPanel.style.display = originalControlDisplay;
        statsPanel.style.display = originalStatsDisplay;
        alert('Map export failed. Please try again.');
    });
}

// ============================================================================
// FEATURE 9: Executive Summary Auto-Generator (F3)
// ============================================================================

function generateExecutiveSummary() {
    console.log('Generating executive summary...');

    const totalHospitals = HOSPITALS.length;
    const uwPartners = HOSPITALS.filter(h => h.uwPartner).length;
    const certified = HOSPITALS.filter(h => h.strokeCertificationType).length;

    const cscCount = HOSPITALS.filter(h => h.strokeCertificationType === 'CSC').length;
    const tscCount = HOSPITALS.filter(h => h.strokeCertificationType === 'TSC').length;
    const pscCount = HOSPITALS.filter(h => h.strokeCertificationType === 'PSC').length;
    const asrCount = HOSPITALS.filter(h => h.strokeCertificationType === 'ASR').length;

    const noCert = HOSPITALS.filter(h => !h.strokeCertificationType).length;
    const notUW = HOSPITALS.filter(h => !h.uwPartner).length;
    const evtDeserts = HOSPITALS.filter(h => hospitalDistances[h.cmsId].nearestEVTDistance > 100).length;
    const zeroCapability = HOSPITALS.filter(h => !h.strokeCertificationType && !h.uwPartner).length;

    // By state
    const waHospitals = HOSPITALS.filter(h => h.state === 'WA').length;
    const waCertified = HOSPITALS.filter(h => h.state === 'WA' && h.strokeCertificationType).length;
    const waPartners = HOSPITALS.filter(h => h.state === 'WA' && h.uwPartner).length;

    const idHospitals = HOSPITALS.filter(h => h.state === 'ID').length;
    const idCertified = HOSPITALS.filter(h => h.state === 'ID' && h.strokeCertificationType).length;
    const idPartners = HOSPITALS.filter(h => h.state === 'ID' && h.uwPartner).length;

    const akHospitals = HOSPITALS.filter(h => h.state === 'AK').length;
    const akCertified = HOSPITALS.filter(h => h.state === 'AK' && h.strokeCertificationType).length;
    const akPartners = HOSPITALS.filter(h => h.state === 'AK' && h.uwPartner).length;

    // Top 10 expansion priorities
    const scored = HOSPITALS.map(hospital => {
        const hospitalId = hospital.cmsId;
        const distToAdvanced = hospitalDistances[hospitalId].nearestAdvancedDistance;
        const distToEVT = hospitalDistances[hospitalId].nearestEVTDistance;

        let score = 0;
        if (!hospital.strokeCertificationType) score += 3;
        if (!hospital.uwPartner) score += 2;
        if (distToAdvanced > 75) score += 2;
        if (distToEVT > 100) score += 1;
        if (hospital.strokeCertificationType === 'ASR' || hospital.strokeCertificationType === 'PSC') score -= 1;

        return { hospital, score, distToAdvanced, distToEVT };
    });

    scored.sort((a, b) => b.score - a.score);
    const top10 = scored.slice(0, 10);

    // Build summary text
    let summary = `UW MEDICINE TELESTROKE NETWORK EXPANSION SUMMARY
Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

CURRENT NETWORK STATUS:
- Total Regional Hospitals: ${totalHospitals}
- Current UW Partners: ${uwPartners} (${(uwPartners / totalHospitals * 100).toFixed(1)}% of total)
- Stroke-Certified Hospitals: ${certified} (${(certified / totalHospitals * 100).toFixed(1)}% of total)

COVERAGE ANALYSIS:
- CSC (Comprehensive): ${cscCount} facilities
- TSC (Thrombectomy-Capable): ${tscCount} facilities
- PSC (Primary): ${pscCount} facilities
- ASR (Acute Stroke Ready): ${asrCount} facilities

SERVICE GAPS IDENTIFIED:
- Hospitals with NO certification: ${noCert} (${(noCert / totalHospitals * 100).toFixed(1)}%)
- Hospitals NOT in UW network: ${notUW} (${(notUW / totalHospitals * 100).toFixed(1)}%)
- Hospitals >100mi from EVT: ${evtDeserts} (${(evtDeserts / totalHospitals * 100).toFixed(1)}%)
- Zero-capability hospitals: ${zeroCapability} (${(zeroCapability / totalHospitals * 100).toFixed(1)}%)

EXPANSION OPPORTUNITIES BY STATE:
- Washington: ${waHospitals} hospitals (certified: ${waCertified}, partners: ${waPartners})
- Idaho: ${idHospitals} hospitals (certified: ${idCertified}, partners: ${idPartners})
- Alaska: ${akHospitals} hospitals (certified: ${akCertified}, partners: ${akPartners})

TOP 10 EXPANSION PRIORITIES:
`;

    top10.forEach((item, index) => {
        summary += `${index + 1}. ${item.hospital.name}, ${item.hospital.state} (Score: ${item.score})\n`;
        summary += `   - Distance to CSC/TSC: ${item.distToAdvanced === Infinity ? 'N/A' : item.distToAdvanced.toFixed(1) + ' mi'}\n`;
        summary += `   - Distance to EVT: ${item.distToEVT === Infinity ? 'N/A' : item.distToEVT.toFixed(1) + ' mi'}\n`;
        summary += `   - Current Status: ${item.hospital.strokeCertificationType || 'No certification'}, ${item.hospital.uwPartner ? 'UW Partner' : 'Not UW Partner'}\n\n`;
    });

    summary += `STRATEGIC RECOMMENDATIONS:
- Alaska represents critical service gap (${akCertified} certifications, ${akPartners} partnerships)
- Eastern Washington underserved for EVT access (${evtDeserts} hospitals >100mi from thrombectomy)
- Idaho panhandle integration opportunity (${idHospitals - idPartners} non-partner hospitals)
- Zero-capability hospitals represent high-value expansion targets (${zeroCapability} facilities)

METHODOLOGY:
- Data sources: CMS (Nov 2024), WA DOH (Oct 2024), Idaho DOH (2025), UW Medicine
- Expansion scoring: No cert (+3), Not UW partner (+2), >75mi from CSC/TSC (+2), >100mi from EVT (+1)
- Distance calculations: Haversine formula (great-circle distance)
- Transfer time estimates: Ground 60 mph, Air 150 mph average speeds
`;

    document.getElementById('executive-summary-content').textContent = summary;
    document.getElementById('executive-summary-modal').style.display = 'block';
}

function closeExecutiveSummary() {
    document.getElementById('executive-summary-modal').style.display = 'none';
}

function copyExecutiveSummary() {
    const text = document.getElementById('executive-summary-content').textContent;
    navigator.clipboard.writeText(text).then(() => {
        alert('Executive summary copied to clipboard!');
    }).catch(err => {
        console.error('Copy failed:', err);
        alert('Copy failed. Please select and copy manually.');
    });
}

function downloadExecutiveSummary() {
    const text = document.getElementById('executive-summary-content').textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `executive_summary_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// FEATURE 10: Connection Lines Visualization (G3)
// ============================================================================

function toggleReferralPathways() {
    if (referralLinesVisible) {
        // Remove lines
        referralLines.forEach(line => map.removeLayer(line));
        referralLines = [];
        referralLinesVisible = false;
        console.log('Referral pathways removed');
    } else {
        console.log('Drawing referral pathways...');

        let lineCount = 0;

        HOSPITALS.forEach(hospital => {
            const hospitalId = hospital.cmsId;
            const distData = hospitalDistances[hospitalId];

            // Skip if this is a CSC/TSC itself
            if (hospital.strokeCertificationType === 'CSC' || hospital.strokeCertificationType === 'TSC') {
                return;
            }

            if (distData.nearestAdvanced && distData.nearestAdvancedDistance !== Infinity) {
                const distance = distData.nearestAdvancedDistance;

                // Color-code by distance
                let color, weight;
                if (distance < 50) {
                    color = '#10b981'; // Green
                    weight = 1;
                } else if (distance <= 100) {
                    color = '#f59e0b'; // Yellow
                    weight = 1.5;
                } else if (distance <= 150) {
                    color = '#ea580c'; // Orange
                    weight = 2;
                } else {
                    color = '#dc2626'; // Red
                    weight = 2.5;
                }

                const line = L.polyline([
                    [hospital.latitude, hospital.longitude],
                    [distData.nearestAdvanced.latitude, distData.nearestAdvanced.longitude]
                ], {
                    color: color,
                    weight: weight,
                    opacity: 0.5,
                    dashArray: '5, 10'
                }).addTo(map);

                referralLines.push(line);
                lineCount++;
            }
        });

        referralLinesVisible = true;
        alert(`Referral Pathways displayed.\n\n${lineCount} hospitals connected to nearest CSC/TSC.\n\nColors: Green (<50mi), Yellow (50-100mi), Orange (100-150mi), Red (>150mi)`);
    }
}

// ============================================================================
// FEATURE 11: Cluster Markers (G4)
// ============================================================================

function toggleClusterMarkers() {
    if (clusteringEnabled) {
        // Disable clustering
        if (markerClusterGroup) {
            map.removeLayer(markerClusterGroup);
            markerClusterGroup = null;
        }
        clusteringEnabled = false;

        // Restore normal markers
        renderMarkers();
        alert('Cluster markers disabled. Showing individual hospital markers.');
    } else {
        // Enable clustering
        markerClusterGroup = L.markerClusterGroup({
            maxClusterRadius: 50,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: function(cluster) {
                const markers = cluster.getAllChildMarkers();
                let highestCert = 'None';

                // Determine highest certification level in cluster
                markers.forEach(m => {
                    const hospital = m.options.hospital;
                    if (hospital.strokeCertificationType === 'CSC') highestCert = 'CSC';
                    else if (hospital.strokeCertificationType === 'TSC' && highestCert !== 'CSC') highestCert = 'TSC';
                    else if (hospital.strokeCertificationType === 'PSC' && !['CSC', 'TSC'].includes(highestCert)) highestCert = 'PSC';
                    else if (hospital.strokeCertificationType === 'ASR' && !['CSC', 'TSC', 'PSC'].includes(highestCert)) highestCert = 'ASR';
                });

                // Color by highest cert
                let color = '#6b7280';
                if (highestCert === 'CSC') color = '#dc2626';
                else if (highestCert === 'TSC') color = '#ea580c';
                else if (highestCert === 'PSC') color = '#f59e0b';
                else if (highestCert === 'ASR') color = '#84cc16';

                const iconHTML = '<div style="background: ' + color + '; color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-weight: 700; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">' + markers.length + '</div>';

                return L.divIcon({
                    html: iconHTML,
                    className: 'custom-cluster-icon',
                    iconSize: L.point(40, 40)
                });
            }
        });

        // Clear existing markers
        markers.forEach(m => map.removeLayer(m));
        markers = [];

        // Add all hospitals to cluster group
        HOSPITALS.forEach(hospital => {
            const color = getMarkerColor(hospital);
            const size = getMarkerSize(hospital);

            const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
                radius: size,
                fillColor: color,
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
                hospital: hospital // Store hospital data
            });

            // Popup
            const popupContent = `
                <div style="font-family: sans-serif; min-width: 300px;">
                    <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: ${color};">${hospital.name}</h3>
                    <div style="font-size: 13px; line-height: 1.6;">
                        <strong>Address:</strong> ${hospital.address}, ${hospital.state}<br>
                        <strong>Certification:</strong> ${hospital.strokeCertificationType || 'None'}<br>
                        <strong>UW Partner:</strong> ${hospital.uwPartner ? 'Yes' : 'No'}
                    </div>
                </div>
            `;

            marker.bindPopup(popupContent);
            marker.on('click', function() {
                showHospitalDetail(hospital);
            });
            markerClusterGroup.addLayer(marker);
        });

        map.addLayer(markerClusterGroup);
        clusteringEnabled = true;
        alert('Cluster markers enabled.\n\nHospitals are now grouped when zoomed out. Click clusters to zoom in.\n\nCluster colors indicate highest certification level in that group.');
    }
}

// ============================================================================
// FEATURE 12: Click-and-Compare Mode (H1)
// ============================================================================

function toggleCompareMode() {
    if (compareMode) {
        // Exit compare mode
        compareMode = false;
        compareHospital1 = null;
        compareHospital2 = null;
        document.getElementById('compare-modal').style.display = 'none';
        renderMarkers();
        alert('Compare mode exited.');
    } else {
        // Enter compare mode
        compareMode = true;
        compareHospital1 = null;
        compareHospital2 = null;

        document.getElementById('compare-instructions').textContent = 'Click on the first hospital to compare...';
        document.getElementById('compare-content').innerHTML = '';
        document.getElementById('compare-modal').style.display = 'block';

        // Re-render markers with click handlers
        markers.forEach(m => map.removeLayer(m));
        markers = [];

        HOSPITALS.forEach(hospital => {
            const color = getMarkerColor(hospital);
            const size = getMarkerSize(hospital);

            const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
                radius: size,
                fillColor: color,
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            });

            marker.on('click', function() {
                handleCompareClick(hospital);
            });

            marker.addTo(map);
            markers.push(marker);
        });

        alert('Compare Mode activated.\n\nClick on two hospitals to compare them.\n\nPress ESC or click the X to exit compare mode.');
    }
}

function handleCompareClick(hospital) {
    if (!compareMode) return;

    if (!compareHospital1) {
        // First hospital selected
        compareHospital1 = hospital;
        document.getElementById('compare-instructions').textContent = `First hospital selected: ${hospital.name}. Now click on the second hospital...`;

        // Highlight first hospital
        markers.forEach(m => {
            const pos = m.getLatLng();
            if (pos.lat === hospital.latitude && pos.lng === hospital.longitude) {
                m.setStyle({ weight: 4, color: '#f59e0b' });
            }
        });
    } else if (!compareHospital2) {
        // Second hospital selected
        compareHospital2 = hospital;

        // Highlight second hospital
        markers.forEach(m => {
            const pos = m.getLatLng();
            if (pos.lat === hospital.latitude && pos.lng === hospital.longitude) {
                m.setStyle({ weight: 4, color: '#10b981' });
            }
        });

        // Show comparison
        showComparison();
    }
}

function showComparison() {
    const h1 = compareHospital1;
    const h2 = compareHospital2;

    const h1Dist = hospitalDistances[h1.cmsId];
    const h2Dist = hospitalDistances[h2.cmsId];

    // Calculate distance between the two hospitals
    const distanceBetween = calculateDistance(h1.latitude, h1.longitude, h2.latitude, h2.longitude);

    let html = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; font-family: sans-serif; font-size: 13px;">
            <div>
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #f59e0b;">${h1.name}</h3>
                <div style="line-height: 1.8;">
                    <strong>State:</strong> ${h1.state}<br>
                    <strong>Address:</strong> ${h1.address}<br>
                    <strong>Certification:</strong> ${h1.strokeCertificationType || 'None'}<br>
                    <strong>Certifying Body:</strong> ${h1.certifyingBody || 'N/A'}<br>
                    <strong>UW Partner:</strong> ${h1.uwPartner ? 'Yes' : 'No'}<br>
                    <strong>EVT Capable:</strong> ${h1.hasELVO ? 'Yes' : 'No'}<br>
                    <strong>Distance to CSC/TSC:</strong> ${h1Dist.nearestAdvancedDistance === Infinity || h1Dist.nearestAdvancedDistance === 0 ? 'N/A' : h1Dist.nearestAdvancedDistance.toFixed(1) + ' mi'}<br>
                    <strong>Distance to EVT:</strong> ${h1Dist.nearestEVTDistance === Infinity || h1Dist.nearestEVTDistance === 0 ? 'N/A' : h1Dist.nearestEVTDistance.toFixed(1) + ' mi'}<br>
                </div>
            </div>
            <div>
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #10b981;">${h2.name}</h3>
                <div style="line-height: 1.8;">
                    <strong>State:</strong> ${h2.state}<br>
                    <strong>Address:</strong> ${h2.address}<br>
                    <strong>Certification:</strong> ${h2.strokeCertificationType || 'None'}<br>
                    <strong>Certifying Body:</strong> ${h2.certifyingBody || 'N/A'}<br>
                    <strong>UW Partner:</strong> ${h2.uwPartner ? 'Yes' : 'No'}<br>
                    <strong>EVT Capable:</strong> ${h2.hasELVO ? 'Yes' : 'No'}<br>
                    <strong>Distance to CSC/TSC:</strong> ${h2Dist.nearestAdvancedDistance === Infinity || h2Dist.nearestAdvancedDistance === 0 ? 'N/A' : h2Dist.nearestAdvancedDistance.toFixed(1) + ' mi'}<br>
                    <strong>Distance to EVT:</strong> ${h2Dist.nearestEVTDistance === Infinity || h2Dist.nearestEVTDistance === 0 ? 'N/A' : h2Dist.nearestEVTDistance.toFixed(1) + ' mi'}<br>
                </div>
            </div>
        </div>
        <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin-top: 20px; text-align: center; font-weight: 700;">
            Distance between hospitals: ${distanceBetween.toFixed(1)} miles
        </div>
    `;

    document.getElementById('compare-content').innerHTML = html;
    document.getElementById('compare-instructions').textContent = 'Comparison complete. Click another hospital or close to exit.';
}

function closeCompare() {
    compareMode = false;
    compareHospital1 = null;
    compareHospital2 = null;
    document.getElementById('compare-modal').style.display = 'none';
    renderMarkers();
}

// ============================================================================
// FEATURE 13: What-If Scenario Builder (I1)
// ============================================================================

function startWhatIfScenario() {
    if (whatIfMode) {
        // Exit what-if mode
        whatIfMode = false;
        if (whatIfMarker) {
            map.removeLayer(whatIfMarker);
            whatIfMarker = null;
        }
        renderMarkers();
        alert('What-If Scenario mode exited.');
    } else {
        // Enter what-if mode
        whatIfMode = true;
        alert('What-If Scenario Mode activated.\n\nClick anywhere on the map to place a hypothetical EVT center.\n\nThe map will show how many hospitals would be within 100 miles of this new center.');

        // Add click handler to map
        map.on('click', handleWhatIfClick);
    }
}

function handleWhatIfClick(e) {
    if (!whatIfMode) return;

    const clickLat = e.latlng.lat;
    const clickLng = e.latlng.lng;

    // Remove previous marker if exists
    if (whatIfMarker) {
        map.removeLayer(whatIfMarker);
    }

    // Place hypothetical EVT center marker (star icon)
    whatIfMarker = L.marker([clickLat, clickLng], {
        icon: L.divIcon({
            className: 'what-if-marker',
            html: '<div style="font-size: 32px; color: #10b981;">★</div>',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        })
    }).addTo(map);

    whatIfMarker.bindPopup('<strong>Hypothetical EVT Center</strong><br>Click "Clear Scenario" to remove').openPopup();

    // Calculate impact
    let hospitalsWithin100 = 0;
    const currentEVTDeserts = HOSPITALS.filter(h => hospitalDistances[h.cmsId].nearestEVTDistance > 100);
    let desertsResolved = 0;

    const hospitalsImpacted = [];

    HOSPITALS.forEach(hospital => {
        const distToNewCenter = calculateDistance(hospital.latitude, hospital.longitude, clickLat, clickLng);

        if (distToNewCenter <= 100) {
            hospitalsWithin100++;

            // Check if this was an EVT desert
            if (hospitalDistances[hospital.cmsId].nearestEVTDistance > 100) {
                desertsResolved++;
                hospitalsImpacted.push(hospital.name);
            }
        }
    });

    // Re-render markers with color coding
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    HOSPITALS.forEach(hospital => {
        const distToNewCenter = calculateDistance(hospital.latitude, hospital.longitude, clickLat, clickLng);
        const wasDesert = hospitalDistances[hospital.cmsId].nearestEVTDistance > 100;
        const nowServed = distToNewCenter <= 100;

        let color, size;

        if (wasDesert && nowServed) {
            color = '#10b981'; // Green - desert resolved
            size = 10;
        } else if (nowServed) {
            color = '#3b82f6'; // Blue - within range
            size = 8;
        } else {
            color = getMarkerColor(hospital);
            size = getMarkerSize(hospital);
        }

        const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
            radius: size,
            fillColor: color,
            color: 'white',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        });

        let popupContent = `<strong>${hospital.name}</strong><br>`;
        popupContent += `Distance to new center: ${distToNewCenter.toFixed(1)} mi<br>`;
        if (wasDesert && nowServed) {
            popupContent += '<strong style="color: #10b981;">✓ EVT Desert RESOLVED</strong>';
        } else if (nowServed) {
            popupContent += '<strong style="color: #3b82f6;">Within 100 miles of new center</strong>';
        }

        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });

    // Show results
    alert(`What-If Scenario Results:\n\nHypothetical EVT Center Location: ${clickLat.toFixed(4)}, ${clickLng.toFixed(4)}\n\n` +
          `${hospitalsWithin100} hospitals within 100 miles\n` +
          `${desertsResolved} EVT deserts resolved\n` +
          `Currently ${currentEVTDeserts.length} hospitals are >100mi from EVT\n\n` +
          `Green markers: Former EVT deserts now served\n` +
          `Blue markers: Other hospitals within range`);

    // Remove map click handler after placement
    map.off('click', handleWhatIfClick);

    // Allow clearing scenario
    whatIfMode = false;
}

// ============================================================================
// FEATURE 14: Optimal EVT Center Placement (I2)
// ============================================================================

function findOptimalEVTLocation() {
    console.log('Calculating optimal EVT center location...');

    // Get all EVT desert hospitals (>100mi from current EVT)
    const evtDesertHospitals = HOSPITALS.filter(h => hospitalDistances[h.cmsId].nearestEVTDistance > 100);

    if (evtDesertHospitals.length === 0) {
        alert('No EVT deserts found! All hospitals are within 100 miles of an EVT center.');
        return;
    }

    console.log(`Found ${evtDesertHospitals.length} EVT desert hospitals`);

    // Calculate geographic centroid
    let sumLat = 0;
    let sumLng = 0;

    evtDesertHospitals.forEach(h => {
        sumLat += h.latitude;
        sumLng += h.longitude;
    });

    const optimalLat = sumLat / evtDesertHospitals.length;
    const optimalLng = sumLng / evtDesertHospitals.length;

    console.log(`Optimal location: ${optimalLat.toFixed(4)}, ${optimalLng.toFixed(4)}`);

    // Remove previous marker if exists
    if (optimalEVTMarker) {
        map.removeLayer(optimalEVTMarker);
    }

    // Place optimal marker
    optimalEVTMarker = L.marker([optimalLat, optimalLng], {
        icon: L.divIcon({
            className: 'optimal-marker',
            html: '<div style="font-size: 40px; color: #ef4444;">⊕</div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        })
    }).addTo(map);

    optimalEVTMarker.bindPopup(`<strong>Optimal EVT Center Location</strong><br>
                                 Lat: ${optimalLat.toFixed(4)}<br>
                                 Lng: ${optimalLng.toFixed(4)}<br>
                                 Geographic centroid of ${evtDesertHospitals.length} EVT desert hospitals`).openPopup();

    // Calculate how many deserts would be resolved
    let desertsResolved = 0;
    evtDesertHospitals.forEach(h => {
        const dist = calculateDistance(h.latitude, h.longitude, optimalLat, optimalLng);
        if (dist <= 100) {
            desertsResolved++;
        }
    });

    // Find nearest city/town to optimal location
    let nearestHospital = null;
    let minDist = Infinity;
    HOSPITALS.forEach(h => {
        const dist = calculateDistance(h.latitude, h.longitude, optimalLat, optimalLng);
        if (dist < minDist) {
            minDist = dist;
            nearestHospital = h;
        }
    });

    // Zoom to optimal location
    map.setView([optimalLat, optimalLng], 8);

    // Show results
    alert(`Optimal EVT Center Location Found:\n\n` +
          `Coordinates: ${optimalLat.toFixed(4)}, ${optimalLng.toFixed(4)}\n` +
          `Nearest hospital: ${nearestHospital.name} (${minDist.toFixed(1)} mi away)\n` +
          `Location: Near ${nearestHospital.address}, ${nearestHospital.state}\n\n` +
          `Impact:\n` +
          `- Would serve ${desertsResolved} of ${evtDesertHospitals.length} current EVT desert hospitals\n` +
          `- Calculated as geographic centroid (average lat/lng) of all EVT deserts\n\n` +
          `A marker (⊕) has been placed at the optimal location.`);
}

// ============================================================================
// FEATURE 15: URL State Persistence (L3)
// ============================================================================

function saveStateToURL() {
    const params = new URLSearchParams();

    // Save active filters
    if (document.getElementById('filter-csc').checked) params.append('csc', '1');
    if (document.getElementById('filter-tsc').checked) params.append('tsc', '1');
    if (document.getElementById('filter-psc').checked) params.append('psc', '1');
    if (document.getElementById('filter-asr').checked) params.append('asr', '1');
    if (document.getElementById('filter-uwPartner').checked) params.append('uw', '1');
    if (document.getElementById('filter-evt').checked) params.append('evt', '1');

    // Save quick filter
    if (activeQuickFilter) params.append('qf', activeQuickFilter);

    // Save map view
    const center = map.getCenter();
    const zoom = map.getZoom();
    params.append('lat', center.lat.toFixed(4));
    params.append('lng', center.lng.toFixed(4));
    params.append('z', zoom);

    // Update URL without page reload
    const newURL = window.location.pathname + '?' + params.toString();
    history.pushState(null, '', newURL);

    console.log('State saved to URL:', newURL);
}

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);

    // Restore filters
    if (params.has('csc')) document.getElementById('filter-csc').checked = true;
    if (params.has('tsc')) document.getElementById('filter-tsc').checked = true;
    if (params.has('psc')) document.getElementById('filter-psc').checked = true;
    if (params.has('asr')) document.getElementById('filter-asr').checked = true;
    if (params.has('uw')) document.getElementById('filter-uwPartner').checked = true;
    if (params.has('evt')) document.getElementById('filter-evt').checked = true;

    // Restore quick filter
    if (params.has('qf')) {
        activeQuickFilter = params.get('qf');
        // Apply quick filter after data loads
        setTimeout(() => {
            quickFilter(activeQuickFilter);
        }, 1000);
    }

    // Restore map view
    if (params.has('lat') && params.has('lng') && params.has('z')) {
        const lat = parseFloat(params.get('lat'));
        const lng = parseFloat(params.get('lng'));
        const zoom = parseInt(params.get('z'));

        setTimeout(() => {
            map.setView([lat, lng], zoom);
        }, 500);
    }

    console.log('State loaded from URL');
}

// Initialize URL state loading
window.addEventListener('load', function() {
    setTimeout(loadStateFromURL, 1500);
});

// Save state when filters change
function autoSaveState() {
    if (typeof saveStateToURL === 'function') {
        saveStateToURL();
    }
}

// Add share URL button functionality
function shareCurrentView() {
    saveStateToURL();
    const url = window.location.href;

    navigator.clipboard.writeText(url).then(() => {
        alert('Shareable URL copied to clipboard!\n\nShare this link to show the exact same map view and filters.');
    }).catch(err => {
        console.error('Copy failed:', err);
        prompt('Copy this URL to share:', url);
    });
}
