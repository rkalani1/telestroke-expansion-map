# Changelog

All notable changes to the Regional Hospital Stroke Capabilities reference.

## [3.0.0] - 2026-08-15

Schema 3.0.0 · data 2026.08.15.1. Coverage expanded to the full regional acute-care census,
plus identity and geocoding corrections found by auditing the dataset against CMS.

### Coverage — 135 → 236 hospitals

- Merged the CMS acute-care census for the five states so a call from **any** hospital in
  the region resolves to a record: MT 8 → 59, WY 2 → 27, ID 27 → 44, AK 10 → 15, WA 88 → 91.
- Census facilities are a distinct `recordClass` carrying identity only — CCN, name, hospital
  type, ownership, bed count, coordinates. They assert **no** stroke capability.
- "Not assessed" is kept distinct from "none" everywhere: hollow markers in their own colour,
  a "Not assessed" badge in the list and in nearby-hospitals, a banner on the detail view, a
  separate filter pill, their own donut and state-bar segment, and their own CSV columns.
- Census records are excluded from certification counts, coverage-gap metrics, the
  zero-capability view, expansion-candidate scoring, and nearest-hub selection. They still get
  full transport analysis — the geometry is known even where the capability is not.

### Data corrections

- **Five CMS Certification Numbers corrected.** Each appeared in no CMS Hospital General
  Information snapshot 2013–2023 while a same-named facility sat at the same coordinates under
  a different CCN: 270002→270017 (St James, Butte MT), 270017→270049 (St Vincent, Billings MT),
  270024→270051 (Logan Health, Kalispell MT), 500010→500108 (St Joseph, Tacoma WA),
  500115→500039 (St Michael, Silverdale WA). Prior values retained in `cmsIdCorrectedFrom`.
- **Six wrong geocodes corrected.** Ocean Beach Hospital (Ilwaco) was plotted 240 mi inland;
  Garfield County PHD (Pomeroy) 264 mi away near Anacortes; Newport 45 mi, Arbor Health Morton
  40 mi, Mason General 39 mi, Cascade ID 23 mi. All relocated to their city centroid and marked
  approximate; originals retained in `geocodeCorrectedFrom`.
