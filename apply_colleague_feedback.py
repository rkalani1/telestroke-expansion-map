"""
Apply colleague feedback updates to telestroke map database
- Adds new hospitals from WA, MT, WY, ID, AK
- Updates existing certifications
- Adds new UW Telestroke Partners
"""

import json
import requests
from time import sleep

def geocode_address(address):
    """
    Geocode an address using Nominatim (OpenStreetMap)
    """
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            'q': address,
            'format': 'json',
            'limit': 1
        }
        headers = {
            'User-Agent': 'TelestrokeMap/1.0'
        }
        response = requests.get(url, params=params, headers=headers)
        sleep(1)  # Rate limiting

        if response.status_code == 200:
            data = response.json()
            if data:
                return float(data[0]['lat']), float(data[0]['lon'])
    except Exception as e:
        print(f"Geocoding error for {address}: {e}")

    return None, None

# Load current database
with open('/Users/rizwankalani/telestroke-map/complete_hospitals_geocoded.json', 'r') as f:
    hospitals = json.load(f)

print(f"Starting with {len(hospitals)} hospitals")

# NEW HOSPITALS TO ADD
new_hospitals = [
    # CSC - Providence Alaska Medical Center
    {
        "name": "PROVIDENCE ALASKA MEDICAL CENTER",
        "address": "3200 PROVIDENCE DRIVE ANCHORAGE AK 99508",
        "city": "Anchorage",
        "state": "AK",
        "zip": "99508",
        "cmsId": "020001",
        "strokeCertificationType": "CSC",
        "certifyingBody": "DNV",
        "hasELVO": True,
        "uwPartner": False
    },
    # CSC - Billings Clinic
    {
        "name": "BILLINGS CLINIC",
        "address": "2800 10TH AVENUE N BILLINGS MT 59101",
        "city": "Billings",
        "state": "MT",
        "zip": "59101",
        "cmsId": "270004",
        "strokeCertificationType": "CSC",
        "certifyingBody": "DNV",
        "hasELVO": True,
        "uwPartner": False
    },
    # CSC - St. Joseph Medical Center Tacoma (need to verify)
    {
        "name": "ST JOSEPH MEDICAL CENTER",
        "address": "1717 SOUTH J STREET TACOMA WA 98405",
        "city": "Tacoma",
        "state": "WA",
        "zip": "98405",
        "cmsId": "500012",
        "strokeCertificationType": "CSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": True,
        "uwPartner": False,
        "notes": "Need to verify this is Tacoma location, not Bellingham"
    },
    # TSC - Providence Everett Medical Center
    {
        "name": "PROVIDENCE REGIONAL MEDICAL CENTER EVERETT",
        "address": "1321 COLBY AVENUE EVERETT WA 98201",
        "city": "Everett",
        "state": "WA",
        "zip": "98201",
        "cmsId": "500051",
        "strokeCertificationType": "TSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": True,
        "uwPartner": False
    },
    # TSC - Intermountain Health St. Vincent
    {
        "name": "INTERMOUNTAIN HEALTH ST VINCENT HEALTHCARE",
        "address": "1233 N 30TH STREET BILLINGS MT 59101",
        "city": "Billings",
        "state": "MT",
        "zip": "59101",
        "cmsId": "270017",
        "strokeCertificationType": "TSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": True,
        "uwPartner": False
    },
    # PSC - Swedish First Hill
    {
        "name": "SWEDISH MEDICAL CENTER - FIRST HILL",
        "address": "747 BROADWAY SEATTLE WA 98122",
        "city": "Seattle",
        "state": "WA",
        "zip": "98122",
        "cmsId": "500005",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - St. Anne Hospital Burien
    {
        "name": "FRANCISCAN HEALTH - ST ANNE HOSPITAL",
        "address": "14656 15TH AVENUE SW BURIEN WA 98166",
        "city": "Burien",
        "state": "WA",
        "zip": "98166",
        "cmsId": "500169",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - Mat-Su Regional
    {
        "name": "MAT-SU REGIONAL MEDICAL CENTER",
        "address": "2500 S WOODWORTH LOOP PALMER AK 99645",
        "city": "Palmer",
        "state": "AK",
        "zip": "99645",
        "cmsId": "020006",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - Logan Health Kalispell
    {
        "name": "LOGAN HEALTH MEDICAL CENTER",
        "address": "310 SUNNYVIEW LANE KALISPELL MT 59901",
        "city": "Kalispell",
        "state": "MT",
        "zip": "59901",
        "cmsId": "270024",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - Eastern Idaho Regional
    {
        "name": "EASTERN IDAHO REGIONAL MEDICAL CENTER",
        "address": "3100 CHANNING WAY IDAHO FALLS ID 83404",
        "city": "Idaho Falls",
        "state": "ID",
        "zip": "83404",
        "cmsId": "130004",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - Cheyenne Regional
    {
        "name": "CHEYENNE REGIONAL MEDICAL CENTER",
        "address": "214 E 23RD STREET CHEYENNE WY 82001",
        "city": "Cheyenne",
        "state": "WY",
        "zip": "82001",
        "cmsId": "530001",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - St. Luke's Boise
    {
        "name": "ST LUKE'S HEALTH SYSTEM - BOISE MEDICAL CENTER",
        "address": "190 E BANNOCK STREET BOISE ID 83712",
        "city": "Boise",
        "state": "ID",
        "zip": "83712",
        "cmsId": "130001",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - St. Luke's Twin Falls
    {
        "name": "ST LUKE'S MAGIC VALLEY MEDICAL CENTER",
        "address": "801 POLE LINE ROAD W TWIN FALLS ID 83301",
        "city": "Twin Falls",
        "state": "ID",
        "zip": "83301",
        "cmsId": "131312",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - Wyoming Medical Center
    {
        "name": "WYOMING MEDICAL CENTER",
        "address": "1233 E 2ND STREET CASPER WY 82601",
        "city": "Casper",
        "state": "WY",
        "zip": "82601",
        "cmsId": "530012",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # PSC - Bozeman Health Deaconess
    {
        "name": "BOZEMAN HEALTH DEACONESS HOSPITAL",
        "address": "915 HIGHLAND BOULEVARD BOZEMAN MT 59715",
        "city": "Bozeman",
        "state": "MT",
        "zip": "59715",
        "cmsId": "270014",
        "strokeCertificationType": "PSC",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    },
    # ASRH - UW Medical Center Montlake
    {
        "name": "UNIVERSITY OF WASHINGTON MEDICAL CENTER - MONTLAKE",
        "address": "1959 NE PACIFIC STREET SEATTLE WA 98195",
        "city": "Seattle",
        "state": "WA",
        "zip": "98195",
        "cmsId": "500008",
        "strokeCertificationType": "ASR",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": True
    },
    # ASRH - Intermountain St. James Butte
    {
        "name": "INTERMOUNTAIN HEALTH ST JAMES HEALTHCARE",
        "address": "400 S CLARK STREET BUTTE MT 59701",
        "city": "Butte",
        "state": "MT",
        "zip": "59701",
        "cmsId": "270002",
        "strokeCertificationType": "ASR",
        "certifyingBody": "Joint Commission",
        "hasELVO": False,
        "uwPartner": False
    }
]

# Geocode new hospitals
print("\nGeocoding new hospitals...")
for hospital in new_hospitals:
    full_address = hospital["address"]
    lat, lon = geocode_address(full_address)
    if lat and lon:
        hospital["latitude"] = lat
        hospital["longitude"] = lon
        print(f"✓ {hospital['name']}: ({lat:.4f}, {lon:.4f})")
    else:
        print(f"✗ {hospital['name']}: GEOCODING FAILED")
        hospital["latitude"] = None
        hospital["longitude"] = None

# Add new hospitals to database
hospitals.extend(new_hospitals)
print(f"\nAdded {len(new_hospitals)} new hospitals")

# UPDATES TO EXISTING HOSPITALS

# 1. Upgrade EvergreenHealth Medical Center from TSC to CSC
for h in hospitals:
    if h.get('name') == 'EVERGREENHEALTH MEDICAL CENTER':
        h['strokeCertificationType'] = 'CSC'
        h['certifyingBody'] = 'DNV'
        h['hasELVO'] = True
        print(f"✓ Updated {h['name']}: TSC → CSC")

# 2. Upgrade Madigan AMC to TSC
for h in hospitals:
    if 'MADIGAN' in h.get('name', '').upper():
        h['strokeCertificationType'] = 'TSC'
        h['certifyingBody'] = 'Joint Commission'
        h['hasELVO'] = True
        print(f"✓ Updated {h['name']}: None → TSC")

# 3. Upgrade Swedish Edmonds to PSC
for h in hospitals:
    if h.get('name') == 'SWEDISH EDMONDS HOSPITAL':
        h['strokeCertificationType'] = 'PSC'
        h['certifyingBody'] = 'Joint Commission'
        print(f"✓ Updated {h['name']}: None → PSC")

# 4. Upgrade Swedish Issaquah to ASRH
for h in hospitals:
    if 'SWEDISH ISSAQUAH' in h.get('name', '').upper():
        h['strokeCertificationType'] = 'ASR'
        h['certifyingBody'] = 'Washington State DOH'
        h['strokeCertificationDetails'] = 'Level 2'
        print(f"✓ Updated {h['name']}: None → ASR (Level 2)")

# 5. Add UW Telestroke Partner flags
for h in hospitals:
    if h.get('name') in ['SKAGIT VALLEY HOSPITAL', 'CASCADE VALLEY HOSPITAL']:
        h['uwPartner'] = True
        print(f"✓ Updated {h['name']}: Added UW Telestroke Partner")

# Save updated database
print(f"\nFinal hospital count: {len(hospitals)}")

with open('/Users/rizwankalani/telestroke-map/complete_hospitals_geocoded.json', 'w') as f:
    json.dump(hospitals, f, indent=2)

print("\n✅ Database updated successfully!")

# Summary
csc_count = len([h for h in hospitals if h.get('strokeCertificationType') == 'CSC'])
tsc_count = len([h for h in hospitals if h.get('strokeCertificationType') == 'TSC'])
psc_count = len([h for h in hospitals if h.get('strokeCertificationType') == 'PSC'])
asr_count = len([h for h in hospitals if h.get('strokeCertificationType') == 'ASR'])
uw_partner_count = len([h for h in hospitals if h.get('uwPartner')])

print(f"\nCertification counts:")
print(f"  CSC: {csc_count}")
print(f"  TSC: {tsc_count}")
print(f"  PSC: {psc_count}")
print(f"  ASR: {asr_count}")
print(f"  UW Partners: {uw_partner_count}")

# New states
states = set(h.get('state') for h in hospitals)
print(f"\nStates: {sorted(states)}")
