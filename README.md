# Regional Hospital Stroke Capabilities — WWAMI atlas

A public-source reference and planning atlas of hospital stroke capability across Washington, Alaska, Idaho, Montana and Wyoming. It is built for clinicians at a comprehensive stroke center who need to look up a hospital, see what is documented about it and how current that is, compare straight-line access to receiving centers, and explore transparent network-planning questions. (The repository name, `telestroke-expansion-map`, reflects the original planning use.)

**Live site:** https://rkalani1.github.io/telestroke-expansion-map/

<!-- counts:start -->253 facility records (WA 95, AK 22, ID 45, MT 62, WY 29): 133 in the adult emergency-stroke analysis set, 3 excluded with a documented reason, 117 with eligibility unresolved; 0 not yet located. Stroke capability: 127 assessed, 36 partly assessed, 84 not assessed, 6 with conflicting evidence; 19 with documented 24/7 thrombectomy. 8 receiving centers outside the five states are included as destinations only. Data 2026.10.17.1, evidence review 2026-10-17.<!-- counts:end -->

> Public-source planning reference. Not a clinical decision aid, not dispatch or patient-routing guidance, and not an official product of any health department or accreditor. It records no institutional approval, affiliation, referral agreement, contract or real-time availability. Unknown means not documented — never "none".

---

## What you can do

| View | For |
|---|---|
| **Find** | Search by current or former name, nickname or abbreviation (`HMC`, `St V`), city, county, health system or CCN/NPI; filter by tier, documented 24/7 EVT, state, system, Critical Access status, evidence state and analysis scope; sort; open a hospital. |
| **Hospital detail** | Identity and campus; national certification and state designation shown separately with their evidence state, sources, excerpts and check dates; documented thrombectomy and 24/7 basis; nearest documented 24/7 EVT and CSC/TSC-level centers (straight-line, set named); my receiving center and the difference; illustrative transfer scenarios that state what they leave out (road network only for ground, landing zones and airports not assessed); nearby hospitals. Distances involving a town-centre location are marked ≈. Side panel on desktop, over the tool column on tablets (the map stays clear), full sheet on phones. |
| **Explore** | Choose *my receiving center* (Harborview is a one-click preset; nothing is chosen for you). Switch the map between capability, distance-to-EVT, distance-to-CSC/TSC, distance-to-my-center, evidence and eligibility modes, each with its own legend. Presets for *Telestroke access review*, *EVT capability assessment* and *State designation review*. Adjust transport assumptions, including the fixed handover times for each mode. State summary and distance-distribution tables, and a sortable distance table for the current results (nearest documented 24/7 EVT and CSC/TSC-level centers, my center and the difference; CSV export with its scope and data version). The access review with its separate verification shortlist, a rank range showing how much each position depends on the weights, and an unscored transfer-scenario column (road connection, rotor-wing range, fixed-wing airport access not assessed). |
| **Compare** | Two to four hospitals side by side with evidence age, unknowns and distances; print or CSV. |
| **Data & methods** | Coverage of evidence by claim, the needs-verification breakdown (open items P1/P2 separated from precision notes P3, each reason viewable on its own), structural checks (labelled as not factual verification), methods, exports (CSV, JSON, Markdown summary, PNG map, print one-pager) with an explicit scope, share link, theme, basemap (standard, muted, muted with USGS terrain shading, or none), colour-vision palette and keyboard-shortcut settings. |

Every view states its scope (filtered results, selected hospitals or whole dataset) and computes its counts from the data it shows. Share links restore the selected hospital, my center, comparison set, mode, overlays, the CSC/TSC-level line, filters, the summary and access-review scopes, scenario, viewport and any explicit display choice; a link's explicit settings win over saved preferences without overwriting them, and links from earlier versions keep working.

## What the data says — and how sure it is

Each hospital is a **campus** record with separate, individually sourced claims: status, address, coordinates, service type, population served, Critical Access designation, emergency department, governance, health system — and, for stroke, **national certification**, **state designation**, **thrombectomy** and **24/7 thrombectomy**. Each claim has a state (*documented*, *verified absent within a scope*, *no record found in reviewed sources*, *not assessed*, *conflicting*, *not applicable*), the sources it rests on, the method used to observe them, and the date it was checked. The build never stamps dates or promotes claims.

- **Partly assessed is not "none found".** A record whose national certification (or, in a state with a designation program, state designation) is still unknown shows as *partly assessed, no tier yet*, not as *no certification found*. *None found* means the national certification and state designation were checked and nothing was found in the reviewed sources; its thrombectomy claims may still be unknown.
- **National and state are never merged.** Washington ECS levels and Idaho TSE levels are shown on the national colour ladder only through an explicit crosswalk, and every such tier says it rests on a state level.
- **The analysis set** (eligible adult emergency-stroke campuses) requires an active campus with a 24/7 general emergency department serving adults — documented for the campus, or inferred from a program requirement it is subject to (Critical Access Hospital conditions of participation, Washington stroke Level II criteria), and the record says which. Everything else is *excluded with a reason* or *unresolved*, and stays searchable. A name like "Clinic" never excludes a hospital.
- **Distances are straight-line miles.** Lines are geometry, not routes or referral relationships. Transport times are adjustable, illustrative scenarios (ground, rotor-wing, fixed-wing) and never compared with treatment-time targets.

