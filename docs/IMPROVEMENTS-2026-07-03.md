# v2.3.0 Improvement Pass — Before / After Notes

Scoped v1 pass turning the capability map into a practical planning product.
Dataset untouched (2026.05.21.3). All changes are app-layer.

## Before → After, by goal area

**1. First-screen layout.** Already strong (sidebar + map + dashboard). Left as-is
except: filtered-CSV labeling in the tools menu, a "None" pill in the filter row,
and the new candidates entry at the top of the Analysis menu. Deliberately no
layout rebuild — the balance worked.

**2. Filter UX.**
- Before: tier pills (CSC/TSC/PSC/ASR/EVT), state dropdown, EVT-distance slider;
  zero-capability hospitals reachable only through a tools-menu overlay.
- After: "None" pill filters uncertified hospitals directly (with URL round-trip);
  EVT-desert threshold is now scenario-configurable and drives the deserts overlay,
  dashboard metric, and executive summary consistently.
- Not implemented: a rural/remote flag filter — the dataset has no rurality field,
  and inventing one would fabricate data. Distance-based remoteness (the EVT
  slider + scenario cap) covers the same planning intent from real fields.

**3. Expansion-candidate view.** Did not exist. Now: ranked sortable table
(106 candidates = non-EVT, non-CSC/TSC sites), per-site "Why?" breakdown with
exact point attribution, nearest EVT / CSC/TSC names and distances, ground/air
minutes, air-only flags, "Show on map", and CSV export. Keyboard: `E`.

**4. Scenario mode.** Did not exist. Now: five sliders (three weights, desert
threshold, distance cap) re-rank live; explicit "never changes source data"
contract in the UI copy and in code (scoring reads precomputed distances only);
scenario is URL-encoded (`wc`/`we`/`wa`/`dm`/`cap`) and resets with `R`.

**5. Executive export.**
- Before: full-dataset CSV, distance-matrix CSV, .txt/clipboard summary, share URL
  that updated only on map movement.
- After: hospitals CSV respects active filters and adds nearest-distance columns;
  candidates CSV with scenario-stamped filename; summary gains active-filter
  context + top-10 candidates with weights; print one-pager button; URL updates
  immediately on any filter/scenario change (debounced for Safari's
  replaceState throttle).

**6. Mobile / keyboard.** New modals reuse the existing focus trap; sortable
headers are keyboard-operable (Enter/Space) with `aria-sort`; `E`/`Q` shortcuts;
scenario grid collapses to one column on narrow screens; verified at 375px.

**7. Data QA panel.** Did not exist. Now (`Q`): data version, verification date,
per-field completeness, four integrity checks computed live in the browser,
transport-model assumptions, primary-source list, methodology/repo links.

**8. Visual polish.** Score bars in the candidates table; sorted-column
highlight; "Why?" rows with accent border; print stylesheet for the executive
one-pager; disclaimer note styling. Existing palette/legend/dark mode retained.

**9. Performance.** Markers were destroyed and recreated (with popup DOM built
eagerly for all 132) on every filter keystroke and analysis-view switch. Now
markers are built once, reused via a LayerGroup, and popup content builds lazily
on open. Analysis overlays restyle cached markers instead of recreating them.

**10. Docs.** README (features, scoring table, shortcuts, verification section),
METHODOLOGY §6 scoring model + renumbered sections, CHANGELOG 2.3.0,
this file, docs/DEPLOY-CHECKLIST.md, scripts/verify-data.py.

## Scope-boundary actions (per the public-data mandate)

- Neutralized non-dataset institutional references: "OHSU/LifeFlight" in the
  executive summary and "LifeFlight / Airlift NW" in METHODOLOGY → generic
  air-medical wording. (Hospital names inside the dataset, including UW Medical
  Center and Harborview records, remain — they are the map subject.)
- Removed a dead `UW` URL-parameter key left over from a removed filter.
- Corrected the footer: it claimed "synthetic public demo" but the dataset has
  been real, registry-verified public data since v2.2.1. New wording:
  public-reference planning tool from public sources, not for clinical use.
- The scoring layer makes no clinical claims: eligibility and signals come only
  from existing fields (`strokeCertificationType`, `hasELVO`, `airOnly`,
  coordinates), weights are user-visible, and every score decomposes into an
  auditable "Why?" list.

## QA evidence (local browser, 2026-07-03)

- Boot: 132 hospitals, zero console errors/warnings across the full session.
- Candidates: top-ranked sites are uncertified SE-Alaska hospitals 550–700 mi
  from the nearest EVT center — face-valid for the region; "Why?" points sum to
  the displayed score (40+40+20+8 → capped 100 for Bartlett Regional).
