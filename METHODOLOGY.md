# Methodology

*Schema 4.0.0 · release 4.0.0 · evidence review 2026-10-17. Counts below are generated from the data by `scripts/build-dataset.py`.*

<!-- counts:start -->253 facility records (WA 95, AK 22, ID 45, MT 62, WY 29): 96 in the adult emergency-stroke analysis set, 3 excluded with a documented reason, 154 with eligibility unresolved; 7 not yet located. Stroke capability: 130 assessed, 1 partly assessed, 117 not assessed, 5 with conflicting evidence; 21 with documented 24/7 thrombectomy. 0 receiving centers outside the five states are included as destinations only. Data 2026.10.17.1, evidence review 2026-10-17.<!-- counts:end -->

This document explains what the dataset contains, how each kind of claim is established, what the dates mean, how distances and transport scenarios are computed, how the access review is scored, and what the data cannot tell you. It is a public-source planning reference: not a clinical decision aid, not dispatch or patient-routing guidance, and not an official product of any health department or accreditor. It represents no institutional approval, affiliation, referral agreement or real-time availability.

---

## 1. What a record is

A record is one **hospital campus** — a physical site — identified by a stable internal `id`. Most ids are the campus's CMS Certification Number (CCN); campuses without their own CCN use a readable id (`130006-MERIDIAN`, `WA-MADIGAN-AMC`). Ids never change meaning: when a campus is renamed, merged or closed, the record stays and says so (`status`), and any earlier id it carried is listed in `previousIds`.

Campus, health system, outpatient facility, mailing address and Medicare billing number are kept apart:

