# Regional Hospital Stroke Capabilities

Interactive map of stroke-center certifications and acute-care hospitals across the WWAMI region (Washington · Alaska · Idaho · Montana · Wyoming), built so a vascular neurologist, fellow, or resident on call can look up **any** hospital in the region and get its capability and transfer picture in one view. (The repository name, `telestroke-expansion-map`, reflects the planning use case; the product itself is a public-source capability reference.)

**Live site:** https://rkalani1.github.io/telestroke-expansion-map/

![Map screenshot](https://img.shields.io/badge/status-live-success) ![License](https://img.shields.io/badge/license-MIT-blue) ![Data](https://img.shields.io/badge/data-verified%20July%202026-informational) ![Records](https://img.shields.io/badge/hospitals-236-blue)

---

## Two classes of record

Every hospital on the map is one of two kinds, and the difference is stated everywhere it matters — marker shape, list badge, detail banner, exports, and every statistic:

| Class | What it means | Count |
|-------|---------------|-------|
| **Stroke capability** | Certification individually verified against primary sources. A blank certification here means *checked, none found*. | 135 |
| **Acute-care census** | Facility identity from the CMS acute-care census, so every hospital in the region is findable. Stroke capability **has not been assessed** — blank means *unknown*, not *none*. | 101 |

Census records never assert a tier or an EVT flag, are excluded from every capability statistic and from expansion-candidate scoring, and still get full transport analysis — the geometry is known even where the capability is not.

## What it does

- Maps every hospital in the dataset with color-coded markers by certification tier (CSC / TSC / PSC / ASR) and visible badges for 24/7 thrombectomy (EVT) capability.
- **Separates national accreditation from state designation.** 67 of the 135 assessed records display a tier derived from a WA ECS or Idaho TSE state designation alone, with no national accreditation on record. The detail view says so in as many words, and the list row carries a dashed state badge — a WA ECS Level III should never be read as a Joint Commission ASR.
- **Finds hospitals by what clinicians actually call them.** Search covers spoken shorthand (`HMC`, `Harborview`, `Sacred Heart`, `St V`), county, health system, facility type, and city — not just the official CMS name.
- Computes, for each hospital, distance and estimated ground/air transport time to the nearest CSC/TSC and nearest EVT center.
- Identifies **EVT deserts** (hospitals beyond a configurable distance from 24/7 thrombectomy) and **zero-capability** hospitals (no national certification — also available as a "None" filter pill).
- **Expansion candidates (press `E`)**: ranks non-EVT, non-CSC/TSC hospitals by a transparent planning heuristic (certification gap, distance to EVT, distance to CSC/TSC), with a per-site "Why?" breakdown showing exactly how each score was computed, nearest-center names, and ground/air estimates.
- **Scenario mode**: adjust the scoring weights, EVT-desert threshold, and distance cap with sliders and watch the ranking re-order live. Scenario settings are display-layer only — the source dataset is never modified — and are encoded in the URL so a scenario can be shared as a link.
- **Data quality panel (press `Q`)**: data version, verification date, per-field completeness, integrity checks run live in the browser, model assumptions, and primary-source list.
- Exports: CSV of the **currently filtered** hospitals, CSV of the ranked expansion candidates (scenario-stamped filename), CSV of the full distance matrix, PNG of the current map view, and an executive summary as `.txt`, clipboard, or **print one-pager**.
- Shareable URL: every filter, search term, scenario parameter, palette, and viewport is encoded in the query string.

## Certification tiers

| Tier | Meaning | Certifying bodies |
|------|---------|-------------------|
| **CSC** | Comprehensive Stroke Center — 24/7 neurosurgery, neuro-ICU, EVT, complex cases | Joint Commission · DNV · ACHC |
| **TSC** | Thrombectomy-Capable Stroke Center — 24/7 mechanical thrombectomy, ≥15 EVT/yr/physician | Joint Commission · ACHC · (DNV "PSC+") |
| **PSC** | Primary Stroke Center — rapid CT, IV thrombolysis, dedicated stroke team | Joint Commission · DNV · ACHC · CIHQ |
| **ASR** | Acute Stroke Ready — stabilization, IV lytic, teleneurology, transfer protocols | Joint Commission ("ASRH") · DNV · ACHC · CIHQ |
| **EVT** | Endovascular thrombectomy capability (not a tier — a capability flagged at each hospital) | N/A |

Washington State runs an independent Level I/II/III ECS system; Idaho runs a TSE Level I/II/III system. Some hospitals (e.g., Kootenai Health) hold only state designations, not national accreditation.

## Data

- **Coverage:** 236 hospitals across WA (91), MT (59), ID (44), WY (27), AK (15) — 135 with verified stroke capability, 101 acute-care census records.
- **Stroke capability last verified:** 2026-07-04 (full dataset) · 2026-07-18 (watch-list re-check + press sweep)
- **Census snapshot:** CMS Hospital General Information, Oct 2023. Used for facility identity, type, ownership and bed counts only — no stroke claim is derived from it.
- **Open items:** [`data/verification-worklist.csv`](./data/verification-worklist.csv) ranks the 56 records that still need a primary-source check, each with the source to check.
- **Methodology:** see [METHODOLOGY.md](./METHODOLOGY.md)
- **Changelog:** see [CHANGELOG.md](./CHANGELOG.md)

## Transport-time model

Distances are great-circle (haversine). Ground transfer time = (haversine × 1.25) / 55 mph + 8 min overhead. Air transfer time = haversine / 150 mph + 25 min dispatch/takeoff/landing overhead. These are **planning estimates** only. Real transfer times depend on weather, traffic, staffing, and specific asset availability.

## Expansion-candidate scoring

The candidates view scores each non-EVT, non-CSC/TSC hospital 0–100 from three normalized signals under user-adjustable weights (defaults in parentheses):

| Signal | Meaning | Default weight |
|--------|---------|----------------|
| Certification gap | No certification 1.0 · ASR 0.65 · PSC 0.35 | 40 |
| EVT distance | Miles to nearest 24/7 EVT center, capped at 200 mi | 40 |
| CSC/TSC distance | Miles to nearest CSC/TSC, capped at 200 mi | 20 |

Records flagged air-only receive a flat +8 for transport fragility. **The score is a planning heuristic computed in the browser from the public dataset. It does not assess clinical operations, staffing, case volume, or telestroke contract status, and it never modifies the source data.** Full details in [METHODOLOGY.md](./METHODOLOGY.md).

## Running locally

Because the site fetches `hospitals.json`, browsers block `file://` loads. Serve via any local web server:

```bash
cd telestroke-expansion-map
python3 -m http.server 8000
# then open http://localhost:8000
```

## Verification (before any deploy)

There is intentionally no build step or test framework. Two lightweight checks cover the moving parts:

```bash
python3 scripts/verify-data.py   # 17 dataset integrity checks (mirrors METHODOLOGY.md §7)
node --check app.js              # JS syntax
```

`verify-data.py` runs without dependencies; installing `zipcodes` (`pip install zipcodes`)
additionally enables the check that every record's coordinates agree with the city it names.

To rebuild the dataset after editing curated records or refreshing the census:

```bash
pip install zipcodes
python3 scripts/build-dataset.py   # normalise + merge census (idempotent)
python3 scripts/build-worklist.py  # regenerate the verification queue
```

Then smoke-test in a browser (see [docs/DEPLOY-CHECKLIST.md](./docs/DEPLOY-CHECKLIST.md) for the full list).

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` or `Ctrl+F` | Focus search |
| `E` | Open expansion candidates |
| `Q` | Open data quality panel |
| `R` | Reset all filters + scenario |
| `D` | Toggle dark mode |
| `?` | Open methods/certification info |
| `Esc` | Close modal / tools menu |

## Accessibility

- Every interactive element is keyboard-reachable; focus rings use a high-contrast indigo (`--accent`).
- Filter pills expose `aria-pressed`; dashboard charts provide `role="img"` + aria-labels.
- Optional colour-blind–safe palette (Okabe-Ito-inspired) via the tools menu.
- Dark mode is a full-app theme, not just map tiles.
- Respects `user-scalable`; there is no zoom lock on the viewport.

## File layout

```
index.html                        Semantic shell
app.css                           All styles (tokens + components + responsive + print)
app.js                            Application logic (data load, map, filters, scoring, exports)
hospitals.json                    Data + metadata (schema, sources, cert definitions)
vendor/leaflet/                   Leaflet 1.9.4, vendored — see vendor/leaflet/README.md
data/cms-census-wwami-2023-10.csv CMS acute-care census subset for the five states
data/verification-worklist.csv    Ranked queue of records needing a primary-source check
llms.txt                          Plain-text site/dataset description for machine readers
scripts/build-dataset.py          Rebuild hospitals.json (normalise + merge census)
scripts/build-worklist.py         Regenerate the verification queue
scripts/verify-data.py            Dataset integrity checks
METHODOLOGY.md                    Data sourcing + certification standards + scoring model
CHANGELOG.md                      Release history
docs/                             Deploy checklist + improvement notes
```

## License

MIT — see [LICENSE](./LICENSE).

## Attribution

- Basemap tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, styled by [CARTO](https://carto.com/attributions)
- Mapping library: [Leaflet](https://leafletjs.com/) (BSD-2-Clause, vendored in `vendor/leaflet/`)
- Acute-care census derived from CMS Hospital General Information
- PNG export: [html2canvas](https://html2canvas.hertzen.com/)

---

*Built for stroke network planning. Feedback and PRs welcome.*
