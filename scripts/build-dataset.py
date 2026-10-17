#!/usr/bin/env python3
"""
Build hospitals.json (schema 4) from versioned curated inputs.

    python3 scripts/build-dataset.py            # write hospitals.json, audit, worklist, doc counts
    python3 scripts/build-dataset.py --check    # exit 1 if any output would change (CI)

Inputs (all committed; no network access, no clock):
  data/curated/manifest.json      release, data version, review date, date semantics
  data/curated/sources.json       source registry: URL, publisher, dates, access method
  data/curated/facilities.json    one record per hospital campus, claim-level evidence
  data/curated/neighbors.json     receiving centres just outside the five states
  data/cms-census-wwami-2023-10.csv  CMS Hospital General Information reference rows
  data/geo/wwami-boundaries.json  Census state/county polygons (scripts/build-geo.py)

Outputs:
  hospitals.json                  what the app loads
  data/audit/evidence-audit.csv   one row per facility x claim: state, method, checked date, sources
  data/verification-worklist.csv  ranked open items, each naming the source that can settle it
  README.md, METHODOLOGY.md, llms.txt, index.html  counts between <!-- counts:... --> markers

The build never stamps a verification date, never promotes a claim, and never
turns "not assessed" into "none": every state and date in the output is the
one recorded on the curated claim. Running it twice produces identical bytes.
"""
import argparse
import csv
import io
import json
import re
import sys
from collections import Counter, OrderedDict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geo import Boundaries, Cities, haversine_mi  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CUR = ROOT / 'data' / 'curated'
OUT_JSON = ROOT / 'hospitals.json'
OUT_AUDIT = ROOT / 'data' / 'audit' / 'evidence-audit.csv'
OUT_WORK = ROOT / 'data' / 'verification-worklist.csv'
CENSUS = ROOT / 'data' / 'cms-census-wwami-2023-10.csv'

STATES = ('WA', 'AK', 'ID', 'MT', 'WY')
TIERS = ('CSC', 'TSC', 'PSC', 'ASR')
CLAIM_STATES = ('affirmative', 'negative', 'no-record-found', 'unknown', 'conflicting', 'not-applicable')
STATUS_VALUES = ('active', 'closed', 'merged', 'unknown')
SERVICE_TYPES = ('general-acute', 'specialty-surgical', 'specialty-cancer', 'specialty-other',
                 'rural-emergency-hospital', 'unknown')
POPULATIONS = ('all-ages', 'adult', 'pediatric', 'unknown')
GOVERNANCE = ('nonprofit', 'proprietary', 'government-local', 'government-state', 'federal-ihs',
              'tribal', 'military-dod', 'veterans-affairs', 'unknown')
METHODS = ('prior-edition', 'search-extract', 'nppes-api', 'cms-dataset', 'regulatory-inference',
           'rule-based', 'derived', 'manual-review', None)
ADDRESS_STATUS = ('corroborated', 'source-reported', 'prior-edition', 'coordinate-derived', 'conflicting', 'unknown')
CCN_RELATIONS = ('own', 'shared', 'none', 'unknown')
LOCATION_METHODS = ('cms-dataset', 'legacy-geocode', 'city-centroid', 'source-reported', 'rule-based', 'manual-review')
PRECISIONS = ('campus', 'street', 'city', 'unknown')
SOURCE_TYPES = ('issuer-registry', 'official-facility', 'government', 'news', 'tertiary', 'dataset',
                'nppes', 'prior-edition', 'regulation', 'other')

# A state designation is drawn on the national tier ladder only for display.
# The mapping is published in hospitals.json and every surface that uses it
# says the tier rests on a state level, not on national accreditation.
CROSSWALK = {
    'WA ECS': {'I': 'CSC', 'II': 'PSC', 'III': 'ASR'},
    'Idaho TSE': {'I': 'CSC', 'II+': 'TSC', 'II': 'PSC', 'III': 'ASR'},
}

# Evidence older than this (relative to the manifest review date) is flagged
# for re-checking. It is a maintenance prompt, not a claim that the fact changed.
STALE_DAYS = 365


class BuildError(Exception):
    pass


def load_json(path):
    return json.loads(Path(path).read_text())


def iso(d):
    if d is None:
        return None
    if not re.fullmatch(r'\d{4}(-\d{2}(-\d{2})?)?', d):
        raise BuildError(f'bad date {d!r}')
    return d


