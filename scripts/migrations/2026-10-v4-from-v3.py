#!/usr/bin/env python3
"""
One-time migration: hospitals.json schema 3.0.0 (commit 33b535b, data
2026.09.13.1) -> curated inputs for schema 4.0.0.

Kept in the repository as the audit trail of how every v3 value became a v4
claim. It does NOT re-verify anything: each v3 statement becomes a claim with
method "prior-edition", the record's own v3 verification date, and the v3
source text preserved verbatim. Later corrections are applied on top of this in
data/curated/facilities.json, each with its own evidence and check date.

    git show 33b535b:hospitals.json > /tmp/v3.json
    python3 scripts/migrations/2026-10-v4-from-v3.py /tmp/v3.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data' / 'curated' / 'facilities.migrated-v3.json'

PRIOR = 'prior-edition-v3'


def title(s):
    keep = {'AMC', 'UW', 'VA', 'CHI', 'DNV', 'CMS', 'EIRMC', 'ER', 'ICU', 'CAH', 'PHS', 'SEARHC',
            'HCA', 'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'PO', 'LLC', 'II', 'III', 'MT.'}
    small = {'of', 'at', 'the', 'and', 'for', 'in', 'on'}
    out = []
    for i, w in enumerate((s or '').split()):
        u = w.upper()
        if u in keep:
            out.append(u)
        elif i and w.lower() in small:
            out.append(w.lower())
        else:
            out.append('-'.join(p[:1].upper() + p[1:].lower() for p in w.split('-')))
    return re.sub(r"\bMc([a-z])", lambda m: 'Mc' + m.group(1).upper(), ' '.join(out))


def claim(**kw):
    base = {'evidence': [], 'checked': None, 'method': None, 'note': None}
    base.update(kw)
    return base


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'hospitals.json'
    v3 = json.loads(src.read_text())
    assert v3.get('schema_version') == '3.0.0', 'expects the v3 file'
    out = []
    for h in v3['hospitals']:
        assessed = h['recordClass'] == 'stroke-capability'
        checked = h.get('lastVerified') if assessed else None
        legacy = '; '.join(h.get('dataSources') or [])
        prior_ev = [{'src': PRIOR, 'excerpt': h.get('certificationDetails') or None,
                     'supports': 'v3 record text and source list: ' + (legacy or 'none listed')}]
        rec = {
            'id': h['id'],
            'previousIds': [],
            'name': title(h['name']),
            'officialName': None,
            'formerNames': [title(p) for p in (h.get('priorNames') or [])],
            'aliases': list(h.get('aliases') or []),
            'ccn': {'value': h.get('cmsId'),
                    'relation': {'ccn': 'own', 'shared-ccn': 'shared', 'military': 'none'}[h['facilityIdType']],
                    'parentId': '130006' if h['facilityIdType'] == 'shared-ccn' else None,
                    'note': h.get('cmsIdNote'), 'correctedFrom': h.get('cmsIdCorrectedFrom')},
            'npi': None,
            'state': h['state'],
            'address': {'street': h.get('address'), 'city': h.get('city'), 'zip': h.get('zip'),
                        'status': ('prior-edition' if assessed else
                                   'coordinate-derived' if h.get('city') else 'unknown'),
                        'evidence': [{'src': PRIOR if assessed else 'cms-hgi-2023-10-archive'}],
                        'checked': checked,
                        'note': ('v3 inferred this city from the CMS coordinates against a ZIP '
                                 'database (cityConfidence: ' + str(h.get('cityConfidence')) + ')')
                                if not assessed and h.get('city') else None},
            'location': {
                'lat': h['latitude'], 'lng': h['longitude'],
                'method': ('city-centroid' if h.get('geocodeCorrectedFrom') else
                           'cms-dataset' if h.get('geocodeSource') == 'CMS Hospital General Information' else
                           'legacy-geocode'),
                'precision': 'city' if h.get('geocodeCorrectedFrom') else 'unknown',
                'evidence': [{'src': 'cms-hgi-2023-10-archive' if h.get('geocodeSource') == 'CMS Hospital General Information' else PRIOR,
                              'supports': 'v3 geocodeSource: ' + str(h.get('geocodeSource'))}],
                'checked': None,
                'note': h.get('geocodeNote'),
            },
            'status': claim(value='unknown', method=None,
                            note='Not checked in v3 beyond presence in the CMS census snapshot.'),
            'serviceType': claim(value='unknown'),
            'population': claim(value='unknown'),
            'cah': claim(state='unknown'),
            'ed': claim(state='unknown', scope='general emergency department open 24/7'),
            'governance': claim(value='unknown'),
            'system': claim(value=None, state='unknown',
                            note=('v3 guessed "' + h['healthSystem'] + '" from the facility name')
                            if h.get('healthSystem') else None),
            'national': None, 'stateDesignation': None, 'evt': None, 'evt247': None,
            'roadNetwork': {'value': 'unknown', 'note': 'v3 airOnly flag: ' + str(bool(h.get('airOnly')))},
            'notes': [],
        }
        if h.get('geocodeCorrectedFrom'):
            rec['location']['previous'] = h['geocodeCorrectedFrom']
        nat = h.get('nationalCertification')
        sd = h.get('stateDesignation')
        if assessed:
            if nat:
                rec['national'] = claim(state='affirmative', body=nat['body'], program=None,
                                        tier=nat['tier'], effective=None, expires=None,
                                        evidence=prior_ev, checked=checked, method='prior-edition')
            else:
                rec['national'] = claim(state='no-record-found', body=None, program=None, tier=None,
                                        effective=None, expires=None, evidence=prior_ev,
                                        checked=checked, method='prior-edition',
                                        note='v3 recorded no national certification (certificationBasis '
                                             + h['certificationBasis'] + ').')
            if h['state'] in ('WA', 'ID'):
                if sd:
                    rec['stateDesignation'] = claim(
                        state='affirmative', authority='WA DOH' if sd['system'] == 'WA ECS' else 'Idaho DHW',
                        system=sd['system'], level=sd['level'], status='designated',
                        effective=None, expires=None, evidence=prior_ev, checked=checked,
                        method='prior-edition')
                else:
                    rec['stateDesignation'] = claim(
                        state='no-record-found', authority='WA DOH' if h['state'] == 'WA' else 'Idaho DHW',
                        system='WA ECS' if h['state'] == 'WA' else 'Idaho TSE', level=None, status='none',
                        effective=None, expires=None, evidence=prior_ev, checked=checked,
                        method='prior-edition', note='v3 recorded no state designation.')
            else:
                rec['stateDesignation'] = claim(state='unknown', authority=None, system=None, level=None,
                                                status='unknown', effective=None, expires=None)
            if h.get('hasELVO'):
                rec['evt'] = claim(state='affirmative', evidence=prior_ev, checked=checked, method='prior-edition')
                rec['evt247'] = claim(state='affirmative', basis='v3 hasELVO = 24/7 thrombectomy',
                                      evidence=prior_ev, checked=checked, method='prior-edition')
            else:
                rec['evt'] = claim(state='no-record-found', evidence=prior_ev, checked=checked, method='prior-edition',
                                   note='v3 hasELVO false: no 24/7 thrombectomy on record.')
                rec['evt247'] = claim(state='no-record-found', basis=None, evidence=prior_ev, checked=checked,
                                      method='prior-edition')
        else:
            unk = dict(state='unknown', note='Capability not assessed (v3 acute-care census record).')
            rec['national'] = claim(body=None, program=None, tier=None, effective=None, expires=None, **unk)
            rec['stateDesignation'] = claim(authority=None, system=None, level=None, status='unknown',
                                            effective=None, expires=None, **unk)
            rec['evt'] = claim(**unk)
            rec['evt247'] = claim(basis=None, **unk)
        out.append(rec)
    out.sort(key=lambda r: r['id'])
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
    print(f'wrote {OUT} ({len(out)} records)')


if __name__ == '__main__':
    main()