- Scenario: weight change to 100/0/20 re-ranked live; URL gained `wc=100&we=0`;
  reset restored defaults and cleaned the URL.
- URL round-trip: `?none=1&state=MT&wc=60&dm=120` restored pill, state filter
  (2 of 132 shown), weight 60, threshold 120 ("11 beyond 120 mi").
- Exports captured in-browser: candidates CSV (106 rows, air-only site shows
  ground `N/A`), filtered hospitals CSV (with new distance columns, 132 rows
  unfiltered), distance matrix CSV (unchanged, 132 rows).
- Regression: lazy popups render; EVT-deserts / zero-capability / distance-map
  overlays all restyle 132 cached markers; normal view restores.
- Keyboard: `E` opens candidates with focus trapped in-modal; `Esc` closes.
- Mobile 375px: candidates modal usable; dark mode: QA panel legible.
- `scripts/verify-data.py`: 7/7 checks pass. `node --check app.js`: clean.
- Not browser-verifiable headlessly: the OS print dialog (manual step in the
  deploy checklist) and PNG export (external html2canvas CDN; code path
  unchanged from 2.2.1).

## Adversarial review round (25-agent workflow, 3 lenses, findings verified)

20 findings confirmed, 2 refuted; all confirmed findings fixed and re-verified
in the browser:

- Hostile shareable URLs (`?cap=0`, `?wc=500`) could poison every score to NaN
  and stick in the URL → scenario params now clamp to the slider ranges, plus a
  division guard in the scoring function.
- Keyboard-sorting the candidates table destroyed the focused header and
  escaped the modal focus trap; headers also weren't announced as interactive →
  headers are now native buttons inside `th`, refocused after each re-render.
- "Show on map" silently no-oped when active filters hid the candidate →
  now opens the hospital detail modal and explains with a toast.
- `E`/`Q` while their modal was open stacked focus traps; closing a
  shortcut-opened modal stranded focus in the hidden overlay → open guard +
  focus parks on the tools FAB when there's no meaningful restore target.
- Dark-mode contrast: sorted-header white-on-light-indigo (~1.9:1) and
  hardcoded QA status hexes → fixed indigo-800 header, theme-aware
  `qa-pass/qa-warn/qa-fail` classes (≥4.5:1 both modes).
- Desert-threshold changes left the dashboard metric and the static
  "EVT deserts (>100 mi)" menu label stale → both now track the scenario value;
  `R` also re-renders an open candidates modal.
- aria-live summary announced on every slider tick → visible summary is
  immediate, screen-reader announcement debounced via a separate live region.
- Print-cleanup timer could strip the print layout mid-dialog on iOS Safari →
  cleanup now only on `afterprint`.
- Stale doc refs (verify-data.py citing §6; in-app QA panel showing 4 of the 5
  documented checks) → §7 cited, fifth check (populated city) added in-app.

## Known gaps / candidate v2 items

- No population weighting in scores (documented limitation).
- `facilities.json` (synthetic v2.2.0 dataset) is still in the repo but unused
  by the app; kept for history, could be archived.
- Candidate table could offer per-state grouping and a map-linked hover.
- PNG export still loads html2canvas from a CDN at click time.

## Data currency sweep (2026-07-03, pre-deploy)

46-agent verification workflow (6 sweep lenses + two-source adjudication). Applied
(all two-source confirmed): Peace Island ASR (new June 2026 WA designation), 3 Idaho
TSE Level III additions, 3 CMS CCN corrections, 2 certification-detail fills.
last_verified → 2026-07-03; data_version → 2026.07.03.1.

**Pending verification (NOT applied — adjudication incomplete or single-source; carry
into next data pass):**
- hasELVO doubts from WA DOH asterisk absence (single source, hospitals still advertise
  EVT): PeaceHealth Southwest, Kadlec, MultiCare Deaconess, Providence St Peter.
- Samaritan Moses Lake possible WA Level II (rejected on adjudication — likely column
  ambiguity in DOH list; recheck).
- East Adams Rural possibly dropped from WA ECS participating list.
- Idaho Falls Community possible TSE III→II upgrade (registry shows II; needs 2nd source).
- Cheyenne Regional JC recert detail (single source); Portneuf/Nampa TSE detail appends.
- Possible additions outside current dataset: Swedish Ballard campus (WA Level III),
  Intermountain St James Butte MT (PSC).