def days_between(a, b):
    """Days from date string a to b (both YYYY-MM-DD; partial dates use the 1st)."""
    def p(s):
        parts = (s + '-01-01')[:10].split('-') if len(s) == 4 else (s + '-01')[:10].split('-') if len(s) == 7 else s.split('-')
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    return (p(b) - p(a)).days


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------
def validate_claim(rid, name, c, sources, errors, kind='state'):
    if c is None:
        errors.append(f'{rid}: {name} missing')
        return
    if kind == 'state' and c.get('state') not in CLAIM_STATES:
        errors.append(f'{rid}: {name}.state {c.get("state")!r} invalid')
    if c.get('method') not in METHODS:
        errors.append(f'{rid}: {name}.method {c.get("method")!r} invalid')
    try:
        iso(c.get('checked'))
        for k in ('effective', 'expires'):
            if k in c:
                iso(c.get(k))
    except BuildError as e:
        errors.append(f'{rid}: {name} {e}')
    for ev in c.get('evidence') or []:
        if ev.get('src') not in sources:
            errors.append(f'{rid}: {name} cites unknown source {ev.get("src")!r}')
    # A positive or negative finding needs at least one cited source and a date.
    st = c.get('state') if kind == 'state' else None
    if st in ('affirmative', 'negative', 'conflicting', 'no-record-found') and not c.get('evidence'):
        errors.append(f'{rid}: {name} is {st} but cites no evidence')
    if st in ('affirmative', 'negative', 'conflicting', 'no-record-found') and not c.get('checked') \
            and not (c.get('method') == 'prior-edition' and c.get('editionAsOf')):
        errors.append(f'{rid}: {name} is {st} but has no checked date')


def validate(facilities, neighbors, sources, manifest):
    errors = []
    for sid, s in sources.items():
        if s.get('type') not in SOURCE_TYPES:
            errors.append(f'source {sid}: type {s.get("type")!r} invalid')
        for k in ('published', 'effective', 'accessed'):
            try:
                iso(s.get(k))
            except BuildError as e:
                errors.append(f'source {sid}: {k} {e}')
    seen = set()
    for r in facilities + neighbors:
        rid = r.get('id')
        if not rid or rid in seen:
            errors.append(f'duplicate or missing id {rid!r}')
        seen.add(rid)
        oor = r.get('outOfRegion')
        if not oor and r.get('state') not in STATES:
            errors.append(f'{rid}: state {r.get("state")!r} not in scope')
        if r.get('status', {}).get('value') not in STATUS_VALUES:
            errors.append(f'{rid}: status.value invalid')
        validate_claim(rid, 'status', r.get('status'), sources, errors, kind='value')
        if not oor:
            for name, vocab in (('serviceType', SERVICE_TYPES), ('population', POPULATIONS), ('governance', GOVERNANCE)):
                if (r.get(name) or {}).get('value') not in vocab:
                    errors.append(f'{rid}: {name}.value invalid')
                validate_claim(rid, name, r.get(name), sources, errors, kind='value')
            for name in ('cah', 'ed'):
                validate_claim(rid, name, r.get(name), sources, errors)
            validate_claim(rid, 'system', r.get('system'), sources, errors, kind='value')
            if (r.get('system') or {}).get('state') not in ('affiliated', 'independent', 'unknown'):
                errors.append(f'{rid}: system.state invalid')
            if (r.get('ccn') or {}).get('relation') not in CCN_RELATIONS:
                errors.append(f'{rid}: ccn.relation invalid')
            ccn = (r.get('ccn') or {}).get('value')
            if ccn and not re.fullmatch(r'\d{6}', ccn):
                errors.append(f'{rid}: ccn {ccn!r} is not six digits')
        for name in ('national', 'stateDesignation', 'evt', 'evt247'):
            validate_claim(rid, name, r.get(name), sources, errors)
        nat = r.get('national') or {}
        if nat.get('state') == 'affirmative' and nat.get('tier') not in TIERS:
            errors.append(f'{rid}: affirmative national certification without a valid tier')
        sd = r.get('stateDesignation') or {}
        if sd.get('state') == 'affirmative':
            if sd.get('system') not in CROSSWALK or sd.get('level') not in CROSSWALK.get(sd.get('system'), {}):
                errors.append(f'{rid}: state designation {sd.get("system")} {sd.get("level")} not in crosswalk')
        loc = r.get('location')
        if loc is not None:
            if not (isinstance(loc.get('lat'), (int, float)) and isinstance(loc.get('lng'), (int, float))):
                errors.append(f'{rid}: location without numeric lat/lng (use null for unlocated)')
            if loc.get('method') not in LOCATION_METHODS:
                errors.append(f'{rid}: location.method {loc.get("method")!r} invalid')
            if loc.get('precision') not in PRECISIONS:
                errors.append(f'{rid}: location.precision {loc.get("precision")!r} invalid')
            for ev in loc.get('evidence') or []:
                if ev.get('src') not in sources:
                    errors.append(f'{rid}: location cites unknown source {ev.get("src")!r}')
        addr = r.get('address') or {}
        if addr.get('status') not in ADDRESS_STATUS:
            errors.append(f'{rid}: address.status {addr.get("status")!r} invalid')
        if addr.get('method') not in METHODS:
            errors.append(f'{rid}: address.method {addr.get("method")!r} invalid')
        for ev in addr.get('evidence') or []:
            if ev.get('src') not in sources:
                errors.append(f'{rid}: address cites unknown source {ev.get("src")!r}')
    for k in ('schema_version', 'data_version', 'release', 'evidence_review_date', 'generated'):
        if not manifest.get(k):
            errors.append(f'manifest missing {k}')
    if errors:
        raise BuildError('curated input invalid:\n  ' + '\n  '.join(errors[:80])
                         + (f'\n  … {len(errors) - 80} more' if len(errors) > 80 else ''))


