"""
Script to update telestroke map based on colleague feedback
Adds new hospitals and updates existing certifications
"""

import json

# Define all updates based on colleague feedback

UPDATES = {
    "uw_partners_to_add": [
        "Skagit Valley Hospital",  # Already exists, just add UW partner flag
        "Cascade Valley Hospital"  # Already exists, just add UW partner flag
    ],

    "csc_additions": [
        {
            "name": "ST JOSEPH MEDICAL CENTER",
            "city": "Tacoma",
            "state": "WA",
            "action": "upgrade_or_add",  # Need to verify which St Joseph this is
            "certifyingBody": "Joint Commission",
            "notes": "Tacoma location - need to verify CMS ID"
        },
        {
            "name": "EVERGREENHEALTH MEDICAL CENTER",
            "action": "upgrade",  # Currently TSC, upgrade to CSC
            "certifyingBody": "DNV"
        },
        {
            "name": "BILLINGS CLINIC",
            "city": "Billings",
            "state": "MT",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "PROVIDENCE ALASKA MEDICAL CENTER",
            "city": "Anchorage",
            "state": "AK",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        }
    ],

    "tsc_additions": [
        {
            "name": "MADIGAN ARMY MEDICAL CENTER",
            "city": "Joint Base Lewis-McChord",
            "state": "WA",
            "action": "upgrade",  # Currently exists with no cert
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "PROVIDENCE EVERETT MEDICAL CENTER",
            "city": "Everett",
            "state": "WA",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "INTERMOUNTAIN HEALTH ST VINCENT REGIONAL HOSPITAL",
            "city": "Billings",
            "state": "MT",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        }
    ],

    "psc_additions": [
        {
            "name": "SWEDISH FIRST HILL",
            "city": "Seattle",
            "state": "WA",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "SWEDISH EDMONDS HOSPITAL",
            "city": "Edmonds",
            "state": "WA",
            "action": "upgrade",  # Currently exists with no cert
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "ST ANNE HOSPITAL",
            "city": "Burien",
            "state": "WA",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "MAT-SU REGIONAL MEDICAL CENTER",
            "city": "Palmer",
            "state": "AK",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "LOGAN HEALTH MEDICAL CENTER",
            "city": "Kalispell",
            "state": "MT",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "EASTERN IDAHO REGIONAL MEDICAL CENTER",
            "city": "Idaho Falls",
            "state": "ID",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "CHEYENNE REGIONAL MEDICAL CENTER",
            "city": "Cheyenne",
            "state": "WY",
            "action": "add_new",
            "certifyingBody": "Joint Commission",
            "notes": "Also known as Memorial Hospital of Laramie"
        },
        {
            "name": "ST LUKE'S HEALTH SYSTEM - BOISE",
            "city": "Boise",
            "state": "ID",
            "action": "add_new",
            "certifyingBody": "Joint Commission",
            "notes": "Treasure Valley location"
        },
        {
            "name": "ST LUKE'S MAGIC VALLEY MEDICAL CENTER",
            "city": "Twin Falls",
            "state": "ID",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "WYOMING MEDICAL CENTER",
            "city": "Casper",
            "state": "WY",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "BOZEMAN HEALTH DEACONESS HOSPITAL",
            "city": "Bozeman",
            "state": "MT",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        }
    ],

    "asrh_additions": [
        {
            "name": "SWEDISH ISSAQUAH CAMPUS",
            "city": "Issaquah",
            "state": "WA",
            "action": "upgrade",  # Currently exists with no cert
            "certifyingBody": "Washington State DOH",
            "level": "Level 2"
        },
        {
            "name": "UW MEDICAL CENTER - MONTLAKE",
            "city": "Seattle",
            "state": "WA",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        },
        {
            "name": "INTERMOUNTAIN HEALTH ST JAMES HEALTHCARE",
            "city": "Butte",
            "state": "MT",
            "action": "add_new",
            "certifyingBody": "Joint Commission"
        }
    ]
}

print("Total updates needed:")
print(f"  UW Partners: {len(UPDATES['uw_partners_to_add'])}")
print(f"  CSC additions/upgrades: {len(UPDATES['csc_additions'])}")
print(f"  TSC additions/upgrades: {len(UPDATES['tsc_additions'])}")
print(f"  PSC additions/upgrades: {len(UPDATES['psc_additions'])}")
print(f"  ASRH additions/upgrades: {len(UPDATES['asrh_additions'])}")
print(f"\nNew states: MT, WY")
print(f"Total hospitals to add/update: {2 + 4 + 3 + 11 + 3} = 23")
