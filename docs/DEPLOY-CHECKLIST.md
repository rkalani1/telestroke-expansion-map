# Deploy checklist

Run top to bottom before every public Pages deployment. "Done" means the **live site** serves the change — a green build or merged PR is not proof.

## 1. Pre-merge (on the feature branch)

CI (`.github/workflows/verify.yml`) runs every item marked *(CI)* on every pull request and every push to `main`. A red check is a blocker; a green check does not prove the live site is right, and structural checks never prove a fact is current.

- [ ] `python3 scripts/build-dataset.py --check` — committed `hospitals.json`, audit CSV, worklist and count sentences are exactly what the curated inputs produce *(CI)*
- [ ] `python3 scripts/verify-data.py` — every check group passes *(CI)*
- [ ] `node --check core.js && node --check app.js` *(CI)*
- [ ] `npx --yes html-validate@8 index.html` *(CI)*
- [ ] `npx --yes eslint@9 core.js app.js tests` *(CI)*
- [ ] `node --test "tests/unit/*.test.js"` *(CI)*
- [ ] `npm run test:e2e` — headless Chromium: lookup, detail, my receiving center, modes and legends, share links, exports (downloaded content checked), axe in both themes, keyboard, layout at 320–1920 px, short landscape, 200% text, blocked tiles/storage *(CI)*
- [ ] Leaflet served from `vendor/leaflet/`, no script from a CDN *(CI)*
- [ ] Release bookkeeping: `release`/`data_version` in `data/curated/manifest.json`, `package.json` version, `?v=` cache-busters and JSON-LD `version`/`dateModified` in `index.html`, CHANGELOG entry, `sitemap.xml` `lastmod` (verify-data checks the first four agree)
- [ ] Dates: `checked` dates moved only on claims actually re-checked; `evidence_review_date` changed only if a review pass happened
- [ ] COMPLIANCE.md review: no patient, staffing, contract, partner-status, strategy, protected-contact or operational content in data, notes, exports, URLs, storage, logs or test fixtures; disclaimers present (footer, methods, access review, one-pager)
- [ ] Manual (not automatable here): a real print preview of the one-pager and of the comparison

## 2. Merge and deploy

- [ ] Merge the pull request into `main` through the normal review path (no bypassed protections, no force-push)
- [ ] GitHub Pages serves `main` from the repository root; watch the Pages build for that commit to finish

## 3. Post-deploy verification (the live surface is the proof)

From a fresh browser context (headless is fine):

- [ ] `index.html` references `app.js?v=<release>`, `core.js?v=<release>`, `app.css?v=<release>`; `hospitals.json` reports the expected `release` and `data_version`
- [ ] App reaches `data-ready="true"` with no console errors or failed same-origin requests
- [ ] Search `HMC` → Harborview opens; detail shows national certification and state designation separately, with sources and check dates
- [ ] Explore: switch to a distance mode; the legend changes with it
- [ ] Phone width (390×844): tab bar, list sheet and detail sheet usable
- [ ] Data & methods: download one CSV and check its header, scope column and a known row
- [ ] Note anything that could not be checked (e.g. print dialogs) as untested

## 4. Rollback

The site is static. If live is wrong, `git revert` the merge commit on `main` and push; Pages redeploys the previous state. No build artifacts or server state to restore.