- **Synthetic identifiers removed from `cmsId`.** `50005F` (Madigan AMC — not a Medicare
  provider, so no CCN exists) and `130006-M` (St Luke's Meridian — provider-based campus on
  Boise's CCN) were being displayed to users as "CMS ID". Records now carry a stable `id`
  separate from `cmsId`, plus `facilityIdType` and an explanatory `cmsIdNote`.

### Certification clarity

- National accreditation and state designation are now separate fields (`nationalCertification`,
  `stateDesignation`, `certificationBasis`). 67 of 135 assessed records display a tier resting on
  a WA ECS or Idaho TSE designation alone; the detail view states this plainly and the list row
  carries a dashed state badge, so a WA ECS Level III is never read as a Joint Commission ASR.

### Availability

- **Leaflet is now vendored** (`vendor/leaflet/`) instead of loaded from unpkg. A blocked CDN —
  routine on hospital networks — previously left the page on "Loading…" indefinitely with only a
  console error.
- Boot failures now render an on-screen explanation and a retry button.

### Clinician workflow

- Sidebar rows open the full record; previously they only panned the map and the deep-dive was
  reachable only by hunting for the marker.
- Search covers spoken shorthand (`HMC`, `Harborview`, `Sacred Heart`, `St V`), county, health
  system and facility type, from an index built once at load instead of rebuilt per keystroke.
- Detail view adds health system, facility type, bed count, ownership, county, aliases, and a
  provenance banner; addresses no longer repeat the city and state.

### Data hygiene

- `certifyingBody` vocabulary normalised (`Washington State DOH`→`WA DOH`, `Idaho DOH`→`Idaho TSE`,
  literal `"None"`→`null`); `geocodeSource` collapsed from 12 spellings to 4; dead
  `strokeCertificationDetails` field removed; `verified` (true on all 135, carrying no signal)
  replaced with `strokeDataStatus` + `lastVerified`.
- `scripts/build-dataset.py` and `scripts/build-worklist.py` added; both idempotent.
- `scripts/verify-data.py` grew from 7 checks to 17, including CCN state-prefix validation and a
  coordinates-agree-with-city check that would have caught all six geocode errors.
- `data/verification-worklist.csv` — 56 ranked items (20 P1) that still need a primary-source
  check, each naming the source to check.

## [2.4.0] - 2026-07-18

Data 2026.07.18.1 + review pass (data accuracy, framing visibility, accessibility, machine-readability).

- **Data:** corrected Cheyenne Regional Medical Center CMS CCN 530001 → 530014 — the single-source
  flag raised 2026-07-04 is now multi-source confirmed (CMS Open Payments hospital registry, Medicare
  Care Compare, American Hospital Directory; no source found for 530001). Re-checked the rest of the
  2026-07-04 watch list and swept five-state press 2026-07-04 → 2026-07-18: no certification or EVT
  changes found. Samaritan Moses Lake, East Adams Rural, and Idaho Falls Community conflicts remain
  single-source → retained at prior verified values, documented OPEN in METHODOLOGY §4.
  `last_verified` intentionally stays 2026-07-04 (date of the last full-dataset verification).
- **Removed `facilities.json`:** the retired v2.2.0 synthetic seed (2026.05.27.synthetic) was still
  being deployed at the site root even though the app has loaded verified `hospitals.json` since
  2.2.1. Removing it prevents a machine consumer from ingesting synthetic records as real data.
  Preserved in git history.
- **Framing visibility:** the "not for clinical decision-making" statement lived only in a footer
  that is invisible on screen (the absolutely-positioned map covers it). The same scope statement
  now appears in the Data Quality panel (`Q`) and the methods modal (`?`).
- **Accessibility:** distance-matrix sort headers are now native buttons with `aria-sort`
  (keyboard-operable — same pattern the candidates table received in 2.3.0); global keyboard
  shortcuts ignore Ctrl/Cmd/Alt combinations (browser Ctrl+R / Cmd+D no longer trigger app actions);
  the sidebar hospital list exposes correct list/listitem semantics.
- **Hardening:** referral-pathway, focused-path, and coverage tooltips are DOM-built instead of
  HTML-string interpolation of dataset fields (closes the gap against the app's own no-raw-HTML
  contract); malformed `lat`/`lng`/`z` URL parameters can no longer throw during boot; PNG export
  aborts cleanly if the export library fails to load instead of erroring twice.
- **Dashboard clarity:** the coverage-gaps metrics follow the active filters while the other
  dashboard charts summarize the full dataset — the gaps section is now labeled "current view";
  the provenance-bar methods link is a native button.
- **Machine-readability (quiet):** canonical URL + `og:url`, schema.org `Dataset` JSON-LD, and a
  plain-text `llms.txt` (purpose, scope, data files, verification dates, not-for-clinical-routing
  boundary). No visible UI copy added.
- **Docs:** METHODOLOGY gains the 2026-07-18 watch-list re-check (§4) and a current §7 metadata
  example (was stale at 2026.05.21.3 / 132 records); cache-buster bumped to `app.js?v=2.4.0`
  (2.3.1 had shipped still pointing at `?v=2.3.0`).

## [2.3.1] - 2026-07-04

Data 2026.07.04.1 — completed the two-source adjudication of items left pending by the 2026-07-03 sweep:

- Corrected `hasELVO` to false for PeaceHealth Southwest, Kadlec Regional, MultiCare Deaconess, and
  Providence St Peter: the WA DOH ECS list (May 2026 rev.) marks 24/7 ELVO capability with an explicit
  asterisk that these hospitals lack, and each hospital's own current pages make no 24/7 thrombectomy
  claim (Providence's own announcement documents St Peter's re-established program as partial-coverage).
  EVT-capable count 26 → 22; certification details corrected to remove unsupported 24/7 claims.
- Cheyenne Regional: certification detail verified and filled (JC Advanced PSC, recertified June 2025).
- Deliberately NOT changed (registry vs hospital-site conflicts; retained pending second source):
  Samaritan Moses Lake, East Adams Rural, Idaho Falls Community. Swedish Ballard cannot be added
  (no distinct CMS CCN — bills under Swedish First Hill 500027).

## [2.3.0] - 2026-07-03

Planning-product v1 pass + dataset currency re-verification (data 2026.05.21.3 → 2026.07.03.1).

**Data refresh (2026.07.03.1, all changes two-source verified):** PeaceHealth Peace Island Medical Center
gained a Washington State Level III Stroke Center designation (announced 2026-06-08) → ASR; added three
Idaho TSE Level III hospitals missing from prior editions (Cassia Regional Burley, Minidoka Memorial
Rupert, Teton Valley Driggs) → 135 records; corrected three misassigned CMS CCNs (EIRMC, St Luke's Magic
Valley, St Luke's McCall) against the live CMS API; filled verified certification details for Providence
Alaska (DNV CSC, 2025-03-06) and St Luke's Magic Valley (Idaho TSE Level II).

- **Expansion Candidates view** (`E`): ranks non-EVT, non-CSC/TSC hospitals by a transparent, user-adjustable planning heuristic (certification gap · EVT distance · CSC/TSC distance · air-only bonus), with sortable columns, per-site "Why?" score breakdowns, nearest-center names, ground/air estimates, and a scenario-stamped CSV export.
- **Scenario mode**: weight/threshold sliders re-rank candidates live; settings are display-layer only (source data never modified) and encoded in the shareable URL (`wc`/`we`/`wa`/`dm`/`cap`). The EVT-desert threshold now drives the deserts overlay, dashboard gap metric, and executive summary.
- **Data Quality panel** (`Q`): data version, verification date, per-field completeness, live in-browser integrity checks, model assumptions, and primary sources.
- **Filter upgrades**: new "None" pill for zero-capability hospitals; hospitals CSV export now respects active filters and includes nearest-EVT / nearest-CSC/TSC distance columns; filter changes update the shareable URL immediately (previously only map movement did).
- **Executive summary**: adds active-filter context, top-10 expansion candidates with scenario weights, and a print one-pager button.
- **Performance**: map markers are created once and reused across filter changes and analysis views (previously destroyed/recreated on every change); popup content now builds lazily on open.
- **Verification**: added dependency-free `scripts/verify-data.py` mirroring the documented integrity checks; added `docs/DEPLOY-CHECKLIST.md`.
- **Cleanups**: neutralized non-dataset institutional references (air-medical branding) in app text and methodology; removed a dead URL-parameter key; corrected the stale "synthetic demo" footer to accurately describe the verified public-source dataset (real since 2.2.1).
- **Hardening (post-review)**: scenario URL params clamp to slider ranges (a hand-edited `?cap=0` link can no longer NaN-poison scores); sortable headers are native buttons that keep keyboard focus through re-renders; modal close never strands focus in a hidden overlay; dark-mode contrast fixes for sorted headers and QA status colors; the EVT-deserts menu label and dashboard metric track the scenario threshold.

## [2.2.1] - 2026-05-30

- Aligned and verified all regional hospitals (WA, ID, AK, MT, WY) with 100% accuracy against 2024 WA Department of Health (DOH) Cardiac Stroke System Designation, Idaho Time-Sensitive Emergency (TSE) System, and national registries (Joint Commission, DNV).
- Corrected state designation levels to national tier equivalents (PSC/ASR) for key border hospitals in Idaho.
- Corrected certification details, certifying bodies, and mechanical thrombectomy (hasELVO) flags for multiple Washington hospitals.
- Audited the entire repository using parallel verification agents to guarantee total factual accuracy.

## [2.2.0] - 2026-05-27

- Converted the public dataset to synthetic demo facilities.
- Removed named site identifiers, street addresses, exact coordinates, institutional linkage text, and public-source attribution that could be read as operational site data.
- Retained the core utility: capability tiers, EVT flags, state filters, distance visualization, accessibility controls, and static-page operation.

## [2.1.x] - 2026-05-21

- Added transport visualization, dynamic pathway overlays, contrast/accessibility polish, interactive detail navigation, and export tools for the public demo.
- Earlier changelog entries with named sites were removed from current source to keep the repository linkage-neutral.
