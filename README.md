# Regional Facility Stroke Capability Demo

Interactive synthetic map of stroke-center capability tiers and EVT access across a five-state sample region. Named sites, street addresses, exact coordinates, health-network relationships, and operational strategy fields are not included.

**Live site:**  /telestroke-expansion-map/

![Map screenshot](https://img.shields.io/badge/status-live-success) ![License](https://img.shields.io/badge/license-MIT-blue) ![Data](https://img.shields.io/badge/data-synthetic%20demo-informational)

---

## What it does

- Maps synthetic facilities with color-coded markers by capability tier (CSC / TSC / PSC / ASR) and visible badges for 24/7 thrombectomy (EVT) capability.
- Computes, for each synthetic facility, distance and estimated ground/air transport time to the nearest CSC/TSC and nearest EVT-capable site.
- Identifies EVT access gaps, zero-capability synthetic facilities, and public-demo capability-gap scoring.
- Exports demo CSV, distance matrix CSV, PNG of the current map view, and an executive summary as text or clipboard content.
- Encodes filters, search term, panel state, palette, and viewport in the query string.

## Certification tiers

| Tier | Meaning |
|------|---------|
| **CSC** | Comprehensive stroke capability tier with advanced neurovascular resources. |
| **TSC** | Thrombectomy-capable tier with EVT access. |
| **PSC** | Primary stroke tier for rapid imaging, lytic treatment, and transfer protocols. |
| **ASR** | Acute stroke-ready tier for rapid stabilization and transfer. |
| **EVT** | Endovascular thrombectomy capability flag, tracked independently from tier. |

## Data

- **Coverage:** 132 synthetic facilities across WA, AK, ID, MT, and WY sample buckets.
- **Last refreshed:** 2026-05-27
- **Methodology:** see [METHODOLOGY.md](./METHODOLOGY.md)
- **Changelog:** see [CHANGELOG.md](./CHANGELOG.md)

## Transport-time model

Distances are great-circle (haversine). Ground transfer time = (haversine x 1.25) / 55 mph + 8 min overhead. Air transfer time = haversine / 150 mph + 25 min dispatch/takeoff/landing overhead. These are **demo estimates** only. Real transfer times depend on weather, traffic, staffing, and asset availability.

## Running locally

Because the site fetches `facilities.json`, browsers block `file://` loads. Serve via any local web server:

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

- Every interactive element is keyboard-reachable.
- Filter pills expose `aria-pressed`; dashboard charts provide `role="img"` plus aria labels.
- Optional color-blind-safe palette via the tools menu.
- Dark mode is a full-app theme, not just map tiles.
- Respects browser zoom; there is no viewport zoom lock.

## File layout

```
index.html            Semantic shell
app.css               Styles
app.js                Application logic
facilities.json       Synthetic demo data and metadata
METHODOLOGY.md        Synthetic data and transport model
CHANGELOG.md          Release history
```

## License

MIT - see [LICENSE](./LICENSE).

## Attribution

- Basemap tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, styled by [CARTO](https://carto.com/attributions)
- Mapping library: [Leaflet](https://leafletjs.com/)
- PNG export: [html2canvas](https://html2canvas.hertzen.com/)

---

This public repository is a synthetic demo. Do not use it for dispatch, patient-care decisions, contracting, staffing, or operational planning.
