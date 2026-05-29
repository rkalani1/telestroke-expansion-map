# Methodology

*Last updated: 2026-05-21 · data version 2026.05.21.3*

This document describes how hospital records, stroke certifications, and transport-time estimates are determined in this project.

---

## 1. Scope

The dataset covers acute-care hospitals in the WWAMI region (Washington, Alaska, Idaho, Montana, Wyoming) that meet at least one of the following criteria:

1. Currently hold a **national stroke certification** (CSC, TSC, PSC, or ASR) from Joint Commission, DNV, ACHC, or CIHQ.
2. Hold a state-level stroke designation equivalent to one of the above (e.g., Idaho TSE Level I/II/III).

This is **not** a complete census of every acute-care hospital in the five states. Montana and Wyoming in particular have many additional critical-access hospitals not currently in scope. The coverage model is focused on hospitals with known stroke capabilities.

As of 2026-05-21, the dataset contains **132 hospitals**: WA 88, AK 10, ID 24, MT 8, WY 2.

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

Geocoding: addresses were forward-geocoded via the [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/) service; each record includes the resulting latitude/longitude.

## 3. Certification nomenclature

| Tier | Joint Commission | DNV | ACHC | CIHQ | Common name in this app |
|------|------------------|-----|------|------|-------------------------|
| CSC | ✓ ("Comprehensive Stroke Center") | ✓ ("Comprehensive Stroke Center") | ✓ | — | **CSC** |
| TSC | ✓ ("Thrombectomy-Capable") | **"PSC+" / "Primary Plus"** | ✓ | — | **TSC** |
| PSC | ✓ | ✓ | ✓ | ✓ | **PSC** |
| ASR | **"ASRH"** | ✓ | ✓ | ✓ | **ASR** |

**EVT** ("endovascular thrombectomy") is not a separate tier but a clinical capability. All CSCs and TSCs provide 24/7 EVT; some PSCs provide EVT as well without holding full TSC certification. In this app, the `hasELVO` flag tracks 24/7 EVT capability independently of the written certification tier, because what matters for stroke-system planning is whether the facility can perform thrombectomy — not which tier label is attached.

### DNV 2025 update

Effective 2025-08-01, DNV consolidated its stroke certification standards into a single **"Integrated Stroke Program Requirements 25-0"** manual, replacing separate ASR, PSC, PSC+, and CSC manuals. The tier names and clinical requirements are unchanged.

## 4. Recent verified changes (2025–2026)

| Hospital | Change | Evidence |
|----------|--------|----------|
| **Providence Alaska Medical Center** | Upgraded from DNV PSC → DNV CSC (2025-03-06) | Providence press release, Mar 2025 |
| **Kootenai Health** (Coeur d'Alene, ID) | Dataset corrected: only holds Idaho TSE Level II state designation, not national JC/DNV PSC | `kh.org/neurology/stroke/` |

Verification methodology: each certification was cross-checked against at least two of (Joint Commission Quality Check, DNV directory, Idaho TSE registry, hospital website, hospital press release).

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
- **Air speed 150 mph** is a blended helicopter (LifeFlight / Airlift NW) and fixed-wing speed; 25-minute overhead covers dispatch, preflight, takeoff, landing, and bedside handoff.
- **Best transport** is the min of both modes — real decisions depend on weather, asset availability, crew duty cycles, and patient stability.

For the **door-to-puncture window**, the detail modal adds a ~30-minute **door-in-door-out (DIDO)** estimate to the transport time. AHA Get-With-The-Guidelines-Stroke target for transferred patients is ≤90 min door-to-puncture; ≤120 min is the "acceptable" stretch target.

**These numbers are not a substitute for live dispatch.** They exist to inform network-planning decisions, not patient-care decisions.

## 6. Data integrity

The `hospitals.json` file includes provenance metadata:

```json
{
  "schema_version": "2.0.0",
  "data_version": "2026.05.21.3",
  "last_verified": "2026-05-21",
  "generated_at": "2026-05-21T09:37:20.505663Z",
  "primary_sources": [ … ],
  "coverage_note": "…",
  "certification_definitions": { … },
  "certifying_bodies": { … },
  "hospitals": [ … 132 records … ]
}
```

Each hospital record includes:

- `cmsId` (CMS Certification Number — unique across all 132)
- `name`, `address`, `city`, `state`, `zip`
- `latitude`, `longitude`, `geocoded`, `geocodeSource`
- `strokeCertificationType` (CSC/TSC/PSC/ASR/null)
- `certifyingBody`, `certificationDetails`
- `hasELVO` (24/7 thrombectomy capability)
- `dataSources[]`, `verified`

Integrity checks enforced at build time:

- Every CMS ID is unique (no duplicates).
- Every hospital has valid `latitude`/`longitude`.
- Every hospital has a populated `city`.
- Every CSC and TSC has `hasELVO = true`.
- Every certified hospital has a `certifyingBody`.

## 7. Limitations

- **Not a live feed.** Certifications change on 2-3 year cycles; we do periodic refresh, not real-time tracking.
- **Scope-limited.** Does not include every acute-care hospital in the five states; see §1.
- **Straight-line geometry.** No road-network routing, no real-time traffic, no weather-adjusted air transport.
- **No population weighting.** EVT-desert analysis does not account for population density; a 100-mile gap in western MT affects far fewer people than a 100-mile gap in suburban WA.
- **State designations vs. national.** Idaho TSE Level II and JC PSC are clinically similar but not legally equivalent; the app labels both as "PSC"-tier in certification type and notes the state designation in the `certifyingBody` / `certificationDetails` fields.

## 8. How to contribute

- **Data corrections:** open an issue with the hospital CMS ID, the proposed change, and the source URL.
- **Code improvements:** open a PR. The app is pure static JS/CSS; no build step required.
- **New features:** feature proposals should serve that workflow.
