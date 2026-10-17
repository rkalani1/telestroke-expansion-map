# Methodology

*Schema 4.0.0 · release 4.0.0 · evidence review 2026-10-17. Counts below are generated from the data by `scripts/build-dataset.py`.*

<!-- counts:start -->253 facility records (WA 95, AK 22, ID 45, MT 62, WY 29): 133 in the adult emergency-stroke analysis set, 3 excluded with a documented reason, 117 with eligibility unresolved; 0 not yet located. Stroke capability: 127 assessed, 36 partly assessed, 84 not assessed, 6 with conflicting evidence; 19 with documented 24/7 thrombectomy. 8 receiving centers outside the five states are included as destinations only. Data 2026.10.17.1, evidence review 2026-10-17.<!-- counts:end -->

This document explains what the dataset contains, how each kind of claim is established, what the dates mean, how distances and transport scenarios are computed, how the access review is scored, and what the data cannot tell you. It is a public-source planning reference: not a clinical decision aid, not dispatch or patient-routing guidance, and not an official product of any health department or accreditor. It represents no institutional approval, affiliation, referral agreement or real-time availability.

---

## 1. What a record is

A record is one **hospital campus** — a physical site — identified by a stable internal `id`. Most ids are the campus's CMS Certification Number (CCN); campuses without their own CCN use a readable id (`130006-MERIDIAN`, `530008-LANDER`, `WA-MADIGAN-AMC`). Ids never change meaning: when a campus is renamed, merged or closed, the record stays and says so (`status`), and any earlier id it carried is listed in `previousIds` — links that use an old id open the record that now carries it. (In 4.0 the Tacoma General campus, which the previous edition had filed under Astria Regional Medical Center's CCN 500012, became `500129-TACOMA-GENERAL`; `500012-ASTRIA` is the Yakima hospital that CCN belongs to.)

Campus, health system, outpatient facility, mailing address and Medicare billing number are kept apart:

