# Methodology

*Last updated: 2026-05-27 · synthetic data version 2026.05.27.synthetic*

This document describes the synthetic facility dataset, capability tiers, EVT flag, and transport-time estimates used in the public demo.

---

## 1. Scope

The public dataset contains 132 synthetic facilities spread across five sample state buckets: WA, AK, ID, MT, and WY. The records are not real site records. Names, street addresses, exact coordinates, source links, and operational relationship fields have been removed or replaced with synthetic values.

## 2. Synthetic data construction

The demo keeps the shape needed to test the application:

- a unique synthetic ID for each record;
- a generic display name;
- a synthetic region label;
- approximate, non-site-specific coordinates within broad state bounds;
- stroke capability tier;
- EVT capability flag;
- optional air-only routing flag for transfer-model testing.

The data should be treated as sample data for UI, accessibility, export, and transport-model demonstrations only.

## 3. Capability nomenclature

| Tier | Meaning in this demo |
|------|----------------------|
| CSC | Highest demonstration capability tier. |
| TSC | Demonstration thrombectomy-capable tier. |
| PSC | Demonstration primary stroke tier. |
| ASR | Demonstration acute stroke-ready tier. |
| EVT | Demonstration thrombectomy capability flag. |

The labels are capability abstractions for the demo. They are not assertions about any real site.

## 4. Transport-time estimates

Transport times shown in popups, detail modals, and exports are order-of-magnitude demo estimates using this model:

```
great_circle_mi = haversine(A, B)

ground_minutes = (great_circle_mi x 1.25) / 55 mph x 60 + 8
air_minutes    =  great_circle_mi / 150 mph x 60 + 25
best_minutes   = min(ground_minutes, air_minutes)
```

Assumptions:

- Road factor 1.25 converts great-circle distance to an approximate road-distance proxy.
- Ground speed 55 mph is a blended effective transport speed.
- Air speed 150 mph is a blended fixed-wing/helicopter proxy.
- Overhead values represent dispatch, loading, takeoff/landing, and handoff time.

These numbers are not a substitute for live dispatch, routing, or operational decision-making.

## 5. Capability-gap scoring

The public capability-gap ranking tool scores each synthetic facility using demo fields only:

```
score =   w_noCert · [no certification]
        + w_farCSC · [> 75 mi from CSC/TSC]
        + w_farEVT · [> 100 mi from EVT]
        + w_hasLow · [ASR or PSC]
```

Default weights are illustrative. Higher score means a larger synthetic capability gap in the demo dataset.

## 6. Data integrity

The `facilities.json` file includes metadata plus 132 synthetic records. Integrity checks expected by the app:

- every synthetic ID is unique;
- every record has latitude and longitude;
- every record has a synthetic region label;
- every CSC and TSC record has `hasELVO = true`;
- every certified record has a capability body label.

## 7. Limitations

- The dataset is synthetic and should not be compared to real-world site coverage.
- Coordinates are broad demo placements, not exact locations.
- No road-network routing, traffic, weather, staffing, or asset availability is modeled.
- Exports are for demonstration only.

## 8. Contributions

Public contributions should preserve the synthetic boundary. Do not add named site data, exact addresses, operational relationships, or restricted data to this public repository.