# ---------------------------------------------------------------------------
# derivation
# ---------------------------------------------------------------------------
def st(c):
    return (c or {}).get('state') or 'unknown'


def derive_tier(r):
    nat, sd = r.get('national') or {}, r.get('stateDesignation') or {}
    if st(nat) == 'affirmative' and nat.get('tier') in TIERS:
        return nat['tier'], 'national'
    if st(sd) == 'affirmative':
        t = CROSSWALK.get(sd.get('system'), {}).get(sd.get('level'))
        if t:
            return t, 'state-crosswalk'
    return None, None


def state_program_applies(r):
    # States that designate hospital stroke centers: Washington (ECS
    # categorization), Idaho (TSE designation) and Wyoming (WDH Heart and Stroke
    # Center designation). Montana and Alaska had no operating program (2026 review).
    return r.get('state') in ('WA', 'ID', 'WY')


def derive_capability(r):
    """assessed: every capability claim documented (any state but unknown);
    partial: some documented, some unknown; unassessed: none was looked at;
    conflicting: any claim conflicting."""
    claims = [r.get('national'), r.get('evt'), r.get('evt247')]
    if state_program_applies(r):
        claims.append(r.get('stateDesignation'))
    states = [st(c) for c in claims]
    if 'conflicting' in states:
        return 'conflicting'
    looked = [c for c in claims if st(c) != 'unknown' or (c or {}).get('method')]
    if not looked:
        return 'unassessed'
    if 'unknown' in states:
        return 'partial'
    return 'assessed'


def tier_class(r, tier, cap):
    """One class per record for filters, counts and map colour. 'none' means the
    national certification (and the state designation, where the state has a
    program) was searched and nothing was found; a record with some of that
    still unknown is 'partial', never 'none'."""
    if tier:
        return tier.lower()
    if cap in ('unassessed', 'conflicting'):
        return cap
    searched = ('no-record-found', 'negative')
    if st(r.get('national')) in searched and (not state_program_applies(r)
                                              or st(r.get('stateDesignation')) in searched + ('not-applicable',)):
        return 'none'
    return 'partial'


def derive_eligibility(r):
    """Adult emergency-stroke analysis set. Rule published in hospitals.json."""
    status = (r.get('status') or {}).get('value')
    ed = st(r.get('ed'))
    pop = (r.get('population') or {}).get('value')
    svc = (r.get('serviceType') or {}).get('value')
    if status in ('closed', 'merged'):
        return {'value': 'excluded', 'code': 'not-active',
                'reason': 'Not an active hospital campus (' + status + ')'}
    if ed == 'negative':
        return {'value': 'excluded', 'code': 'no-general-ed',
                'reason': 'No general 24/7 emergency department documented for this campus'}
    if pop == 'pediatric':
        return {'value': 'excluded', 'code': 'pediatric',
                'reason': "Pediatric hospital — outside the adult emergency-stroke analysis set"}
    if status == 'active' and ed == 'affirmative' and pop in ('all-ages', 'adult'):
        return {'value': 'eligible', 'code': 'eligible',
                'reason': 'Active campus with a documented general 24/7 emergency department serving adults'}
    missing = []
    if status != 'active':
        missing.append('active status')
    if ed != 'affirmative':
        missing.append('24/7 emergency department')
    if pop not in ('all-ages', 'adult'):
        missing.append('population served')
    if svc and svc.startswith('specialty') and ed != 'affirmative':
        missing.append('specialty campus with no documented general ED')
    return {'value': 'unknown', 'code': 'unresolved',
            'reason': 'Eligibility unresolved — not yet documented: ' + ', '.join(missing)}


def last_checked(r, names):
    ds = [(r.get(n) or {}).get('checked') for n in names]
    ds = [d for d in ds if d]
    return max(ds) if ds else None


