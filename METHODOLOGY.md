# Methodology

*Last updated: 2026-08-15 · schema 3.0.0 · data version 2026.08.15.1*
*Stroke capability verified 2026-07-04 (watch-list re-checked 2026-07-18); acute-care census snapshot Oct 2023*

This document describes how hospital records, stroke certifications, and transport-time estimates are determined in this project.

---

## 1. Scope and record classes

The dataset covers the WWAMI region (Washington, Alaska, Idaho, Montana, Wyoming) and holds **two classes of record**. The distinction is load-bearing: it is the difference between "we checked and found no certification" and "we have not checked".

### `stroke-capability` — 135 records

Hospitals whose stroke capability has been individually verified against primary sources. A hospital qualifies if it:

1. Currently holds a **national stroke certification** (CSC, TSC, PSC, or ASR) from Joint Commission, DNV, ACHC, or CIHQ; or
2. Holds a state-level stroke designation (WA ECS Level I/II/III, Idaho TSE Level I/II/III); or
3. Was checked and found to hold neither — recorded as `strokeCertificationType: null` with `certificationBasis: "none"`.

Distribution: WA 88, ID 27, AK 10, MT 8, WY 2.

### `acute-care-census` — 101 records

Every remaining Medicare-certified acute-care and critical-access hospital in the five states, from the CMS acute-care census. These exist so that a call from any hospital in the region resolves to a record with a location, a facility profile, and a transfer picture.

Their stroke capability has **not** been assessed. They carry `strokeCertificationType: null`, `hasELVO: false` and `certificationBasis: "not-assessed"`, and the application:

- renders them hollow on the map, in a distinct colour, at a smaller radius;
- badges them "Not assessed" in the sidebar list and in the nearby-hospitals list;
- shows a banner on the detail view stating that no certification on file means unknown, not none;
- excludes them from certification counts, coverage-gap metrics, the zero-capability view, and expansion-candidate scoring;
- never treats them as a hub in nearest-CSC/TSC or nearest-EVT calculations.

Distribution: MT 51, WY 25, ID 17, AK 5, WA 3.

**Total: 236 records** — WA 91, MT 59, ID 44, WY 27, AK 15.

### What is still out of scope

- 19 CMS census rows for the five states carry no coordinates and could not be plotted (listed in `data/verification-worklist.csv`).
- Facilities with no CMS Certification Number are only present where curated by hand (e.g. Madigan Army Medical Center); the census cannot supply them.
- The census snapshot is from Oct 2023, so hospitals opened since are absent and closures may persist.

## 2. Data sources

Each hospital record is derived from, and cross-checked against, these primary sources:

| Source | Purpose |
|--------|---------|
| **CMS Hospital General Information** (Nov 2024) | Provider identity (CMS CCN), official name, street address |
| **The Joint Commission Quality Check** | CSC, TSC, PSC, ASRH certifications |
| **DNV Healthcare Accredited Organizations Directory** | CSC, PSC+ (TSC-equivalent), PSC, ASR certifications |
| **Idaho TSE System** | Idaho state Level I / II / III designations |
| **Washington State DOH** | ECS facility list, state stroke designations |
| **Hospital websites & press releases** | Recent certification changes, thrombectomy capability |
| **CMS Hospital General Information** (Oct 2023 snapshot) | Acute-care census: CCN, facility name, hospital type, ownership, bed count, coordinates |

The Oct 2023 CMS snapshot is vendored at `data/cms-census-wwami-2023-10.csv` (253 rows) so the build is reproducible without network access. It is used for **facility identity only** — no stroke-capability claim is ever derived from it.

Geocoding: addresses were forward-geocoded via the [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/) service; each record includes the resulting latitude/longitude.

## 3. Certification nomenclature

| Tier | Joint Commission | DNV | ACHC | CIHQ | Common name in this app |
|------|------------------|-----|------|------|-------------------------|
| CSC | ✓ ("Comprehensive Stroke Center") | ✓ ("Comprehensive Stroke Center") | ✓ | — | **CSC** |
| TSC | ✓ ("Thrombectomy-Capable") | **"PSC+" / "Primary Plus"** | ✓ | — | **TSC** |
| PSC | ✓ | ✓ | ✓ | ✓ | **PSC** |
| ASR | **"ASRH"** | ✓ | ✓ | ✓ | **ASR** |

