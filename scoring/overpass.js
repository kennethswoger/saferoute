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
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];
const BATCH_TIMEOUT   = 20000; // ms client-side timeout per endpoint
const SERVER_TIMEOUT  = 15;    // seconds — Overpass [timeout:N] directive
const MAX_QUERIES     = 15;    // sample points per route (fewer = smaller query)
const QUERY_RADIUS    = 25;    // metres radius around each sample point
const LANDUSE_RADIUS  = 100;   // metres — larger radius for residential landuse polygons
const MAX_HIGHWAY_DIST = 50;   // metres — max nearest-node distance for highway ways
const MAX_LANDUSE_DIST = 200;  // metres — max nearest-node distance for landuse polygons
const RETRY_DELAY     = 2000;  // ms — pause before single retry on total failure

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
// Bump this version any time the cache schema or query logic changes so stale
// entries (including poisoned nulls from API failures) are automatically ignored.
const CACHE_VERSION = 2;
function cacheKey(lat, lon) {
  return `sr_osm_v${CACHE_VERSION}_${Math.round(lat * 1000)}_${Math.round(lon * 1000)}`;
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

// ── Build Overpass QL queries ──────────────────────────────────────────────────
// Two separate queries so we can use `out tags geom` for highway ways (needed
// for nearest-node matching) while using the cheaper `out tags center` for
// landuse polygons (we only need to know if one exists nearby, not its shape).
function buildHighwayQuery(points) {
  const filter  = `["highway"]["highway"!~"motorway_link|trunk_link|footway|steps|pedestrian"]`;
  const clauses = points
    .map(([lat, lon]) => `  way(around:${QUERY_RADIUS},${lat},${lon})${filter};`)
    .join('\n');
  return `[out:json][timeout:${SERVER_TIMEOUT}];\n(\n${clauses}\n);\nout tags geom;`;
}

function buildLanduseQuery(points) {
  const clauses = points
    .map(([lat, lon]) => `  way(around:${LANDUSE_RADIUS},${lat},${lon})[landuse=residential];`)
    .join('\n');
  return `[out:json][timeout:${SERVER_TIMEOUT}];\n(\n${clauses}\n);\nout tags center;`;
}

// ── Fire a query against all endpoints, first valid response wins ──────────────
// Cancels all losing requests as soon as a winner resolves.
async function fetchQuery(query) {
  const body = `data=${encodeURIComponent(query)}`;
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  const timers = controllers.map((c, i) =>
    setTimeout(() => c.abort(), BATCH_TIMEOUT)
  );

  const cleanup = () => {
    controllers.forEach((c, i) => { clearTimeout(timers[i]); c.abort(); });
  };

  const attempts = OVERPASS_ENDPOINTS.map((endpoint, i) =>
    fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal:  controllers[i].signal,
    })
    .then(async res => {
      clearTimeout(timers[i]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Reject if server returned a remark indicating a timeout/error
      if (json.remark && !json.elements?.length) throw new Error(`Overpass remark: ${json.remark}`);
      return json;
    })
    .catch(err => { clearTimeout(timers[i]); throw err; })
  );

  try {
    const result = await Promise.any(attempts);
    cleanup(); // cancel remaining in-flight requests
    return result;
  } catch (err) {
    cleanup();
    throw err;
  }
}

async function fetchBatch(points) {
  // Run both queries in parallel — landuse result merged into elements array
  const [hwJson, luJson] = await Promise.all([
    fetchQuery(buildHighwayQuery(points)),
    fetchQuery(buildLanduseQuery(points)).catch(() => ({ elements: [] })), // landuse is best-effort
  ]);
  return { elements: [...(hwJson.elements ?? []), ...(luJson.elements ?? [])] };
}

// ── Nearest-node distance from a way's geometry to a query point ──────────────
// `out geom` returns el.geometry as an array of { lat, lon } nodes.
// Using the nearest node rather than the bbox centroid prevents long roads
// (e.g. Lee Blvd) from bleeding into adjacent residential intersections whose
// centroid happens to land closer to the sample point than the residential road.
function nearestNodeDist(el, lat, lon) {
  const nodes = el.geometry;
  if (!nodes?.length) return Infinity;
  let min = Infinity;
  for (const node of nodes) {
    const d = distMetres(lat, lon, node.lat, node.lon);
    if (d < min) min = d;
  }
  return min;
}

// ── Match returned ways back to sample points ──────────────────────────────────
// For each returned way, compute the nearest-node distance to every sample
// point and assign it to the sample point it is physically closest to,
// subject to a hard cap so ways that are just far away get discarded.
function matchWaysToPoints(elements, samplePoints) {
  const buckets = samplePoints.map(() => []);

  for (const el of elements) {
    const isLanduse = !!el.tags?.landuse;
    const cap = isLanduse ? MAX_LANDUSE_DIST : MAX_HIGHWAY_DIST;

    // Highway ways: use nearest-node distance (requires geom).
    // Landuse ways: use bbox centroid distance (center only, no geom).
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < samplePoints.length; i++) {
      const d = isLanduse
        ? (el.center ? distMetres(samplePoints[i][0], samplePoints[i][1], el.center.lat, el.center.lon) : Infinity)
        : nearestNodeDist(el, samplePoints[i][0], samplePoints[i][1]);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    if (minDist <= cap) {
      buckets[nearestIdx].push({ el, dist: minDist });
    }
  }

  return buckets.map(group => {
    if (!group.length) return null;

    // Split: highway ways vs landuse context ways
    const highwayGroup = group.filter(({ el }) => el.tags?.highway);

    if (highwayGroup.length) {
      // Sort: closest way wins. Within 12m prefer cycling-friendlier road type.
      const PROXIMITY_BAND = 12;
      highwayGroup.sort((a, b) => {
        const band = Math.abs(a.dist - b.dist) <= PROXIMITY_BAND;
        if (band) {
          const ra = HIGHWAY_RANK.indexOf(a.el.tags?.highway ?? '');
          const rb = HIGHWAY_RANK.indexOf(b.el.tags?.highway ?? '');
          return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
        }
        return a.dist - b.dist;
      });
      const tags = highwayGroup[0].el?.tags ?? null;
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
    }

    // No highway way found — if the area is tagged residential in OSM, infer it.
    // Houses lining a street → landuse=residential polygon nearby → safe to assume
    // the road is a residential 25 mph street even without a direct highway hit.
    const inResidentialArea = group.some(({ el }) => el.tags?.landuse === 'residential');
    if (inResidentialArea) {
      return {
        highway:          'residential',
        maxspeed:         null,
        width:            null,
        cycleway:         null,
        surface:          null,
        lanes:            null,
        name:             null,
        landuse_inferred: true,
      };
    }

    return null;
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

      const elements = json.elements ?? [];
      const freshResults = matchWaysToPoints(elements, uncachedPts);

      // Only cache null (API miss) when the query actually returned data.
      // If elements is empty the API may have silently failed — don't poison
      // the cache so that "Try again" can issue a real request next time.
      const queryReturnedData = elements.length > 0;

      uncachedIdxs.forEach((sampleI, freshI) => {
        const result = freshResults[freshI] ?? null;
        if (result !== null || queryReturnedData) {
          writeCache(samplePts[sampleI][0], samplePts[sampleI][1], result);
        }
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