def critical_claims(r):
    names = ['national', 'evt247']
    if state_program_applies(r):
        names.append('stateDesignation')
    return names


def oldest_critical(r):
    """(oldest check date over the documented critical claims, any undated?).
    A documented claim with no check date makes the record's evidence age unknown."""
    dates, undated = [], False
    for n in critical_claims(r):
        c = r.get(n) or {}
        if st(c) == 'unknown' and not c.get('method'):
            continue
        if c.get('checked'):
            dates.append(c['checked'])
        else:
            undated = True
    return (None if undated or not dates else min(dates)), undated


def needs_verification(r, derived, review_date):
    codes = []
    cap = derived['capability']
    if cap == 'unassessed':
        codes.append('capability-unassessed')
    if cap == 'conflicting':
        codes.append('conflicting-evidence')
    if cap == 'partial':
        codes.append('capability-partial')
    for n in ('national', 'stateDesignation', 'evt', 'evt247', 'status', 'ed'):
        if st(r.get(n)) == 'conflicting' and 'conflicting-evidence' not in codes:
            codes.append('conflicting-evidence')
    lc = derived.get('capabilityOldest')
    if cap in ('assessed', 'partial') and lc and days_between(lc, review_date) > STALE_DAYS:
        codes.append('evidence-stale')
    if cap in ('assessed', 'partial', 'conflicting') and derived.get('capabilityUndated'):
        codes.append('evidence-undated')
    if derived['eligibility']['value'] == 'unknown':
        codes.append('eligibility-unresolved')
    if not derived['located']:
        codes.append('unlocated')
    elif (r.get('location') or {}).get('precision') in ('city', 'unknown') and (r.get('status') or {}).get('value') != 'closed':
        codes.append('location-unverified')
    astat = (r.get('address') or {}).get('status')
    if astat == 'conflicting':
        codes.append('address-conflicting')
    elif astat not in ('corroborated', 'source-reported') and (r.get('status') or {}).get('value') != 'closed':
        codes.append('address-unverified')
    if (r.get('status') or {}).get('value') == 'unknown':
        codes.append('status-unknown')
    for c in derived.get('geoFlags') or []:
        codes.append(c)
    return codes


def load_census():
    rows = {}
    with open(CENSUS, newline='') as f:
        for row in csv.DictReader(f):
            rows[row['ccn']] = row
    return rows


def cms_reference(r, census):
    ccn = (r.get('ccn') or {}).get('value')
    row = census.get(ccn) if ccn else None
    if not row:
        return None
    shared = (r.get('ccn') or {}).get('relation') == 'shared'
    try:
        beds = int(float(row['beds'])) if row['beds'] else None
    except ValueError:
        beds = None
    return OrderedDict([
        ('name', row['cms_name']),
        ('asOf', row['cms_name_as_of']),
        ('hospitalType', row['hospital_type'] or None),
        ('ownership', row['ownership'] or None),
        # Bed counts describe the whole licensed entity behind a CCN; on a
        # shared CCN they are the parent's, so they are not attributed here.
        ('beds', None if shared else beds),
        ('bedsScope', 'not attributed: CCN shared with another campus' if shared
         else 'licensed entity under this CCN, CMS snapshot'),
        ('priorNames', [p for p in (row['prior_names'] or '').split(' | ') if p]),
    ])


# A campus more than this far from the town its address names is flagged: the
# check that catches a hospital plotted in the wrong town (v3 placed South
# Peninsula Hospital in Anchor Point and Cascade Medical Center 23 mi from Cascade).
CITY_TOLERANCE_MI = 15


def geography(r, bounds, cities):
    loc = r.get('location')
    out = {'county': None, 'countyFips': None, 'countyBoundaryMi': None, 'cityDistanceMi': None, 'nearestTown': None, 'flags': []}
    if not loc:
        return out
    if r.get('outOfRegion'):
        return out
    where, mi = bounds.check_state(loc['lat'], loc['lng'], r['state'])
    if where == 'outside':
        out['flags'].append('outside-state-boundary')
    elif where == 'near-boundary':
        out['flags'].append('near-state-boundary')
    name, fips, bd = bounds.county_of(loc['lat'], loc['lng'], r['state'])
    out['county'], out['countyFips'], out['countyBoundaryMi'] = name, fips, bd
    if bd is not None and bd < 1.0:
        out['flags'].append('near-county-boundary')
    city = (r.get('address') or {}).get('city')
    hit = cities.lookup(r['state'], city, near=(loc['lat'], loc['lng'])) if city else None
    if hit and loc.get('method') != 'city-centroid':
        d = haversine_mi(loc['lat'], loc['lng'], hit[1], hit[2])
        out['cityDistanceMi'] = round(d, 1)
        if d > CITY_TOLERANCE_MI:
            out['flags'].append('far-from-named-city')
        else:
            # The pattern behind the previous edition's Alaska errors: the point
            # sits in one town while the record names a neighbouring one.
            near = cities.nearest(r['state'], loc['lat'], loc['lng'])
            if near and near[0] != hit[0] and d > 8 and near[3] < d / 3:
                out['flags'].append('nearer-to-another-town')
                out['nearestTown'] = near[0]
    elif city and not hit and loc.get('method') != 'city-centroid':
        out['flags'].append('town-not-in-gazetteer')
    if loc.get('conflict'):
        out['flags'].append('location-conflict')
    return out


