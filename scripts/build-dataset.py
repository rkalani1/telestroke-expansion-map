#!/usr/bin/env python3
"""
Build hospitals.json from the curated stroke-capability records plus the vendored
CMS acute-care census.

Idempotent: running it twice produces the same output. It reads hospitals.json,
normalises and enriches every curated record, merges in census-only facilities as
clearly-labelled `acute-care-census` records, and writes hospitals.json back.

    python3 scripts/build-dataset.py            # rebuild in place
    python3 scripts/build-dataset.py --dry-run  # report what would change

Inputs
  hospitals.json                            curated stroke-capability records
  data/cms-census-wwami-2023-10.csv         CMS Hospital General Information subset

Dependency: `zipcodes` (offline US ZIP/city/county database) — only needed to
derive city and county for census records. Install with `pip install zipcodes`.
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from math import radians, sin, cos, asin, sqrt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'hospitals.json')
CENSUS = os.path.join(ROOT, 'data', 'cms-census-wwami-2023-10.csv')

SCHEMA_VERSION = '3.0.0'
CENSUS_AS_OF = '2023-10'
CENSUS_SOURCE = ('CMS Hospital General Information (Oct 2023 snapshot, via '
                 'klocey/hospitals-data-archive)')

# A curated record whose coordinates sit further than this from the city it
# names is treated as a geocoding error rather than a hospital on the edge of
# town. Real western-US hospitals sit up to ~12 mi from their mailing city's
# centroid (Madigan AMC is on Joint Base Lewis-McChord but posts a Tacoma
# address); every genuine error found so far was off by 23 mi or more.
GEOCODE_TOLERANCE_MI = 18

# Ceiling for asserting an inferred city on a census record from its CMS
# coordinates. Tighter than the above: a wrong town name is worse than none.
CENSUS_CITY_MAX_MI = 12

# ---------------------------------------------------------------------------
# 1. CMS Certification Number corrections
#
# Each of these CCNs is absent from every CMS Hospital General Information
# snapshot 2013-2023, while a facility with a matching name sits at the same
# coordinates under a different CCN. Distances below are between our recorded
# coordinates and the CMS coordinates for the replacement CCN.
# ---------------------------------------------------------------------------
CCN_CORRECTIONS = {
    # was -> (now, evidence)
    '270002': ('270017', 'CMS lists ST JAMES HEALTHCARE (Butte MT) under 270017, 0.07 mi from '
                         'our coordinates; 270002 absent from all CMS snapshots 2013-2023'),
    '270017': ('270049', 'CMS lists ST VINCENT HEALTHCARE (Billings MT) under 270049, 0.17 mi '
                         'from our coordinates; 270017 belongs to St James Healthcare in Butte'),
    '270024': ('270051', 'CMS lists LOGAN HEALTH MEDICAL CENTER (Kalispell MT) under 270051 as of '
                         'the 2023-10 snapshot, 0.10 mi from our coordinates; 270024 absent from '
                         'all CMS snapshots 2013-2023'),
    '500010': ('500108', 'CMS lists ST JOSEPH MEDICAL CENTER (Tacoma WA) under 500108, 0.03 mi '
                         'from our coordinates; 500010 absent from all CMS snapshots 2013-2023'),
    '500115': ('500039', 'CMS lists HARRISON MEDICAL CENTER under 500039 — renamed St Michael '
                         'Medical Center and relocated Bremerton -> Silverdale in 2020, which is '
                         'why the 2023 CMS coordinates still show the old campus 7.0 mi away; '
                         '500115 absent from all CMS snapshots 2013-2023'),
}

# Facilities with no CMS CCN of their own.
IDENTITY_OVERRIDES = {
    '50005F': {
        'id': 'WA-MADIGAN-AMC',
        'cmsId': None,
        'facilityIdType': 'military',
        'cmsIdNote': 'US Army medical center — not a Medicare-certified provider, so it has no '
                     'CMS Certification Number. Previous editions carried a synthetic id "50005F".',
    },
    '130006-M': {
        'id': '130006-MERIDIAN',
        'cmsId': '130006',
        'facilityIdType': 'shared-ccn',
        'cmsIdNote': "Provider-based campus operating under St Luke's Boise Medical Center's CCN "
                     '130006. Previous editions carried a synthetic id "130006-M".',
    },
}

# ---------------------------------------------------------------------------
# 2. Controlled vocabularies
# ---------------------------------------------------------------------------
CERT_BODY_CANON = {
    'None': None,
    'Washington State DOH': 'WA DOH',
    'WA DOH': 'WA DOH',
    'Idaho DOH': 'Idaho TSE',
    'Idaho TSE': 'Idaho TSE',
    'Joint Commission': 'Joint Commission',
    'Joint Commission / Idaho TSE': 'Joint Commission / Idaho TSE',
    'DNV': 'DNV',
    'DNV (Primary Plus / PSC+)': 'DNV',
}

GEOCODE_SOURCE_CANON = {
    'Nominatim/OpenStreetMap': 'Nominatim/OpenStreetMap',
    'OSM/Nominatim (2026-07-03)': 'Nominatim/OpenStreetMap',
    'Nominatim/OpenStreetMap (corrected CMS ID 2026)': 'Nominatim/OpenStreetMap',
    'Manual/Web-verified': 'Manual (web-verified)',
    'Manual (web-verified)': 'Manual (web-verified)',
    'Manual (verified location)': 'Manual (web-verified)',
    'Manual (Lewiston, ID verified)': 'Manual (web-verified)',
    'Web search verification': 'Manual (web-verified)',
    'Verified coordinates': 'Manual (web-verified)',
    'Hospital website (corrected CMS ID 2026)': 'Hospital website',
    'Bozeman Health website (corrected CMS ID 2026)': 'Hospital website',
}

STATE_SYSTEM = {'WA DOH': 'WA ECS', 'Idaho TSE': 'Idaho TSE',
                'Joint Commission / Idaho TSE': 'Idaho TSE'}
NATIONAL_BODIES = {'Joint Commission', 'DNV', 'ACHC', 'CIHQ'}

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, '1': 1, '2': 2, '3': 3, '4': 4}

# Health systems, matched against the uppercased facility name. Longest match wins.
HEALTH_SYSTEMS = [
    ('PROVIDENCE', 'Providence'), ('PEACEHEALTH', 'PeaceHealth'), ('MULTICARE', 'MultiCare'),
    ('SWEDISH', 'Swedish (Providence)'), ('VIRGINIA MASON', 'Virginia Mason Franciscan Health'),
    ('KAISER PERMANENTE', 'Kaiser Permanente'), ('EVERGREENHEALTH', 'EvergreenHealth'),
    ('CONFLUENCE HEALTH', 'Confluence Health'), ('ASTRIA', 'Astria Health'),
    ('UW MEDIC', 'UW Medicine'), ('HARBORVIEW', 'UW Medicine'),
    ("ST LUKE'S", "St Luke's Health System"), ('ST LUKES', "St Luke's Health System"),
    ('SAINT ALPHONSUS', 'Saint Alphonsus (Trinity Health)'),
    ('ST ALPHONSUS', 'Saint Alphonsus (Trinity Health)'),
    ('KOOTENAI', 'Kootenai Health'), ('BILLINGS CLINIC', 'Billings Clinic'),
    ('INTERMOUNTAIN', 'Intermountain Health'), ('LOGAN HEALTH', 'Logan Health'),
    ('BOZEMAN HEALTH', 'Bozeman Health'), ('BENEFIS', 'Benefis Health System'),
    ('SEARHC', 'SEARHC'), ('BANNER', 'Banner Health'), ('LEGACY', 'Legacy Health'),
    ('ARBOR HEALTH', 'Arbor Health'), ('JEFFERSON HEALTHCARE', 'Jefferson Healthcare'),
    ('WHIDBEYHEALTH', 'WhidbeyHealth'), ('OVERLAKE', 'Overlake Medical Center'),
    ('TRIOS', 'Trios Health'), ('SUMMIT PACIFIC', 'Summit Pacific Medical Center'),
    ('SAMARITAN', 'Samaritan Healthcare'), ('PORTNEUF', 'Portneuf Medical Center'),
    ('GRITMAN', 'Gritman Medical Center'), ('PULLMAN REGIONAL', 'Pullman Regional Hospital'),
    ('SKAGIT', 'Skagit Regional Health'), ('CASCADE VALLEY', 'Skagit Regional Health'),
    ('OLYMPIC MEDICAL', 'Olympic Medical Center'), ('VALLEY MEDICAL CENTER', 'UW Medicine'),
    ('ALASKA NATIVE', 'Alaska Native Tribal Health Consortium'),
    ('ALASKA REGIONAL', 'HCA Healthcare'), ('EASTERN IDAHO REGIONAL', 'HCA Healthcare'),
    ('WEST VALLEY MEDICAL', 'HCA Healthcare'), ('MAT-SU REGIONAL', 'Community Health Systems'),
    ('CHEYENNE REGIONAL', 'Cheyenne Regional Medical Center'),
    ('BARTLETT REGIONAL', 'City and Borough of Juneau'),
]

# Spoken names a clinician is likely to type. Only well-established shorthand.
CURATED_ALIASES = {
    '500064': ['Harborview', 'HMC', 'HVMC'],
    '500001': ['UWMC Northwest', 'Northwest Hospital', 'UW Northwest'],
    '500054': ['Sacred Heart', 'SHMC', 'PSHMC'],
    '500005': ['VM', 'Virginia Mason', 'VMMC'],
    '500027': ['Swedish First Hill'],
    '500025': ['Swedish Cherry Hill'],
    '500088': ['Valley Medical', 'VMC Renton'],
    '500014': ['Providence Everett', 'PRMCE'],
    '500044': ['Deaconess Spokane'],
    '500024': ["St Pete's", 'St Peter'],
    '500115': ['Harrison Medical Center', 'St Michael Silverdale'],
    '500039': ['Harrison Medical Center', 'St Michael Silverdale'],
    '500108': ['St Joseph Tacoma', 'SJMC'],
    '130006': ["St Luke's Boise", 'SLRMC'],
    '130007': ["St Al's", 'Saint Als', 'SARMC'],
    '020001': ['PAMC', 'Providence Anchorage'],
    '270004': ['Billings Clinic'],
    '270049': ['St V', "St Vincent's Billings"],
    '270051': ['Kalispell Regional', 'KRMC'],
    '530012': ['Wyoming Medical Center', 'WMC Casper'],
    '530014': ['CRMC'],
    'WA-MADIGAN-AMC': ['Madigan', 'MAMC', 'Madigan Army Medical Center'],
    '130006-MERIDIAN': ["St Luke's Meridian"],
}

STOPWORDS = {'OF', 'THE', 'AND', 'AT', 'A', 'INC', 'CAH', 'LLC', 'DBA'}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def haversine_mi(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(radians, (lat1, lon1, lat2, lon2))
    return 3959 * 2 * asin(sqrt(sin((lat2 - lat1) / 2) ** 2
                                + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2))


def norm_place(s):
    return re.sub(r'[^a-z]', '', (s or '').lower())


def strip_locality(address, city, state, zipcode):
    """Reduce 'STREET CITY ST 99999' to 'STREET'. Leaves street-only values alone."""
    if not address:
        return address
    a = address.strip()
    for token in (str(zipcode or ''), state or '', (city or '').upper()):
        if not token:
            continue
        pat = re.compile(r'[\s,]+' + re.escape(token) + r'\s*$', re.IGNORECASE)
        m = pat.search(a)
        if m:
            a = a[:m.start()].rstrip(' ,')
    return re.sub(r'\s{2,}', ' ', a).strip()


def parse_state_designation(body, details):
    """Extract a structured state stroke designation, if the record carries one."""
    system = STATE_SYSTEM.get(body)
    if not system:
        return None
    text = details or ''
    pat = (r'(?:Washington\s+State|WA|Idaho\s+TSE|Idaho|State|state)?\s*'
           r'Level\s+(I{1,3}|IV|[1-4])(\+?)')
    m = re.search(pat, text)
    if not m:
        return None
    level = ROMAN.get(m.group(1).upper())
    if not level:
        return None
    plus = m.group(2) == '+'
    roman = {1: 'I', 2: 'II', 3: 'III', 4: 'IV'}[level]
    return {
        'system': system,
        'level': roman + ('+' if plus else ''),
        'label': f"{system} Level {roman}{'+' if plus else ''}",
    }


def parse_national_certification(body, details, tier):
    """Return the national-accreditor certification, if any."""
    if not body:
        return None
    bodies = [b.strip() for b in body.split('/')]
    nat = [b for b in bodies if b in NATIONAL_BODIES]
    if not nat:
        return None
    return {'body': ' / '.join(nat), 'tier': tier, 'details': details}


def health_system(name):
    up = (name or '').upper()
    best = None
    for needle, label in HEALTH_SYSTEMS:
        if needle in up and (best is None or len(needle) > len(best[0])):
            best = (needle, label)
    return best[1] if best else None


def acronym(name):
    words = [w for w in re.split(r'[^A-Za-z]+', (name or '').upper())
             if w and w not in STOPWORDS]
    if len(words) < 2:
        return None
    letters = ''.join(w[0] for w in words)
    return letters if 2 <= len(letters) <= 6 else None


def build_aliases(rec):
    out = []
    out.extend(CURATED_ALIASES.get(rec['id'], []))
    ac = acronym(rec['name'])
    if ac:
        out.append(ac)
    sysname = rec.get('healthSystem')
    if sysname:
        base = re.sub(r'\s*\(.*\)$', '', sysname).upper()
        short = re.sub(r'^' + re.escape(base) + r'\s+', '', (rec['name'] or '').upper()).title()
        if short and norm_place(short) != norm_place(rec['name']):
            out.append(short)
    seen, uniq = set(), []
    for a in out:
        k = norm_place(a)
        if k and k not in seen and k != norm_place(rec['name']):
            seen.add(k)
            uniq.append(a)
    return uniq


def geocode_precision(lat, lon):
    dp = min(len(str(lat).split('.')[-1]), len(str(lon).split('.')[-1]))
    return 'approximate' if dp <= 4 else 'rooftop'


class PlaceResolver:
    """Nearest-ZIP city/county lookup from an offline database."""

    def __init__(self):
        try:
            import zipcodes
        except ImportError:
            self.by_state = None
            return
        self.by_state = defaultdict(list)
        for z in zipcodes.list_all():
            if z['state'] not in ('WA', 'AK', 'ID', 'MT', 'WY'):
                continue
            if not (z['lat'] and z['long'] and z['active']):
                continue
            z['_la'], z['_lo'] = float(z['lat']), float(z['long'])
            z['_std'] = z['zip_code_type'] == 'STANDARD'
            self.by_state[z['state']].append(z)

    def city_centroid(self, city, state):
        """Centroid of the named city, or None if it is not in the ZIP database."""
        if not self.by_state or not city:
            return None
        target = norm_place(city)
        hits = []
        for z in self.by_state.get(state) or []:
            names = [z['city']] + list(z.get('acceptable_cities') or [])
            if any(norm_place(n) == target for n in names):
                hits.append(z)
        if not hits:
            return None
        std = [z for z in hits if z['_std']]
        return (std or hits)[0]

    def resolve(self, lat, lon, state, name='', prefer_name=True):
        """Best (zip_record, miles). Prefers a town whose name appears in the facility name."""
        if not self.by_state:
            return None, None
        cands = self.by_state.get(state) or []
        n = norm_place(name) if prefer_name else ''
        best = None
        for z in cands:
            d = haversine_mi(lat, lon, z['_la'], z['_lo'])
            if d > 60:
                continue
            score = d
            if not z['_std']:
                score += 6
            names = [z['city']] + list(z.get('acceptable_cities') or [])
            # Only let a name match pull a candidate in from nearby. Without the
            # distance cap "BIG HORN CO MEMORIAL HOSPITAL" (Hardin) is dragged to
            # the hamlet of Bighorn 40 mi away.
            if d < 20 and any(len(norm_place(c)) > 3 and norm_place(c) in n for c in names):
                score -= 25
            if best is None or score < best[0]:
                best = (score, d, z)
        if best is None:
            best = min(((haversine_mi(lat, lon, z['_la'], z['_lo']), 0, z) for z in cands),
                       key=lambda t: t[0], default=(None, None, None))
            if best[2] is None:
                return None, None
            return best[2], best[0]
        return best[2], best[1]


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def load_census():
    if not os.path.exists(CENSUS):
        sys.exit(f'missing census file: {CENSUS}')
    rows = {}
    with open(CENSUS, newline='') as f:
        for r in csv.DictReader(f):
            rows[r['ccn']] = r
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    with open(DATA) as f:
        doc = json.load(f)
    curated = doc['hospitals']
    census = load_census()
    places = PlaceResolver()
    if places.by_state is None:
        print('WARNING: `zipcodes` not installed — city/county derivation skipped', file=sys.stderr)

    changes = Counter()
    out = []

    # --- curated stroke-capability records -------------------------------
    for h in curated:
        rec = dict(h)
        old_id = rec['cmsId']

        # identity
        override = IDENTITY_OVERRIDES.get(old_id)
        if override:
            rec['id'] = override['id']
            rec['cmsId'] = override['cmsId']
            rec['facilityIdType'] = override['facilityIdType']
            rec['cmsIdNote'] = override['cmsIdNote']
            changes['identity_override'] += 1
        else:
            new_ccn, evidence = CCN_CORRECTIONS.get(old_id, (old_id, None))
            if evidence:
                rec['cmsIdCorrectedFrom'] = old_id
                rec['cmsIdNote'] = evidence
                changes['ccn_corrected'] += 1
            rec['cmsId'] = new_ccn
            rec['id'] = new_ccn
            rec['facilityIdType'] = 'ccn'

        rec['recordClass'] = 'stroke-capability'
        rec['strokeDataStatus'] = 'verified'
        rec['lastVerified'] = doc.get('last_verified')

        # address / locality
        stripped = strip_locality(rec.get('address'), rec.get('city'),
                                  rec.get('state'), rec.get('zip'))
        if stripped != rec.get('address'):
            changes['address_stripped'] += 1
        rec['address'] = stripped

        # certification vocabulary
        body = rec.get('certifyingBody')
        canon = CERT_BODY_CANON.get(body, body)
        if canon != body:
            changes['cert_body_normalised'] += 1
        rec['certifyingBody'] = canon

        details = rec.get('certificationDetails')
        rec['stateDesignation'] = parse_state_designation(canon, details)
        rec['nationalCertification'] = parse_national_certification(
            canon, details, rec.get('strokeCertificationType'))
        if rec['nationalCertification'] and rec['stateDesignation']:
            rec['certificationBasis'] = 'both'
        elif rec['nationalCertification']:
            rec['certificationBasis'] = 'national'
        elif rec['stateDesignation']:
            rec['certificationBasis'] = 'state'
        else:
            rec['certificationBasis'] = 'none'

        # geocoding
        gs = rec.get('geocodeSource')
        rec['geocodeSource'] = GEOCODE_SOURCE_CANON.get(gs, gs)
        rec['geocoded'] = True
        rec['geocodePrecision'] = geocode_precision(rec['latitude'], rec['longitude'])

        # Guard against geocodes that landed in the wrong place entirely. Six
        # curated records were plotted tens to hundreds of miles from the city
        # they name — Ocean Beach Hospital (Ilwaco, on the coast) sat 240 mi
        # inland — which silently corrupts every transport estimate derived
        # from them. A city centroid is approximate but is not wrong by a
        # county, so relocate and say so.
        centroid = places.city_centroid(rec.get('city'), rec['state']) if places.by_state else None
        if centroid:
            off = haversine_mi(rec['latitude'], rec['longitude'],
                               centroid['_la'], centroid['_lo'])
            if off > GEOCODE_TOLERANCE_MI:
                rec['geocodeCorrectedFrom'] = {
                    'latitude': rec['latitude'], 'longitude': rec['longitude'],
                    'milesFromStatedCity': round(off, 1),
                }
                rec['latitude'] = round(centroid['_la'], 4)
                rec['longitude'] = round(centroid['_lo'], 4)
                rec['geocodeSource'] = 'City centroid (ZIP code area)'
                rec['geocodePrecision'] = 'approximate'
                rec['geocodeNote'] = (
                    f"Previous coordinates were {off:.0f} mi from {rec['city']}, {rec['state']} "
                    'and produced incorrect transport estimates. Relocated to the city centroid '
                    'pending a street-level re-geocode.')
                changes['geocode_corrected'] += 1

        # census enrichment
        c = census.get(rec['cmsId']) if rec['cmsId'] else None
        if c and rec['facilityIdType'] == 'shared-ccn':
            # Bed count, ownership and type on a shared CCN describe the whole
            # licensed entity, not this campus. Attributing them here would
            # report the parent hospital's size for a satellite campus.
            rec['hospitalType'] = c['hospital_type']
            rec['ownership'] = c['ownership'] or None
            rec['beds'] = None
            rec['cmsNameAsOf'] = c['cms_name_as_of'] or None
            changes['shared_ccn_beds_suppressed'] += 1
        elif c:
            rec['hospitalType'] = c['hospital_type']
            rec['ownership'] = c['ownership'] or None
            try:
                rec['beds'] = int(float(c['beds'])) if c['beds'] else None
            except ValueError:
                rec['beds'] = None
            rec['cmsNameAsOf'] = c['cms_name_as_of'] or None
            if norm_place(c['cms_name']) != norm_place(rec['name']):
                rec['cmsName'] = c['cms_name']
        else:
            rec.setdefault('hospitalType', None)
            rec.setdefault('ownership', None)
            rec.setdefault('beds', None)

        # County, derived from the nearest ZIP centroid. The offline ZIP database
        # has some bad centroids, so only trust the lookup when it independently
        # reproduces the city we already hold for this record; otherwise leave
        # county unset rather than assert a wrong one.
        if places.by_state:
            z, _ = places.resolve(rec['latitude'], rec['longitude'], rec['state'], rec['name'])
            if z:
                accepted = {norm_place(z['city'])} | {
                    norm_place(c) for c in (z.get('acceptable_cities') or [])}
                if norm_place(rec.get('city')) in accepted:
                    rec['county'] = z['county']
                else:
                    rec['county'] = None
                    changes['county_unresolved'] += 1

        rec['healthSystem'] = health_system(rec['name'])
        rec['aliases'] = build_aliases(rec)

        rec.pop('strokeCertificationDetails', None)
        rec.pop('verified', None)
        out.append(rec)

    known = {r['cmsId'] for r in out if r['cmsId']}

    # --- census-only acute-care facilities -------------------------------
    added = 0
    for ccn, c in sorted(census.items()):
        if ccn in known:
            continue
        if not (c['latitude'] and c['longitude']):
            changes['census_skipped_no_coords'] += 1
            continue
        lat, lon = float(c['latitude']), float(c['longitude'])
        city = county = zipc = None
        city_conf = None
        if places.by_state:
            z, dist = places.resolve(lat, lon, c['state'], c['cms_name'])
            # The name-match bonus can pull the answer to a like-named hamlet
            # (Rosebud Health Care Center is actually in Forsyth). If that
            # happens, fall back to the plainly nearest town.
            if z and dist is not None and dist > CENSUS_CITY_MAX_MI:
                z2, dist2 = places.resolve(lat, lon, c['state'], prefer_name=False)
                if z2 and dist2 is not None and dist2 < dist:
                    z, dist = z2, dist2
            # CMS coordinates are authoritative here; the city is inferred. If no
            # town centroid sits near the point, say nothing rather than name the
            # wrong town — the ZIP database is sparse in rural Alaska.
            if z and dist is not None and dist <= CENSUS_CITY_MAX_MI:
                city, county, zipc = z['city'], z['county'], z['zip_code']
                names = [z['city']] + list(z.get('acceptable_cities') or [])
                corroborated = any(len(norm_place(x)) > 3
                                   and norm_place(x) in norm_place(c['cms_name'])
                                   for x in names)
                city_conf = 'name-corroborated' if corroborated else 'coordinate-derived'
            elif z:
                city_conf = 'unresolved'
                changes['census_city_unresolved'] += 1
        try:
            beds = int(float(c['beds'])) if c['beds'] else None
        except ValueError:
            beds = None
        rec = {
            'id': ccn,
            'cmsId': ccn,
            'facilityIdType': 'ccn',
            'recordClass': 'acute-care-census',
            'strokeDataStatus': 'not-assessed',
            'name': c['cms_name'],
            'address': None,
            'city': city,
            'cityConfidence': city_conf,
            'county': county,
            'state': c['state'],
            'zip': zipc,
            'latitude': lat,
            'longitude': lon,
            'geocoded': True,
            'geocodeSource': 'CMS Hospital General Information',
            'geocodePrecision': geocode_precision(lat, lon),
            'strokeCertificationType': None,
            'certifyingBody': None,
            'certificationDetails': None,
            'certificationBasis': 'not-assessed',
            'stateDesignation': None,
            'nationalCertification': None,
            'hasELVO': False,
            'hospitalType': c['hospital_type'],
            'ownership': c['ownership'] or None,
            'beds': beds,
            'cmsNameAsOf': c['cms_name_as_of'] or None,
            'priorNames': [p for p in (c['prior_names'] or '').split(' | ') if p],
            'dataSources': [CENSUS_SOURCE],
            'lastVerified': None,
        }
        rec['healthSystem'] = health_system(rec['name'])
        rec['aliases'] = build_aliases(rec)
        out.append(rec)
        added += 1

    changes['census_added'] = added

    out.sort(key=lambda r: (r['state'], r.get('city') or '', r['name']))

    doc['schema_version'] = SCHEMA_VERSION
    doc['data_version'] = datetime.now(timezone.utc).strftime('%Y.%m.%d.1')
    doc['generated_at'] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    doc['census_snapshot'] = {
        'source': CENSUS_SOURCE,
        'as_of': CENSUS_AS_OF,
        'file': 'data/cms-census-wwami-2023-10.csv',
        'note': 'Used for facility identity, hospital type, ownership and bed counts only. '
                'No stroke-capability claim is derived from it.',
    }
    doc['record_classes'] = {
        'stroke-capability': 'Stroke capability individually verified against primary sources; '
                             'see last_verified.',
        'acute-care-census': 'Facility identity from the CMS acute-care census. Stroke capability '
                             'has NOT been assessed — absence of a certification here means '
                             'unknown, not none.',
    }
    doc['hospitals'] = out

    if args.dry_run:
        print(json.dumps({'changes': dict(changes), 'total': len(out)}, indent=2))
        return

    with open(DATA, 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')

    by_class = Counter(r['recordClass'] for r in out)
    by_state = Counter(r['state'] for r in out)
    print(f'wrote {DATA}')
    print(f'  total records : {len(out)}')
    print(f'  by class      : {dict(by_class)}')
    print(f'  by state      : {dict(sorted(by_state.items()))}')
    for k, v in sorted(changes.items()):
        print(f'  {k:28s}: {v}')


if __name__ == '__main__':
    main()
