// scoring/overpass.js — OSM Overpass API client + sessionStorage cache
//
// fetchRoadData(points) → array of road tag objects, one per input point,
// matched to the nearest OSM way. Returns null on total failure so the
// engine falls back to the simulated classifier.
//
// Strategy: batch all sample points into a SINGLE Overpass union query
// instead of one request per point. This collapses ~30 HTTP round-trips
// into 1, dramatically reducing the chance of hitting public API rate
// limits and server-side timeouts.

import { WIDTH_DEFAULTS } from './profiles.js';

// Tried simultaneously — first valid response wins.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const BATCH_TIMEOUT  = 30000; // ms client-side timeout for the single batch request
const SERVER_TIMEOUT = 25;    // seconds — Overpass [timeout:N] directive
const MAX_QUERIES    = 25;    // sample points per route (fewer = smaller query)
const QUERY_RADIUS    = 25;   // metres radius around each sample point
const MAX_CENTER_DIST = 120;  // metres — ignore ways whose bbox centroid is farther than this
const RETRY_DELAY    = 4000;  // ms — pause before single retry on total failure

// ── Speed normalisation ────────────────────────────────────────────────────────
export function parseSpeed(raw) {
  if (!raw) return null;
  const str = raw.toString().trim().toLowerCase();
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  if (str.includes('mph'))   return num;
  if (str.includes('knots')) return Math.round(num * 1.151);
  return Math.round(num * 0.621); // assume km/h → mph
}

// ── Width normalisation ────────────────────────────────────────────────────────
export function parseWidth(raw, highwayType) {
  if (raw) {
    const n = parseFloat(raw);
    if (!isNaN(n)) return n;
  }
  return WIDTH_DEFAULTS[highwayType] ?? 6;
}

// ── sessionStorage cache ───────────────────────────────────────────────────────
function cacheKey(lat, lon) {
  return `sr_osm_${Math.round(lat * 1000)}_${Math.round(lon * 1000)}`;
}

// Returns undefined  → not in cache (needs a fresh fetch)
//         null       → cached API miss (don't retry)
//         { ... }    → cached result
function readCache(lat, lon) {
  try {
    const raw = sessionStorage.getItem(cacheKey(lat, lon));
    if (raw === null) return undefined;
    return JSON.parse(raw);
  } catch { return undefined; }
}

function writeCache(lat, lon, data) {
  try {
    sessionStorage.setItem(cacheKey(lat, lon), JSON.stringify(data));
  } catch { /* storage full — silently skip */ }
}

// ── Road-type preference order ─────────────────────────────────────────────────
// Prefer dedicated cycling infrastructure, then lower-traffic roads.
const HIGHWAY_RANK = [
  'cycleway', 'path', 'residential', 'service',
  'tertiary', 'secondary', 'primary', 'trunk', 'motorway',
];

function bestWay(elements) {
  if (!elements?.length) return null;
  return elements.slice().sort((a, b) => {
    const ra = HIGHWAY_RANK.indexOf(a.tags?.highway ?? '');
    const rb = HIGHWAY_RANK.indexOf(b.tags?.highway ?? '');
    const ia = ra === -1 ? 99 : ra;
    const ib = rb === -1 ? 99 : rb;
    return ia - ib;
  })[0];
}

// ── Haversine distance in metres ───────────────────────────────────────────────
function distMetres(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) *
               Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Build a single batched Overpass QL union query ─────────────────────────────
// Each sample point becomes one `way(around:R,lat,lon)[filters]` clause.
// `out tags center` returns each way's tags + bounding-box centroid so we
// can match ways back to their nearest sample point.
function buildBatchQuery(points) {
  const filters = `["highway"]["highway"!~"motorway_link|trunk_link|footway|steps|pedestrian"]`;
  const unions  = points
    .map(([lat, lon]) => `  way(around:${QUERY_RADIUS},${lat},${lon})${filters};`)
    .join('\n');
  return `[out:json][timeout:${SERVER_TIMEOUT}];\n(\n${unions}\n);\nout tags center;`;
}

// ── Fire the batch query, racing both endpoints simultaneously ─────────────────
async function fetchBatch(points) {
  const body = `data=${encodeURIComponent(buildBatchQuery(points))}`;

  const attempts = OVERPASS_ENDPOINTS.map(endpoint => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT);
    return fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal:  controller.signal,
    })
    .then(async res => {
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch(err => { clearTimeout(timer); throw err; });
  });

  return await Promise.any(attempts); // throws AggregateError only if ALL fail
}