def build_record(r, census, bounds, cities, review_date):
    rec = OrderedDict()
    for k, v in r.items():
        rec[k] = v
    tier, basis = derive_tier(r)
    geo = geography(r, bounds, cities)
    located = r.get('location') is not None
    derived = OrderedDict([
        ('tier', tier),
        ('tierBasis', basis),
        ('capability', 'n/a' if r.get('outOfRegion') else derive_capability(r)),
        ('tierClass', None if r.get('outOfRegion') else tier_class(r, tier, derive_capability(r))),
        ('capabilityChecked', last_checked(r, ('national', 'stateDesignation', 'evt', 'evt247'))),
        ('capabilityOldest', None if r.get('outOfRegion') else oldest_critical(r)[0]),
        ('capabilityUndated', False if r.get('outOfRegion') else oldest_critical(r)[1]),
        ('eligibility', {'value': 'not-applicable', 'code': 'out-of-region',
                         'reason': 'Receiving center outside the five states; used only as a destination'}
         if r.get('outOfRegion') else derive_eligibility(r)),
        ('located', located),
        ('county', geo['county']),
        ('countyFips', geo['countyFips']),
        ('cityDistanceMi', geo['cityDistanceMi']),
        ('nearestTown', geo['nearestTown']),
        ('geoFlags', geo['flags']),
    ])
    derived['needsVerification'] = [] if r.get('outOfRegion') else needs_verification(r, derived, review_date)
    # Evidence age is the age of the OLDEST critical claim: one fresh re-check
    # must not make carried-forward EVT or certification evidence look new.
    if derived.get('capabilityOldest'):
        derived['capabilityAgeDays'] = days_between(derived['capabilityOldest'], review_date)
    rec['cms'] = None if r.get('outOfRegion') else cms_reference(r, census)
    rec['derived'] = derived
    return rec


# ---------------------------------------------------------------------------
# audit + worklist
# ---------------------------------------------------------------------------
AUDIT_CLAIMS = ('status', 'address', 'location', 'ed', 'population', 'serviceType', 'cah',
                'governance', 'system', 'national', 'stateDesignation', 'evt', 'evt247')


def claim_value(name, c):
    if c is None:
        return ''
    if name == 'address':
        return ', '.join(x for x in (c.get('street'), c.get('city'), c.get('zip')) if x)
    if name == 'location':
        return f"{c.get('lat')},{c.get('lng')} ({c.get('method')}, {c.get('precision')})"
    if name == 'national':
        return ' '.join(x for x in (c.get('body'), c.get('program') or c.get('tier')) if x)
    if name == 'stateDesignation':
        return ' '.join(x for x in (c.get('system'), ('Level ' + c['level']) if c.get('level') else None,
                                    c.get('status') if c.get('status') not in (None, 'designated') else None) if x)
    if name == 'system':
        return c.get('value') or ''
    return str(c.get('value') if 'value' in c else '')


def _key(name, c):
    """The substantive content of a claim, for comparing it with its earlier value."""
    if c is None:
        return None
    if name in ('status', 'serviceType', 'population', 'governance'):
        return c.get('value')
    if name == 'system':
        return (c.get('state'), c.get('value'))
    if name == 'national':
        return (c.get('state'), c.get('tier'), c.get('body'))
    if name == 'stateDesignation':
        return (c.get('state'), c.get('system'), c.get('level'))
    if name == 'address':
        return (c.get('street'), (c.get('city') or '').lower() or None)
    return c.get('state')


def _blank(name, key):
    if key in (None, 'unknown'):
        return True
    if isinstance(key, tuple):
        return key[0] in (None, 'unknown') if name != 'address' else not any(key)
    return False


