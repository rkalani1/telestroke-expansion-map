#!/usr/bin/env python3
"""
Structural, provenance, geography and regression checks on the built dataset.

    python3 scripts/verify-data.py

Reads hospitals.json (what the app loads) and checks it independently of the
build: it recomputes what it can rather than trusting the build's own derived
fields, so a defect in build-dataset.py surfaces here instead of being copied
into both. No network, no clock, no third-party packages. Exit 1 on any failure.

The checks are grouped; each prints one PASS/FAIL line with up to a few
examples. METHODOLOGY.md §8 describes them.
"""
import csv
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geo import Boundaries, Cities, haversine_mi  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATES = ('WA', 'AK', 'ID', 'MT', 'WY')
TIERS = ('CSC', 'TSC', 'PSC', 'ASR')
CLAIM_STATES = {'affirmative', 'negative', 'no-record-found', 'unknown', 'conflicting', 'not-applicable'}
DOCUMENTED = {'affirmative', 'negative', 'no-record-found', 'conflicting'}
PRECISIONS = {'campus', 'street', 'city', 'unknown'}
ELIG_CODES = {'eligible', 'unresolved', 'restricted-access', 'not-active', 'no-general-ed', 'pediatric', 'out-of-region'}
# Governance values whose emergency department serves eligible beneficiaries
# (Veterans, TRICARE); civilian and EMS access is not documented, so a record
# with such an ED is held out of the analysis set (restricted-access).
FEDERAL_GOVERNANCE = {'veterans-affairs', 'military-dod'}
# Program requirements that document a 24/7 ED when the campus holds the status
# (regulatory inference). Listed here, not imported from the build.
ED_RULE_SOURCES = ('ecfr-42-cfr-485-618', 'wa-doh-ecs-stroke-level2-application', 'ecfr-42-cfr-485-528')
# Capability claims, and the states with a hospital stroke designation program
# (Washington ECS, Idaho TSE, Wyoming WDH designation; METHODOLOGY section 3),
# where the state designation counts towards a record's capability.
CAPABILITY_CLAIMS = ('national', 'evt', 'evt247', 'stateDesignation')
STATE_PROGRAM_STATES = ('WA', 'ID', 'WY')
# The previous edition's dataset-wide stamp; never a claim-level check date.
PRIOR_EDITION_STAMP = '2026-07-04'
# Fixed lengths that earlier curation scripts cut evidence and note text at.
CUT_LENGTHS = {'note': (379, 380, 399, 400, 419, 420), 'supports': (240, 400), 'excerpt': (200, 300, 400)}
CROSSWALK = {
    'WA ECS': {'I': 'CSC', 'II': 'PSC', 'III': 'ASR'},
    'Idaho TSE': {'I': 'CSC', 'II+': 'TSC', 'II': 'PSC', 'III': 'ASR'},
}
DATE = re.compile(r'^\d{4}(-\d{2}(-\d{2})?)?$')
# Claims about the campus itself; a conflict among them is settled by the licensing
# roster, current CMS data and the hospital's own pages (code conflicting-identity).
IDENTITY_CLAIMS = ('status', 'ed', 'cah')
# History labels: the previous edition's, or an earlier step of this review.
PREV_EDITION_LABEL = 'v3 (data 2026.09.13.1)'
EARLIER_STEP = 'this review (earlier step)'
# Review-rule wording (METHODOLOGY section 3; docs/EVIDENCE-AUDIT-2026-10.md).
SWEEP_ONLY = 'Statewide sweep only; no campus-specific search.'
OLD_SWEEP_WORDING = re.compile(r'covered only by|not an individual search|No search specific to this hospital')
ISSUER_UNREACHED = re.compile(r'Joint Commission Quality Check.{0,40}DNV.{0,80}(?:not reachable|could not be (?:reached|opened|read))')
STATE_ROSTER_OR_PROGRAM = re.compile(r'DOH 345-299|Idaho TSE|Time Sensitive Emergenc|designation program|designation rule')
STATE_NAMES = {'AK': 'Alaska', 'ID': 'Idaho', 'MT': 'Montana', 'WY': 'Wyoming', 'WA': 'Washington'}


def real_date(d):
    """A well-formed date that also exists on the calendar."""
    if not isinstance(d, str) or not DATE.match(d):
        return False
    try:
        date.fromisoformat({4: d + '-01-01', 7: d + '-01'}.get(len(d), d))
        return True
    except ValueError:
        return False
# The v3 edition's last data date; a prior-edition claim cannot have been
# checked after the edition it was carried from.
PRIOR_EDITION_MAX = '2026-09-19'

failures = 0


def report(name, problems, limit=6):
    global failures
    if problems:
        failures += 1
        print(f'FAIL  {name} ({len(problems)})')
        for p in problems[:limit]:
            print(f'        {p}')
        if len(problems) > limit:
            print(f'        … {len(problems) - limit} more')
    else:
        print(f'PASS  {name}')


def st(c):
    return (c or {}).get('state') or 'unknown'


def claims_of(r):
    for k, v in r.items():
        if isinstance(v, dict) and k not in ('derived', 'cms', 'ccn'):
            yield k, v


def looks_cut(text, lengths):
    """A string of exactly a known cut length that ends mid-word."""
    return isinstance(text, str) and len(text) in lengths and text[-1:].isalpha()


