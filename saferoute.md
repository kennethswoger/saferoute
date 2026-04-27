# SafeRoute — Grade My Route

> A safety-first cycling route auditor. Drop in a `.gpx`, `.fit`, or `.tcx` file and get a segment-by-segment safety score before you clip in.

---

## Project Overview

SafeRoute grades existing cycling routes against real road data — road width, speed limits, traffic exposure, and bike infrastructure — and returns an overall Safety Score plus a visual, shareable report. The MVP is a standalone web tool targeting club riders who plan routes in Komoot, Strava, or Garmin Connect and want to audit them before a group ride.

**Core user story:**
> As a club ride organizer, I want to drop in a GPX file from Komoot and see a safety breakdown of each road segment, so I can flag risky sections for my group before we roll out.

---

## MVP Scope

The MVP is a **client-side web app** — no backend, no auth, no database. Everything runs in the browser.

### Must-have (v1)
- [ ] File upload: `.gpx`, `.tcx`, `.fit` drag-and-drop
- [ ] GPX + TCX parsing (native browser DOMParser)
- [ ] FIT file parsing (binary — use `fit-file-parser` npm package)
- [ ] Coordinate-to-road-segment matching via OpenStreetMap Overpass API
- [ ] Safety scoring engine (weighted: road width, speed limit, traffic, infrastructure, surface)
- [ ] Color-coded route map (Leaflet.js, dark CartoDB tiles)
- [ ] Overall Safety Score ring (0–100)
- [ ] Five-factor score breakdown
- [ ] Segment-by-segment table
- [ ] Hazard list (flagged dangerous/caution segments)
- [ ] Shareable text summary (copy to clipboard)

### Post-MVP (v2+)
- [x] Strava OAuth — import routes directly without file export
- [ ] Safer alternative route suggestion
- [ ] Shareable report URL (encode route + scores in URL params or short link)
- [ ] Community hazard layer (user-reported road conditions)
- [ ] Garmin Connect + Wahoo direct sync
- [ ] PWA / mobile-optimized layout

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Vanilla HTML/CSS/JS | Zero build tooling for MVP, ship fast |
| Maps | Leaflet.js 1.9.x | Lightweight, OSM-native, free |
| Tile layer | CartoDB Dark Matter | Free, no API key, looks great |
| Road data | OSM Overpass API | Free, global, has width/speed/cycleway tags |
| GPX/TCX parsing | Browser DOMParser | Native, no dependency |
| FIT parsing | `fit-file-parser` (npm/CDN) | Battle-tested binary FIT decoder |
| Styling | CSS custom properties | No framework needed at this scale |
| Fonts | Google Fonts — Syne + DM Sans + DM Mono | Design system established |
| Hosting | GitHub Pages | Free, zero config, deploys from repo |

**When moving to a framework:** Vite + vanilla TS is the recommended next step if the codebase grows. Avoid React for a tool this focused — it's overkill and adds bundle weight.

---

## Design System

### Color Tokens
```css
:root {
  /* Backgrounds */
  --bg:       #0A0E0C;
  --s1:       #111714;
  --s2:       #181F1C;
  --s3:       #1E2720;
  --s4:       #242E28;

  /* Borders */
  --border:   rgba(255,255,255,0.06);
  --border2:  rgba(255,255,255,0.12);
  --border3:  rgba(255,255,255,0.20);

  /* Text */
  --text:     #EDF2EE;
  --muted:    #6B8070;
  --dim:      #3A4A40;

  /* Safety tiers */
  --safe:        #1D9E75;
  --safe-bg:     #04342C;
  --safe-mid:    #5DCAA5;
  --safe-light:  #9FE1CB;

  --warn:        #BA7517;
  --warn-bg:     #412402;
  --warn-mid:    #EF9F27;

  --danger:      #D85A30;
  --danger-bg:   #4A1B0C;
  --danger-mid:  #F0997B;
}
```

### Typography
```
Display / Score:   Syne 800
Screen headings:   Syne 700
Body:              DM Sans 400/500
Data / Labels:     DM Mono 400/500
```

