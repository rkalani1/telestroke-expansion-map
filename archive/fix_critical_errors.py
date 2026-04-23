#!/usr/bin/env python3
"""
Fix critical database errors discovered during 100% accuracy verification
January 2025
"""

import json

def main():
    # Load database
    with open('complete_hospitals_geocoded.json', 'r') as f:
        hospitals = json.load(f)

    corrections_made = []

    # Fix 1: MultiCare Allenmore Hospital - Wrong CMS ID
    for h in hospitals:
        if h['name'] == 'MULTICARE ALLENMORE HOSPITAL' and h.get('cmsId') == '500007':
            h['cmsId'] = '500129'
            corrections_made.append(
                f"FIXED: MultiCare Allenmore Hospital CMS ID: 500007 → 500129 (was duplicate with Island Hospital)"
            )
            print(f"✓ Fixed MultiCare Allenmore Hospital CMS ID: 500007 → 500129")

    # Fix 2: St. Joseph Hospital (Bellingham) - Add PeaceHealth prefix for consistency
    for h in hospitals:
        if h.get('cmsId') == '500030' and h['name'] == 'ST JOSEPH HOSPITAL':
            h['name'] = 'PEACEHEALTH ST JOSEPH MEDICAL CENTER'
            corrections_made.append(
                f"FIXED: Renamed 'ST JOSEPH HOSPITAL' → 'PEACEHEALTH ST JOSEPH MEDICAL CENTER' (Bellingham)"
            )
            print(f"✓ Fixed hospital name: ST JOSEPH HOSPITAL → PEACEHEALTH ST JOSEPH MEDICAL CENTER")

    # Verify no duplicate CMS IDs remain
    cms_ids = {}
    for h in hospitals:
        cms_id = h.get('cmsId')
        if cms_id and cms_id != 'None':
            if cms_id in cms_ids:
                cms_ids[cms_id].append(h['name'])
            else:
                cms_ids[cms_id] = [h['name']]

    duplicates = {k: v for k, v in cms_ids.items() if len(v) > 1}
    if duplicates:
        print("\n⚠ WARNING: Duplicate CMS IDs still exist:")
        for cms_id, names in duplicates.items():
            print(f"  {cms_id}: {names}")
    else:
        print("\n✓ No duplicate CMS IDs found")

    # Save corrected database
    with open('complete_hospitals_geocoded.json', 'w') as f:
        json.dump(hospitals, f, indent=2)

    print(f"\n✓ Saved corrected database")
    print(f"\nTotal corrections made: {len(corrections_made)}")
    for correction in corrections_made:
        print(f"  - {correction}")

    # Final stats
    wa_hospitals = [h for h in hospitals if h['state'] == 'WA']
    print(f"\nFinal stats:")
    print(f"  Total hospitals: {len(hospitals)}")
    print(f"  Washington: {len(wa_hospitals)}")
    print(f"  Idaho: {len([h for h in hospitals if h['state'] == 'ID'])}")
    print(f"  Alaska: {len([h for h in hospitals if h['state'] == 'AK'])}")

if __name__ == '__main__':
    main()