def check_dates(where, c, review, p):
    """The date rules for a claim, applied the same way to its changedFrom entry."""
    for k in ('checked', 'effective', 'expires', 'editionAsOf'):
        d = c.get(k)
        if d is not None and not real_date(d):
            p.append(f'{where}.{k}: bad date {d!r}')
    if real_date(c.get('editionAsOf')) and c['editionAsOf'] > review:
        p.append(f'{where}: editionAsOf {c["editionAsOf"]} after the review date {review}')
    if c.get('checked') and c['checked'] > review:
        p.append(f'{where}: checked {c["checked"]} after the review date {review}')
    if c.get('method') == 'prior-edition' and c.get('checked') == PRIOR_EDITION_STAMP:
        p.append(f'{where}: carries the previous edition\'s dataset-wide date as a claim check date')
    if c.get('method') == 'prior-edition' and c.get('checked') and c['checked'] > PRIOR_EDITION_MAX:
        # Carried-forward evidence keeps the date it was last checked;
        # the build must never re-stamp it.
        p.append(f'{where}: prior-edition claim stamped {c["checked"]}')
    if c.get('checked') and not c.get('method'):
        p.append(f'{where}: checked date without a method')


def expected_capability(r):
    """derived.capability recomputed (METHODOLOGY section 3): assessed when every
    capability claim is documented (any state but unknown), partial when some are,
    unassessed when none was looked at (unknown with no method), conflicting when
    any conflicts. The state designation counts only where the state has a program."""
    if r.get('outOfRegion'):
        return 'n/a'
    names = CAPABILITY_CLAIMS if r.get('state') in STATE_PROGRAM_STATES else CAPABILITY_CLAIMS[:3]
    claims = [r.get(k) or {} for k in names]
    states = [st(c) for c in claims]
    if 'conflicting' in states:
        return 'conflicting'
    if not any(st(c) != 'unknown' or c.get('method') for c in claims):
        return 'unassessed'
    return 'partial' if 'unknown' in states else 'assessed'


def expected_tier_class(r, tier, cap):
    """derived.tierClass recomputed: the tier; else unassessed/conflicting; else
    'none' when the national certification (and the state designation, where the
    state has a program) is settled without a credential (no record found,
    negative, or not applicable to a closed campus); else 'partial'."""
    if r.get('outOfRegion'):
        return None
    if tier:
        return tier.lower()
    if cap in ('unassessed', 'conflicting'):
        return cap
    settled = ('no-record-found', 'negative', 'not-applicable')
    if st(r.get('national')) in settled and (r.get('state') not in STATE_PROGRAM_STATES
                                             or st(r.get('stateDesignation')) in settled):
        return 'none'
    return 'partial'


def expected_eligibility(r):
    """(value, code) of the adult emergency-stroke analysis set, recomputed from the
    record's own claims (METHODOLOGY section 5), independently of the build."""
    if r.get('outOfRegion'):
        return 'not-applicable', 'out-of-region'
    status = (r.get('status') or {}).get('value')
    ed = st(r.get('ed'))
    pop = (r.get('population') or {}).get('value')
    if status in ('closed', 'merged'):
        return 'excluded', 'not-active'
    if ed == 'negative':
        return 'excluded', 'no-general-ed'
    if pop == 'pediatric':
        return 'excluded', 'pediatric'
    if (r.get('governance') or {}).get('value') in FEDERAL_GOVERNANCE and ed == 'affirmative':
        return 'unknown', 'restricted-access'
    if status == 'active' and ed == 'affirmative' and pop in ('all-ages', 'adult'):
        return 'eligible', 'eligible'
    return 'unknown', 'unresolved'


