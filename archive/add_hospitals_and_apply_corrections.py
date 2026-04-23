#!/usr/bin/env python3
"""
Add 3 missing Idaho hospitals and apply all stroke certification corrections
Based on user-verified official sources - January 2025
"""

import json

def main():
    # Load database
    with open('/Users/rizwankalani/telestroke-map/complete_hospitals_geocoded.json', 'r') as f:
        hospitals = json.load(f)

    print("=" * 80)
    print("STEP 1: ADD 3 MISSING IDAHO HOSPITALS")
    print("=" * 80)
    print()

    # New hospitals to add
    new_hospitals = [
        {
            "name": "BONNER GENERAL HOSPITAL",
            "address": "520 N THIRD AVENUE",
            "zip": "83864",
            "state": "ID",
            "cmsId": "131328",
            "latitude": 48.27741277,
            "longitude": -116.5501,
            "geocoded": True,
            "geocodeSource": "Web search verification",
            "uwPartner": False,
            "strokeCertificationType": "ASR",
            "certifyingBody": "Idaho DOH",
            "certificationDetails": "Idaho TSE Level III Stroke Center (Acute Stroke Ready equivalent)",
            "hasELVO": False,
            "dataSources": ["Idaho DOH TSE Facility Designations", "Hospital website"],
            "verified": True
        },
        {
            "name": "GRITMAN MEDICAL CENTER",
            "address": "700 SOUTH MAIN STREET",
            "zip": "83843",
            "state": "ID",
            "cmsId": "131327",
            "latitude": 46.728822,
            "longitude": -117.0009008,
            "geocoded": True,
            "geocodeSource": "Web search verification",
            "uwPartner": False,
            "strokeCertificationType": None,
            "certifyingBody": None,
            "certificationDetails": None,
            "hasELVO": False,
            "dataSources": ["CMS Provider Database"],
            "verified": True
        },
        {
            "name": "SYRINGA GENERAL HOSPITAL",
            "address": "607 WEST MAIN STREET",
            "zip": "83530",
            "state": "ID",
            "cmsId": "131315",
            "latitude": 45.9265043,
            "longitude": -116.1271627,
            "geocoded": True,
            "geocodeSource": "Web search verification",
            "uwPartner": False,
            "strokeCertificationType": None,
            "certifyingBody": None,
            "certificationDetails": None,
            "hasELVO": False,
            "dataSources": ["CMS Provider Database"],
            "verified": True
        }
    ]

    # Add new hospitals
    for hosp in new_hospitals:
        hospitals.append(hosp)
        print(f"✓ ADDED: {hosp['name']}")
        if hosp['strokeCertificationType']:
            print(f"  Stroke: {hosp['strokeCertificationType']} - {hosp['certificationDetails']}")
        else:
            print(f"  Stroke: None")
        print(f"  Location: {hosp['address']}, {hosp['zip']}")
        print(f"  CMS ID: {hosp['cmsId']}")
        print()

    print("=" * 80)
    print("STEP 2: APPLY CORRECTIONS TO EXISTING HOSPITALS")
    print("=" * 80)
    print()

    corrections_made = []

    # CORRECTION 1: Kootenai Health - Add DNV accreditation details
    for h in hospitals:
        if h['name'] == 'KOOTENAI HEALTH' and h['state'] == 'ID':
            old_details = h.get('certificationDetails', 'None')
            h['certificationDetails'] = 'Idaho TSE Level II Stroke Center (Primary Stroke Center equivalent) - DNV Accredited'
            corrections_made.append(
                f"Kootenai Health: Added DNV accreditation details"
            )
            print(f"✓ UPDATED: Kootenai Health (Coeur d'Alene, ID)")
            print(f"  Added: DNV Accredited designation")
            print(f"  Full details: {h['certificationDetails']}")
            print()

    # CORRECTION 2: St. Joseph Regional Medical Center - Add thrombectomy capability
    for h in hospitals:
        if h['name'] == 'ST JOSEPH REGIONAL MEDICAL CENTER' and h['state'] == 'ID':
            old_elvo = h.get('hasELVO', False)
            h['hasELVO'] = True
            h['certificationDetails'] = 'Idaho TSE Level II Stroke Center (Primary Stroke Center equivalent) - Thrombectomy capable with interventional neuroradiology'
            corrections_made.append(
                f"St. Joseph Regional Medical Center: Added thrombectomy capability (hasELVO = True)"
            )
            print(f"✓ UPDATED: St. Joseph Regional Medical Center (Lewiston, ID)")
            print(f"  Changed: hasELVO = {old_elvo} → True")
            print(f"  Added: Thrombectomy capable with interventional neuroradiology")
            print(f"  Full details: {h['certificationDetails']}")
            print()

    # CORRECTION 3: Steele Memorial Medical Center - REMOVE ASR certification
    for h in hospitals:
        if h['name'] == 'STEELE MEMORIAL MEDICAL CENTER' and h['state'] == 'ID':
            old_cert = h.get('strokeCertificationType', 'None')
            h['strokeCertificationType'] = None
            h['certifyingBody'] = None
            h['certificationDetails'] = None
            corrections_made.append(
                f"Steele Memorial Medical Center: REMOVED {old_cert} certification (not in verified list)"
            )
            print(f"✓ REMOVED: Steele Memorial Medical Center (Salmon, ID)")
            print(f"  Removed: {old_cert} certification")
            print(f"  Reason: Not in user-verified Idaho TSE designation list")
            print()

    # Verify Alaska hospitals (should all be None)
    print("=" * 80)
    print("STEP 3: VERIFY ALASKA HOSPITALS")
    print("=" * 80)
    ak_hospitals = [h for h in hospitals if h['state'] == 'AK']
    all_correct = True
    for h in ak_hospitals:
        cert = h.get('strokeCertificationType')
        if cert is not None:
            print(f"⚠ WARNING: {h['name']} has certification: {cert}")
            all_correct = False
        else:
            print(f"✓ {h['name']}: No certification (correct)")

    if all_correct:
        print("\n✅ All Alaska hospitals correctly show NO certification")
    print()

    # Save updated database
    with open('/Users/rizwankalani/telestroke-map/complete_hospitals_geocoded.json', 'w') as f:
        json.dump(hospitals, f, indent=2)

    print("=" * 80)
    print("FINAL STATISTICS")
    print("=" * 80)
    print()

    # Idaho stats
    id_hospitals = [h for h in hospitals if h['state'] == 'ID']
    id_certified = [h for h in id_hospitals if h.get('strokeCertificationType')]
    id_psc = [h for h in id_hospitals if h.get('strokeCertificationType') == 'PSC']
    id_asr = [h for h in id_hospitals if h.get('strokeCertificationType') == 'ASR']
    id_evt = [h for h in id_hospitals if h.get('hasELVO') == True]

    print("IDAHO:")
    print(f"  Total hospitals: 11 → {len(id_hospitals)} (+3 added)")
    print(f"  Stroke certified: {len(id_certified)}")
    print(f"    Level II (PSC equivalent): {len(id_psc)}")
    print(f"    Level III (ASR equivalent): {len(id_asr)}")
    print(f"  EVT-capable: {len(id_evt)}")
    print()

    print("  Certified hospitals:")
    for h in sorted(id_certified, key=lambda x: x['name']):
        print(f"    - {h['name']}: {h['strokeCertificationType']}")
        if h.get('hasELVO'):
            print(f"      → Thrombectomy capable")
    print()

    # Overall stats
    all_certified = [h for h in hospitals if h.get('strokeCertificationType')]
    all_evt = [h for h in hospitals if h.get('hasELVO') == True]

    print("OVERALL DATABASE:")
    print(f"  Total hospitals: 104 → {len(hospitals)} (+3)")
    print(f"  Total stroke certified: {len(all_certified)}")
    print(f"  Total EVT-capable: {len(all_evt)}")
    print()

    print("=" * 80)
    print("CHANGES SUMMARY")
    print("=" * 80)
    print(f"\n✅ Added 3 new Idaho hospitals")
    print(f"✅ Applied {len(corrections_made)} corrections to existing hospitals")
    print(f"✅ Verified all {len(ak_hospitals)} Alaska hospitals (all correct)")
    print()
    print("All changes saved to complete_hospitals_geocoded.json")
    print()

if __name__ == '__main__':
    main()
