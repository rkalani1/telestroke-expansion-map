#!/usr/bin/env python3
"""
Build data/geo/wwami-boundaries.json — state and county/borough polygons for the
five WWAMI states, used by verify-data.py and build-dataset.py to check that each
hospital's coordinates fall inside the state (and county) its record names.

Input: counties-10m.json from the `us-atlas` npm package (v3.0.1, ISC licence),
a TopoJSON redistribution of the US Census Bureau 2017 cartographic boundary
files (1:10,000,000, generalised). Obtain it with:

    npm pack us-atlas@3.0.1 && tar -xzf us-atlas-3.0.1.tgz
    python3 scripts/build-geo.py package/counties-10m.json

The output is committed, so neither the dataset build nor CI needs the network.
Generalisation means coastlines are simplified: a coastal campus can sit a little
outside its state polygon, which is why the checks use a distance tolerance.
Alaska's 2019 split of the Valdez-Cordova Census Area (into Chugach and Copper
River) post-dates the 2017 edition and is noted where it matters.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'geo' / 'wwami-boundaries.json'
STATE_FIPS = {'53': 'WA', '02': 'AK', '16': 'ID', '30': 'MT', '56': 'WY'}


def decode(topo):
    sx, sy = topo['transform']['scale']
    tx, ty = topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((round(x * sx + tx, 5), round(y * sy + ty, 5)))
        arcs.append(pts)

    def ring(indexes):
        out = []
        for i in indexes:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(pts if not out else pts[1:])
        return out

    def polygons(geom):
        if geom['type'] == 'Polygon':
            return [[ring(r) for r in geom['arcs']]]
        if geom['type'] == 'MultiPolygon':
            return [[ring(r) for r in poly] for poly in geom['arcs']]
        return []
    return polygons


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not src or not src.exists():
        sys.exit(__doc__)
    topo = json.loads(src.read_text())
    polygons = decode(topo)
    out = {
        'source': 'US Census Bureau cartographic boundary files, 2017 edition, 1:10,000,000 '
                  '(generalised), via the us-atlas npm package v3.0.1 (counties-10m.json)',
        'note': 'Generalised boundaries: use a distance tolerance near coastlines and borders. '
                'County-equivalents for Alaska are boroughs and census areas as of 2017; the '
                'Valdez-Cordova Census Area was split into Chugach and Copper River in 2019.',
        'states': {},
        'counties': [],
    }
    for g in topo['objects']['states']['geometries']:
        st = STATE_FIPS.get(str(g['id']).zfill(2))
        if st:
            out['states'][st] = polygons(g)
    for g in topo['objects']['counties']['geometries']:
        fips = str(g['id']).zfill(5)
        st = STATE_FIPS.get(fips[:2])
        if st:
            out['counties'].append({'fips': fips, 'name': g['properties']['name'], 'state': st,
                                    'polygons': polygons(g)})
    out['counties'].sort(key=lambda c: c['fips'])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'wrote {OUT} — {len(out["states"])} states, {len(out["counties"])} counties')


if __name__ == '__main__':
    main()
