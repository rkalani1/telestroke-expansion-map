# Changelog

All notable changes to the Regional Hospital Stroke Capabilities reference.

## [3.1.0] - 2026-08-15

Follow-up polish pass closing the remaining verified audit findings.

### Accuracy
- Provenance bar no longer pairs "verified 2026-07-04" with the all-236 count —
  it now reads "capability verified for 135" and carries the not-for-clinical-use
  disclaimer, whose previous home was a footer the fullscreen map covered.
- Executive summary leads with the ACTIVE VIEW block and labels every statistic
  REGION-WIDE, so a filtered export can no longer be read as filtered figures.
- The four analysis map views (referral pathways, distance map, EVT deserts,
  zero-capability) now render the filtered set the sidebar describes, not all 236.
- "Washington ECS" added to the certifying-bodies glossary — 54 records cite it
  and it was never defined; the "all bodies equivalent" claim is now scoped to
  the national certifiers.
- Ground-speed code comment corrected (said ~60 mph; model and docs say 55);
  unused NEEDLE_TARGET_MIN constant removed.

### Interaction
- Escape out of location-query mode no longer reopens the tools menu.
- EVT slider filters per notch but re-fits the map once on release, instead of
  eight fitBounds animations per drag; shared-link params are clamped and
  step-snapped so knob, label and applied filter always agree.
- Collapsed dashboard is inert — it kept a focusable close button inside an
  aria-hidden subtree, a dead tab stop between the list and the tools FAB.
- Referral lines and coverage circles are tappable (canvas hit tolerance was 0).

### Screen readers
- Filter results announce the full sentence with the active filters, not a bare
  integer; histogram and state bars expose their actual distributions.

### Mobile
- Tools menu is a bottom sheet — the desktop flyout collapsed to 33px of
  scrollable menu on a landscape phone and to nothing at 320px.
- Sliders and the state select meet 44px touch targets; map-mode hint no longer
  swallows taps and is hidden on touch-only devices.

### In-app reference
- Keyboard shortcuts (all 11) listed in the ? modal; README table corrected.
- Palette reads cached per theme state (~620 getComputedStyle calls per render
  before); dark-mode toggle now re-renders markers so census hollows repaint.

## [3.0.0] - 2026-08-15

Schema 3.0.0 · data 2026.08.15.1. Coverage expanded to the full regional acute-care census,
plus identity and geocoding corrections found by auditing the dataset against CMS.

### Transport model and clinician workflow (audit follow-up)

An 8-dimension audit raised 72 findings; 52 survived independent adversarial
verification. Fixed here:

- **Door-to-puncture measured to the wrong destination.** The window was computed
  to the nearest CSC/TSC rather than the nearest EVT centre — different sets, 22
  vs 18 — inflating it for 59 records by up to 109 min. Cheyenne Regional read
  203 min while naming Banner Wyoming (81 min away) directly above. EVT-capable
  sites now say "on site" instead of showing a transfer window.
- **Ground times quoted for hospitals with no road connection.** The popup
  printed "~782 min ground" for Bartlett Regional (Juneau); the modal had the
  correct branch but the popup never passed the flag.
- **Verdict sentence and progress bar disagreed** for anything in the 91–120 min
  band, using different thresholds against different quantities.
- **"Best" transport unlabelled.** The crossover is ~18 mi, not the ~80 mi the
  code comment claimed, so "best" is a helicopter for 181 of 218 transfers.
- **Executive summary excluded all 18 CSC/TSC hospitals** from its within-60-min
  counts while keeping them in the denominator (ground 20.3% → 28.0%).
- **Search:** `st alphonsus` returned nothing while `saint alphonsus` returned
  two; queries are now normalised (st/saint, mt/mount, punctuation), every token
  must match at a word boundary, and results are ranked by relevance.
- **`titleCase` shouted 32 of 236 names** — "ST Luke's", "Community Hospital OF
  Anaconda" — from a blanket uppercase-if-short rule.
- **24/7 EVT had no visual channel**: the four PSC-tier EVT centres were
  pixel-identical to the 41 PSCs without thrombectomy. Now a teal ring, with a
  matching legend key.
- **Nearest EVT added to the map popup**, and the detail record reordered so the
  transfer answer is above the fold on a phone.
- **Keyboard:** single-key shortcuts fired over open modals, moving focus behind
  the overlay and permanently escaping the focus trap; `r` wiped every filter
  from one keypress while the hospital list holds button focus (now `Shift+R`).
- **Shared links dropped the "Not assessed" filter**, then rewrote the address
  bar without it so the loss was undetectable.
- **Accessibility:** row `aria-label`s suppressed every badge, so tier, state-only
  status and EVT capability were unavailable to screen readers; badge and
  pressed-pill contrast failed 1.4.3 in all four palettes (worst 2.04:1, now
  ≥4.5:1); focus rings were invisible on the header buttons and drawn outside
  the viewport on the map.
- **Mobile:** `100vh` clipped the zoom control and hid the OSM/CARTO attribution
  on iOS and Android; sub-16px inputs force-zoomed Safari on every search tap;
  the status bar reported a filtered subset as the regional total and Clear left
  filters intact.
- **CI added** (`.github/workflows/verify.yml`), which immediately caught that
  `build-dataset.py` was not idempotent — a second run promoted census records
  to "verified" and collided two corrected CCNs.

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