def audit_outcome(name, c):
    """What this review did with the claim (see docs/EVIDENCE-AUDIT-2026-10.md)."""
    if c is None:
        return 'missing'
    if c.get('inaccessible'):
        return 'inaccessible'
    m = c.get('method')
    if c.get('state') == 'conflicting' or (name == 'address' and c.get('status') == 'conflicting') \
            or (name == 'location' and c.get('conflict')):
        return 'conflicting'
    if name == 'location':
        if m == 'legacy-geocode' or (m in ('cms-dataset', 'city-centroid') and not c.get('checked')):
            return 'carried-forward'
        if m in ('rule-based',):
            return 'confirmed'
        if m == 'city-centroid':
            return 'established'
        return 'corrected' if c.get('previous') or 'replaced' in (c.get('note') or '') or 'Restored' in (c.get('note') or '') else 'confirmed'
    if m == 'prior-edition' or (name == 'address' and c.get('status') == 'prior-edition'):
        return 'carried-forward'
    if not m:
        return 'not-assessed'
    prev = c.get('changedFrom')
    if prev is None:
        return 'confirmed'
    before, after = _key(name, prev), _key(name, c)
    if before == after:
        return 'confirmed'
    if name == 'address' and not before[0] and before[1] == after[1]:
        return 'established'   # a street added to the town already recorded
    if _blank(name, before):
        return 'established'
    return 'corrected'


def write_audit(records, sources):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(['id', 'name', 'state', 'claim', 'outcome', 'claim_state', 'value', 'method', 'checked',
                'previous', 'sources', 'note'])
    for r in records:
        if r.get('outOfRegion'):
            continue
        for name in AUDIT_CLAIMS:
            c = r.get(name)
            prev = (c or {}).get('changedFrom')
            w.writerow([
                r['id'], r['name'], r['state'], name, audit_outcome(name, c),
                (c or {}).get('state', ''), claim_value(name, c), (c or {}).get('method') or '',
                (c or {}).get('checked') or '',
                json.dumps(prev, ensure_ascii=False, sort_keys=True) if prev is not None else '',
                ' | '.join(sorted({ev.get('src') for ev in (c or {}).get('evidence') or [] if ev.get('src')})),
                ((c or {}).get('note') or '').replace('\n', ' '),
            ])
    return buf.getvalue()


WORK_TEXT = {
    'conflicting-evidence': ('P1', 'Resolve conflicting evidence', 'Issuer registry for the credential in conflict; hospital page'),
    'evidence-undated': ('P2', 'Re-check capability evidence carried from the previous edition without a claim-level check date', 'Issuer registries (Joint Commission Quality Check, DNV) and hospital stroke pages'),
    'capability-partial': ('P3', 'Finish the capability assessment (some of national, state, EVT and 24/7 EVT not yet documented)', 'Hospital stroke and neurointerventional pages; issuer registries'),
    'capability-unassessed': ('P2', 'Assess stroke capability (national, state, EVT)', 'Joint Commission Quality Check, DNV certificate checker, state registry, hospital stroke page'),
    'evidence-stale': ('P2', 'Re-check capability evidence (older than 12 months)', 'Issuer registries and hospital pages'),
    'eligibility-unresolved': ('P2', 'Confirm active status and general 24/7 emergency department', 'Hospital emergency services page; state licensing roster'),
    'unlocated': ('P1', 'Locate campus (no verified coordinates)', 'Official campus address, then a documented geocoder (US Census geocoder or Nominatim) with match type recorded'),
    'location-unverified': ('P3', 'Verify campus coordinates', 'Geocode the verified street address; record geocoder, query and match type'),
    'address-unverified': ('P3', 'Verify physical campus address', 'NPPES organization record (282N taxonomy) and the hospital website'),
    'status-unknown': ('P2', 'Confirm active / closed status', 'State hospital licensing roster; CMS Hospital General Information (current)'),
    'outside-state-boundary': ('P1', 'Coordinates fall outside the named state', 'Re-geocode from the verified address'),
    'near-state-boundary': ('P3', 'Coordinates near the state boundary (generalised coastline?)', 'Confirm against the verified address'),
    'near-county-boundary': ('P3', 'Coordinates within 1 mi of a county boundary — county assignment uncertain', 'Confirm county from the verified address'),
    'nearer-to-another-town': ('P2', 'Coordinates sit much nearer another town than the one the address names', 'Verified street address and town, then a documented geocoder'),
    'town-not-in-gazetteer': ('P3', 'Town not in the gazetteer, so the town check could not run', 'Confirm the town from the verified address'),
    'far-from-named-city': ('P1', 'Coordinates more than 15 mi from the town the address names', 'Verified street address, then a documented geocoder'),
    'location-conflict': ('P2', 'Two coordinate sources disagree by more than 1 mi', 'Geocode the verified street address and keep the matching point'),
    'address-conflicting': ('P2', 'NPPES and the previous edition give different street addresses', 'Hospital website contact page; state licensing roster'),
}


