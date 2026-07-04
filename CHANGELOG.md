# Changelog

All notable changes to the Regional Facility Stroke Capabilities demo.

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
