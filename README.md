# SafeRoute

**Grade your cycling route before you ride it.**

SafeRoute is a client-side web app that analyzes cycling routes from GPX, TCX, or FIT files and returns a safety score based on real OpenStreetMap road data. Upload a route exported from Strava, Komoot, Garmin, or Wahoo and get a color-coded breakdown of every segment — no account, no backend, no data leaving your browser.

Built for club ride organizers who want to audit routes before group rides.

---

## Features

- **Drag-and-drop file upload** — GPX, TCX, and FIT supported
- **Real OSM road data** — queries the Overpass API in a single batched request, racing two endpoints simultaneously for reliability
- **Per-segment safety scoring** — 0–100 score based on five weighted factors
- **Color-coded map** — green / amber / red polylines on a dark Leaflet map
- **Interactive focus** — click any segment row or hazard to highlight and zoom to it on the map; click again to deselect
- **Score breakdown** — factor bars showing what's driving the overall score
- **Hazard list** — surfaces all segments scoring below 50
- **Demo route** — try it instantly with a Kansas City loop without uploading anything
- **Fully client-side** — no server, no build step, deployable to GitHub Pages as-is

---

## How Scoring Works

Each road segment is scored 0–100 across five factors:

| Factor | Weight | What it measures |
|---|---|---|
| Traffic Exposure | 28% | Road type (cycleway → motorway) |
| Road Width | 25% | Lane width in metres from OSM or type default |
| Speed Limit | 25% | Posted limit from OSM `maxspeed` tag or type default |
| Infrastructure | 12% | Cycling infrastructure quality by road type |
| Surface Quality | 10% | Expected surface condition by road type |

**Score tiers:**

| Score | Label | Color |
|---|---|---|
| 80–100 | Safe | Green |
| 65–79 | Mostly Safe | Green |
| 50–64 | Use Caution | Amber |
| 35–49 | Risky | Red |
| 0–34 | Avoid | Red |

OSM data is fetched via a single batched Overpass union query covering up to 15 evenly-spaced sample points per route. Results are cached in `sessionStorage` so subsequent loads for the same area are instant.

**Data source tiers** (shown as badges in the segment detail panel):

| Badge | Meaning |
|---|---|
| OSM | Road attributes matched directly from OpenStreetMap |
| Inferred | No direct OSM highway hit — attributes inherited from the nearest OSM neighbor segment |
| Simulated | OSM unavailable — defaults to residential road profile |

**A note on Overpass reliability:** SafeRoute queries the public Overpass API, which is a free community-run service. During peak hours these servers can be slow or return timeout errors (504). The app automatically retries once before falling back to simulated data. If you see all-simulated results, waiting a minute and re-uploading usually resolves it — the servers recover quickly. Subsequent loads of the same route area are served from the local session cache and skip the API entirely.

---

## Supported File Types

| Format | Source |
|---|---|
| `.gpx` | Strava, Komoot, Garmin, RideWithGPS, most bike computers |
| `.tcx` | Garmin, Wahoo |
| `.fit` | Garmin, Wahoo, most modern bike computers |

---

## Tech Stack

- **Vanilla HTML / CSS / JS** — no framework, no build step
- **Leaflet 1.9.4** — map rendering with Stadia Maps Alidade Smooth Dark tiles
- **OpenStreetMap / Overpass API** — real road data
- **fit-file-parser** — FIT file decoding via CDN
- **GitHub Pages** — hosting

---

## Running Locally

Because SafeRoute uses ES modules (`type="module"`), it must be served over HTTP — it won't work opened directly from the filesystem.

```bash
# Python (built-in)
python3 -m http.server 8080

# Node (if you have npx)
npx serve .

# VS Code
# Install the "Live Server" extension and click "Go Live"
```

Then open `http://localhost:8080`.

---

## Project Structure

```
saferoute/
├── index.html              # App shell, state machine containers
├── app.js                  # Entry point, file handling, UI state machine
├── style.css               # Design tokens, layout, component styles
│
├── parser/
│   ├── index.js            # File type router
│   ├── gpx.js              # GPX parser (DOMParser)
│   ├── tcx.js              # TCX parser (DOMParser)
│   └── fit.js              # FIT parser (fit-file-parser)
│
├── scoring/
│   ├── engine.js           # Segment grouping, scoring formula, main export
│   ├── overpass.js         # Overpass API client, batched query, cache
│   └── profiles.js         # Road type profiles, speed/width defaults, tiers
│
├── ui/
│   ├── map.js              # Leaflet map, polylines, focus interaction
│   └── results.js          # Score ring, factor bars, hazard list, segment table
│
└── assets/
    └── demo-kc.gpx         # Kansas City demo route
```

---

## Disclaimer

Safety scores are informational only. Road conditions, traffic, construction, and time of day are not factored in. Always ride with awareness and follow local traffic laws.

Road data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License.
