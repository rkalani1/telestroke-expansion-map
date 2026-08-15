# Vendored Leaflet 1.9.4

`leaflet.js`, `leaflet.css` and `images/` are copied verbatim from the
[`leaflet@1.9.4`](https://www.npmjs.com/package/leaflet/v/1.9.4) npm package
(`dist/`), unmodified. Leaflet is BSD-2-Clause licensed; see
<https://github.com/Leaflet/Leaflet/blob/main/LICENSE>.

## Why vendored

The app previously loaded Leaflet from `unpkg.com`. When that host is
unreachable — which is routine on hospital networks that block third-party
CDNs, and on any restricted-egress network — `L` is undefined, `initMap()`
throws, and the page sits on "Loading…" forever with nothing but a console
error. For a tool meant to be opened from inside a hospital, a hard dependency
on an external CDN is a availability risk with no upside.

Serving these two files from the same origin as the rest of the app removes
that failure mode entirely. It also removes the need for subresource-integrity
pinning, since the bytes are in the repository and reviewed in the diff.

## Upgrading

```bash
npm pack leaflet@<version>
tar -xzf leaflet-<version>.tgz
cp package/dist/leaflet.js package/dist/leaflet.css vendor/leaflet/
cp package/dist/images/* vendor/leaflet/images/
```

Then update the version in this file and smoke-test the map.

## Still remote

- **Basemap tiles** — `basemaps.cartocdn.com`. A map without tiles still shows
  markers, the sidebar, distances and every analysis tool, so this degrades
  gracefully rather than failing hard.
- **`html2canvas`** — loaded on demand from `cdnjs.cloudflare.com` only when
  the user exports a PNG, and already guarded with a user-visible error toast.
- **Fonts** — Google Fonts, with a system-font fallback in `app.css`.