| Field | Meaning |
|---|---|
| `ccn.value` / `ccn.relation` | The CMS Certification Number the campus bills under: `own`, `shared` (a provider-based campus billing under another campus's CCN; `parentId` names it), `none` (not a Medicare-certified provider, e.g. a military hospital) or `unknown`. Bed counts from CMS describe the whole CCN, so they are not attributed to a shared-CCN campus. `ccn.previous` lists earlier CCNs of the same campus (with the CMS name and the last snapshot that listed it), so the census mapping is explicit. |
| `npi` | The campus's NPPES organization record (282N hospital taxonomy at the physical address), when one was matched. |
| `address` | The **physical** campus address. Mailing PO boxes are never used. `address.status`: `corroborated` (the previous edition's CMS address and the NPPES practice location agree), `source-reported` (one registry record), `prior-edition`, `coordinate-derived` (a town an earlier edition inferred from coordinates), `conflicting` (registries disagree; both are in the note) or `unknown`. A different NPPES street was adopted only after review (for example Samaritan Hospital's 2026 replacement campus); otherwise the record is marked conflicting. Where an NPPES record belongs to a parent campus (St. Luke's Meridian, Allenmore), its address is not used. |
| `location` | Coordinates with their `method` (where they came from) and `precision` (`campus`, `street`, `city`, `unknown`). `location: null` means **not located** — the record stays searchable and is counted, but no point is drawn. See §6. |
| `system` | Public health-system affiliation with its evidence, or `independent`/`unknown`. Affiliation never implies a telestroke, referral, transfer or contract relationship. |

## 2. The source universe and the inventory denominator

The census denominator is the **CMS Hospital General Information** dataset for the five states. The current release (data.cms.gov dataset `xubh-q36u`) could not be retrieved in the October 2026 pass — the host was blocked from the authoring environment — so the vendored October 2023 snapshot (`data/cms-census-wwami-2023-10.csv`, archived copy) is the reference, and refreshing it is the first item on the worklist. Some snapshot rows last appear in an older month; their `as_of` says so and their status was checked separately.

Every census row is accounted for: it is a campus record's CCN, or one of its `ccn.previous` (Big Sky's earlier acute-care CCN, Mt. Edgecumbe's earlier CCN, Idaho Doctors Hospital as Grove Creek's former name, Lander Regional as SageWest's Lander campus, UW Medicine/Northwest Hospital as UW Medical Center – Northwest), or a record of its own whose status is open until a source settles it. The previous edition dropped sixteen census rows — among them Yukon-Kuskokwim Delta Regional, Norton Sound, Maniilaq, Kanakanak, Providence Valdez, Cordova, Mary Bridge Children's and two IHS hospitals in Montana; all are records again. Rows without coordinates are **not** dropped (see §6).

The census cannot supply facilities that are not in it (military, Veterans Affairs and some tribal hospitals; hospitals opened after October 2023; campuses that share a parent's CCN). Those are added only when the evidence review identifies them, and the inventory is therefore described as *the CMS census plus identified additions*, not "every hospital".

The NPPES NPI Registry (CMS) was queried for every state's hospital organization records (taxonomies General Acute Care Hospital, Military Hospital and Rural Emergency Hospital), to confirm current legal and trade names, physical practice addresses, active status and taxonomy, and to list NPPES hospitals with no matching record — chiefly Veterans Affairs and military facilities, department-level duplicates and former hospitals — as leads for the worklist.

### How identity claims were assigned

| Claim | Rule (written into each claim's note) |
|---|---|
| `cah` | CMS hospital type in the snapshot, cross-checked with the CMS numbering (CAHs hold CCNs ending 1300–1399) and the NPPES Critical Access taxonomy; disagreement is `conflicting`. Military hospitals: `not-applicable`. |
| `governance` | CMS ownership category (federal split into IHS and others by facility identity); DoD from the NPPES military taxonomy. |
| `serviceType`, `population` | CMS hospital type and NPPES primary taxonomy; children's hospitals are `pediatric`; other general acute hospitals are taken to serve all ages (`rule-based`). |
| `system` | Only when the NPPES legal or trade name names the system. |
| `status` | `active` when an NPPES record updated since January 2024 and the CMS October 2023 snapshot both list the campus, or a current state roster lists it, or a credential for it was described in sources read in this pass; otherwise `unknown` with the reason. These are administrative records, not observations of operations. |
| `ed` | Documented directly; or inferred for a Critical Access Hospital from the Condition of Participation requiring 24-hour emergency services (42 CFR 485.618; a Rural Emergency Hospital must also staff an ED 24/7); or inferred for a current Washington ECS **Level II** stroke center, whose categorization criteria require "Emergency Department personnel trained in diagnosing and treating acute stroke 24 hours a day, seven days a week". The Level I and III criteria retrieved did not state an ED requirement, and no ED requirement was found for Idaho TSE levels or Joint Commission/DNV certifications, so those credentials alone do not document an ED. |

## 3. Separate dimensions

Facility characteristics overlap — a tribal hospital can be a Critical Access Hospital; a pediatric hospital can have a 24/7 emergency department — so each is its own sourced claim rather than one category:

`status` (active / closed / merged / unknown) · `serviceType` (general acute, specialty, Rural Emergency Hospital…) · `population` (all ages / adult / pediatric) · `cah` (Critical Access Hospital designation) · `ed` (general emergency department open 24/7) · `governance` (nonprofit, proprietary, local government/hospital district, state, IHS, tribal, DoD, VA) · `system`.

Stroke capability is four more, also kept separate everywhere — schema, map, list, detail, filters, charts, comparison, scoring and exports:

| Claim | What it records |
|---|---|
| `national` | National certification: accrediting body (Joint Commission, DNV, ACHC, CIHQ), program as the body names it, tier, effective/expiry dates when known. |
| `stateDesignation` | State designation: issuing authority, system (Washington ECS categorization; Idaho TSE designation; Wyoming Department of Health Heart and Stroke Center designation, which follows national accreditation), level exactly as issued (e.g. Idaho **Level II+**), status including pending. No hospital stroke designation program was found in operation in Montana or Alaska (October 2026; an Alaska bill passed the Legislature in May 2026), so those records say "no state program found" rather than "not designated". The current Wyoming designated list was not found, so Wyoming designations are not assessed. |
| `evt` | Endovascular thrombectomy capability documented for this campus. |
| `evt247` | 24/7 thrombectomy documented explicitly, or entailed by a named current credential (`basis` says which). |

A Primary Stroke Center may document 24/7 thrombectomy; certification alone does not establish current service availability; absence from a directory is not proof of absent capability. What a credential entails was checked against the program's own materials: Joint Commission Thrombectomy-Capable and Comprehensive Stroke Centers require documented 24/7 neurointerventional coverage, and a Washington ECS asterisk means Level I/II with all aspects of large-vessel-occlusion therapy available 24/7, so either can be the `basis` for `evt247`. DNV's Primary Stroke Center Plus and Idaho TSE Level II+ require thrombectomy capability, but no text was found requiring it 24/7, so they document `evt`, not `evt247`, on their own.

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

### Assessment state of a record

`derived.capability` summarises the capability claims (national certification, thrombectomy, 24/7 thrombectomy, and the state designation where the state has a program): **assessed** when every one is documented (any state but unknown), **partial** when some are documented and some unknown, **not assessed** when none was looked at, and **conflicting** when any is conflicting. "Not assessed" is never shown as "none". A record with no display tier is shown as *none found* only when it is assessed; a partly assessed record without a tier is shown as *partly assessed* (grey fill with a dashed purple ring), because the credential that would give it a tier may simply not have been checked yet (`derived.tierClass`).

## 4. Evidence and provenance

Every material claim carries `evidence: [{src, excerpt, kind, supports}]`, a `checked` date and a `method`. `src` points into a shared source registry (`data/curated/sources.json`, published inside `hospitals.json`) holding the URL, publisher, title, document dates, access date and access method, so one registry page cited by forty records is one source entry.

| Method | Meaning |
|---|---|
| `prior-edition` | Carried forward from the previous edition (v3, data 2026.09.13.1) with that edition's own check date and source text. Not re-observed in the current pass unless a later claim says so. |
| `search-extract` | Observed through a web-search tool's extraction of the cited page. Direct page fetching was blocked in the authoring environment, so the page itself was not opened; excerpts are labelled `quote` only when the tool presented verbatim page text, otherwise `paraphrase`. Registry content was accepted only when repeated, independent queries agreed, and the number of queries is recorded. |
| `nppes-api` | Retrieved from the CMS NPPES NPI Registry API. Self-reported by the provider: good for names, physical address and status; weak on its own for designations. |
| `cms-dataset` | Read from the vendored CMS snapshot (its month is stated). |
| `regulatory-inference` | Follows from a cited regulation or program requirement plus another documented fact — e.g. CMS Conditions of Participation require a Critical Access Hospital to provide emergency services 24 hours a day (42 CFR 485.618), so a documented CAH has a documented 24/7 ED. |
| `rule-based` | Assigned by a documented rule applied to the cited sources; the rule is written in the claim note (see §2). |
| `manual-review` | Reconciled by the maintainer from the cited sources, with the reasoning in the note. |

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

- **Eligible** — active campus **and** a general emergency department open 24/7 **and** serving adults (all ages or adult). The emergency department is either documented for the campus or inferred from a program requirement the campus is subject to: the Critical Access Hospital conditions of participation (42 CFR 485.618) or the Washington stroke Level II designation criteria. In this edition every eligible record rests on such an inference; each record's eligibility reason says which, and a campus-specific ED source would replace it.
- **Excluded** (with the reason) — closed or merged; documented absence of a general 24/7 ED; pediatric-only hospital.
- **Unresolved** — anything else. Unresolved is neither eligible nor excluded.

A name never excludes a hospital: "Clinic" in a name (Great Falls Clinic Hospital, Billings Clinic) is not evidence about its emergency department. Map and list default to *eligible + unresolved*, with unresolved records badged; the filters can switch to the eligible set only, include excluded records, or show every record. Counts are always computed from the data in view and state their scope.

## 6. Geography

- **County/borough** is derived from the coordinates against generalised 2017 Census cartographic boundaries (`data/geo/wwami-boundaries.json`, built by `scripts/build-geo.py` from the `us-atlas` package). Points within a mile of a county line are flagged as uncertain. Alaska's 2019 split of the Valdez-Cordova Census Area post-dates the boundaries.
- **State containment** is checked against the state polygon with a 3-mile tolerance for generalised coastlines (bounding boxes are not enough: an Alaska point can be "in bounds" and in the sea).
- **Location method and precision are recorded, not inferred.** Earlier editions labelled coordinates "rooftop" from their number of decimal places; that inference is gone. CMS-supplied coordinates are labelled as such (CMS does not document its geocoding), and earlier-edition geocodes say their geocoder, query and match type were not recorded. Where the earlier geocode and the CMS point agree within 0.3 mi and the street address is corroborated, the agreement is recorded (`method: rule-based`, `agreementFt`) but precision stays `unknown`: two geocodes that do not record their match type corroborate each other without establishing a precision. Where they disagree by more than a mile the record carries both points and is flagged, unless reviewed (St. Michael Medical Center and Trios moved campuses after the CMS point was recorded; Lourdes' earlier geocode was 4.5 mi from its address). No geocoder was reachable from the authoring environment, so no new street-level geocodes were made.
- **Town check.** Each record's coordinates are compared with the GeoNames point for the town its address names (`data/geo/cities-wwami.json`, built by `scripts/build-cities.py`, CC BY 4.0). More than 15 mi apart is flagged `far-from-named-city`; a point more than 8 mi from the named town and under a third of that distance from another town is flagged `nearer-to-another-town` (the pattern of the previous edition's errors, which a fixed radius alone misses); a town missing from the gazetteer is flagged `town-not-in-gazetteer`, so an unchecked record is visible rather than silently passed. This check found the previous edition's Alaska errors (South Peninsula Hospital in "Anchor Point", Central Peninsula in "Sterling") and showed that its relocation of six records to ZIP-area centroids had itself moved Cascade Medical Center 23 mi from Cascade, ID; those six now use their CMS coordinates again. A town-level match is still not proof of the campus location.
- **Town-level placement.** A record with no cited coordinates but a documented town is placed at that town's GeoNames point with precision `city`, labelled "town centre — approximate" wherever it is shown, and stays on the worklist. Distances from such points are approximate. A record with neither stays unlocated rather than receiving an invented point.

## 7. Distances, destinations and transport scenarios

**Distances** are straight-line (great-circle) miles between recorded coordinates. Lines on the map are geometry — not road routes, transfer pathways or referral relationships. Circles are straight-line radii, not travel-time isochrones.

**"Nearest" always names its destination set**:

- *documented 24/7 EVT centers* — `evt247` affirmative;
- *CSC/TSC-level centers* — display tier CSC or TSC (national certification, or a state level on that tier).

A destination must be an active, located campus that is not excluded (closed, pediatric-only, or documented without a general ED), or a listed neighboring-state center. A documented emergency department is required of a *sending* hospital in the analysis set, not of a receiving center whose stroke credential is itself documented. When the sending hospital is itself in the set the answer is **on site, 0 mi** — a real value, distinct from unknown. The nearest geometric destination is not necessarily the clinically appropriate or accepting destination.

**Edge effects.** Border hospitals can be closer to receiving centers outside the five states. Neighboring-state centers with a supported Comprehensive, Thrombectomy-Capable or DNV Primary Stroke Center Plus credential (`data/curated/neighbors.json`: OHSU, Legacy Emanuel and PeaceHealth RiverBend in Oregon; University of Utah, Intermountain Medical Center and McKay-Dee in Utah; UCHealth Medical Center of the Rockies in Colorado; Sanford Bismarck in North Dakota) are included as destinations only — shown as squares, never counted in the inventory, and removable with one switch. Their credentials rest on the hospitals' own current pages and state lists (issuer directories were unreachable), and no source gave campus coordinates, so each sits at its town's centre and distances to it are approximate. Centers whose certifier was unnamed or conflicting (Providence St. Vincent, Providence Portland, CHI St. Alexius) and PSC-only centers are not included. Canadian centers are not included.

**My receiving center** is a user choice of any campus that could be a destination (as above) (Harborview Medical Center is offered as a one-click preset). It is kept in the browser and in links the user chooses to share. The comparison is *my center minus the nearest documented 24/7 EVT center*, in the same metric. Modeled minute differences are shown only when both legs use the same mode and both are modeled; otherwise "unavailable" with the reason. Differences are worded as "lower/higher under this scenario" — never as catchments, partnerships, acceptance or recommendations.

**Transport scenarios** are illustrative, adjustable assumptions — not measured performance, dispatch estimates or aircraft availability. The app never chooses a transport asset.

| Interval | Start → end | Scenario default |
|---|---|---|
| DIDO (sending hospital) | ED arrival → departure from the first hospital, as Get With The Guidelines–Stroke defines door-in-door-out. Transport activation and loading happen inside it, so they are not added again. | 60 min (input, not a benchmark) |
| Ground leg | departure → arrival at the receiving hospital | straight-line × 1.25 road factor at 55 mph + 8 min handover |
| Rotor-wing leg | departure → arrival | 140 mph + 15 min, within a 150-mi scenario range |
| Fixed-wing leg | departure → arrival, including ground legs to/from airports | 250 mph + 40 min ground legs + 20 min handling |
| Receiving-center intervals | arrival → treatment | **not modeled** |

Ground transfer is modeled only between campuses on the **same documented road network** (`roadNetwork`): the contiguous-US road network; the Alaska Railbelt (treated as separate — the cross-border road is not an acute transfer route); isolated local networks; and ferry-dependent sites (no ground model across a ferry). Unknown connectivity shows ground as unavailable, never as a plausible time. Weather, staffing, asset availability, airport/landing access and acceptance are not modeled. Every number in the table — speeds, the road factor, the rotor-wing range and each mode's fixed handover or handling time — is adjustable in Explore → Transport scenario assumptions and carried in share links; the assumptions sentence under each scenario table states all of them, so the minutes shown can be reproduced from it.

No total is compared with a treatment-time target, and no on-target/over-target judgement is made: the spoke-arrival-to-receiving-arrival clock is not a door-to-needle or door-to-device interval, treatment may begin at the sending hospital, and eligibility for treatment depends on clinical information this map does not hold.

## 8. Access review (public-data scenario)

The access review ranks **questions to investigate**, not hospitals to approach.

- **Candidates**: campuses in the analysis set without on-site documented 24/7 EVT and without a CSC/TSC-level tier.
- **Score** (0–100) = weighted mean of normalized components:
  - *documented capability-tier gap* — from the display tier, so from the national certification or, where there is none, the state level: none found 1.0 · ASR 0.65 · PSC 0.35;
  - straight-line miles to the nearest documented 24/7 EVT center, capped and divided by the cap;
  - straight-line miles to the nearest CSC/TSC-level center, capped;
  - optionally, miles to my receiving center, capped.
- **Missing evidence never becomes a gap.** Candidates whose capability is unassessed, partly assessed or conflicting get no gap value; they go to a separate **verification shortlist**, ranked by geography alone. Shortlist membership depends only on the evidence, never on the weights, so it is still listed (and exported) when every weight is zero.
- **Transfer scenario, not scored.** Beside the score, each candidate shows what the scenario model can say about a transfer to its nearest documented 24/7 EVT center: ground on a documented road network or not (or unknown), rotor-wing within or beyond the scenario range, fixed-wing with airport access not assessed. It is carried into the summary and the CSV and never enters the score.
- **Ties** (same score to 0.1) share a rank and are ordered by distance to EVT, then name, then id. **All-zero weights** produce no ranking and say so. **Sensitivity**: each candidate's rank range when each non-zero weight is halved or increased by half in turn (increasing one weight by half is done by scaling the others to two-thirds, which is the same for a weighted mean and stays inside the slider range).
- The score uses only public geometry and documented capability. It does not model operations, staffing, volumes, population, payer mix, existing telestroke coverage, contracts or business opportunity, and it never changes the data.

**Presets** frame common questions with transparent filters: *Telestroke access review*, *EVT capability assessment*, *State designation review*. None establishes onboarding eligibility, certification eligibility, the feasibility of an EVT program, or an outreach list.

## 9. Checks

`python3 scripts/verify-data.py` checks the built file independently of the build, recomputing rather than trusting derived fields: envelope and crosswalk; identity (unique and retired ids, CCN ownership, misspelt names); provenance (vocabularies, every cited source exists, dated evidence for every documented claim, no carried-forward claim re-stamped with a new date); capability (tier traceable to an issuer, EVT consistency, no tier on an unassessed record); eligibility (rule-consistent, every exclusion documented, no name-based exclusion); geography (state polygons, no unsupported precision); regressions (the Homer/Soldotna corrections, the town check still flagging the previous edition's misplacements, same-town outliers that the town check has not already flagged); counts (published counts recompute; the count sentences in the docs agree); the public-data boundary (no contact details, private-operations wording or tracker hosts); and wording/versioning (retired phrases, cache-busters, JSON-LD version, changelog, a priority and an app label for every needs-verification code). Dates are checked against the calendar, not only their format, and source links must be web addresses. `python3 scripts/build-dataset.py --check` confirms the committed outputs are exactly what the curated inputs produce. The same structural checks run in the app's Data & methods view.

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
