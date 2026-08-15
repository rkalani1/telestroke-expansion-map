#!/usr/bin/env python3
"""
Generate data/verification-worklist.csv — the queue of records that could not be
confirmed from offline sources, each with the primary source to check.

Nothing here is a claim that a record is wrong. It is a ranked list of where
verification effort pays off most, so a re-verification pass starts with the
records whose staleness would mislead a clinician, not with alphabetical order.

    python3 scripts/build-worklist.py
"""

import csv
import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'hospitals.json')
CENSUS = os.path.join(ROOT, 'data', 'cms-census-wwami-2023-10.csv')
OUT = os.path.join(ROOT, 'data', 'verification-worklist.csv')

# Items left explicitly open by the 2026-07-18 watch-list re-check
# (METHODOLOGY.md §4). Each still needs a second confirming source.
CARRIED_OPEN_ITEMS = [
    ('500033', 'WA Stroke Level II designation',
     'Registry (WA DOH ECS, May 2026 rev.) shows a designation; press coverage of the new '
     'hospital does not mention one. Retained no-certification.'),
    ('501311', 'ECS list removal / Rural Emergency Hospital conversion',
     'REH conversion confirmed by regional press; absence from the DOH list remains '
     'single-sourced for removal. Retained ASR.'),
    ('130074', 'Idaho TSE Level III -> II upgrade',
     'Registry shows Level II; hospital site still says Level III. Retained Level III.'),
]

FIELDS = ['priority', 'id', 'name', 'state', 'item', 'why_flagged', 'source_to_check']


def main():
    with open(DATA) as f:
        hospitals = json.load(f)['hospitals']
    by_id = {h['id']: h for h in hospitals}
    rows = []

    def add(priority, rid, name, state, item, why, source):
        rows.append(dict(priority=priority, id=rid, name=name, state=state,
                         item=item, why_flagged=why, source_to_check=source))

    # 1. Assessed hospitals carrying no certification. A stale "none" on a large
    #    referral centre is the highest-consequence error in the dataset.
    for h in hospitals:
        if h['recordClass'] != 'stroke-capability' or h['strokeCertificationType']:
            continue
        beds = h.get('beds') or 0
        add('P1' if beds >= 100 else 'P2', h['id'], h['name'], h['state'],
            'Certification status',
            f"No certification on record; {beds or 'unknown'} beds, "
            f"{h.get('hospitalType') or 'type unknown'} — large uncertified referral centres "
            'are the most likely stale records',
            'Joint Commission Quality Check + DNV directory + hospital website')

    # 2. CSC/TSC tiers resting on a state designation alone.
    for h in hospitals:
        if h.get('certificationBasis') == 'state' and h['strokeCertificationType'] in ('CSC', 'TSC'):
            label = h['stateDesignation']['label'] if h.get('stateDesignation') else 'a state designation'
            add('P1', h['id'], h['name'], h['state'], 'State-derived CSC/TSC tier',
                f"Displayed as {h['strokeCertificationType']} on the strength of {label} alone",
                'Joint Commission Quality Check / DNV directory; state registry')

    # 3. EVT flags without CSC/TSC — these drive every nearest-EVT calculation.
    for h in hospitals:
        if (h.get('hasELVO') and h['recordClass'] == 'stroke-capability'
                and h['strokeCertificationType'] not in ('CSC', 'TSC')):
            add('P1', h['id'], h['name'], h['state'], '24/7 EVT capability',
                'Flagged EVT-capable without CSC/TSC certification — drives every nearest-EVT '
                'calculation in the region',
                'Hospital neurointerventional service page; state registry; AHA GWTG '
                'Target: Stroke advanced-therapy list')

    # 4. Items carried forward as open.
    for rid, item, why in CARRIED_OPEN_ITEMS:
        h = by_id.get(rid)
        if h:
            add('P1', rid, h['name'], h['state'], item, why,
                'State registry + hospital site (needs a second confirming source)')

    # 5. Records relocated to a city centroid by the build.
    for h in hospitals:
        g = h.get('geocodeCorrectedFrom')
        if g:
            add('P1', h['id'], h['name'], h['state'], 'Street-level geocode',
                f"Coordinates were {g['milesFromStatedCity']} mi from {h['city']}; now at the "
                'city centroid (approximate)',
                'Geocode the street address (Nominatim, or the US Census geocoder)')

    # 6. Census facilities that could not be plotted at all.
    with open(CENSUS, newline='') as f:
        for r in csv.DictReader(f):
            if not (r['latitude'] and r['longitude']) and r['ccn'] not in by_id:
                add('P2', r['ccn'], r['cms_name'], r['state'],
                    'Missing from map — no coordinates',
                    'CMS census row carries no lat/lon, so the facility could not be plotted',
                    'Geocode the facility address; confirm the facility is still open')

    # 7. Census records whose city could not be inferred.
    for h in hospitals:
        if h.get('cityConfidence') == 'unresolved':
            add('P2', h['id'], h['name'], h['state'], 'City unknown',
                'No town centroid within 12 mi of the CMS coordinates',
                'Confirm city from the hospital website')

    # 8. The census snapshot itself.
    add('P1', '—', 'ALL census records', '—', 'Census vintage',
        'Facility identity comes from an Oct 2023 CMS snapshot: it misses hospitals opened '
        'since, may retain closed ones, and carries superseded names',
        'Refresh from data.cms.gov Hospital General Information (dataset xubh-q36u)')

    order = {'P1': 0, 'P2': 1}
    rows.sort(key=lambda r: (order[r['priority']], r['state'], r['name']))
    with open(OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    print(f'wrote {OUT}')
    print(f'  {len(rows)} items — {dict(Counter(r["priority"] for r in rows))}')
    for item, n in Counter(r['item'] for r in rows).most_common():
        print(f'  {n:3d}  {item}')


if __name__ == '__main__':
    main()
