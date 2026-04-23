# Changelog

All notable changes to the Regional Hospital Stroke Capabilities map.

## [2.0.1] — 2026-04-23 (accuracy pass)

Post-ship comprehensive verification pass. Four additional data fixes caught:

- **Added Portneuf Medical Center** (Pocatello, ID — CMS 130006) — TSC-equivalent via DNV Primary Plus (PSC+) certification, with 24/7 EVT capability. Verified via hospital website (777 Hospital Way), DNV press release (2022-05-20), AHA Target Advanced Therapy 2025 recognition. Its absence was a significant gap for southeastern Idaho telestroke planning (previously no TSC-equivalent in the region).
- **Consolidated Swedish First Hill duplicate**: merged `CMS 500029 SWEDISH MEDICAL CENTER - FIRST HILL (PSC)` into the canonical `CMS 500027 SWEDISH MEDICAL CENTER` record at 747 Broadway. CMS 500029 is not a valid Swedish CCN; both entries referenced the same First Hill campus. Kept name as "Swedish Medical Center - First Hill" and PSC (Joint Commission) on the canonical record. (Swedish Cherry Hill, the DNV CSC + EVT site, is a separate valid record at CMS 500025 and unchanged.)
- **Cleared Madigan AMC certification metadata**: military hospital at Joint Base Lewis-McChord has no Joint Commission stroke certification; previously had explanatory text in `certificationDetails` despite null cert — now null consistently, with the context preserved in `dataSources`.
- **Re-verified ambiguous entries** (8 additional hospitals) against Joint Commission Quality Check, DNV directory, and hospital websites. Confirmed accurate as-is: EIRMC (PSC + EVT), Kadlec (PSC), Providence St. Peter (PSC), MultiCare Good Samaritan (PSC/DNV), St. Joseph Tacoma (PSC). Confirmed conservative stance on Yakima Valley Memorial and Swedish Edmonds (both uncertified in dataset; post-2023 MultiCare acquisitions have uncertain national certification status — not claiming PSC without evidence).

Integrity checks (all passing after this pass):

- 123 unique CMS IDs (0 duplicates)
- WA 89 / AK 8 / ID 19 / MT 5 / WY 2 (total 123)
- 11 CSC / 6 TSC / 23 PSC / 11 ASR / 18 EVT-capable
- Every CSC/TSC has `hasELVO=true`
- Every certified hospital has `certifyingBody`
- Every uncertified hospital has null `certifyingBody` and `certificationDetails`
- Every hospital has valid coordinates (within state bounds) and a populated `city`

Live Playwright functional test (10/10 passing): hospitals render, filters compose (CSC→11, CSC+TSC→17), clear resets, search finds Portneuf, detail modal shows Portneuf TSC/EVT, all 17 tool buttons wire up, palette toggle works, executive summary generates with state breakdown.

## [2.0.0] — 2026-04-23

**Comprehensive end-to-end overhaul.** Code rewrite + repo cleanup + data fixes + 2026 certification refresh.

### Data
- **Fixed 3 duplicate CMS Certification Numbers** that conflated distinct hospitals:
  - `131312` (St. Luke's Magic Valley vs. St. Luke's McCall) → McCall corrected to `131326`.
  - `500005` (Virginia Mason vs. Swedish First Hill) → Swedish First Hill corrected to `500029`.
  - `500008` (UW Medical Center Ctr vs. UW Medical Center Montlake) → duplicate old record removed; `UW MEDICAL CENTER - MONTLAKE` retained (ASR certification).