def main():
    doc = json.loads((ROOT / 'hospitals.json').read_text())
    manifest = json.loads((ROOT / 'data' / 'curated' / 'manifest.json').read_text())
    H = doc['hospitals']
    inreg = [r for r in H if not r.get('outOfRegion')]
    review = doc['evidence_review_date']
    sources = doc['sources']

    # -- envelope -------------------------------------------------------------
    p = []
    if not str(doc.get('schema_version', '')).startswith('4.'):
        p.append(f'schema_version {doc.get("schema_version")!r} is not 4.x')
    for k in ('release', 'data_version', 'generated', 'evidence_review_date', 'eligibility_rule',
              'tier_crosswalk', 'claim_states', 'methods', 'date_semantics'):
        if not doc.get(k):
            p.append(f'missing top-level {k}')
    if doc.get('tier_crosswalk', {}).get('mapping') != CROSSWALK:
        p.append('tier_crosswalk.mapping differs from the documented crosswalk')
    for k in ('release', 'data_version', 'evidence_review_date', 'generated'):
        if doc.get(k) != manifest.get(k):
            p.append(f'{k} differs from data/curated/manifest.json')
    report('Envelope: schema 4, manifest fields, published crosswalk', p)

    # -- identity -------------------------------------------------------------
    p = []
    ids = Counter(r['id'] for r in H)
    p += [f'duplicate id {i}' for i, n in ids.items() if n > 1]
    prev = Counter(x for r in H for x in r.get('previousIds') or [])
    p += [f'previousId {i} reused' for i, n in prev.items() if n > 1]
    p += [f'previousId {i} is also a live id' for i in prev if i in ids]
    own = Counter((r.get('ccn') or {}).get('value') for r in inreg
                  if (r.get('ccn') or {}).get('relation') == 'own')
    p += [f'CCN {c} marked "own" on {n} records' for c, n in own.items() if c and n > 1]
    for r in inreg:
        c = r.get('ccn') or {}
        if c.get('value') and not re.fullmatch(r'\d{6}', c['value']):
            p.append(f'{r["id"]}: CCN {c["value"]!r} not six digits')
        if c.get('relation') == 'shared' and not c.get('note') and not c.get('parentId'):
            p.append(f'{r["id"]}: shared CCN without a parent or note')
        if r['state'] not in STATES:
            p.append(f'{r["id"]}: state {r["state"]!r} outside the five states')
        if not r.get('name') or r['name'] != r['name'].strip():
            p.append(f'{r["id"]}: blank or untrimmed name')
        if re.search(r'Hosptial|Hosiptal|Hopsital', r['name']):
            p.append(f'{r["id"]}: misspelt name {r["name"]!r}')
    report('Identity: unique stable ids, CCN ownership, names', p)

    # -- claims and provenance ------------------------------------------------
    p = []
    for r in H:
        for name, c in claims_of(r):
            s = c.get('state')
            if name == 'system':
                if s not in ('affiliated', 'independent', 'unknown'):
                    p.append(f'{r["id"]}.system: state {s!r}')
                s = 'affirmative' if s in ('affiliated', 'independent') else None
            elif s is not None and s not in CLAIM_STATES:
                p.append(f'{r["id"]}.{name}: state {s!r}')
            if s in DOCUMENTED:
                if not c.get('evidence'):
                    p.append(f'{r["id"]}.{name}: {s} with no evidence')
                if not c.get('checked') and not (c.get('method') == 'prior-edition' and c.get('editionAsOf')):
                    p.append(f'{r["id"]}.{name}: {s} with no checked date')
            for ev in c.get('evidence') or []:
                if ev.get('src') not in sources:
                    p.append(f'{r["id"]}.{name}: cites {ev.get("src")!r}, not in sources')
                for k in ('supports', 'excerpt'):
                    if looks_cut(ev.get(k), CUT_LENGTHS[k]):
                        p.append(f'{r["id"]}.{name}: evidence {k} looks cut at a fixed length ("…{ev[k][-30:]}")')
            check_dates(f'{r["id"]}.{name}', c, review, p)
            # Claim history is checked the same way as the claim itself.
            cf = c.get('changedFrom')
            if cf is not None:
                if not isinstance(cf, dict):
                    p.append(f'{r["id"]}.{name}.changedFrom: not an object')
                else:
                    check_dates(f'{r["id"]}.{name}.changedFrom', cf, review, p)
            n = c.get('note') or ''
            if looks_cut(n, CUT_LENGTHS['note']):
                p.append(f'{r["id"]}.{name}: note looks cut at a fixed length ("…{n[-30:]}")')
    for sid, s in sources.items():
        if not s.get('url') and s.get('type') not in ('prior-edition', 'regulation', 'dataset', 'nppes'):
            p.append(f'source {sid}: no URL')
        if looks_cut(s.get('title'), (200,)):
            p.append(f'source {sid}: title looks cut at a fixed length')
        title = (s.get('title') or '').strip()
        # A raw web address, with or without a scheme: "https://…", "www.…", or a bare
        # host or host/path ("doh.wa.gov/sites/…", "example.org").
        if not title or re.match(r'(https?://|www\.)', title, re.I) or title == s.get('url') or \
                re.fullmatch(r'(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]\S*)?', title, re.I) or \
                (' ' not in title and '/' in title):
            p.append(f'source {sid}: title is missing or a raw web address')
        # A search-reported document date kept in the note must agree with the registry.
        for m in re.finditer(r'Document date as reported: ([0-9-]+) \((published|updated|effective)\)', s.get('note') or ''):
            have = s.get('effective') if m.group(2) == 'effective' else s.get('published')
            if not have or not m.group(1).startswith(have):
                p.append(f'source {sid}: note says "{m.group(0)}" but the registry {m.group(2)} date is {have!r}')
        if s.get('url') and not re.match(r'https?://', s['url'], re.I):
            p.append(f'source {sid}: url {s["url"][:40]!r} is not a web address')
        for k in ('published', 'effective', 'accessed'):
            if s.get(k) and not real_date(s[k]):
                p.append(f'source {sid}.{k}: bad date {s[k]!r}')
        if s.get('accessed') and s['accessed'] > review:
            p.append(f'source {sid}: accessed {s["accessed"]} after the review date')
    report('Provenance: vocabularies, cited sources exist, dated evidence and history, no re-stamped dates, no cut text', p)

    # -- capability -------------------------------------------------------------
    p = []
    for r in H:
        d = r['derived']
        nat, sd = r.get('national') or {}, r.get('stateDesignation') or {}
        want = None, None
        if st(nat) == 'affirmative' and nat.get('tier') in TIERS:
            want = nat['tier'], 'national'
        elif st(sd) == 'affirmative' and CROSSWALK.get(sd.get('system'), {}).get(sd.get('level')):
            want = CROSSWALK[sd['system']][sd['level']], 'state-crosswalk'
        if (d['tier'], d['tierBasis']) != want:
            p.append(f'{r["id"]}: tier {d["tier"]}/{d["tierBasis"]}, expected {want[0]}/{want[1]}')
        if st(nat) == 'affirmative' and not (nat.get('body') and nat.get('tier')):
            p.append(f'{r["id"]}: national certification without issuer and tier')
        if st(r.get('evt247')) == 'affirmative' and st(r.get('evt')) not in ('affirmative', 'conflicting'):
            p.append(f'{r["id"]}: 24/7 thrombectomy documented but thrombectomy itself is {st(r.get("evt"))}')
        if d['capability'] == 'unassessed' and d['tier']:
            p.append(f'{r["id"]}: unassessed record carries tier {d["tier"]}')
        if r.get('outOfRegion'):
            continue
        if d['capability'] not in ('assessed', 'partial', 'unassessed', 'conflicting'):
            p.append(f'{r["id"]}: capability {d["capability"]!r}')
        if d['capability'] == 'assessed' and any(st(r.get(k)) == 'unknown' for k in ('national', 'evt247')):
            p.append(f'{r["id"]}: "assessed" with an unknown capability claim')
        cap = expected_capability(r)
        if d['capability'] != cap:
            p.append(f'{r["id"]}: capability {d["capability"]}, recomputed {cap}')
        tc = expected_tier_class(r, want[0], cap)
        if d.get('tierClass') != tc:
            p.append(f'{r["id"]}: tierClass {d.get("tierClass")}, recomputed {tc}')
        # Not applicable is for a campus that no longer operates (closed or
        # merged); an operating campus's capability is searched, never waived.
        status = (r.get('status') or {}).get('value')
        for k in CAPABILITY_CLAIMS:
            if st(r.get(k)) == 'not-applicable' and status not in ('closed', 'merged'):
                p.append(f'{r["id"]}.{k}: not-applicable on a {status} campus')
    # An inference from a rule cites the rule.
    for r in H:
        for name, c in claims_of(r):
            if c.get('method') == 'regulatory-inference' and not any(
                    (sources.get(ev.get('src')) or {}).get('type') == 'regulation' or ev.get('src') in ED_RULE_SOURCES
                    for ev in c.get('evidence') or []):
                p.append(f'{r["id"]}.{name}: regulatory-inference without a cited regulation or program rule')
    report('Capability: tier traceable to an issuer, EVT consistency, capability and tier class recomputed, '
           'not-applicable only on closed campuses, inferences cite their rule', p)

    # -- eligibility ------------------------------------------------------------
    p = []
    for r in H:
        e = r['derived']['eligibility']
        want = expected_eligibility(r)
        if (e.get('value'), e.get('code')) != want:
            p.append(f'{r["id"]}: eligibility {e.get("value")}/{e.get("code")}, recomputed {want[0]}/{want[1]}')
    for r in inreg:
        e = r['derived']['eligibility']
        nv = r['derived']['needsVerification']
        if e.get('code') not in ELIG_CODES:
            p.append(f'{r["id"]}: eligibility code {e.get("code")!r}')
        # The worklist names the right question for an unresolved record.
        if e.get('code') == 'restricted-access' and ('federal-ed-access' not in nv or 'eligibility-unresolved' in nv):
            p.append(f'{r["id"]}: restricted-access without federal-ed-access (or with eligibility-unresolved)')
        if e.get('code') == 'unresolved' and ('eligibility-unresolved' not in nv or 'federal-ed-access' in nv):
            p.append(f'{r["id"]}: unresolved eligibility without eligibility-unresolved (or with federal-ed-access)')
        if e.get('code') != 'restricted-access' and 'federal-ed-access' in nv:
            p.append(f'{r["id"]}: federal-ed-access on a record that is not restricted-access')
        # A conflict about the campus itself (status, ED, address) has its own code,
        # settled by the licensing roster; a capability conflict keeps conflicting-evidence.
        identity = any(st(r.get(k)) == 'conflicting' for k in IDENTITY_CLAIMS) or \
            (r.get('address') or {}).get('status') == 'conflicting'
        if identity != ('conflicting-identity' in nv):
            p.append(f'{r["id"]}: conflicting status/ED/CAH/address is {identity}, conflicting-identity code is '
                     f'{"conflicting-identity" in nv}')
        if 'address-conflicting' in nv:
            p.append(f'{r["id"]}: retired code address-conflicting (a conflicting address is conflicting-identity)')
        capconf = any(st(r.get(k)) == 'conflicting' for k in CAPABILITY_CLAIMS)
        if capconf != ('conflicting-evidence' in nv):
            p.append(f'{r["id"]}: conflicting capability claim is {capconf}, conflicting-evidence code is {"conflicting-evidence" in nv}')
        if e['value'] == 'eligible':
            inferred = (r.get('ed') or {}).get('method') == 'regulatory-inference'
            if ('(inferred from ' in e.get('reason', '')) != inferred or \
                    ('(documented for this campus)' in e.get('reason', '')) == inferred:
                p.append(f'{r["id"]}: eligibility reason does not say how the ED is known')
        if e['value'] in ('excluded', 'unknown') and not e.get('reason'):
            p.append(f'{r["id"]}: {e["value"]} without a reason')
        status = (r.get('status') or {}).get('value')
        if e['value'] == 'eligible' and not (status == 'active' and st(r.get('ed')) == 'affirmative'
                                             and (r.get('population') or {}).get('value') in ('all-ages', 'adult')):
            p.append(f'{r["id"]}: eligible without active status, documented ED and adult population')
        if e['value'] == 'excluded':
            ok = {'not-active': status in ('closed', 'merged'),
                  'no-general-ed': st(r.get('ed')) == 'negative',
                  'pediatric': (r.get('population') or {}).get('value') == 'pediatric'}.get(e['code'])
            if not ok:
                p.append(f'{r["id"]}: excluded as {e["code"]} but the record does not say so')
    # A hospital is never excluded because of a word in its name.
    gf = [r for r in inreg if 'Great Falls Clinic' in r['name']]
    if not gf:
        p.append('Great Falls Clinic Hospital missing')
    for r in gf:
        if r['derived']['eligibility']['value'] == 'excluded':
            p.append(f'{r["id"]}: Great Falls Clinic Hospital excluded ({r["derived"]["eligibility"]["code"]})')
    report('Eligibility: recomputed for every record, every exclusion documented, no name-based exclusion; '
           'worklist codes for unresolved, restricted-access and conflicting records', p)

    # -- geography ----------------------------------------------------------------
    p = []
    bounds = Boundaries()
    for r in H:
        loc = r.get('location')
        if loc is None:
            if r['derived']['located']:
                p.append(f'{r["id"]}: located=true with no location')
            continue
        if loc.get('precision') not in PRECISIONS:
            p.append(f'{r["id"]}: precision {loc.get("precision")!r}')
        if loc.get('precision') in ('campus', 'street') and loc.get('method') == 'legacy-geocode':
            p.append(f'{r["id"]}: {loc["precision"]} precision claimed for an undocumented legacy geocode')
        if r.get('outOfRegion'):
            continue
        where, mi = bounds.check_state(loc['lat'], loc['lng'], r['state'])
        flagged = 'outside-state-boundary' in r['derived']['geoFlags']
        if where == 'outside' and not flagged:
            p.append(f'{r["id"]}: {mi:.1f} mi outside {r["state"]} and not flagged')
    report('Geography: coordinates in the named state or flagged, no unsupported precision', p)

    # -- regressions: specific errors fixed in 4.0 ---------------------------------
    p = []
    by_name = {}
    for r in inreg:
        by_name.setdefault(r['name'], []).append(r)
    expected_city = {
        'South Peninsula Hospital': 'Homer',
        'Central Peninsula Hospital': 'Soldotna',
    }
    for name, city in expected_city.items():
        rs = by_name.get(name) or []
        if not rs:
            p.append(f'{name} missing')
        for r in rs:
            got = (r.get('address') or {}).get('city')
            if got != city:
                p.append(f'{r["id"]} {name}: city {got!r}, expected {city}')
    # A city named on the record should be near its coordinates; a 25-mile
    # gap between two records of the same city usually means one is misplaced.
    by_city = {}
    for r in inreg:
        a, loc = r.get('address') or {}, r.get('location')
        if a.get('city') and loc:
            by_city.setdefault((r['state'], a['city'].lower()), []).append(r)
    for (s, city), rs in by_city.items():
        if len(rs) < 2:
            continue
        lat = sorted(x['location']['lat'] for x in rs)[len(rs) // 2]
        lng = sorted(x['location']['lng'] for x in rs)[len(rs) // 2]
        for r in rs:
            d = haversine_mi(lat, lng, r['location']['lat'], r['location']['lng'])
            # Records the town check already flags are reported there.
            if d > 25 and not {'far-from-named-city', 'nearer-to-another-town'} & set(r['derived']['needsVerification']):
                p.append(f'{r["id"]} {r["name"]}: {d:.0f} mi from other {city.title()}, {s} records')
    # The town check must still catch the previous edition's own errors.
    cities = Cities()
    for label, lat, lng, town in (('South Peninsula as "Anchor Point"', 59.652133, -151.550296, 'Anchor Point'),
                                  ('Central Peninsula as "Sterling"', 60.493865, -151.077658, 'Sterling')):
        hit = cities.lookup('AK', town, near=(lat, lng))
        near = cities.nearest('AK', lat, lng)
        d = haversine_mi(lat, lng, hit[1], hit[2]) if hit else 0
        if not (hit and near and near[0] != hit[0] and d > 8 and near[3] < d / 3):
            p.append(f'town check no longer flags {label}')
    report('Regressions: known city/coordinate errors stay fixed', p)

    # -- review rules (October 2026 decisions) ------------------------------------------
    p = []
    prev_ids = set(json.loads((ROOT / 'data' / 'curated' / 'previous-edition-ids.json').read_text())['ids'])
    audit_doc = (ROOT / 'docs' / 'EVIDENCE-AUDIT-2026-10.md').read_text()
    h247 = re.compile(r'24\s*/\s*7|24-hour|24 hours|around[- ]the[- ]clock|open 24|round-the-clock', re.I)
    opening = re.compile(r'\bopen(?:s|ed|ing)\b|ribbon', re.I)
    state_label = re.compile(r'^\s*(no[- ]record[- ]found|negative|not[- ]applicable|affirmative|unknown|conflicting)\s*[:;]', re.I)
    sweep = {}
    for r in inreg:
        rid = r['id']
        nat = r.get('national') or {}
        # Statewide-sweep-only national claims: the standard phrase, never the older
        # wordings; Montana's carry the caveat that the sweep is known to be incomplete.
        if OLD_SWEEP_WORDING.search(nat.get('note') or ''):
            p.append(f'{rid}.national: older sweep-only wording; use "{SWEEP_ONLY}"')
        if st(nat) == 'no-record-found' and SWEEP_ONLY in (nat.get('note') or ''):
            sweep.setdefault(r['state'], []).append(rid)
            if r['state'] == 'MT' and 'known to be incomplete' not in nat['note']:
                p.append(f'{rid}.national: Montana sweep-only claim without the incomplete-sweep caveat')
        # A no-record-found national, thrombectomy or 24/7 thrombectomy claim set in this
        # review names its search date and sources and says the issuer directories could
        # not be reached; a state-designation one names the roster or the missing program.
        for k in ('national', 'evt', 'evt247'):
            c = r.get(k) or {}
            if st(c) == 'no-record-found' and c.get('method') not in (None, 'prior-edition'):
                n = c.get('note') or ''
                if 'October 2026' not in n or not ISSUER_UNREACHED.search(n):
                    p.append(f'{rid}.{k}: no-record-found note without its dated sources or the unreachable issuer directories')
        sd = r.get('stateDesignation') or {}
        if st(sd) == 'no-record-found' and sd.get('method') not in (None, 'prior-edition'):
            if not STATE_ROSTER_OR_PROGRAM.search(sd.get('note') or ''):
                p.append(f'{rid}.stateDesignation: no-record-found note names no state roster or program')
            if r['state'] == 'WA' and 'not verified absence' not in sd['note']:
                p.append(f'{rid}.stateDesignation: a Washington record not seen on DOH 345-299 must say "not verified absence"')
        # An affirmative previous-edition capability claim is never overwritten with
        # no record found (conflicting, both cited; or unknown with the value quoted).
        for k in CAPABILITY_CLAIMS:
            c = r.get(k) or {}
            cf = c.get('changedFrom') or {}
            if cf.get('state') == 'affirmative' and cf.get('method') == 'prior-edition' and st(c) == 'no-record-found':
                p.append(f'{rid}.{k}: affirmative previous-edition claim overwritten with no-record-found')
        # History labels: the previous edition's label only on a record it contained.
        in_prev = rid in prev_ids or any(x in prev_ids for x in r.get('previousIds') or [])
        for k, c in claims_of(r):
            cf = c.get('changedFrom')
            if isinstance(cf, dict):
                if cf.get('edition') not in (PREV_EDITION_LABEL, EARLIER_STEP):
                    p.append(f'{rid}.{k}.changedFrom: edition {cf.get("edition")!r}')
                elif cf['edition'] == PREV_EDITION_LABEL and not in_prev:
                    p.append(f'{rid}.{k}.changedFrom: labelled with the previous edition, which did not contain this record')
            # Evidence texts report what a source says; a claim-state label in one must
            # be the claim's own state.
            for e in c.get('evidence') or []:
                m = state_label.match(e.get('supports') or '')
                if m and m.group(1).lower().replace(' ', '-') != c.get('state'):
                    p.append(f'{rid}.{k}: evidence text labelled "{m.group(1)}" on a {c.get("state")} claim')
        # Closed or merged campuses, uniformly: every capability claim not applicable;
        # status, ED and CAH dated by the closure or merger, the date stated in the notes.
        status = r.get('status') or {}
        if status.get('value') in ('closed', 'merged'):
            eff = status.get('effective')
            if not eff:
                p.append(f'{rid}: {status["value"]} without the date it took effect')
            for k in CAPABILITY_CLAIMS:
                if st(r.get(k)) != 'not-applicable':
                    p.append(f'{rid}.{k}: {st(r.get(k))} on a {status["value"]} campus (expected not-applicable)')
            for k in ('ed', 'cah'):
                c = r.get(k) or {}
                if c.get('effective') != eff or not eff or eff not in (c.get('note') or ''):
                    p.append(f'{rid}.{k}: effective {c.get("effective")!r} / note should give the closure or merger date {eff!r}')
        # Emergency departments: one stated only in reports of the facility's opening is
        # unknown; one stated on the facility's own page is recorded (not left unknown).
        ed = r.get('ed') or {}
        evs = ed.get('evidence') or []
        if evs and ed.get('method') != 'regulatory-inference' and st(ed) != 'unknown' and all(
                opening.search(' '.join([(sources.get(e['src']) or {}).get('title') or '', e.get('excerpt') or '', e.get('supports') or '']))
                for e in evs):
            p.append(f'{rid}.ed: {st(ed)} resting only on reports of the opening (expected unknown, statement quoted)')
        if st(ed) == 'unknown' and 'opening' not in (ed.get('note') or ''):
            for k, c in claims_of(r):
                for e in c.get('evidence') or []:
                    txt = ' '.join(x for x in (e.get('excerpt'), e.get('supports')) if x)
                    if (sources.get(e['src']) or {}).get('type') == 'official-facility' and h247.search(txt) and \
                            re.search(r'emergenc|\bER\b|\bED\b', txt):
                        p.append(f'{rid}.ed: unknown, but {k} cites the facility\'s own page stating a 24/7 emergency department ({e["src"]})')
    # The sweep-only list is generated from the data: the manifest open item and the
    # EVIDENCE-AUDIT per-state rows must give the same count and records.
    n_sweep = sum(len(v) for v in sweep.values())
    items = [o for o in manifest.get('openItems') or [] if '(statewide sweeps only)' in (o.get('scope') or '')]
    if len(items) != 1:
        p.append(f'manifest: {len(items)} statewide-sweeps-only open items (expected 1)')
    else:
        q = items[0]['question']
        if not q.startswith(f'{n_sweep} national no-record-found claims'):
            p.append(f'manifest sweep-only item does not give the count {n_sweep}: {q[:60]!r}')
        for s, ids in sweep.items():
            if f'{STATE_NAMES[s]} ({len(ids)})' not in q:
                p.append(f'manifest sweep-only item: no "{STATE_NAMES[s]} ({len(ids)})"')
            for rid in ids:
                if f'({rid})' not in q:
                    p.append(f'manifest sweep-only item does not list {rid}')
    for s, name in STATE_NAMES.items():
        row = next((ln for ln in audit_doc.splitlines() if ln.startswith(f'| {name} |')), None)
        n = len(sweep.get(s, []))
        if row is None:
            p.append(f'docs/EVIDENCE-AUDIT-2026-10.md: no {name} row')
        elif n and f'Sweep only: {n} national claim' not in row:
            p.append(f'docs/EVIDENCE-AUDIT-2026-10.md {name} row does not say "Sweep only: {n} national claim…"')
        elif not n and 'Sweep only:' in row:
            p.append(f'docs/EVIDENCE-AUDIT-2026-10.md {name} row lists sweep-only claims; the data has none')
    # The audit never calls a claim that is now unknown "corrected": an earlier value
    # that could not be confirmed is searched-unresolved.
    with open(ROOT / 'data' / 'audit' / 'evidence-audit.csv', newline='') as f:
        for row in csv.DictReader(f):
            blank = row['claim_state'] in ('unknown', '') and row['value'] in ('', 'unknown', 'None')
            if row['outcome'] == 'corrected' and blank:
                p.append(f'audit {row["id"]}.{row["claim"]}: "corrected" to an unknown value (expected searched-unresolved)')
            # (Coordinates keep their earlier point in location.previous, not in changedFrom.)
            if row['outcome'] == 'corrected' and row['previous'] and json.loads(row['previous']).get('edition') != PREV_EDITION_LABEL:
                p.append(f'audit {row["id"]}.{row["claim"]}: "corrected", but the earlier value is not the previous edition\'s')
    report('Review rules: sweep-only claims and their list, no-record-found notes, history labels, closed campuses, '
           'opening-only and operator ED statements, evidence wording, audit outcomes', p)

    # -- counts ---------------------------------------------------------------------
    p = []
    c = doc['counts']
    el = Counter(r['derived']['eligibility']['value'] for r in inreg)
    cap = Counter(r['derived']['capability'] for r in inreg)
    want = {
        'records': len(inreg), 'neighbors': len(H) - len(inreg),
        'eligible': el['eligible'], 'excluded': el['excluded'], 'eligibility_unknown': el['unknown'],
        'unlocated': sum(1 for r in inreg if r.get('location') is None),
        'evt247_documented': sum(1 for r in inreg if st(r.get('evt247')) == 'affirmative'),
    }
    for k, v in want.items():
        if c.get(k) != v:
            p.append(f'counts.{k} = {c.get(k)}, recomputed {v}')
    for k in ('assessed', 'partial', 'unassessed', 'conflicting'):
        if c['capability'].get(k) != cap[k]:
            p.append(f'counts.capability.{k} = {c["capability"].get(k)}, recomputed {cap[k]}')
    for s in STATES:
        n = sum(1 for r in inreg if r['state'] == s)
        if c['by_state'].get(s) != n:
            p.append(f'counts.by_state.{s} = {c["by_state"].get(s)}, recomputed {n}')
    if sum(c['by_state'].values()) != c['records']:
        p.append('by_state does not sum to records')
    if c['eligible'] + c['excluded'] + c['eligibility_unknown'] != c['records']:
        p.append('eligible + excluded + unresolved does not equal records')
    # How the eligible records' emergency departments are known (METHODOLOGY §5).
    by_rule, documented = Counter(), 0
    for r in inreg:
        if r['derived']['eligibility']['value'] != 'eligible':
            continue
        edc = r.get('ed') or {}
        if edc.get('method') != 'regulatory-inference':
            documented += 1
        else:
            srcs = {ev.get('src') for ev in edc.get('evidence') or []}
            by_rule[next((x for x in ED_RULE_SOURCES if x in srcs), 'other')] += 1
    b = c.get('eligible_ed_basis') or {}
    if b.get('documented') != documented or b.get('inferred') != sum(by_rule.values()):
        p.append(f'counts.eligible_ed_basis = {b.get("documented")}/{b.get("inferred")} documented/inferred, '
                 f'recomputed {documented}/{sum(by_rule.values())}')
    for k, n in by_rule.items():
        if (b.get('inferred_by_rule') or {}).get(k) != n:
            p.append(f'counts.eligible_ed_basis.inferred_by_rule.{k} = {(b.get("inferred_by_rule") or {}).get(k)}, recomputed {n}')
    m = re.search(r'<!-- ed-basis:start -->(.*?)<!-- ed-basis:end -->', (ROOT / 'METHODOLOGY.md').read_text(), re.S)
    if not m:
        p.append('METHODOLOGY.md: no ed-basis marker')
    elif not (f'Of the {el["eligible"]} eligible records' in m.group(1) and f'{sum(by_rule.values())} rest on such an inference'
              in m.group(1) and f'and {documented} on an emergency department documented' in m.group(1)):
        p.append(f'METHODOLOGY.md ed-basis sentence does not match the data: {m.group(1)[:120]!r}')
    sentence = re.compile(r'<!-- counts:start -->(.*?)<!-- counts:end -->', re.S)
    texts = {}
    jsonld = re.compile(r'<script type="application/ld\+json">.*?"description": "Public-source reference dataset: ([^"]*)"', re.S)
    for name in ('README.md', 'METHODOLOGY.md', 'llms.txt', 'index.html'):
        path = ROOT / name
        if path.exists():
            m = (jsonld if name == 'index.html' else sentence).search(path.read_text())
            if m:
                texts[name] = m.group(1).strip()
            else:
                p.append(f'{name}: no counts marker')
    if len({t.replace("'", '"') for t in texts.values()}) > 1:
        p.append('count sentences differ between ' + ', '.join(texts))
    for name, t in texts.items():
        if f'{c["records"]} facility records' not in t:
            p.append(f'{name}: count sentence does not match counts.records')
    report('Counts: published counts recompute, doc sentences agree, ED basis of the analysis set', p)

    # -- public-data boundary ----------------------------------------------------------
    p = []
    email = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
    phone = re.compile(r'\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b')
    private = re.compile(r'\b(confidential|internal only|do not share|patient name|MRN|contract (?:value|terms)|'
                         r'staffing (?:plan|level)s?|on-call schedule)\b', re.I)
    # A personal name introduced by a title or honorific (Dr. X, Gov. X, Governor X ...).
    person = re.compile(r'\b(?:Dr|Gov|Sen|Rep|Mr|Mrs|Ms)\.\s+[A-Z][a-z]+|\b(?:Governor|Senator|Mayor)\s+[A-Z][a-z]+')
    # Source URLs are addresses, not text; titles, publishers and notes are checked.
    src_text = json.dumps({k: {f: v.get(f) for f in ('title', 'publisher', 'note')} for k, v in sources.items()}, ensure_ascii=False)
    blob = json.dumps(H, ensure_ascii=False) + src_text
    for rx, label in ((email, 'email address'), (phone, 'phone number'), (private, 'private-operations wording'),
                      (person, 'personal name')):
        for m in sorted(set(rx.findall(blob)))[:5]:
            p.append(f'{label} in hospitals.json: {m!r}')
    # Source ids are made from URLs; an id must not carry a person's name. Caught here:
    # honorifics and titles, and member-office hosts (<name>.senate.gov, <name>.house.gov;
    # committee hosts name a committee). URLs themselves stay as published citations.
    committee = ('veterans', 'finance', 'help', 'judiciary', 'appropriations', 'energy', 'commerce', 'budget', 'foreign', 'aging',
                 'indian', 'agriculture', 'banking', 'epw', 'rules', 'intelligence', 'hsgac', 'sbc', 'armed-services', 'www')
    person_id = re.compile(r'governor|senator|mayor|(?:^|-)(?:dr|gov|sen|rep|mr|mrs|ms)(?:-|$)|^(?!(?:' + '|'.join(committee)
                           + r')-)[a-z]+-(?:senate|house)-')
    for sid in sorted(sources):
        if person_id.search(sid):
            p.append(f'source id {sid!r} looks like it names a person')
    for name in ('app.js', 'core.js', 'index.html'):
        t = (ROOT / name).read_text()
        for host in re.findall(r'https?://([a-z0-9.-]+)', t):
            if any(x in host for x in ('google-analytics', 'googletagmanager', 'doubleclick', 'segment.',
                                       'hotjar', 'plausible', 'mixpanel', 'clarity.ms', 'facebook')):
                p.append(f'{name}: tracker host {host}')
    report('Public-data boundary: no contacts, personal names, private-operations wording or trackers; records and sources', p)

    # -- wording and versioning ------------------------------------------------------------
    p = []
    banned = {
        'zero-capability': re.compile(r'zero[- ]capability', re.I),
        '"on target" door-to-puncture verdict': re.compile(r'\bon[- ]target\b', re.I),
        'rooftop precision': re.compile(r'rooftop', re.I),
        '"Referral pathways"': re.compile(r'Referral pathways?', re.I),
    }
    for name in ('app.js', 'core.js', 'index.html', 'hospitals.json', 'README.md', 'llms.txt'):
        t = (ROOT / name).read_text()
        for label, rx in banned.items():
            if rx.search(t):
                p.append(f'{name}: contains {label}')
    html = (ROOT / 'index.html').read_text()
    rel = doc['release']
    for asset in re.findall(r'(?:href|src)="((?:app|core)\.(?:js|css)[^"]*)"', html):
        if f'?v={rel}' not in asset:
            p.append(f'index.html: {asset} cache-buster is not ?v={rel}')
    pkg = json.loads((ROOT / 'package.json').read_text())
    if pkg.get('version') != rel:
        p.append(f'package.json version {pkg.get("version")} != release {rel}')
    if f'## [{rel}]' not in (ROOT / 'CHANGELOG.md').read_text():
        p.append(f'CHANGELOG.md has no ## [{rel}] entry')
    if re.search(r'src="https://(unpkg|cdnjs|cdn\.jsdelivr)[^"]*', html):
        p.append('index.html loads a script from a CDN')
    m = re.search(r'<script type="application/ld\+json">.*?"version": "([^"]*)"', html, re.S)
    if not m or m.group(1) != rel:
        p.append(f'index.html JSON-LD version {m.group(1) if m else None!r} != release {rel}')
    # Every needs-verification code the build emits has a priority and an app label.
    codes = doc.get('needs_verification_codes') or {}
    used = {c for r in inreg for c in r['derived']['needsVerification']}
    for c in sorted(used - set(codes)):
        p.append(f'needs-verification code {c!r} has no priority in needs_verification_codes')
    app = (ROOT / 'app.js').read_text()
    labels = re.search(r'const NV_LABELS = \{(.*?)\n\};', app, re.S)
    have = set(re.findall(r"'?([a-z0-9-]+)'?:\s*'", labels.group(1))) if labels else set()
    for c in sorted((set(codes) | used) - have):
        p.append(f'app.js NV_LABELS has no label for {c!r}')
    for c in sorted(have - set(codes)):
        p.append(f'app.js NV_LABELS labels {c!r}, which the build no longer emits')
    report('Wording and versioning: retired phrases gone, cache-busters and changelog match the release', p)

    print()
    if failures:
        print(f'{failures} check group(s) failed')
        return 1
    print(f'all checks passed · {len(inreg)} records · data {doc["data_version"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