### Safety Score Thresholds
| Score | Tier | Color |
|-------|------|-------|
| 80–100 | Safe | `--safe` (#1D9E75) |
| 65–79 | Mostly Safe | gradient safe→warn |
| 50–64 | Use Caution | `--warn` (#BA7517) |
| 35–49 | Risky | danger→warn |
| 0–34 | Avoid | `--danger` (#D85A30) |

---

## Scoring Engine

### Weighted Formula
```
Safety Score = (widthScore × 0.25)
             + (speedScore × 0.25)
             + (trafficScore × 0.28)
             + (infraScore × 0.12)
             + (surfaceScore × 0.10)
```

### Factor Scoring Functions

**Road width → score**
```js
function widthScore(meters) {
  if (meters >= 12) return 95;
  if (meters >= 8)  return 78;
  if (meters >= 6)  return 62;
  if (meters >= 4)  return 45;
  return 30;
}
```

**Speed limit → score**
```js
function speedScore(mph) {
  if (mph <= 15) return 96;
  if (mph <= 25) return 84;
  if (mph <= 30) return 72;
  if (mph <= 35) return 58;
  if (mph <= 45) return 40;
  if (mph <= 55) return 22;
  return 10;
}
```

**OSM highway tag → traffic/infra scores**
```js
const ROAD_PROFILES = {
  cycleway:    { trafficScore: 95, infraScore: 98, surfaceScore: 90 },
  path:        { trafficScore: 92, infraScore: 88, surfaceScore: 65 },
  residential: { trafficScore: 72, infraScore: 55, surfaceScore: 80 },
  service:     { trafficScore: 80, infraScore: 40, surfaceScore: 60 },
  tertiary:    { trafficScore: 60, infraScore: 45, surfaceScore: 75 },
  secondary:   { trafficScore: 42, infraScore: 35, surfaceScore: 70 },
  primary:     { trafficScore: 28, infraScore: 20, surfaceScore: 72 },
  trunk:       { trafficScore: 12, infraScore: 8,  surfaceScore: 80 },
  motorway:    { trafficScore: 2,  infraScore: 0,  surfaceScore: 85 },
};
```

### Overall Route Score
Weight each segment by its distance share so longer dangerous stretches pull the score down more:
```js
const totalDist = segments.reduce((s, sg) => s + sg.dist, 0);
const overall = Math.round(
  segments.reduce((s, sg) => s + sg.score * (sg.dist / totalDist), 0)
);
```

---

## OSM Overpass API Integration

### Query Strategy
Batch coordinate clusters to avoid per-point requests. Sample the route to ~50 representative points, then query a radius around each cluster.

**Overpass QL query per cluster:**
```
[out:json][timeout:10];
way(around:30, {lat}, {lon})
  ["highway"]
  ["highway"!~"motorway_link|trunk_link"];
out tags;
```

**Tags to extract:**
```
highway       → road classification (primary, secondary, cycleway, etc.)
maxspeed      → speed limit ("30 mph", "25", "30 mph" — needs normalization)
width         → road width in meters (often missing — fall back to highway defaults)
cycleway      → presence of bike lane ("lane", "track", "shared_lane")
surface       → road surface ("asphalt", "concrete", "gravel", "cobblestone")
lanes         → number of lanes (proxy for road width if `width` missing)
```

**Speed normalization:**
```js
function parseSpeed(raw) {
  if (!raw) return null;
  const num = parseFloat(raw);
  if (raw.includes('mph')) return num;
  if (raw.includes('knots')) return num * 1.151;
  return num * 0.621; // assume km/h, convert to mph
}
```

**Width fallback by highway type (meters):**
```js
const WIDTH_DEFAULTS = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8,
  tertiary: 7,  residential: 6, service: 4.5,
  cycleway: 3,  path: 2.5, footway: 2,
};
```

### Rate limiting
Overpass is a shared public resource. The free endpoint (`overpass-api.de`) asks for reasonable use:
- Batch queries aggressively — one request per 10–15 route points, not per point
- Cache results in `sessionStorage` keyed by coordinate hash
- Add 300ms delay between requests
- For production: self-host Overpass or use the `overpass.kumi.systems` mirror

---

## File Parsing

### GPX
```js
function parseGPX(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const points = [...doc.querySelectorAll('trkpt, rtept')]
    .map(p => [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon'))])
    .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));
  const name = doc.querySelector('name')?.textContent?.trim() ?? 'My Route';
  return { points, name, fileType: 'GPX' };
}
```

### TCX
```js
function parseTCX(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const points = [...doc.querySelectorAll('Trackpoint')]
    .map(p => {
      const lat = p.querySelector('LatitudeDegrees')?.textContent;
      const lon = p.querySelector('LongitudeDegrees')?.textContent;
      return [parseFloat(lat), parseFloat(lon)];
    })
    .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));
  const name = doc.querySelector('Name')?.textContent?.trim() ?? 'My Route';
  return { points, name, fileType: 'TCX' };
}
```

### FIT (binary)
FIT files require the `fit-file-parser` library. Load via CDN or npm:
```html
<script src="https://cdn.jsdelivr.net/npm/fit-file-parser@1.9.0/dist/fit-parser.js"></script>
```
```js
function parseFIT(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({ force: true, speedUnit: 'mph', lengthUnit: 'mi' });
    parser.parse(arrayBuffer, (err, data) => {
      if (err) { reject(err); return; }
      const points = (data.activity?.sessions?.[0]?.laps ?? [])
        .flatMap(lap => lap.records ?? [])
        .filter(r => r.position_lat && r.position_long)
        .map(r => [r.position_lat, r.position_long]);
      const name = data.activity?.sport ?? 'FIT Route';
      resolve({ points, name, fileType: 'FIT' });
    });
  });
}
```

---

## File Structure

```
saferoute/
├── index.html          # Main app shell
├── style.css           # All styles (CSS custom properties, no framework)
├── app.js              # Entry point, file handling, state machine
├── parser/
│   ├── gpx.js          # GPX/TCX XML parsing
│   └── fit.js          # FIT binary parsing (wraps fit-file-parser)
├── scoring/
│   ├── engine.js       # Core safety scoring formula
│   ├── overpass.js     # OSM Overpass API client + caching
│   └── profiles.js     # Road type profiles and defaults
├── ui/
│   ├── map.js          # Leaflet map init, segment polylines, markers
│   ├── results.js      # Score ring, factor bars, segment table, hazards
│   └── share.js        # Copy/share functionality
├── assets/
│   └── demo-kc.gpx     # Bundled KC demo route (Loose Park loop)
└── README.md
```

---

## Suggested Claude Code Prompt Flow

When starting with Claude Code, work through these in order:

**1. Scaffold**
```
Create the file structure above. Start with index.html linking style.css and app.js. 
Add Google Fonts import for Syne, DM Sans, DM Mono. Apply the CSS custom properties 
from the design system. Build the upload/drop zone UI state only — no results yet.
```

**2. File parsing**
```
Implement parser/gpx.js and parser/fit.js. GPX and TCX use DOMParser. FIT uses 
fit-file-parser from CDN. All three return { points: [[lat,lon],...], name, fileType }.
Wire up the file input and drag-drop in app.js.
```

**3. Scoring engine (offline / simulated)**
```
Implement scoring/engine.js using the road profiles and scoring functions from the 
spec. For now, classify each coordinate using a seeded deterministic function 
(no API calls). Return segments with score, road type, speed limit, width per point.
```

**4. Map**
```
Implement ui/map.js using Leaflet 1.9.4. Use CartoDB Dark Matter tiles. Draw each 
segment as a colored polyline — green (#1D9E75) for score>=75, amber (#BA7517) for 
>=50, red (#D85A30) below. Add start/end markers. Fit bounds to route.
```

**5. Results UI**
```
Implement ui/results.js. Render the score ring (SVG circle with stroke-dashoffset), 
five factor bars (animated width), segment table, hazard list. Match the design 
system colors and fonts exactly.
```

**6. Overpass integration**
```
Implement scoring/overpass.js. Query the Overpass API with batched coordinate 
clusters (every 15 points). Extract highway, maxspeed, width, cycleway, surface tags.
Cache results in sessionStorage. Replace the simulated classifier with real data.
Add a loading/progress state while API calls resolve.
```

**7. Share**
```
Implement ui/share.js. Copy summary text to clipboard. Encode route name, score, 
distance, and top hazards into a URL hash for basic shareability.
```

---

## Demo Route

A bundled Kansas City demo route is included at `assets/demo-kc.gpx`. It covers the Loose Park → Ward Pkwy → Brookside loop — a typical Apogee ATP club ride corridor mixing residential streets, a secondary road (Ward Pkwy), and a dedicated path section through the park. Good variety of safety conditions for testing the scorer.

---

## GitHub Pages Deploy

No build step needed for the MVP. Just push to `main` and enable Pages from the repo settings (root of `main` branch).

```bash
git init
git add .
git commit -m "feat: initial SafeRoute MVP"
git remote add origin https://github.com/YOUR_USERNAME/saferoute.git
git push -u origin main
# Then: Settings → Pages → Source: Deploy from branch → main / root
```

Live at: `https://YOUR_USERNAME.github.io/saferoute/`

---

## Known Limitations (MVP)

- **Overpass API cold queries** can take 2–5s for long routes. Add a progress indicator.
- **FIT files** store lat/lon as semicircles — `fit-file-parser` handles the conversion but verify with a real Garmin export.
- **Road width** is sparsely tagged in OSM for US roads — fallback defaults by highway type are essential.
- **Speed limit data** is inconsistent in OSM for residential streets in the US. Default `residential` → 25mph is a reasonable assumption for KC.
- **Overpass rate limits** — don't hammer it. Cache aggressively. If building for real traffic, budget for a self-hosted instance or the Overpass API paid tier.

---

## Potential V2 Features

- ~~**Strava import** — OAuth flow, pull route from Strava API directly, no file export needed~~ ✅ shipped
- **Shareable report URL** — encode route + scores in URL for easy club sharing
- **Alternative route suggestion** — if score < 60, suggest a safer OSM-routed alternative via OSRM or Valhalla
- **Community hazard layer** — user-reported road issues overlaid on the map
- **Garmin/Wahoo direct sync** — connect account, pull latest routes automatically
- **Saved route history** — localStorage for personal route archive

---

*Built with OpenStreetMap data © OpenStreetMap contributors. Road safety scores are informational only — always ride with awareness and follow local traffic laws.*