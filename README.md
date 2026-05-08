# SafeRoute

**Grade your cycling route before you ride it.**

SafeRoute is a client-side web app that analyzes cycling routes from GPX, TCX, or FIT files and returns a safety score based on real OpenStreetMap road data. Upload a route exported from Strava, Komoot, Garmin, or Wahoo and get a color-coded breakdown of every segment — no account, no backend, no data leaving your browser.

Built for club ride organizers who want to audit routes before group rides.

---

## Features

- **Drag-and-drop file upload** — GPX, TCX, and FIT supported
- **Strava import** — connect your Strava account and pick a saved route directly, no file export needed
- **Ride profiles** — Solo, Club Ride, and Large Group profiles adjust scoring weights to match your ride type
- **Real OSM road data** — queries the Overpass API in a single batched request, racing four endpoints simultaneously for reliability
- **Per-segment safety scoring** — 0–100 score with a visual gauge, based on five weighted factors
- **Color-coded map** — green / amber / red polylines on a Thunderforest OpenCycleMap base
- **Interactive focus** — click any segment row or hazard to highlight and zoom to it on the map; click again to deselect
- **Score breakdown** — factor bars showing what's driving the overall score
- **Hazard list** — surfaces all segments scoring below 50
- **Demo route** — try it instantly with a Kansas City loop without uploading anything
- **No build step** — deployable to GitHub Pages as-is

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
- **Leaflet 1.9.4** — map rendering with Thunderforest OpenCycleMap tiles
- **OpenStreetMap / Overpass API** — real road data
- **fit-file-parser** — FIT file decoding via CDN
- **GitHub Pages** — hosting

---

## Strava Integration Setup

Strava import requires a one-time setup to keep your API credentials off the client.

**1. Create a Strava app** at https://www.strava.com/settings/api. Set the Authorization Callback Domain to your GitHub Pages domain (e.g. `kennethswoger.github.io`).

**2. Deploy the Cloudflare Worker** (free tier — handles the OAuth token exchange so `CLIENT_SECRET` never touches the browser):

```bash
cd worker
npx wrangler login
npx wrangler secret put STRAVA_CLIENT_SECRET   # paste your secret when prompted
npx wrangler deploy                             # prints your worker URL
```

**3. Configure `js/strava.js`** with your app's `CLIENT_ID` and the worker URL printed by `wrangler deploy`:

```js
const CLIENT_ID = 'YOUR_STRAVA_CLIENT_ID';
const PROXY_URL = 'https://saferoute-strava-proxy.YOUR_SUBDOMAIN.workers.dev';
```

**4. Update `worker/wrangler.toml`** with your `CLIENT_ID` and your allowed origins:

```toml
STRAVA_CLIENT_ID = "YOUR_STRAVA_CLIENT_ID"
ALLOWED_ORIGINS  = "https://YOUR_USERNAME.github.io,http://localhost:8080"
```

`CLIENT_SECRET` is stored only in Cloudflare's secret vault and never appears in code or the repository.

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

Install dependencies first (only needed once):

```bash
npm install
```

**Unit tests** — scoring engine, Overpass matching logic, parsers, and road profiles:

```bash
npm run test:run
```

Run in watch mode during development:

```bash
npm test
```

**End-to-end tests** — full browser flows via Playwright (requires a local server running on port 8080):

```bash
# Install Playwright browsers (only needed once)
npx playwright install

# In one terminal, start the local server
python3 -m http.server 8080

# In another terminal, run the e2e suite
npm run test:e2e
```

Open the Playwright UI for step-by-step debugging:

```bash
npm run test:e2e:ui
```

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
│   ├── results.js          # Score ring, factor bars, hazard list, segment table
│   ├── gauge.js            # Reusable score gauge SVG component
│   └── roadLabels.js       # OSM highway type → US-friendly display labels
│
├── js/
│   └── strava.js           # Strava OAuth PKCE flow, token storage, API calls
│
├── worker/
│   ├── index.js            # Cloudflare Worker — Strava token exchange proxy
│   └── wrangler.toml       # Worker config (deploy with `npx wrangler deploy`)
│
└── assets/
    ├── demo-kc.gpx         # Kansas City demo route
    ├── btn_strava_connect_with_orange.svg
    └── btn_strava_import_with_orange.svg
```

---

## Disclaimer

Safety scores are informational only. Road conditions, traffic, construction, and time of day are not factored in. Always ride with awareness and follow local traffic laws.

Road data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License.