// ── Match returned ways back to sample points ──────────────────────────────────
// Overpass `out center` gives each way's bounding-box centroid. We assign
// every returned way to the nearest sample point (nearest-neighbour), then
// pick the best-ranked way for each sample point.
//
// This is more robust than a fixed MATCH_RADIUS because it works regardless
// of how long individual road segments are in OSM.
function matchWaysToPoints(elements, samplePoints) {
  // Build one bucket per sample point, tracking distance alongside the element
  const buckets = samplePoints.map(() => []);

  for (const el of elements) {
    if (!el.center) continue;
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < samplePoints.length; i++) {
      const d = distMetres(
        samplePoints[i][0], samplePoints[i][1],
        el.center.lat,      el.center.lon,
      );
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    // Only include ways whose centroid is plausibly close to the sample point.
    // Long roads (e.g. Switzer St) have centroids far from any given sample —
    // capping here prevents them from bleeding into nearby residential segments.
    if (minDist <= MAX_CENTER_DIST) {
      buckets[nearestIdx].push({ el, dist: minDist });
    }
  }

  return buckets.map(group => {
    if (!group.length) return null;

    // Sort: closest way wins. Within 12m of each other, prefer lower HIGHWAY_RANK
    // (cycling-friendlier road). This stops a distant tertiary from overriding
    // a nearby residential that the cyclist is actually on.
    const PROXIMITY_BAND = 12; // metres
    group.sort((a, b) => {
      const band = Math.abs(a.dist - b.dist) <= PROXIMITY_BAND;
      if (band) {
        const ra = HIGHWAY_RANK.indexOf(a.el.tags?.highway ?? '');
        const rb = HIGHWAY_RANK.indexOf(b.el.tags?.highway ?? '');
        return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      }
      return a.dist - b.dist;
    });

    const tags = group[0].el?.tags ?? null;
    if (!tags) return null;
    return {
      highway:  tags.highway  ?? null,
      maxspeed: tags.maxspeed ?? null,
      width:    tags.width    ?? null,
      cycleway: tags.cycleway ?? null,
      surface:  tags.surface  ?? null,
      lanes:    tags.lanes    ?? null,
      name:     tags.name     ?? null,
    };
  });
}

// ── Evenly sample at most N indices from an array ─────────────────────────────
function sampleIndices(length, n) {
  if (length <= n) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: n }, (_, i) =>
    Math.round(i * (length - 1) / (n - 1))
  );
}

// ── Main export ────────────────────────────────────────────────────────────────
// 1. Sample the route down to MAX_QUERIES evenly-spaced points.
// 2. Split into cached vs uncached sample points.
// 3. Fire ONE batched Overpass query for all uncached points.
// 4. Match returned ways back to sample points, write cache.
// 5. Map every original route point to its nearest sample result.
//
// Returns an array the same length as `points` (tags object or null per entry).
// Returning null for the whole array signals total failure; the engine falls
// back to the simulated classifier for every segment.
//
// onProgress(done, total) — optional callback for loading label updates.
export async function fetchRoadData(points, onProgress) {
  if (!points?.length) return null;

  try {
    const sampleIdxs = sampleIndices(points.length, MAX_QUERIES);
    const samplePts  = sampleIdxs.map(i => points[i]);

    // Separate already-cached from points that need a live fetch
    const cacheHits = samplePts.map(([lat, lon]) => readCache(lat, lon));
    // undefined = not cached; null = cached miss; {...} = cached hit
    const uncachedIdxs = cacheHits
      .map((v, i) => v === undefined ? i : -1)
      .filter(i => i !== -1);
    const uncachedPts = uncachedIdxs.map(i => samplePts[i]);

    // tagResults[i] corresponds to samplePts[i]
    const tagResults = [...cacheHits]; // fill cached values; uncached slots = undefined

    if (uncachedPts.length > 0) {
      onProgress?.(0, samplePts.length);

      let json;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) {
            console.warn(`[SafeRoute] Overpass batch failed, retrying in ${RETRY_DELAY / 1000}s…`);
            onProgress?.(0, samplePts.length);
            await new Promise(r => setTimeout(r, RETRY_DELAY));
          }
          json = await fetchBatch(uncachedPts);
          break;
        } catch {
          if (attempt === 1) {
            console.warn('[SafeRoute] Overpass batch failed after retry — falling back to simulated data.');
            return null;
          }
        }
      }

      const freshResults = matchWaysToPoints(json.elements ?? [], uncachedPts);

      // Store results and fill in tagResults
      uncachedIdxs.forEach((sampleI, freshI) => {
        const result = freshResults[freshI] ?? null;
        writeCache(samplePts[sampleI][0], samplePts[sampleI][1], result);
        tagResults[sampleI] = result;
      });
    }

    onProgress?.(samplePts.length, samplePts.length);

    // Map every original point index to its nearest sample index
    return points.map((_, pi) => {
      let nearest = 0, minDist = Infinity;
      for (let si = 0; si < sampleIdxs.length; si++) {
        const d = Math.abs(sampleIdxs[si] - pi);
        if (d < minDist) { minDist = d; nearest = si; }
        if (sampleIdxs[si] > pi) break; // sampleIdxs is sorted — past the closest
      }
      return tagResults[nearest] ?? null;
    });

  } catch (err) {
    console.warn('[SafeRoute] Overpass failed, using simulated data:', err.message);
    return null;
  }
}
