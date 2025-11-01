// Complete Hospitals Database and Map Functionality

let HOSPITALS = [];
let ALL_HOSPITALS = []; // Store all hospitals for search
let map;
let markers = [];

// Load hospital data
fetch('complete_hospitals_geocoded.json')
    .then(response => response.json())
    .then(data => {
        HOSPITALS = data.filter(h => h.latitude && h.longitude);
        ALL_HOSPITALS = [...HOSPITALS]; // Store copy for search
        console.log(`Loaded ${HOSPITALS.length} hospitals with coordinates`);
        console.log(`Total in database: ${data.length}`);
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
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
        uwPartner: document.getElementById('filter-uwPartner').checked,
        evt: document.getElementById('filter-evt').checked,
    };

    // Get search term
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    // Check if any filters are active
    const anyFilterActive = filters.csc || filters.tsc || filters.psc || filters.uwPartner || filters.evt;

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

        // Coordinates
        popupContent += `<br><strong>Coordinates:</strong> ${hospital.latitude.toFixed(4)}, ${hospital.longitude.toFixed(4)}<br>`;

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
        uwPartner: document.getElementById('filter-uwPartner').checked,
        evt: document.getElementById('filter-evt').checked,
    };

    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    // Check if any filters are active
    const anyFilterActive = filters.csc || filters.tsc || filters.psc || filters.uwPartner || filters.evt;

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
