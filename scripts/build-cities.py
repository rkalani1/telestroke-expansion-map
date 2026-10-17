#!/usr/bin/env python3
"""
Build data/geo/cities-wwami.json — named-place points for the five WWAMI states
and their neighbours, used to check each hospital's coordinates against the city
its address names, and to place a campus at city level when no cited source gives
its coordinates.

Input: cities.json from the `cities.json` npm package (v1.1.65), a redistribution
of the GeoNames gazetteer (places with population > 1,000 plus administrative
seats), licensed CC BY 4.0 (https://www.geonames.org). Obtain it with:

    npm pack cities.json@1.1.65 && tar -xzf cities.json-1.1.65.tgz
    python3 scripts/build-cities.py package/cities.json

The output is committed, so neither the dataset build nor CI needs the network.
A GeoNames point marks a town centre, not a hospital campus; records placed from
it carry precision "city" and stay on the verification worklist.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'geo' / 'cities-wwami.json'
STATES = ('WA', 'AK', 'ID', 'MT', 'WY', 'OR', 'UT', 'NV', 'CO', 'SD', 'ND', 'NE', 'CA')


def main():
    src = Path(sys.argv[1])
    rows = json.loads(src.read_text())
    out = {}
    for c in rows:
        if c.get('country') != 'US' or c.get('admin1') not in STATES:
            continue
        key = c['admin1']
        out.setdefault(key, []).append([c['name'], round(float(c['lat']), 5), round(float(c['lng']), 5)])
    for k in out:
        out[k].sort()
    doc = {
        'source': 'GeoNames gazetteer via the cities.json npm package v1.1.65 (CC BY 4.0, https://www.geonames.org)',
        'license': 'CC BY 4.0',
        'note': 'Town-centre points for places with population over 1,000 and administrative seats. Not hospital locations.',
        'states': dict(sorted(out.items())),
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'wrote {OUT} ({sum(len(v) for v in out.values())} places)')


if __name__ == '__main__':
    main()
