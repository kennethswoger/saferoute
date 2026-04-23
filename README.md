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

OSM data is fetched via a single batched Overpass union query covering up to 25 evenly-spaced sample points per route, using nearest-node geometry matching to avoid long collector roads bleeding into adjacent residential streets. Results are cached in `sessionStorage` so subsequent loads for the same area are instant.

**Data source tiers** (shown as badges in the segment detail panel):

| Badge | Meaning |
|---|---|
| OSM | Road attributes matched directly from OpenStreetMap |
| Inferred | No direct OSM highway hit — attributes inherited from the nearest OSM neighbor segment, or synthesized from a nearby `landuse=residential` polygon |
| Simulated | OSM unavailable — defaults to residential road profile |

When Overpass is fully unavailable the engine falls back to residential defaults for all segments rather than risk misclassification.

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

## Testing

Install dev dependencies first:

```bash
npm install
```

### Unit tests (Vitest)

Runs in [happy-dom](https://github.com/capricorn86/happy-dom) — no browser required.

```bash
npm test          # watch mode
npm run test:run  # single pass (CI)
```

| File | What it covers |
|---|---|
| `tests/parser.test.js` | GPX / TCX parsing — coordinates, route name, edge cases |
| `tests/profiles.test.js` | `getTier` thresholds, `ROAD_PROFILES` / weight / default tables |
| `tests/engine.test.js` | `scoreWidth`, `scoreSpeed`, `scoreSegment`, `groupIntoSegments`, `resolveRoadAttrs` |
| `tests/overpass.test.js` | `parseSpeed`, `parseWidth`, `sampleIndices`, `buildHighwayQuery`, `matchWaysToPoints` |

Fixtures live in `tests/fixtures/` — `test-route.gpx` (a small Kansas City loop) and `overpass-mock.json` (a canned Overpass response used by both unit and E2E tests).

### E2E tests (Playwright)

Runs against a live server. The config spins up `python3 -m http.server 8080` automatically; if a server is already running on that port it will be reused.

```bash
npm run test:e2e        # headless Chromium
npm run test:e2e:ui     # Playwright UI (interactive)
```

E2E tests use a Page Object (`tests/e2e/saferoute.page.js`) that intercepts Overpass requests and returns the mock fixture, so tests are deterministic and offline-capable. Covered flows: upload screen on load, GPX upload → scored results, score range (0–100), route name display, hazard list, and reset back to upload state.

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
├── assets/
│   └── demo-kc.gpx         # Kansas City demo route
│
├── tests/
│   ├── engine.test.js      # Scoring engine unit tests
│   ├── overpass.test.js    # Overpass client unit tests
│   ├── parser.test.js      # GPX / TCX parser unit tests
│   ├── profiles.test.js    # Road profiles / tier unit tests
│   ├── fixtures/
│   │   ├── test-route.gpx  # Sample route for tests
│   │   └── overpass-mock.json  # Canned Overpass response
│   └── e2e/
│       ├── saferoute.page.js   # Playwright Page Object
│       └── upload.spec.js      # E2E upload + results flow
│
├── vitest.config.js        # Unit test config (happy-dom)
└── playwright.config.js    # E2E test config (Chromium, local server)
```

---

## Disclaimer

Safety scores are informational only. Road conditions, traffic, construction, and time of day are not factored in. Always ride with awareness and follow local traffic laws.

Road data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License.