| Field | Meaning |
|---|---|
| `ccn.value` / `ccn.relation` | The CMS Certification Number the campus bills under: `own`, `shared` (a provider-based campus billing under another campus's CCN; `parentId` names it), `none` (not a Medicare-certified provider, e.g. a military hospital) or `unknown`. Bed counts and ownership from CMS describe the whole CCN, so they are not attributed to a shared-CCN campus. |
| `npi` | The campus's NPPES organization record (282N hospital taxonomy at the physical address), when one was matched. |
| `address` | The **physical** campus address. Mailing PO boxes are never used as the location. `address.status` says whether it was verified. |
| `location` | Coordinates with their `method` (where they came from) and `precision` (`campus`, `street`, `city`, `unknown`). `location: null` means **not located** — the record stays searchable and is counted, but no point is drawn. |
| `system` | Public health-system affiliation with its evidence, or `independent`/`unknown`. Affiliation never implies a telestroke, referral, transfer or contract relationship. |

## 2. The source universe and the inventory denominator

The census denominator is the **CMS Hospital General Information** dataset for the five states. The current release (data.cms.gov dataset `xubh-q36u`) could not be retrieved in the October 2026 pass — the host was blocked from the authoring environment — so the vendored October 2023 snapshot (`data/cms-census-wwami-2023-10.csv`, archived copy) is the reference, and refreshing it is the first item on the worklist. Some snapshot rows last appear in an older month; their `as_of` says so and their status was checked separately.

Every census row is accounted for: matched to a campus record, or represented as a closed/merged record, or listed in the worklist. Rows without coordinates are **not** dropped: they are records with `location: null` until a campus location is documented.

The census cannot supply facilities that are not in it (military, Veterans Affairs and some tribal hospitals; hospitals opened after October 2023; campuses that share a parent's CCN). Those are added only when the evidence review identifies them, and the inventory is therefore described as *the CMS census plus identified additions*, not "every hospital".

The NPPES NPI Registry (CMS) was queried for every state's hospital organization records, to confirm current legal and trade names, physical practice addresses, active/deactivated status and taxonomy (including the Critical Access taxonomy), and to list NPPES hospitals with no matching record as leads.

## 3. Separate dimensions

Facility characteristics overlap — a tribal hospital can be a Critical Access Hospital; a pediatric hospital can have a 24/7 emergency department — so each is its own sourced claim rather than one category:

`status` (active / closed / merged / unknown) · `serviceType` (general acute, specialty, Rural Emergency Hospital…) · `population` (all ages / adult / pediatric) · `cah` (Critical Access Hospital designation) · `ed` (general emergency department open 24/7) · `governance` (nonprofit, proprietary, local government/hospital district, state, IHS, tribal, DoD, VA) · `system`.

Stroke capability is four more, also kept separate everywhere — schema, map, list, detail, filters, charts, comparison, scoring and exports:

| Claim | What it records |
|---|---|
| `national` | National certification: accrediting body (Joint Commission, DNV, ACHC, CIHQ), program as the body names it, tier, effective/expiry dates when known. |
| `stateDesignation` | State designation: issuing authority, system (Washington ECS categorization; Idaho TSE designation), level exactly as issued (e.g. Idaho **Level II+**), status including pending. Montana, Wyoming and Alaska are recorded as `not-applicable` only where no state program was found. |
| `evt` | Endovascular thrombectomy capability documented for this campus. |
| `evt247` | 24/7 thrombectomy documented explicitly, or entailed by a named current credential (`basis` says which). |

A Primary Stroke Center may document 24/7 thrombectomy; certification alone does not establish current service availability; absence from a directory is not proof of absent capability.

### Claim states

| State | Meaning |
|---|---|
| `affirmative` | Positive evidence (see sources and `checked`). |
| `negative` | Verified absent within a stated scope and date. |
| `no-record-found` | Searched the stated sources and found no record. **Not** proof of absence; displayed as "No record found in reviewed sources". |
| `unknown` | Not assessed or could not be assessed. Never encoded as false, zero or "No". |
| `conflicting` | Credible sources disagree; both are cited and neither is shown as settled. |
| `not-applicable` | The claim does not apply. |

### Display tier and the crosswalk

For drawing and filtering, each record shows one tier (CSC/TSC/PSC/ASR). It comes from the national certification when one is documented; otherwise from the state designation through an explicit **display crosswalk**:

| System | Level → shown as |
|---|---|
| WA ECS | I → CSC · II → PSC · III → ASR |
| Idaho TSE | I → CSC · II+ → TSC · II → PSC · III → ASR |

The crosswalk exists so state-designated sites can be coloured alongside nationally certified ones. It does **not** mean the hospital holds, or meets the standards of, the national certification of that tier, and every surface that shows a crosswalked tier names its basis (`derived.tierBasis = state-crosswalk`). DNV's *Primary Stroke Center Plus* is shown on the TSC tier and named as such.

## 4. Evidence and provenance

Every material claim carries `evidence: [{src, excerpt, kind, supports}]`, a `checked` date and a `method`. `src` points into a shared source registry (`data/curated/sources.json`, published inside `hospitals.json`) holding the URL, publisher, title, document dates, access date and access method, so one registry page cited by forty records is one source entry.

| Method | Meaning |
|---|---|
| `prior-edition` | Carried forward from the previous edition (v3, data 2026.09.13.1) with that edition's own check date and source text. Not re-observed in the current pass unless a later claim says so. |
| `search-extract` | Observed through a web-search tool's extraction of the cited page. Direct page fetching was blocked in the authoring environment, so the page itself was not opened; excerpts are labelled `quote` only when the tool presented verbatim page text, otherwise `paraphrase`. Registry content was accepted only when repeated, independent queries agreed, and the number of queries is recorded. |
| `nppes-api` | Retrieved from the CMS NPPES NPI Registry API. Self-reported by the provider: good for names, physical address and status; weak on its own for designations. |
| `cms-dataset` | Read from the vendored CMS snapshot (its month is stated). |
| `regulatory-inference` | Follows from a cited regulation or program requirement plus another documented fact — e.g. CMS Conditions of Participation require a Critical Access Hospital to provide emergency services 24 hours a day (42 CFR 485.618), so a documented CAH has a documented 24/7 ED. |
| `manual-review` | Reconciled by the maintainer from the cited sources. |

**Who settles what.** The issuer settles its own credential: the Washington State Department of Health for ECS categorization, Idaho DHW (Bureau of EMS & Preparedness) for TSE designation, each accrediting body for its certifications. A clear current registry is not vetoed by an older hospital press release or web page; a genuine unresolved disagreement is recorded as `conflicting` with both sides cited. Document dates are the document's own publication, effective, revision or expiry dates — never a search date, crawl date or website footer year. Historical material (for example a 2010 dataset republished on a newer page) is context only and cannot establish a current roster.

**What a rebuild does not do.** A rebuild, a page refresh, a press sweep or a passing test does not re-verify anything. The build never stamps a verification date, never promotes a claim, and never turns `unknown` into "none": every state and date in `hospitals.json` is the one recorded on the curated claim, and running the build twice produces identical bytes.

### What the dates mean

| Date | Meaning |
|---|---|
| `release` | App and dataset release version. |
| `data_version` | Version of the dataset content (YYYY.MM.DD.n by the date the curated inputs last changed). |
| `generated` | Date the curated inputs behind the file last changed. **Not** a verification date. |
| `evidence_review_date` | Date of the most recent evidence-review pass. It does **not** mean every record was verified that day. |
| claim `checked` | When that claim was last compared against its cited evidence; `null` = never. |
| source `published` / `effective` | The document's own dates, when it states them. |
| source `accessed` | When the evidence was observed, with the access method. |
| CMS `asOf` | The CMS snapshot month a reference row comes from. |

## 5. The adult emergency-stroke analysis set

All records stay searchable. Analyses and default map views use a defined denominator:

- **Eligible** — active campus **and** a documented general emergency department open 24/7 **and** serving adults (all ages or adult).
- **Excluded** (with the reason) — closed or merged; documented absence of a general 24/7 ED; pediatric-only hospital.
- **Unresolved** — anything else. Unresolved is neither eligible nor excluded.

A name never excludes a hospital: "Clinic" in a name (Great Falls Clinic Hospital, Billings Clinic) is not evidence about its emergency department. Map and list default to *eligible + unresolved*, with unresolved records badged; the filters can switch to the eligible set only, include excluded records, or show every record. Counts are always computed from the data in view and state their scope.

## 6. Geography

- **County/borough** is derived from the coordinates against generalised 2017 Census cartographic boundaries (`data/geo/wwami-boundaries.json`, built by `scripts/build-geo.py` from the `us-atlas` package). Points within a mile of a county line are flagged as uncertain. Alaska's 2019 split of the Valdez-Cordova Census Area post-dates the boundaries.
- **State containment** is checked against the state polygon with a 3-mile tolerance for generalised coastlines (bounding boxes are not enough: an Alaska point can be "in bounds" and in the sea).
- **Location method and precision are recorded, not inferred.** Earlier editions labelled coordinates "rooftop" from their number of decimal places; that inference is gone. CMS-supplied coordinates are labelled as such (CMS does not document its geocoding), earlier-edition geocodes say their geocoder, query and match type were not recorded, and city-centroid placements say so. A point falling in the right ZIP or county is **not** proof it is on the right campus.

## 7. Distances, destinations and transport scenarios

**Distances** are straight-line (great-circle) miles between recorded coordinates. Lines on the map are geometry — not road routes, transfer pathways or referral relationships. Circles are straight-line radii, not travel-time isochrones.

**"Nearest" always names its destination set**:

- *documented 24/7 EVT centers* — `evt247` affirmative;
- *CSC/TSC-level centers* — display tier CSC or TSC (national certification, or a state level on that tier).

A destination must be an active, located campus in the analysis set, or a listed neighboring-state center. When the sending hospital is itself in the set the answer is **on site, 0 mi** — a real value, distinct from unknown. The nearest geometric destination is not necessarily the clinically appropriate or accepting destination.

**Edge effects.** Border hospitals can be closer to receiving centers outside the five states. A small, source-verified set of neighboring-state centers (`data/curated/neighbors.json`) is included as destinations only — shown as squares, never counted in the inventory, and removable with one switch. Canadian centers are not included.

**My receiving center** is a user choice of any active, eligible campus (Harborview Medical Center is offered as a one-click preset). It is kept in the browser and in links the user chooses to share. The comparison is *my center minus the nearest documented 24/7 EVT center*, in the same metric. Modeled minute differences are shown only when both legs use the same mode and both are modeled; otherwise "unavailable" with the reason. Differences are worded as "lower/higher under this scenario" — never as catchments, partnerships, acceptance or recommendations.

**Transport scenarios** are illustrative, adjustable assumptions — not measured performance, dispatch estimates or aircraft availability. The app never chooses a transport asset.

| Interval | Start → end | Scenario default |
|---|---|---|
| DIDO (sending hospital) | ED arrival → departure. Transport activation and loading happen inside it, so they are not added again. | 60 min (input, not a benchmark) |
| Ground leg | departure → arrival at the receiving hospital | straight-line × 1.25 road factor at 55 mph + 8 min handover |
| Rotor-wing leg | departure → arrival | 140 mph + 15 min, within a 150-mi scenario range |
| Fixed-wing leg | departure → arrival, including ground legs to/from airports | 250 mph + 40 min ground legs + 20 min handling |
| Receiving-center intervals | arrival → treatment | **not modeled** |

Ground transfer is modeled only between campuses on the **same documented road network** (`roadNetwork`): the contiguous-US road network; the Alaska Railbelt (treated as separate — the cross-border road is not an acute transfer route); isolated local networks; and ferry-dependent sites (no ground model across a ferry). Unknown connectivity shows ground as unavailable, never as a plausible time. Weather, staffing, asset availability, airport/landing access and acceptance are not modeled.

No total is compared with a treatment-time target, and no on-target/over-target judgement is made: the spoke-arrival-to-receiving-arrival clock is not a door-to-needle or door-to-device interval, treatment may begin at the sending hospital, and eligibility for treatment depends on clinical information this map does not hold.

## 8. Access review (public-data scenario)

The access review ranks **questions to investigate**, not hospitals to approach.

- **Candidates**: campuses in the analysis set without on-site documented 24/7 EVT and without a CSC/TSC-level tier.
- **Score** (0–100) = weighted mean of normalized components:
  - *documented certification gap*: none found 1.0 · ASR 0.65 · PSC 0.35;
  - straight-line miles to the nearest documented 24/7 EVT center, capped and divided by the cap;
  - straight-line miles to the nearest CSC/TSC-level center, capped;
  - optionally, miles to my receiving center, capped.
- **Missing evidence never becomes a gap.** Candidates whose capability is unassessed or conflicting get no gap value; they go to a separate **verification shortlist**, ranked by geography alone.
- **Ties** (same score to 0.1) share a rank and are ordered by distance to EVT, then name, then id. **All-zero weights** produce no ranking and say so. **Sensitivity**: each candidate's rank range when each non-zero weight is halved or increased by half in turn.
- The score uses only public geometry and documented capability. It does not model operations, staffing, volumes, population, payer mix, existing telestroke coverage, contracts or business opportunity, and it never changes the data.

**Presets** frame common questions with transparent filters: *Telestroke access review*, *EVT capability assessment*, *State designation review*. None establishes onboarding eligibility, certification eligibility, the feasibility of an EVT program, or an outreach list.

## 9. Checks

`python3 scripts/verify-data.py` runs structural checks on the built file: identity, vocabularies, referential integrity of every cited source, dated evidence for every documented claim, tier traceability, geography against state polygons, denominators, and that no unassessed record carries a tier. `python3 scripts/build-dataset.py --check` confirms the committed outputs are exactly what the curated inputs produce. The same structural checks run in the app's Data & methods view.

**Structural checks are not factual verification.** Passing them means the file is internally consistent; it says nothing about whether a hospital's certification is current.

## 10. Limits

- Primary registries (Joint Commission Quality Check, DNV certificate checker, WA DOH, Idaho TSE, data.cms.gov) could not be opened directly from the authoring environment in the October 2026 pass. Claims checked then were observed through web-search extracts of the cited pages or the NPPES API, and say so; the worklist names the direct check that would settle each one.
- Many values are carried forward from the previous edition with that edition's check date. They are not re-verified by being carried forward.
- The CMS census is the October 2023 snapshot; hospitals opened since appear only where the review identified them.
- Straight-line geometry only: no road routing, traffic or weather. Transport scenarios are illustrative.
- No population weighting: the data hold no denominator for people served.
- Unknown is a valid answer and is shown as unknown.

## 11. Maintenance

See [docs/SOURCE-MAINTENANCE.md](docs/SOURCE-MAINTENANCE.md) for how to re-check a claim, add a source, refresh the census, and rebuild; [docs/SCHEMA.md](docs/SCHEMA.md) for every field; and [docs/EVIDENCE-AUDIT-2026-10.md](docs/EVIDENCE-AUDIT-2026-10.md) for what this pass checked, corrected, confirmed and left open.