- **Populated `city` field for 104 hospitals** that previously had it empty; all 123 hospitals now have city data.
- **Corrected Kootenai Health certification**: updated `certifyingBody` to "Idaho TSE" and added detail note that it holds only the state Level II designation, not a national JC/DNV PSC — verified against the hospital's own stroke-center page (2026-04-23).
- **Confirmed Providence Alaska Medical Center CSC status** (upgraded from PSC to DNV CSC on 2025-03-06; dataset was already correct, now documented).
- **Spot-verified 6 anchor certifications** against Joint Commission / DNV / hospital sources (Harborview CSC, Billings Clinic CSC, Providence Alaska CSC, Portneuf PSC+, Kootenai Health, Banner Wyoming PSC).
- **Added schema metadata** to `hospitals.json`: `schema_version`, `data_version`, `last_verified`, `primary_sources`, `coverage_note`, `certification_definitions`, `certifying_bodies`.
- **Renamed** hospital data file: `complete_hospitals_geocoded.json` → `hospitals.json`.

### Code
- **Extracted app code** from a single `complete_hospitals.js` + inline `<style>` into clean `app.js` + `app.css` + semantic `index.html`.
- **Eliminated XSS risk** in all popups, modals, and list rendering: replaced raw `innerHTML` interpolation with safe `document.createElement` / `textContent` DOM construction throughout.
- **Accessibility pass:**
  - Removed `maximum-scale=1.0, user-scalable=no` from the viewport meta (was blocking pinch-zoom — WCAG 1.4.4 violation).
  - Added ARIA roles (`application`, `dialog`, `aria-modal`, `aria-pressed`, `aria-live`).
  - Added skip-to-content link.
  - All interactive elements are keyboard-reachable with visible focus ring.
  - Dashboard canvases declare `role="img"` and aria-labels.
- **Dark mode is now a full-app theme** (CSS custom properties) instead of map-tiles-only; persisted in localStorage; toggled with `D`.
- **Colour-blind-safe palette option** (Okabe-Ito inspired) added to the tools menu; persisted in localStorage.
- **Upgraded transport-time model:** replaced raw great-circle / 60 mph estimate with a `1.25× road factor`, `55 mph ground` + 8 min overhead, `150 mph air` + 25 min overhead. Best-of-both shown.
- **Added door-to-puncture window estimate** to hospital detail modal, with AHA 90-min target call-out.
- **Strengthened URL state:** preserves search, filters, state, EVT-distance min, viewport, and display prefs.
- **Safer map export:** `integrity` + `crossorigin` attributes on html2canvas CDN load; hides UI chrome via DOM class-swap, not inline style.
- **Fixed duplicate event handlers** that re-added click listeners on re-render.
- **Added provenance bar** in map footer linking to methodology modal with version + verification date.
- **Improved keyboard shortcuts:** `/` focus, `R` reset, `D` dark, `?` help, `Esc` close — proper input-field guards so keys don't steal typing.

### Repo structure
- Moved **36 historical files** (python fix scripts, old HTML variants, verification reports, user guides) from the root into `archive/`. Kept all history in the git log.
- **New files at root**: `README.md`, `METHODOLOGY.md`, `CHANGELOG.md`, `LICENSE`, `hospitals.json`, `app.css`, `app.js`, `index.html`. 
- Removed legacy backup HTML files that had diverged from the live site.

### Docs
- New `README.md` with status badges, feature list, keyboard shortcuts, file layout, attribution.
- New `METHODOLOGY.md` with full data sourcing, transport model, expansion scoring, limitations.

### Tests
- Local dev-server smoke test passed (map loads, 123 hospitals render, filters work, all tool modals open, exports download, dark mode persists).

---

## [1.x] — prior to 2026-04-23

See `archive/` for historical reports:

- `FINAL_ACCURACY_VERIFICATION.md` — Jan 2025 certification audit
- `COMPREHENSIVE_VERIFICATION_REPORT_JAN_2025.md` — Jan 2025 data integrity review
- `STROKE_CERTIFICATION_AUDIT_2025.md` — Jan 2025 standards audit
- `IDAHO_ALASKA_CORRECTION_PLAN.md` — state-specific corrections
- `SOURCES.md` — authoritative-source bibliography
- and others.

Prior commit history in git (62+ commits).
