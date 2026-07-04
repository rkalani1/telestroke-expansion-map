#!/usr/bin/env python3
"""Lightweight integrity checks for hospitals.json (no dependencies).

Mirrors the checks documented in METHODOLOGY.md §7 and the in-app
Data Quality panel. Run before any deploy:

    python3 scripts/verify-data.py

Exit code 0 = all checks pass; 1 = at least one failure.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "hospitals.json"
VALID_STATES = {"WA", "AK", "ID", "MT", "WY"}
VALID_TIERS = {"CSC", "TSC", "PSC", "ASR", None}

def main() -> int:
    payload = json.loads(DATA.read_text())
    hospitals = payload["hospitals"]
    failures = []

    def check(name, ok, detail=""):
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
        if not ok:
            failures.append(name)

    print(f"hospitals.json — {len(hospitals)} records, "
          f"version {payload.get('data_version')}, verified {payload.get('last_verified')}\n")

    ids = [h.get("cmsId") for h in hospitals]
    check("Every CMS ID unique", len(set(ids)) == len(ids),
          f"{len(set(ids))}/{len(ids)} unique")

    check("Every record geocoded (plausible lat/lon)",
          all(isinstance(h.get("latitude"), (int, float))
              and isinstance(h.get("longitude"), (int, float))
              and 24 <= h["latitude"] <= 72 and -180 <= h["longitude"] <= -100
              for h in hospitals))

    check("Every state in WA/AK/ID/MT/WY",
          all(h.get("state") in VALID_STATES for h in hospitals))

    check("Every certification tier valid (CSC/TSC/PSC/ASR/null)",
          all(h.get("strokeCertificationType") in VALID_TIERS for h in hospitals))

    adv = [h for h in hospitals if h.get("strokeCertificationType") in ("CSC", "TSC")]
    check("Every CSC/TSC has hasELVO = true",
          all(h.get("hasELVO") is True for h in adv), f"{len(adv)} CSC/TSC records")

    certified = [h for h in hospitals if h.get("strokeCertificationType")]
    check("Every certified hospital has a certifying body",
          all(h.get("certifyingBody") for h in certified), f"{len(certified)} certified")

    check("Every hospital has a populated city",
          all(h.get("city") for h in hospitals))

    # Informational missingness summary (not pass/fail — absence of a national
    # certification is a real data point, not an error)
    no_cert = sum(1 for h in hospitals if not h.get("strokeCertificationType"))
    evt = sum(1 for h in hospitals if h.get("hasELVO"))
    air_only = sum(1 for h in hospitals if h.get("airOnly"))
    print(f"\n  Info: {no_cert} hospitals without national certification, "
          f"{evt} EVT-capable, {air_only} flagged air-only")

    if failures:
        print(f"\n{len(failures)} check(s) FAILED")
        return 1
    print("\nAll checks passed")
    return 0

if __name__ == "__main__":
    sys.exit(main())
