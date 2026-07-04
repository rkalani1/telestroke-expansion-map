# Deploy Checklist

Run top to bottom before every public Pages deployment. "Done" means the **live site** serves the change — a green build or merged PR is not proof.

## 1. Pre-merge (on the feature branch)

- [ ] `python3 scripts/verify-data.py` — all integrity checks pass
- [ ] `node --check app.js` — syntax clean
- [ ] Local smoke test (`python3 -m http.server 8000`):
  - [ ] App boots with no console errors; hospital count matches dataset
  - [ ] Filters: each tier pill, **None** pill, state dropdown, EVT-distance slider
  - [ ] Expansion candidates (`E`): table renders, a "Why?" row expands, one scenario slider re-ranks, **Reset scenario** restores defaults
  - [ ] Data quality panel (`Q`): all integrity checks show ✓ pass
  - [ ] Exports: filtered hospitals CSV, candidates CSV, distance matrix CSV download and open
  - [ ] Executive summary: generates; **Print one-pager** shows summary-only print preview (manual — needs a real print dialog)
  - [ ] Shareable URL: copy URL with filters + scenario set, open in a new tab, state restores
  - [ ] Mobile viewport (~375px): sidebar, dashboard, and candidates modal usable
  - [ ] Dark mode (`D`) and colour-blind palette render legibly
- [ ] COMPLIANCE.md review (required by its stated cadence — this change adds exports/analysis views):
  - [ ] No PHI, partner status, internal planning, dispatch, or operational data
  - [ ] No institutional branding outside hospital dataset fields
  - [ ] Disclaimers present (candidates modal note, footer, methodology)

## 2. Merge & deploy

- [ ] Merge feature branch to `main` (PR preferred for the checks trail)
- [ ] Confirm the Pages source in repo **Settings → Pages** (this repo serves `main` root)
- [ ] Wait for the Pages build; if a build sticks in `errored` at `syncing_files`, re-request with
      `gh api -X POST repos/rkalani1/telestroke-expansion-map/pages/builds`

## 3. Post-deploy verification (the live surface is the proof)

- [ ] Hard-refresh https://rkalani1.github.io/telestroke-expansion-map/
- [ ] View source: `app.js?v=` matches the new version (cache-buster)
- [ ] Provenance bar shows expected data version
- [ ] Open Expansion Candidates on the live site; spot-check the top-3 ranking against local
- [ ] Data quality panel: integrity checks all ✓ on live
- [ ] One export (candidates CSV) downloads from live
- [ ] Check on a phone or narrow window

## 4. Rollback

- [ ] If live is broken: `git revert` the merge commit on `main` and push — Pages redeploys the previous state. No build artifacts to restore; the site is fully static.
