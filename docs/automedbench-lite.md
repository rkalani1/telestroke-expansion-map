# AutoMedBench-Lite Gate for Map Dataset Updates

Use this gate before accepting AI-generated changes to hospital data, certification tiers, EVT capability flags, transport-time assumptions, exports, or map copy.

This gate evaluates workflow discipline. It does not approve planning, routing, transfer, or operational decisions.

## S1 Plan

- Identify the hospital row, certification rule, transport assumption, export field, or UI text being changed.
- State whether the change affects data, methodology, visualization, exports, or copy.
- Define stop conditions for stale source data, conflicting certification, or unverifiable geocoding.

## S2 Setup

- Inspect `hospitals.json`, `facilities.json` if relevant, `METHODOLOGY.md`, `CHANGELOG.md`, `app.js`, and `README.md`.
- Identify source URLs, last-reviewed dates, and certification definitions.
- Identify local server preview steps because browser file loads can block JSON.

## S3 Validate

- Verify certification tier and EVT flags against public certification/source records.
- Check coordinates, state, facility name, and duplicated facilities.
- Spot-check distance/transport outputs for changed hospitals.
- Confirm source dates and methodology language stay synchronized.
- Confirm no private operational details, site negotiations, or confidential contacts are introduced.

## S4 Execute

Make the scoped change after S1-S3 are complete. Keep planning-estimate language intact.

## S5 Submit

Report changed files, source trace, local preview checks, distance/geocoding checks, residual owner review, and no-confidential-data confirmation.

## One-Shot Prompt

```text
Apply the telestroke-expansion-map AutoMedBench-Lite gate. Write S1 Plan, S2 Setup, and S3 Validate before editing. Then execute the scoped change and submit changed files, source trace, local preview checks, distance/geocoding checks, residual owner review, and no-confidential-data confirmation. Stop if source or geospatial validation cannot be completed.
```
