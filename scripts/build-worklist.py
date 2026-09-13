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

# Items left explicitly open by the targeted re-checks of 2026-07-18, 2026-08-15,
# 2026-09-12 and 2026-09-13 (METHODOLOGY.md §4). Each names the source that can
# actually settle it: a national certification is confirmed in a certifier
# directory, a state level on the state registry — naming the wrong one sends the
# next pass somewhere that cannot answer the question.
CARRIED_OPEN_ITEMS = [
    ('500033', 'WA Stroke Level II designation',
     'Registry (WA DOH ECS, May 2026 rev.) shows a designation; the 2026-08-15 and 2026-09-12 '
     'search passes found no second, non-DOH source (hospital site silent). Retained '
     'no-certification.',
     'WA DOH ECS list (DOH 345-299) + hospital site or regional press'),
    ('501311', 'ECS list removal / Rural Emergency Hospital conversion',
     'REH conversion confirmed by regional press (approval expected summer 2026); hospital site '
     'still claims WA Level III Stroke as of 2026-09-12. Absence from the DOH list remains '
     'single-sourced for removal. Retained ASR.',
     'WA DOH ECS list (DOH 345-299) + CMS provider enrollment (REH conversion)'),
    ('130074', 'Idaho TSE Level III -> II upgrade',
     'Registry shows Level II; hospital site (May 2021 announcement, still live 2026-09-12) says '
     'Level III; no independent 2024-2026 source found. Retained Level III.',
     'Idaho TSE Facility Designations registry + hospital site'),
    ('WA-MADIGAN-AMC', 'WA ECS stroke level confirmation',
     'Tier corrected TSC->PSC and hasELVO withdrawn 2026-08-15 on internal evidence; the ECS '
     'Level II designation itself still needs confirmation against the current DOH list '
     '(2026-09-12 search found only a 2023 third-party "no JC stroke certification" listing).',
     'WA DOH ECS list (DOH 345-299)'),
    ('130013', '24/7 EVT capability re-check (Nampa)',
     'hasELVO withdrawn 2026-08-15: designation is plain TSE Level II (two-source, Apr 2023). The '
     'hospital site still lists thrombectomy (2026-09-12) but no independent source does. '
     'Redesignation due ~2026.',
     'Idaho TSE Facility Designations registry + hospital neurointerventional service page'),
    ('530012', 'JC certification recertification check (Banner Wyoming)',
     'EVT independently confirmed (2024 press); JC Advanced PSC last publicly confirmed March '
     '2022, described as retained in July 2025 coverage — a formal recertification date is still '
     'unconfirmed.',
     'Joint Commission Quality Check (qualitycheck.org)'),
    ('130018', 'Idaho TSE "Level II+" label check (EIRMC)',
     'Own site claims II+ with active 2025 EVT metrics (still live 2026-09-12); Wikipedia shows '
     'plain Level II. Confirm the II+ tier against the registry.',
     'Idaho TSE Facility Designations registry'),
    ('270023', 'Joint Commission directory check (Community Medical Center Missoula)',
     'Promoted from census to assessed 2026-09-12 on NBC Montana coverage + hospital news release '
     '(June 2026, JC Advanced Primary Stroke Center). Confirm the listing.',
     'Joint Commission Quality Check (qualitycheck.org) + one independent source'),
    ('500108', 'CSC certifying body and WA ECS level (St. Joseph Tacoma)',
     "Tier CSC with 24/7 EVT is corroborated by VMFH's stroke-center page, which names no "
     'accreditor; the Joint Commission attribution is carried forward from prior editions. '
     'Confirm the certifying body and the current ECS level.',
     'Joint Commission Quality Check + DNV directory; WA DOH ECS list (DOH 345-299)'),
    ('020008', 'Joint Commission stroke certification check (Bartlett Regional)',
     'Wikipedia states the hospital is Joint Commission-accredited "for ... acute stroke care"; no '
     'hospital or certifier source found in the 2026-09-12 search pass. Single source — check for '
     'an ASRH/PSC certification. Retained none-on-record.',
     'Joint Commission Quality Check (qualitycheck.org) + hospital website'),
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
    carried_ids = {rid for rid, *_ in CARRIED_OPEN_ITEMS}
    for h in hospitals:
        if h['recordClass'] != 'stroke-capability' or h['strokeCertificationType']:
            continue
        if h['id'] in carried_ids:
            continue  # a specific carried item already covers this record
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
    for rid, item, why, source in CARRIED_OPEN_ITEMS:
        h = by_id.get(rid)
        if h:
            add('P1', rid, h['name'], h['state'], item, why, source)

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
