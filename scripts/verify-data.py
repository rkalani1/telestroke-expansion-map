#!/usr/bin/env python3
"""Lightweight integrity checks for hospitals.json (no dependencies).

Mirrors the checks documented in METHODOLOGY.md §7 and the in-app
Data Quality panel. Run before any deploy:

    python3 scripts/verify-data.py

Exit code 0 = all checks pass; 1 = at least one failure.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "hospitals.json"
VALID_STATES = {"WA", "AK", "ID", "MT", "WY"}
VALID_TIERS = {"CSC", "TSC", "PSC", "ASR", None}
VALID_CLASSES = {"stroke-capability", "acute-care-census"}
VALID_BASES = {"national", "state", "both", "none", "not-assessed"}
VALID_ID_TYPES = {"ccn", "shared-ccn", "military"}
# CMS Certification Number state prefixes for the five states in scope.
CCN_PREFIX = {"AK": "02", "ID": "13", "MT": "27", "WA": "50", "WY": "53"}


def main() -> int:
    payload = json.loads(DATA.read_text())
    hospitals = payload["hospitals"]
    failures = []

    def check(name, ok, detail=""):
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
        if not ok:
            failures.append(name)

    assessed = [h for h in hospitals if h.get("recordClass") != "acute-care-census"]
    census = [h for h in hospitals if h.get("recordClass") == "acute-care-census"]

    print(f"hospitals.json — {len(hospitals)} records "
          f"({len(assessed)} assessed, {len(census)} census), "
          f"schema {payload.get('schema_version')}, "
          f"version {payload.get('data_version')}, verified {payload.get('last_verified')}\n")

    # ---- identity -------------------------------------------------------
    ids = [h.get("id") for h in hospitals]
    check("Every record id present and unique",
          all(ids) and len(set(ids)) == len(ids), f"{len(set(ids))}/{len(ids)} unique")

    own_ccns = [h["cmsId"] for h in hospitals
                if h.get("facilityIdType") == "ccn" and h.get("cmsId")]
    dupes = [c for c, n in Counter(own_ccns).items() if n > 1]
    check("Every self-owned CMS CCN unique", not dupes, f"duplicates: {dupes}" if dupes else
          f"{len(own_ccns)} CCNs")

    check("Every facilityIdType recognised",
          all(h.get("facilityIdType") in VALID_ID_TYPES for h in hospitals))

    bad_prefix = [f"{h['id']}({h['state']})" for h in hospitals
                  if h.get("cmsId") and re.fullmatch(r"\d{6}", h["cmsId"])
                  and not h["cmsId"].startswith(CCN_PREFIX[h["state"]])]
    check("Every CCN's state prefix matches its state",
          not bad_prefix, f"mismatched: {bad_prefix}" if bad_prefix else "")

    bad_format = [h["id"] for h in hospitals
                  if h.get("cmsId") and not re.fullmatch(r"\d{6}", h["cmsId"])]
    check("Every CMS CCN is six digits (synthetic ids are cmsId=null)",
          not bad_format, f"malformed: {bad_format}" if bad_format else "")

    # ---- geometry -------------------------------------------------------
    check("Every record geocoded (plausible lat/lon)",
          all(isinstance(h.get("latitude"), (int, float))
              and isinstance(h.get("longitude"), (int, float))
              and 24 <= h["latitude"] <= 72 and -180 <= h["longitude"] <= -100
              for h in hospitals))

    check("Every state in WA/AK/ID/MT/WY",
          all(h.get("state") in VALID_STATES for h in hospitals))

    # ---- record classes -------------------------------------------------
    check("Every recordClass recognised",
          all(h.get("recordClass") in VALID_CLASSES for h in hospitals))

    check("Every certificationBasis recognised",
          all(h.get("certificationBasis") in VALID_BASES for h in hospitals))

    # A census record asserting a certification would be a fabricated claim.
    check("No census record asserts stroke capability",
          all(h.get("strokeCertificationType") is None and h.get("hasELVO") is False
              and h.get("certificationBasis") == "not-assessed" for h in census),
          f"{len(census)} census records")

    check("Every assessed record has a definite EVT flag",
          all(isinstance(h.get("hasELVO"), bool) for h in assessed))

    # ---- certification --------------------------------------------------
    check("Every certification tier valid (CSC/TSC/PSC/ASR/null)",
          all(h.get("strokeCertificationType") in VALID_TIERS for h in hospitals))

    adv = [h for h in assessed if h.get("strokeCertificationType") in ("CSC", "TSC")]
    check("Every CSC/TSC has hasELVO = true",
          all(h.get("hasELVO") is True for h in adv), f"{len(adv)} CSC/TSC records")

    certified = [h for h in assessed if h.get("strokeCertificationType")]
    check("Every certified hospital has a certifying body",
          all(h.get("certifyingBody") for h in certified), f"{len(certified)} certified")

    # certificationBasis must agree with the structured certification fields.
    inconsistent = []
    for h in assessed:
        nat = bool(h.get("nationalCertification"))
        st = bool(h.get("stateDesignation"))
        expected = ("both" if nat and st else "national" if nat
                    else "state" if st else "none")
        if h.get("certificationBasis") != expected:
            inconsistent.append(h["id"])
    check("certificationBasis agrees with national/state fields",
          not inconsistent, f"inconsistent: {inconsistent[:6]}" if inconsistent else "")

    check("Every assessed hospital has a populated city",
          all(h.get("city") for h in assessed))

    # ---- geometry vs. stated locality ----------------------------------
    # A hospital plotted in the wrong town silently corrupts every transport
    # estimate derived from it. Needs the optional `zipcodes` package.
    try:
        import zipcodes  # noqa: F401
    except ImportError:
        print("  [SKIP] Coordinates agree with stated city — "
              "install `zipcodes` to enable this check")
    else:
        from math import radians, sin, cos, asin, sqrt

        def hav(a, b, c, d):
            a, b, c, d = map(radians, (a, b, c, d))
            return 3959 * 2 * asin(sqrt(sin((c - a) / 2) ** 2
                                        + cos(a) * cos(c) * sin((d - b) / 2) ** 2))

        def key(s):
            return re.sub(r"[^a-z]", "", (s or "").lower())

        centroids = {}
        for z in zipcodes.list_all():
            if z["state"] not in VALID_STATES or not (z["lat"] and z["long"] and z["active"]):
                continue
            for nm in [z["city"]] + list(z.get("acceptable_cities") or []):
                centroids.setdefault((z["state"], key(nm)), []).append(
                    (float(z["lat"]), float(z["long"])))

        strays = []
        for h in hospitals:
            pts = centroids.get((h["state"], key(h.get("city"))))
            if not pts:
                continue
            off = min(hav(h["latitude"], h["longitude"], la, lo) for la, lo in pts)
            if off > 18:
                strays.append(f'{h["id"]} {h.get("city")},{h["state"]} {off:.0f}mi')
        check("Coordinates agree with stated city (within 18 mi)",
              not strays, f"stray: {strays}" if strays else f"{len(hospitals)} records")

    # ---- informational --------------------------------------------------
    no_cert = sum(1 for h in assessed if not h.get("strokeCertificationType"))
    evt = sum(1 for h in hospitals if h.get("hasELVO"))
    air_only = sum(1 for h in hospitals if h.get("airOnly"))
    state_only = sum(1 for h in assessed if h.get("certificationBasis") == "state")
    derived_city = sum(1 for h in hospitals if h.get("cityConfidence") == "coordinate-derived")
    by_state = Counter(h["state"] for h in hospitals)
    print(f"\n  Info: {no_cert} assessed hospitals with no certification on record, "
          f"{evt} EVT-capable, {air_only} flagged air-only")
    print(f"  Info: {state_only} records whose displayed tier rests on a STATE designation only")
    print(f"  Info: {derived_city} census records with a coordinate-derived city")
    print(f"  Info: by state — {dict(sorted(by_state.items()))}")

    if failures:
        print(f"\n{len(failures)} check(s) FAILED")
        return 1
    print("\nAll checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
