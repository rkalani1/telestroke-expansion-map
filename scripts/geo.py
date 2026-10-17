"""Dependency-free geographic helpers shared by build-dataset.py and verify-data.py.

Point-in-polygon against the generalised Census boundaries in
data/geo/wwami-boundaries.json, plus distance-to-boundary so a check can tell a
coastal campus on a simplified shoreline (a few hundred metres out) from a
hospital plotted in the wrong state.
"""
import json
from math import radians, sin, cos, asin, sqrt
from pathlib import Path

GEO = Path(__file__).resolve().parent.parent / 'data' / 'geo' / 'wwami-boundaries.json'
EARTH_MI = 3958.8


def haversine_mi(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(radians, (lat1, lon1, lat2, lon2))
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return EARTH_MI * 2 * asin(sqrt(a))


def _in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def in_polygons(lat, lng, polygons):
    for poly in polygons:
        if poly and _in_ring(lng, lat, poly[0]) and not any(_in_ring(lng, lat, h) for h in poly[1:]):
            return True
    return False


def _seg_dist_mi(lat, lng, a, b):
    # Equirectangular projection around the point: accurate enough at the
    # few-mile scale this is used for.
    k = cos(radians(lat))
    px, py = 0.0, 0.0
    ax, ay = (a[0] - lng) * k, a[1] - lat
    bx, by = (b[0] - lng) * k, b[1] - lat
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return sqrt(cx * cx + cy * cy) * 69.09


def boundary_distance_mi(lat, lng, polygons, cutoff=None):
    best = float('inf')
    for poly in polygons:
        for ring in poly:
            for i in range(len(ring) - 1):
                a, b = ring[i], ring[i + 1]
                # cheap reject on bounding box
                if cutoff is not None and (min(a[1], b[1]) - lat > cutoff / 69 or lat - max(a[1], b[1]) > cutoff / 69):
                    continue
                d = _seg_dist_mi(lat, lng, a, b)
                if d < best:
                    best = d
    return best


class Boundaries:
    def __init__(self, path=GEO):
        doc = json.loads(Path(path).read_text())
        self.source = doc['source']
        self.states = doc['states']
        self.counties = doc['counties']

    def state_of(self, lat, lng):
        for st, polys in self.states.items():
            if in_polygons(lat, lng, polys):
                return st
        return None

    def check_state(self, lat, lng, state, tolerance_mi=3.0):
        """('inside'|'near-boundary'|'outside', miles outside or 0)."""
        polys = self.states.get(state)
        if polys is None:
            return 'unknown-state', None
        if in_polygons(lat, lng, polys):
            return 'inside', 0.0
        d = boundary_distance_mi(lat, lng, polys, cutoff=50)
        return ('near-boundary' if d <= tolerance_mi else 'outside'), round(d, 2)

    def county_of(self, lat, lng, state):
        """(name, fips, miles to the county boundary) or (None, None, None)."""
        for c in self.counties:
            if c['state'] == state and in_polygons(lat, lng, c['polygons']):
                return c['name'], c['fips'], round(boundary_distance_mi(lat, lng, c['polygons'], cutoff=20), 2)
        return None, None, None


CITIES = Path(__file__).resolve().parent.parent / 'data' / 'geo' / 'cities-wwami.json'


def city_key(name):
    """Normalise a place name for lookup: case, diacritics, Saint/St., punctuation."""
    import unicodedata
    s = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode().lower()
    s = s.replace('saint ', 'st ').replace('st. ', 'st ').replace('mount ', 'mt ').replace('mt. ', 'mt ')
    return ''.join(ch for ch in s if ch.isalnum())


class Cities:
    """GeoNames town-centre points (data/geo/cities-wwami.json)."""

    def __init__(self, path=CITIES):
        doc = json.loads(Path(path).read_text())
        self.source = doc['source']
        self.index = {}
        for st, rows in doc['states'].items():
            for name, lat, lng in rows:
                self.index.setdefault((st, city_key(name)), []).append((name, lat, lng))

    def candidates(self, state, city):
        if not city:
            return []
        k = city_key(city)
        hits = self.index.get((state, k)) or []
        if not hits and k.endswith('city'):
            hits = self.index.get((state, k[:-4])) or []
        return hits

    def lookup(self, state, city, near=None):
        """(name, lat, lng) for a city in a state, or None. With several places of
        the same name, `near` (lat, lng) picks the closest; otherwise the first."""
        hits = self.candidates(state, city)
        if not hits:
            return None
        if near is None:
            return hits[0]
        return min(hits, key=lambda h: haversine_mi(near[0], near[1], h[1], h[2]))

    def nearest(self, state, lat, lng):
        """(name, lat, lng, miles) of the gazetteer place in `state` nearest the point."""
        best = None
        for (st, _), rows in self.index.items():
            if st != state:
                continue
            for name, a, b in rows:
                d = haversine_mi(lat, lng, a, b)
                if best is None or d < best[3]:
                    best = (name, a, b, d)
        return best
