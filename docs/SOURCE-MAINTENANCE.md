# Source maintenance

How to keep the dataset honest: re-check a claim, add a source, refresh the reference files, and release. Every change is a curated edit followed by a deterministic rebuild; nothing is ever re-verified by rebuilding.

## Principles

1. **One claim at a time.** Change only the claim the evidence speaks to (`national`, `stateDesignation`, `evt`, `evt247`, `ed`, `status`, `address`, …). Leave the others, and their dates, alone.
2. **The issuer settles its own credential.** WA DOH for ECS categorization (DOH 345-299), Idaho DHW Bureau of EMS & Preparedness for TSE designation, the Joint Commission (Quality Check), DNV (certificate checker), ACHC and CIHQ for their certifications. A hospital page or press release corroborates; a current official registry is not vetoed by an older press release.
3. **Use the document's own dates** — publication, effective, revision, expiry. Never a search date, crawl date or website footer year. Historical pages give context, not a current roster.
4. **Record what you did.** `checked` is the date you compared the claim with its evidence; `method` is how you observed it (`search-extract` if you only saw a search tool's summary of the page; say `manual-review` only when you read the source itself). Put the reasoning in `note`.
5. **Unknown is allowed.** If the evidence is not there, the claim stays `unknown` or becomes `no-record-found` with the scope searched. Never encode unknown as false, zero or "No".
6. **Public information only.** No patient information, staffing, contracts, internal partner status, confidential strategy, protected contacts or real operational notes — not in data, notes, commits, issues or test fixtures.

## Re-check a claim

1. Open `data/verification-worklist.csv`; each row names the record, the open question and the source that can settle it.
2. Read the source. Add it to `data/curated/sources.json` if it is not there (see below).
3. Edit the record in `data/curated/facilities.json`:
   - set `state` (or `value`) and the claim-specific fields (`body`, `program`, `tier`, `effective`, `expires`; or `authority`, `system`, `level`, `status`);
   - set `evidence` to `[{src, excerpt, kind, supports}]` — a short excerpt, `kind` `quote` only for verbatim text;
   - set `checked` to today and `method`;
   - if the value changed, keep the earlier value in `changedFrom` (`{state/value…, checked, method, edition}`).
4. Rebuild and verify:

   ```bash
   python3 scripts/build-dataset.py
   python3 scripts/verify-data.py
   ```

5. Review the diff of `hospitals.json`, `data/audit/evidence-audit.csv` and the worklist. Only the claims you changed (and counts derived from them) should move.

## Add a source

Add an entry to `data/curated/sources.json` with a short stable id:

```json
"wa-doh-ecs-345-299": {
  "type": "issuer-registry",
  "title": "Washington State Emergency Cardiac and Stroke System — categorized hospitals (DOH 345-299)",
  "publisher": "Washington State Department of Health",
  "url": "https://doh.wa.gov/…",
  "published": null, "effective": "2026-05", "accessed": "2026-10-17",
  "access": "search-extract",
  "note": "What was and was not seen; revision date and how it was established."
}
```

Reuse an existing id whenever the same document supports several claims.

## Add, split, merge or close a campus

- **New campus** (opened, or missing from the census): add a record with a new stable id (its CCN, or `<parentCCN>-<CAMPUS>` for a provider-based campus, or a readable id for a non-Medicare hospital), every claim `unknown` until sourced, and a `notes` line explaining the addition.
- **Split** (two campuses under one CCN): one record per physical campus; the second gets `ccn.relation: "shared"` and `parentId`.
- **CCN change** (same campus, new number): keep the record; move the old number into `ccn.previous` with the CMS name and last month listed.
- **Re-identification** (an id that named the wrong campus): give the record a new id and put the old one in `previousIds`, so old links still open it.
- **Closure or merger**: keep the record, set `status` to `closed` or `merged` with a dated source. It leaves the analysis set (excluded, with that reason) but stays searchable.

## Refresh the CMS census

The reference census is `data/cms-census-wwami-2023-10.csv` (CMS Hospital General Information, October 2023). The current release is dataset `xubh-q36u` at https://data.cms.gov/provider-data/dataset/xubh-q36u — it could not be retrieved from the October 2026 authoring environment. To refresh:

1. Download the current CSV and filter to WA, AK, ID, MT, WY.
2. Write `data/cms-census-wwami-<YYYY-MM>.csv` with the same columns (`ccn, cms_name, cms_name_as_of, state, hospital_type, ownership, beds, latitude, longitude, prior_names`), carrying forward rows that disappeared with their last month in `cms_name_as_of`.
3. Point `CENSUS` in `scripts/build-dataset.py` and `census_snapshot` in `data/curated/manifest.json` at it.
4. Rebuild. For every new CCN add a record; for every CCN that disappeared, check status with the state licensing roster before changing anything; for changed hospital types (e.g. a Critical Access conversion or a Rural Emergency Hospital conversion) re-check `cah`, `serviceType` and `ed`.

## Reference files

- `data/geo/wwami-boundaries.json` — state and county polygons (`scripts/build-geo.py`, from `us-atlas@3.0.1`).
- `data/geo/cities-wwami.json` — GeoNames town points (`scripts/build-cities.py`, from `cities.json@1.1.65`, CC BY 4.0).

Both are committed so neither the build nor CI needs the network. The scripts' docstrings give the exact commands to regenerate them.

## Release

1. Bump `release` and `data_version` in `data/curated/manifest.json` (and `evidence_review_date` / `generated` only when a review pass actually happened / inputs changed); bump `package.json` `version` and the `?v=` cache-busters in `index.html`; add the CHANGELOG entry.
2. `python3 scripts/build-dataset.py`, then every check in the README ("Checks").
3. Open a pull request; CI runs the same checks plus the headless end-to-end suite.
4. After merge, GitHub Pages deploys `main`. Follow [DEPLOY-CHECKLIST.md](DEPLOY-CHECKLIST.md) to verify the live site.