def write_worklist(records, manifest):
    rows = []
    for r in records:
        if r.get('outOfRegion'):
            continue
        for code in r['derived']['needsVerification']:
            pri, item, src = WORK_TEXT.get(code, ('P3', code, ''))
            # Unresolved eligibility on a closed record is noise.
            rows.append([pri, r['id'], r['name'], r['state'], code, item, src])
        for item in r.get('openItems') or []:
            rows.append([item.get('priority', 'P1'), r['id'], r['name'], r['state'], 'open-item',
                         item['question'], item['nextCheck']])
    for item in manifest.get('openItems') or []:
        rows.append([item.get('priority', 'P1'), '—', item.get('scope', 'ALL'), '—', 'open-item',
                     item['question'], item['nextCheck']])
    order = {'P1': 0, 'P2': 1, 'P3': 2}
    rows.sort(key=lambda x: (order.get(x[0], 9), x[3], x[2], x[4], x[5]))
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(['priority', 'id', 'name', 'state', 'code', 'item', 'source_to_check'])
    w.writerows(rows)
    return buf.getvalue(), rows


# ---------------------------------------------------------------------------
# counts in docs
# ---------------------------------------------------------------------------
def compute_counts(records):
    inreg = [r for r in records if not r.get('outOfRegion')]
    c = OrderedDict()
    c['records'] = len(inreg)
    c['neighbors'] = len(records) - len(inreg)
    c['by_state'] = OrderedDict((s, sum(1 for r in inreg if r['state'] == s)) for s in STATES)
    c['active'] = sum(1 for r in inreg if r['status']['value'] == 'active')
    c['closed_or_merged'] = sum(1 for r in inreg if r['status']['value'] in ('closed', 'merged'))
    c['status_unknown'] = sum(1 for r in inreg if r['status']['value'] == 'unknown')
    el = Counter(r['derived']['eligibility']['value'] for r in inreg)
    c['eligible'] = el['eligible']
    c['excluded'] = el['excluded']
    c['eligibility_unknown'] = el['unknown']
    c['unlocated'] = sum(1 for r in inreg if not r['derived']['located'])
    cap = Counter(r['derived']['capability'] for r in inreg)
    c['capability'] = OrderedDict((k, cap[k]) for k in ('assessed', 'partial', 'unassessed', 'conflicting'))
    c['evt247_documented'] = sum(1 for r in inreg if st(r['evt247']) == 'affirmative')
    c['tiers'] = OrderedDict((t, sum(1 for r in inreg if r['derived']['tier'] == t)) for t in TIERS)
    c['state_only_tier'] = sum(1 for r in inreg if r['derived']['tierBasis'] == 'state-crosswalk')
    c['national_certified'] = sum(1 for r in inreg if st(r['national']) == 'affirmative')
    return c


def counts_sentence(c, manifest):
    return (f"{c['records']} facility records (WA {c['by_state']['WA']}, AK {c['by_state']['AK']}, "
            f"ID {c['by_state']['ID']}, MT {c['by_state']['MT']}, WY {c['by_state']['WY']}): "
            f"{c['eligible']} in the adult emergency-stroke analysis set, {c['excluded']} excluded with a "
            f"documented reason, {c['eligibility_unknown']} with eligibility unresolved; "
            f"{c['unlocated']} not yet located. Stroke capability: {c['capability']['assessed']} assessed, "
            f"{c['capability']['partial']} partly assessed, {c['capability']['unassessed']} not assessed, "
            f"{c['capability']['conflicting']} with conflicting evidence; "
            f"{c['evt247_documented']} with documented 24/7 thrombectomy. "
            f"{c['neighbors']} receiving centers outside the five states are included as destinations only. "
            f"Data {manifest['data_version']}, evidence review {manifest['evidence_review_date']}.")


def audit_table(records):
    """Markdown table: claim x audit outcome counts, in-region records only."""
    outcomes = ('confirmed', 'established', 'corrected', 'carried-forward', 'conflicting', 'inaccessible', 'not-assessed', 'missing')
    rows = []
    totals = Counter()
    for name in AUDIT_CLAIMS:
        c = Counter(audit_outcome(name, r.get(name)) for r in records if not r.get('outOfRegion'))
        totals.update(c)
        rows.append('| `' + name + '` | ' + ' | '.join(str(c[o]) for o in outcomes) + ' |')
    head = '| Claim | ' + ' | '.join(outcomes) + ' |\n|---|' + '---:|' * len(outcomes)
    tot = '| **All claims** | ' + ' | '.join(f'**{totals[o]}**' for o in outcomes) + ' |'
    return '\n'.join([head] + rows + [tot])


