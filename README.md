# Regional Hospital Stroke Capabilities

Interactive map of stroke-center certifications and telestroke partnerships across the WWAMI region (Washington · Alaska · Idaho · Montana · Wyoming), built for telestroke-network expansion planning.

**Live site:** https://rkalani1.github.io/telestroke-expansion-map/

![Map screenshot](https://img.shields.io/badge/status-live-success) ![License](https://img.shields.io/badge/license-MIT-blue) ![Data](https://img.shields.io/badge/data-verified%20Apr%202026-informational)

---

## What it does

- Maps every hospital in the dataset with color-coded markers by certification tier (CSC / TSC / PSC / ASR) and visible badges for 24/7 thrombectomy (EVT) capability and UW Medicine telestroke partnership.
- Computes, for each hospital, distance and estimated ground/air transport time to the nearest CSC/TSC and nearest EVT center.
- Identifies **EVT deserts** (hospitals &gt;100 mi from 24/7 thrombectomy), **zero-capability** hospitals (no national certification and not a telestroke partner), and scores **expansion candidates** via a configurable multi-criteria rank.
- Exports: CSV of the hospital dataset, CSV of the full distance matrix, PNG of the current map view, and an executive summary as `.txt` or clipboard.
- Shareable URL: every filter, search term, panel state, palette, and viewport is encoded in the query string.

## Certification tiers

| Tier | Meaning | Certifying bodies |
|------|---------|-------------------|
| **CSC** | Comprehensive Stroke Center — 24/7 neurosurgery, neuro-ICU, EVT, complex cases | Joint Commission · DNV · ACHC |
| **TSC** | Thrombectomy-Capable Stroke Center — 24/7 mechanical thrombectomy, ≥15 EVT/yr/physician | Joint Commission · ACHC · (DNV "PSC+") |
| **PSC** | Primary Stroke Center — rapid CT, IV thrombolysis, dedicated stroke team | Joint Commission · DNV · ACHC · CIHQ |
| **ASR** | Acute Stroke Ready — stabilization, IV lytic, teleneurology, transfer protocols | Joint Commission ("ASRH") · DNV · ACHC · CIHQ |
| **EVT** | Endovascular thrombectomy capability (not a tier — a capability flagged at each hospital) | N/A |

Washington State runs an independent Level I/II/III ECS system; Idaho runs a TSE Level I/II/III system. Some hospitals (e.g., Kootenai Health) hold only state designations, not national accreditation.

## Data

- **Coverage:** 123 hospitals across WA (89), AK (8), ID (19), MT (5), WY (2). Scoped to UW Medicine telestroke planning; includes all verified national-stroke-certified hospitals and all current UW telestroke partners in the five-state region.
- **Last verified:** 2026-04-23
- **Methodology:** see [METHODOLOGY.md](./METHODOLOGY.md)
- **Changelog:** see [CHANGELOG.md](./CHANGELOG.md)

## Transport-time model

Distances are great-circle (haversine). Ground transfer time = (haversine × 1.25) / 55 mph + 8 min overhead. Air transfer time = haversine / 150 mph + 25 min dispatch/takeoff/landing overhead. These are **planning estimates** only. Real transfer times depend on weather, traffic, staffing, and specific asset availability.

## Running locally

Because the site fetches `hospitals.json`, browsers block `file://` loads. Serve via any local web server:

```bash
cd telestroke-expansion-map
python3 -m http.server 8000
# then open http://localhost:8000
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` or `Ctrl+F` | Focus search |
| `R` | Reset all filters |
| `D` | Toggle dark mode |
| `?` | Open methods/certification info |
| `Esc` | Close modal / tools menu |

## Accessibility

- Every interactive element is keyboard-reachable; focus rings use a high-contrast indigo (`--accent`).
- Filter pills expose `aria-pressed`; dashboard charts provide `role="img"` + aria-labels.
- Optional colour-blind–safe palette (Okabe-Ito-inspired) via the tools menu.
- Dark mode is a full-app theme, not just map tiles.
- Respects `user-scalable`; there is no zoom lock on the viewport.

## File layout

```
index.html            Semantic shell
app.css               All styles (tokens + components + responsive + print)
app.js                Application logic (data load, map, filters, tools, exports)
hospitals.json        Data + metadata (schema, sources, cert definitions)
METHODOLOGY.md        Data sourcing + certification standards
CHANGELOG.md          Release history
archive/              Prior code, reports, and scripts (historical)
```

## License

MIT — see [LICENSE](./LICENSE).

## Attribution

- Basemap tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, styled by [CARTO](https://carto.com/attributions)
- Mapping library: [Leaflet](https://leafletjs.com/)
- PNG export: [html2canvas](https://html2canvas.hertzen.com/)

---

*Built for UW Medicine stroke/telestroke network planning. Feedback and PRs welcome.*