**EVT** ("endovascular thrombectomy") is not a separate tier but a clinical capability. All CSCs and TSCs provide 24/7 EVT; some PSCs provide EVT as well without holding full TSC certification. In this app, the `hasELVO` flag tracks 24/7 EVT capability independently of the written certification tier, because what matters for stroke-system planning is whether the facility can perform thrombectomy — not which tier label is attached.

### National certification vs. state designation

These are different things and the dataset now keeps them apart. Every record carries:

- `nationalCertification` — `{body, tier, details}` when a national accreditor (Joint Commission, DNV, ACHC, CIHQ) certifies the site, else `null`.
- `stateDesignation` — `{system, level, label}` when a state stroke system designates it (`WA ECS Level II`, `Idaho TSE Level III`, …), else `null`.
- `certificationBasis` — `national` · `state` · `both` · `none` · `not-assessed`.
- `strokeCertificationType` — the **display tier**, which for a state-only site is this project's mapping of a state level onto the national ladder.

Of the 135 assessed records, **67 display a tier that rests on a state designation alone** (49 ASR, 16 PSC, 1 CSC, 1 TSC), 46 are national-only, 3 hold both, and 19 hold neither. Because a state level is not a national certification, the detail view labels these explicitly and the sidebar row carries a dashed state badge. Idaho TSE Level II and Joint Commission PSC are clinically similar but not legally equivalent; the two CSC/TSC-level records resting on a state designation alone are flagged P1 in the verification worklist.

### DNV 2025 update

Effective 2025-08-01, DNV consolidated its stroke certification standards into a single **"Integrated Stroke Program Requirements 25-0"** manual, replacing separate ASR, PSC, PSC+, and CSC manuals. The tier names and clinical requirements are unchanged.

## 4. Recent verified changes (2025–2026)