DOC_TARGETS = ('README.md', 'METHODOLOGY.md', 'llms.txt', 'index.html', 'docs/EVIDENCE-AUDIT-2026-10.md')
AUDIT_MARK = re.compile(r'(<!-- audit-table:start -->)(.*?)(<!-- audit-table:end -->)', re.S)
MARK = re.compile(r'(<!-- counts:start -->)(.*?)(<!-- counts:end -->)', re.S)
JSONLD = re.compile(r'("description": ")([^"]*)(")')


def render_docs(sentence, table):
    out = {}
    for name in DOC_TARGETS:
        p = ROOT / name
        if not p.exists():
            continue
        text = p.read_text()
        new = MARK.sub(lambda m: m.group(1) + sentence + m.group(3), text)
        new = AUDIT_MARK.sub(lambda m: m.group(1) + '\n' + table + '\n' + m.group(3), new)
        if name == 'index.html':
            new = re.sub(r'(<script type="application/ld\+json">.*?"description": ")[^"]*(")',
                         lambda m: m.group(1) + 'Public-source reference dataset: ' + sentence.replace('"', "'") + m.group(2),
                         new, flags=re.S)
        out[name] = (text, new)
    return out


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='fail if any output would change')
    args = ap.parse_args()

    manifest = load_json(CUR / 'manifest.json')
    sources = load_json(CUR / 'sources.json')
    facilities = load_json(CUR / 'facilities.json')
    neighbors = load_json(CUR / 'neighbors.json')
    validate(facilities, neighbors, sources, manifest)

    census = load_census()
    bounds = Boundaries()
    cities = Cities()
    review = manifest['evidence_review_date']
    records = [build_record(r, census, bounds, cities, review) for r in facilities]
    records += [build_record(r, census, bounds, cities, review) for r in neighbors]
    records.sort(key=lambda r: (1 if r.get('outOfRegion') else 0, r['state'], (r.get('address') or {}).get('city') or '~', r['name'], r['id']))

    used = set()
    for r in records:
        for k, v in r.items():
            if isinstance(v, dict):
                for ev in v.get('evidence') or []:
                    used.add(ev.get('src'))
    unused = sorted(set(sources) - used)
    counts = compute_counts(records)

    doc = OrderedDict()
    doc['schema_version'] = manifest['schema_version']
    doc['release'] = manifest['release']
    doc['data_version'] = manifest['data_version']
    doc['generated'] = manifest['generated']
    doc['evidence_review_date'] = review
    doc['date_semantics'] = manifest['date_semantics']
    doc['scope'] = manifest['scope']
    doc['eligibility_rule'] = manifest['eligibility_rule']
    doc['tier_crosswalk'] = {'note': manifest['crosswalk_note'], 'mapping': CROSSWALK}
    doc['claim_states'] = manifest['claim_states']
    doc['methods'] = manifest['methods']
    doc['census_snapshot'] = manifest['census_snapshot']
    doc['geography'] = {'boundaries': Boundaries().source, 'note': manifest['geography_note']}
    doc['road_networks'] = manifest['road_networks']
    doc['certification_definitions'] = manifest['certification_definitions']
    doc['counts'] = counts
    doc['sources'] = OrderedDict((k, sources[k]) for k in sorted(sources) if k not in unused)
    doc['hospitals'] = records

    outputs = {
        OUT_JSON: json.dumps(doc, indent=1, ensure_ascii=False) + '\n',
        OUT_AUDIT: write_audit(records, sources),
    }
    work_text, work_rows = write_worklist(records, manifest)
    outputs[OUT_WORK] = work_text
    for name, (old, new) in render_docs(counts_sentence(counts, manifest), audit_table(records)).items():
        outputs[ROOT / name] = new

    changed = []
    for path, text in outputs.items():
        old = path.read_text() if path.exists() else None
        if old != text:
            changed.append(path.relative_to(ROOT))
            if not args.check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
    if args.check:
        if changed:
            print('Outputs are stale — run: python3 scripts/build-dataset.py')
            for c in changed:
                print('  ', c)
            return 1
        print('build outputs up to date')
        return 0
    print(f'records: {counts["records"]} (+{counts["neighbors"]} out-of-region destinations)')
    print(f'eligible {counts["eligible"]} · excluded {counts["excluded"]} · unknown {counts["eligibility_unknown"]} · unlocated {counts["unlocated"]}')
    print(f'capability: {dict(counts["capability"])} · 24/7 EVT documented {counts["evt247_documented"]}')
    print(f'worklist items: {len(work_rows)} · unused sources dropped from output: {len(unused)}')
    print('changed:', ', '.join(str(c) for c in changed) or 'nothing')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BuildError as e:
        print('BUILD ERROR:', e, file=sys.stderr)
        sys.exit(2)