[METHODOLOGY.md](METHODOLOGY.md) explains all of it; [docs/SCHEMA.md](docs/SCHEMA.md) lists every field; [docs/EVIDENCE-AUDIT-2026-10.md](docs/EVIDENCE-AUDIT-2026-10.md) reports what the October 2026 review checked, corrected and left open; [data/audit/evidence-audit.csv](data/audit/evidence-audit.csv) is the claim-by-claim inventory and [data/verification-worklist.csv](data/verification-worklist.csv) the ranked list of open checks.

## Running locally

The site is static. Serve the folder (browsers block `fetch` from `file://`):

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

## Checks

```bash
python3 scripts/build-dataset.py --check   # committed outputs match the curated inputs
python3 scripts/verify-data.py             # independent structural, provenance and geography checks
node --check core.js && node --check app.js
npx --yes html-validate@8 index.html
npx --yes eslint@9 core.js app.js tests
npm ci && npm test                         # unit tests + headless end-to-end tests (Node 22+)
```

The end-to-end tests run Chromium headlessly through Playwright (`npx playwright install chromium` once, or set `CHROMIUM_PATH`). They inspect the DOM, accessibility tree, computed styles, layout geometry, console and downloaded files; they take no screenshots. CI runs all of the above on every pull request.

## Updating the data

Edit the curated inputs in `data/curated/` (one claim at a time, with its source and check date), then:

```bash
python3 scripts/build-dataset.py   # writes hospitals.json, the audit CSV, the worklist and the count sentences
python3 scripts/verify-data.py
```

The build is deterministic: no clock, no network, identical bytes on every run. [docs/SOURCE-MAINTENANCE.md](docs/SOURCE-MAINTENANCE.md) covers re-checking a claim, adding a source, refreshing the CMS census and the boundary and gazetteer files, and cutting a release.

## Keyboard

Shortcuts can be switched off in Data & methods; none overrides browser find (Ctrl/⌘+F).

| Key | Action |
|---|---|
| `/` | Focus hospital search |
| `L` | Focus the hospital list (arrow keys move, Enter opens) |
| `M` | Focus the map |
| `F` `E` `C` `Q` | Find · Explore · Compare · Data & methods |
| `G` | Summary by state |
| `D` | Toggle light/dark theme |
| `Shift+R` | Reset filters |
| `?` | Shortcut list |
| `Esc` | Close the dialog, hospital details or mobile sheet (focus returns where it was) |

## Accessibility

Built to WCAG 2.2 AA and tested headlessly with axe-core in both themes, by keyboard, and at 320–1920 px, short landscape and 200% text: semantic controls, visible focus, focus restoration, non-colour status cues (marker shape, outline and ring carry assessment state), 24 px minimum targets, reduced-motion support, and an optional colour-vision-safe palette. The hospital list and all evidence work with map tiles, fonts or scripts from other hosts blocked. Criteria that need human judgement (for example the clarity of wording to a screen-reader user) have not been formally user-tested.

## Files

```
index.html  app.css  app.js       The app (static; no build step)
core.js                           Pure logic shared by the app and the unit tests
hospitals.json                    The dataset the app loads (generated)
data/curated/                     Curated inputs: manifest, sources, facilities, neighbors
data/audit/evidence-audit.csv     Claim-level audit inventory (generated)
data/verification-worklist.csv    Ranked open checks (generated)
data/cms-census-wwami-2023-10.csv CMS Hospital General Information snapshot, five states
data/geo/                         Census boundaries and the GeoNames town gazetteer extract
scripts/                          build-dataset, verify-data, build-geo, build-cities, geo helpers, migrations
tests/unit  tests/e2e             node:test unit tests; Playwright headless end-to-end tests
vendor/leaflet/                   Leaflet 1.9.4, vendored
docs/                             Schema, source maintenance, evidence audit, deploy checklist
```

## Attribution and licence

MIT — see [LICENSE](LICENSE).

- Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, used under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); the map degrades to a list-and-evidence view when tiles are unavailable.
- [Leaflet](https://leafletjs.com/) (BSD-2-Clause), vendored.
- Hospital identity: CMS Hospital General Information and the CMS NPPES NPI Registry (public domain).
- County and state boundaries: US Census Bureau cartographic boundary files via the `us-atlas` package (ISC).
- Town points: [GeoNames](https://www.geonames.org) via the `cities.json` package, CC BY 4.0.
- Certification and designation evidence: the issuing bodies and hospitals cited per claim in `hospitals.json`.
