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
ELIG_CODES = {'eligible', 'unresolved', 'not-active', 'no-general-ed', 'pediatric', 'out-of-region'}
CROSSWALK = {
    'WA ECS': {'I': 'CSC', 'II': 'PSC', 'III': 'ASR'},
    'Idaho TSE': {'I': 'CSC', 'II+': 'TSC', 'II': 'PSC', 'III': 'ASR'},
}
DATE = re.compile(r'^\d{4}(-\d{2}(-\d{2})?)?$')


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
            for k in ('checked', 'effective', 'expires', 'editionAsOf'):
                d = c.get(k)
                if d is not None and not real_date(d):
                    p.append(f'{r["id"]}.{name}.{k}: bad date {d!r}')
            if real_date(c.get('editionAsOf')) and c['editionAsOf'] > review:
                p.append(f'{r["id"]}.{name}: editionAsOf {c["editionAsOf"]} after the review date {review}')
            if c.get('checked') and c['checked'] > review:
                p.append(f'{r["id"]}.{name}: checked {c["checked"]} after the review date {review}')
            if c.get('method') == 'prior-edition' and c.get('checked') == '2026-07-04':
                p.append(f'{r["id"]}.{name}: carries the previous edition\'s dataset-wide date as a claim check date')
            if c.get('method') == 'prior-edition' and c.get('checked') and c['checked'] > PRIOR_EDITION_MAX:
                # Carried-forward evidence keeps the date it was last checked;
                # the build must never re-stamp it.
                p.append(f'{r["id"]}.{name}: prior-edition claim stamped {c["checked"]}')
            n = c.get('note') or ''
            if len(n) in (379, 380, 399, 400, 419, 420) and n[-1:].isalpha():
                p.append(f'{r["id"]}.{name}: note looks cut at a fixed length ("…{n[-30:]}")')
            if c.get('checked') and not c.get('method'):
                p.append(f'{r["id"]}.{name}: checked date without a method')
    for sid, s in sources.items():
        if not s.get('url') and s.get('type') not in ('prior-edition', 'regulation', 'dataset', 'nppes'):
            p.append(f'source {sid}: no URL')
        if s.get('url') and not re.match(r'https?://', s['url'], re.I):
            p.append(f'source {sid}: url {s["url"][:40]!r} is not a web address')
        for k in ('published', 'effective', 'accessed'):
            if s.get(k) and not real_date(s[k]):
                p.append(f'source {sid}.{k}: bad date {s[k]!r}')
        if s.get('accessed') and s['accessed'] > review:
            p.append(f'source {sid}: accessed {s["accessed"]} after the review date')
    report('Provenance: vocabularies, cited sources exist, dated evidence, no re-stamped dates', p)

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
    report('Capability: tier traceable to an issuer, EVT consistency, unassessed carries no tier', p)

    # -- eligibility ------------------------------------------------------------
    p = []
    for r in inreg:
        e = r['derived']['eligibility']
        if e.get('code') not in ELIG_CODES:
            p.append(f'{r["id"]}: eligibility code {e.get("code")!r}')
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
    report('Eligibility: rule-consistent, every exclusion documented, no name-based exclusion', p)

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
    report('Counts: published counts recompute, doc sentences agree', p)

    # -- public-data boundary ----------------------------------------------------------
    p = []
    email = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
    phone = re.compile(r'\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b')
    private = re.compile(r'\b(confidential|internal only|do not share|patient name|MRN|contract (?:value|terms)|'
                         r'staffing (?:plan|level)s?|on-call schedule)\b', re.I)
    blob = json.dumps(H, ensure_ascii=False)
    for rx, label in ((email, 'email address'), (phone, 'phone number'), (private, 'private-operations wording')):
        for m in sorted(set(rx.findall(blob)))[:5]:
            p.append(f'{label} in hospitals.json: {m!r}')
    for name in ('app.js', 'core.js', 'index.html'):
        t = (ROOT / name).read_text()
        for host in re.findall(r'https?://([a-z0-9.-]+)', t):
            if any(x in host for x in ('google-analytics', 'googletagmanager', 'doubleclick', 'segment.',
                                       'hotjar', 'plausible', 'mixpanel', 'clarity.ms', 'facebook')):
                p.append(f'{name}: tracker host {host}')
    report('Public-data boundary: no contacts, private-operations wording or trackers', p)

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
    for c in sorted(set(codes) - have):
        p.append(f'app.js NV_LABELS has no label for {c!r}')
    report('Wording and versioning: retired phrases gone, cache-busters and changelog match the release', p)

    print()
    if failures:
        print(f'{failures} check group(s) failed')
        return 1
    print(f'all checks passed · {len(inreg)} records · data {doc["data_version"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