| Hospital | Change | Evidence |
|----------|--------|----------|
| **PeaceHealth Southwest, Kadlec, MultiCare Deaconess, Providence St Peter** (WA) | `hasELVO` corrected to false — no 24/7-ELVO asterisk on the WA DOH ECS list (May 2026 rev.) and each hospital's current pages make no 24/7 thrombectomy claim (St Peter's program re-established spring 2025 with explicitly partial coverage per Providence) | WA DOH 345-299 (May 2026); hospital/system websites; Providence blog 2025-04-09 |
| **Cheyenne Regional Medical Center** (WY) | Certification detail verified: JC Advanced Primary Stroke Center recertified June 2025 | Joint Commission directory; hospital press release |
| **PeaceHealth Peace Island Medical Center** (Friday Harbor, WA) | New Washington State Level III Stroke Center designation (announced 2026-06-08) | WA DOH ECS list DOH 345-299 (May 2026 rev.); PeaceHealth announcement |
| **Cassia Regional** (Burley), **Minidoka Memorial** (Rupert), **Teton Valley** (Driggs) | Added — Idaho TSE Level III Stroke Centers (registry updated 2026-06-10) missing from prior editions | Idaho TSE Facility Designations registry; hospital websites |
| **EIRMC / St Luke's Magic Valley / St Luke's McCall** | CMS CCN corrections (130004→130018, 131312→130002, 131326→131312) — prior IDs misassigned | Live CMS Hospital General Information API (2026-07-03) |
| **Providence Alaska Medical Center** | Upgraded from DNV PSC → DNV CSC (2025-03-06) | Providence press release, Mar 2025 |
| **Kootenai Health** (Coeur d'Alene, ID) | Dataset corrected: only holds Idaho TSE Level II state designation, not national JC/DNV PSC | `kh.org/neurology/stroke/` |

### 2026-07-03 currency re-verification

The full dataset was re-verified on 2026-07-03: all 88 WA records diffed against the WA DOH ECS list
(DOH 345-299, May 2026 revision), all Idaho records diffed against the Idaho TSE Facility Designations
registry (updated 2026-06-10), all certified AK/MT/WY records checked against certifier directories,
hospital sites, and press coverage, and a five-state press sweep (2026-05-01 → 2026-07-03) found no
additional certification changes. Every applied change required two independent public sources. On 2026-07-04 the remaining open items
were adjudicated: four WA `hasELVO` flags were corrected (see table), and three registry-vs-hospital-site
conflicts (Samaritan Moses Lake possible WA Stroke Level II, East Adams possible ECS list removal,
Idaho Falls Community possible TSE Level III→II upgrade) were deliberately retained at their prior
verified values pending a second confirming source — state registries typically lead hospital-site
updates, so these are re-check candidates for the next data pass.

Verification methodology: each certification was cross-checked against at least two of (Joint Commission Quality Check, DNV directory, Idaho TSE registry, hospital website, hospital press release).

### 2026-07-18 watch-list re-check

Targeted re-check of the items left open on 2026-07-04, plus a five-state press sweep
(2026-07-04 → 2026-07-18) that found no new certification or EVT-capability changes.
This was not a full-dataset re-verification, so `last_verified` remains 2026-07-04.

| Item | Outcome |
|------|---------|
| **Cheyenne Regional Medical Center** CCN | **Corrected 530001 → 530014.** CMS Open Payments hospital registry, Medicare Care Compare, and the American Hospital Directory all list CRMC under CCN 530014; no source found for 530001. Two-source bar met → applied. |
| **Samaritan (Moses Lake)** possible WA Stroke Level II | Still single-source (WA DOH ECS list, May 2026 rev.). Press coverage of the new hospital (opened 2026-03-07) does not mention a stroke designation. **OPEN — retained no-certification.** |
| **East Adams Rural (Ritzville)** possible ECS removal | Rural Emergency Hospital conversion confirmed by regional press (approved ~2026-03); hospital site still claims WA Level III Stroke. DOH-list absence remains single-source for removal. **OPEN — retained ASR; re-check after REH transition settles.** |
| **Idaho Falls Community** possible TSE Level III→II | Hospital site still says Level III; no second source for the registry's Level II. **OPEN — retained Level III.** |

## 5. Transport-time estimates

Transport times shown in popups, detail modals, and exports are **order-of-magnitude planning estimates** using this model:

```
great_circle_mi = haversine(A, B)             # earth radius 3959 mi

ground_minutes  = (great_circle_mi × 1.25) / 55 mph × 60 + 8   # road factor + overhead
air_minutes     =  great_circle_mi / 150 mph × 60 + 25          # dispatch + takeoff/land
best_minutes    = min(ground_minutes, air_minutes)
```

Assumptions:

- **Road factor 1.25** converts great-circle to approximate road distance in varied western terrain. This is conservative for urban corridors and may underestimate mountain routes in MT/ID/WY.
- **Ground speed 55 mph** is a blended rural/urban ambulance speed with lights; 8-minute overhead covers dispatch, onsite load, and hospital unload.
- **Air speed 150 mph** is a blended rotor-wing and fixed-wing air-medical speed; 25-minute overhead covers dispatch, preflight, takeoff, landing, and bedside handoff.
- **Best transport** is the min of both modes — real decisions depend on weather, asset availability, crew duty cycles, and patient stability.

For the **door-to-puncture window**, the detail modal adds a ~30-minute **door-in-door-out (DIDO)** estimate to the transport time. AHA Get-With-The-Guidelines-Stroke target for transferred patients is ≤90 min door-to-puncture; ≤120 min is the "acceptable" stretch target.

**These numbers are not a substitute for live dispatch.** They exist to inform network-planning decisions, not patient-care decisions.

## 6. Expansion-candidate scoring

The **Expansion Candidates** view (press `E` in the app) ranks potential telestroke spoke sites. The score is computed entirely in the browser from fields already in `hospitals.json` — it adds no new claims about any hospital and never modifies the dataset.

**Eligibility.** Hospitals that are EVT-capable (`hasELVO = true`) or hold CSC/TSC certification are hubs, not spoke candidates, and are excluded from the ranking. **Acute-care census records are also excluded**: scoring a facility whose stroke capability was never assessed would manufacture a certification gap out of missing data. 113 of the 236 records are eligible.

**Model.** Each eligible hospital gets a 0–100 score from three normalized signals under scenario weights `w`:

```
certGap = 1.0 if no certification · 0.65 if ASR · 0.35 if PSC
evtGap  = min(miles_to_nearest_EVT,    cap) / cap
advGap  = min(miles_to_nearest_CSCTSC, cap) / cap

score = 100 × (w_cert·certGap + w_evt·evtGap + w_adv·advGap) / (w_cert + w_evt + w_adv)
        + 8 if the record is flagged air-only          (clamped to 100)
```

Defaults: `w_cert = 40`, `w_evt = 40`, `w_adv = 20`, `cap = 200 mi`, EVT-desert threshold 100 mi. All five are adjustable in **scenario mode**; scenario settings are encoded in the URL (`wc`, `we`, `wa`, `dm`, `cap` query parameters) so a scenario can be shared as a link.

**Rationale for the certification-gap ladder.** A hospital with no national certification has the largest documented gap between current state and telestroke-supported acute stroke care; ASR sites have foundational capability but depend on transfer and teleconsultation; PSC sites already deliver thrombolysis independently. The 1.0 / 0.65 / 0.35 spacing is a planning judgment, not a clinical measurement — which is exactly why it is user-adjustable.

**What the score is not.** It does not assess clinical operations, staffing, stroke case volume, existing telestroke contracts, payer mix, or population served. It has **no population weighting** (see §8). It is a conversation-starter for network planning, not a site-selection verdict.

## 7. Data integrity

`hospitals.json` carries provenance metadata:

```json
{
  "schema_version": "3.0.0",
  "data_version": "2026.08.15.1",
  "last_verified": "2026-07-04",
  "generated_at": "…",
  "primary_sources": [ … ],
  "census_snapshot": { "source": …, "as_of": "2023-10", "file": …, "note": … },
  "record_classes": { "stroke-capability": …, "acute-care-census": … },
  "certification_definitions": { … },
  "certifying_bodies": { … },
  "hospitals": [ … 236 records … ]
}
```

### Record identity

`id` is the primary key and is stable; `cmsId` is the CMS Certification Number and may be `null` or shared. `facilityIdType` says which case applies:

| `facilityIdType` | Meaning | Example |
|---|---|---|
| `ccn` | Has its own CMS CCN | most records |
| `shared-ccn` | Provider-based campus billing under a parent's CCN | St Luke's Meridian, on Boise's `130006` |
| `military` | Not a Medicare-certified provider, so no CCN exists | Madigan Army Medical Center |

Earlier editions used synthetic identifiers (`50005F`, `130006-M`) in the `cmsId` field, which the UI then displayed as "CMS ID". Both are now modelled honestly, and distance calculations key on `id` rather than `cmsId` — previously Madigan keyed on a null and Meridian collided with Boise.

### CMS Certification Number corrections

Five CCNs in the dataset appear in **no** CMS Hospital General Information snapshot from 2013 to 2023, while a facility with a matching name sits at the same coordinates under a different CCN:

| Was | Now | Facility | Evidence |
|---|---|---|---|
| 270002 | **270017** | St James Healthcare, Butte MT | CMS lists it under 270017, 0.07 mi from our coordinates |
| 270017 | **270049** | St Vincent Healthcare, Billings MT | CMS lists it under 270049, 0.17 mi away; 270017 is St James |
| 270024 | **270051** | Logan Health Medical Center, Kalispell MT | CMS 2023-10 name matches exactly, 0.10 mi away |
| 500010 | **500108** | St Joseph Medical Center, Tacoma WA | CMS lists it under 500108, 0.03 mi away |
| 500115 | **500039** | St Michael Medical Center, Silverdale WA | CMS 500039 "Harrison Medical Center", renamed and relocated from Bremerton in 2020 |

Each superseded value is retained on the record in `cmsIdCorrectedFrom` with the reasoning in `cmsIdNote`.

### Geocoding

Six records were plotted in the wrong place, which silently corrupts every distance and transport estimate derived from them:

| Record | Stated city | Error |
|---|---|---|
| Garfield County PHD #1 | Pomeroy, WA | 264 mi — coordinates were near Anacortes |
| Ocean Beach Hospital | Ilwaco, WA | 240 mi — a coastal hospital plotted in the Columbia Basin |
| Newport Community Hospital | Newport, WA | 45 mi |
| Arbor Health Morton Hospital | Morton, WA | 40 mi — coordinates were at Joint Base Lewis-McChord |
| Mason General Hospital | Shelton, WA | 39 mi |
| Cascade Medical Center | Cascade, ID | 23 mi |

All six are relocated to their city's ZIP centroid, marked `geocodePrecision: "approximate"` with `geocodeSource: "City centroid (ZIP code area)"`, and retain the original coordinates in `geocodeCorrectedFrom`. A centroid is imprecise but is not wrong by a county. All six are P1 in the verification worklist for a street-level re-geocode.

The tolerance is 18 miles, chosen because real western-US hospitals sit up to ~12 mi from their mailing city's centroid — Madigan posts a Tacoma address from Joint Base Lewis-McChord, 12.1 mi out — while every genuine error found was off by 23 mi or more.

City and county on census records are inferred from the CMS coordinates against an offline ZIP database, flagged `cityConfidence` as `name-corroborated`, `coordinate-derived`, or `unresolved`. Where no town centroid sits within 12 mi, no city is asserted: a wrong town name is worse than none. County on curated records is only set when the lookup independently reproduces the city already on file.

### Checks

Run `python3 scripts/verify-data.py`; the same checks run live in the app's Data Quality panel (press `Q`). 17 checks:

**Identity** — every `id` present and unique · every self-owned CCN unique · every `facilityIdType` recognised · every CCN's state prefix matches its state (AK 02, ID 13, MT 27, WA 50, WY 53) · every CCN is six digits.

**Geometry** — every record geocoded with plausible coordinates · every state in scope · every record's coordinates within 18 mi of the city it names *(requires `pip install zipcodes`; skipped otherwise)*.

**Classes** — every `recordClass` and `certificationBasis` recognised · **no census record asserts stroke capability** · every assessed record has a definite EVT flag.

**Certification** — every tier valid · every CSC/TSC has `hasELVO = true` · every certified hospital has a certifying body · `certificationBasis` agrees with the `nationalCertification`/`stateDesignation` fields · every assessed hospital has a populated city.

### Rebuilding

`scripts/build-dataset.py` is idempotent and regenerates `hospitals.json` from the curated records plus the vendored census. `scripts/build-worklist.py` regenerates `data/verification-worklist.csv`.

## 8. Limitations

- **Not a live feed.** Certifications change on 2-3 year cycles; we do periodic refresh, not real-time tracking.
- **Two different currencies in one file.** Stroke capability was verified 2026-07-04; facility identity for census records comes from an Oct 2023 CMS snapshot. A hospital that opened, closed, or was renamed since 2023 may be missing or stale. Every record states which class it belongs to.
- **Capability unknown is not capability absent.** 101 of 236 records have never been assessed for stroke capability. The app marks them everywhere, but the distinction only works if the reader honours it.
- **Census cities are inferred.** City and county on census records are derived from CMS coordinates against a ZIP centroid database, not from a street address. Roughly one in ten lands on a neighbouring town; each carries a `cityConfidence` flag, and the map marker is on the CMS coordinates regardless.
- **Six approximate locations.** The records relocated in §7 sit at a city centroid, not a street address, so their distances carry up to a few miles of error until re-geocoded.
- **Scope-limited.** 19 CMS census rows lack coordinates and are absent from the map; facilities without a CMS CCN are only present where curated by hand. See §1.
- **Straight-line geometry.** No road-network routing, no real-time traffic, no weather-adjusted air transport.
- **No population weighting.** EVT-desert analysis does not account for population density; a 100-mile gap in western MT affects far fewer people than a 100-mile gap in suburban WA.
- **State designations vs. national.** Idaho TSE Level II and JC PSC are clinically similar but not legally equivalent. 67 of 135 assessed records display a tier derived from a state designation alone; see §3. The tier is this project's mapping, not an accreditor's finding.
- **Scoring is a heuristic.** The expansion-candidate score (§6) reflects only certification tier and distance geometry from the public dataset. Two hospitals with identical scores can differ enormously in feasibility.

## 9. How to contribute

- **Data corrections:** open an issue with the hospital CMS ID, the proposed change, and the source URL.
- **Code improvements:** open a PR. The app is pure static JS/CSS; no build step required.
- **New features:** feature proposals should serve that workflow.
