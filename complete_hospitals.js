// Complete Hospitals Database and Map Functionality

let HOSPITALS = [];
let map;
let markers = [];

// Load hospital data
fetch('complete_hospitals_geocoded.json')
    .then(response => response.json())
    .then(data => {
        HOSPITALS = data.filter(h => h.latitude && h.longitude);
        console.log(`Loaded ${HOSPITALS.length} hospitals with coordinates`);
        console.log(`Total in database: ${data.length}`);
        initializeMap();
        updateStats();
        setupFilters();
    })
    .catch(error => {
        console.error('Error loading hospital data:', error);
        alert('Error loading hospital data. Please refresh the page.');
    });

function initializeMap() {
    console.log('Initializing map...');
    map = L.map('map', {
        zoomControl: false
    }).setView([47.0, -120.5], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    renderMarkers();
}

function getMarkerColor(hospital) {
    // National certifications take precedence
    if (hospital.nationalCertification) {
        const cert = hospital.nationalCertification.toUpperCase();
        if (cert.includes('CSC')) return '#dc2626'; // Red - Comprehensive
        if (cert.includes('TSC') || cert.includes('THROMBECTOMY')) return '#ea580c'; // Orange - Thrombectomy-Capable
        if (cert.includes('PSC+') || cert.includes('PLUS')) return '#f59e0b'; // Amber - Primary Plus
        if (cert.includes('PSC')) return '#84cc16'; // Lime - Primary
    }

    // UW Partners without national certification
    if (hospital.uwPartner) return '#3b82f6'; // Blue

    // Other hospitals
    return '#6b7280'; // Gray
}

function getMarkerSize(hospital) {
    // National certifications and UW Partners get larger markers
    if (hospital.nationalCertification) return 10;
    if (hospital.uwPartner) return 9;
    if (hospital.hasELVO) return 9;
    if (hospital.waStateStrokeLevel === 'I') return 8;
    return 6;
}

function renderMarkers() {
    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // Get filter states
    const filters = {
        uwPartner: document.getElementById('filter-uwPartner').checked,
        nationalCert: document.getElementById('filter-nationalCert').checked,
        evt: document.getElementById('filter-evt').checked,
        waLevel1: document.getElementById('filter-waLevel1').checked,
        waLevel2: document.getElementById('filter-waLevel2').checked,
        waLevel3: document.getElementById('filter-waLevel3').checked,
        acute: document.getElementById('filter-acute').checked,
        critical: document.getElementById('filter-critical').checked,
        other: document.getElementById('filter-other').checked
    };

    // Filter hospitals
    const filtered = HOSPITALS.filter(h => {
        // Special designation filters
        if (filters.uwPartner && h.uwPartner) return true;
        if (filters.nationalCert && h.nationalCertification) return true;
        if (filters.evt && h.hasELVO) return true;

        // WA State level filters
        if (filters.waLevel1 && h.waStateStrokeLevel === 'I') return true;
        if (filters.waLevel2 && h.waStateStrokeLevel === 'II') return true;
        if (filters.waLevel3 && h.waStateStrokeLevel === 'III') return true;

        // Hospital type filters
        const hospType = (h.hospitalType || '').toLowerCase();
        if (filters.acute && hospType.includes('acute care')) return true;
        if (filters.critical && h.isCriticalAccess) return true;
        if (filters.other && !hospType.includes('acute care') && !h.isCriticalAccess) return true;

        // Show all if no filters selected
        const anyFilterSelected = Object.values(filters).some(v => v);
        return !anyFilterSelected;
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

        // Popup content
        let popupContent = `
            <div style="font-family: sans-serif; min-width: 280px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: ${color};">${hospital.name}</h3>
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>Location:</strong> ${hospital.address || 'Address not available'}, ${hospital.state}<br>
                    ${hospital.hospitalType ? `<strong>Type:</strong> ${hospital.hospitalType}<br>` : ''}
                    ${hospital.isCriticalAccess ? `<strong>Critical Access Hospital</strong><br>` : ''}
                    ${hospital.waStateStrokeLevel ? `<strong>WA State Stroke Level:</strong> ${hospital.waStateStrokeLevel}<br>` : ''}
                    ${hospital.nationalCertification ? `<strong>National Certification:</strong> ${hospital.nationalCertification}<br>` : ''}
                    ${hospital.certifyingBody ? `<strong>Certifying Body:</strong> ${hospital.certifyingBody}<br>` : ''}
                    ${hospital.hasELVO ? `<strong>24/7 Thrombectomy (EVT):</strong> Yes<br>` : ''}
                    ${hospital.uwPartner ? `<strong>✓ UW Medicine Telestroke Partner</strong><br>` : ''}
                    ${hospital.emergencyServices ? `<strong>Emergency Services:</strong> Yes<br>` : ''}
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
    document.getElementById('stat-uwPartners').textContent = filtered.filter(h => h.uwPartner).length;
    document.getElementById('stat-nationalCert').textContent = filtered.filter(h => h.nationalCertification).length;
    document.getElementById('stat-evt').textContent = filtered.filter(h => h.hasELVO).length;
}

function setupFilters() {
    const filterIds = [
        'filter-uwPartner', 'filter-nationalCert', 'filter-evt',
        'filter-waLevel1', 'filter-waLevel2', 'filter-waLevel3',
        'filter-acute', 'filter-critical', 'filter-other'
    ];

    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', renderMarkers);
        }
    });
}

function toggleAllFilters(group, state) {
    const elements = document.querySelectorAll(`.filter-${group}`);
    elements.forEach(el => {
        el.checked = state;
    });
    renderMarkers();
}

function showLevelInfo() {
    document.getElementById('info-panel').classList.add('active');
}

function closeInfo() {
    document.getElementById('info-panel').classList.remove('active');
}
