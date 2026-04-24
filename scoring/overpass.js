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
const BATCH_TIMEOUT    = 20000; // ms client-side timeout per endpoint
const SERVER_TIMEOUT   = 15;    // seconds — Overpass [timeout:N] directive
const MIN_QUERIES      = 15;    // minimum sample points (short routes)
const MAX_QUERIES      = 120;   // hard cap — spread across chunked batches
const POINTS_PER_BATCH = 10;    // points per Overpass request (smaller = faster per chunk, more chunks)
const QUERY_RADIUS    = 50;    // metres radius around each sample point
const LANDUSE_RADIUS  = 100;   // metres — larger radius for residential landuse polygons
const MAX_HIGHWAY_DIST = 75;   // metres — max perpendicular distance for highway ways
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
const CACHE_VERSION = 10;
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

// ── Perpendicular segment distance from a way's geometry to a query point ──────
// For each consecutive node pair (A→B), finds the closest point on that segment
// to the sample point using a flat-earth projection. This correctly handles long
// roads whose nodes are spaced far apart — the road itself may pass within 2m of
// the sample point even if no individual node is within 50m.
function nearestSegmentDist(el, lat, lon) {
  const nodes = el.geometry;
  if (!nodes?.length) return Infinity;
  if (nodes.length === 1) return distMetres(lat, lon, nodes[0].lat, nodes[0].lon);

  // Local flat-earth projection centred on the sample point (valid for <5 km)
  const cosLat    = Math.cos(lat * Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLon = mPerDegLat * cosLat;

  let minDist = Infinity;

  for (let i = 0; i < nodes.length - 1; i++) {
    const ax = (nodes[i].lon     - lon) * mPerDegLon;
    const ay = (nodes[i].lat     - lat) * mPerDegLat;
    const bx = (nodes[i + 1].lon - lon) * mPerDegLon;
    const by = (nodes[i + 1].lat - lat) * mPerDegLat;

    const abx = bx - ax, aby = by - ay;
    const len2 = abx * abx + aby * aby;

    let d;
    if (len2 === 0) {
      d = Math.sqrt(ax * ax + ay * ay); // degenerate segment
    } else {
      // t = projection parameter clamped to [0,1] → closest point on segment
      const t  = Math.max(0, Math.min(1, -(ax * abx + ay * aby) / len2));
      const cx = ax + t * abx;
      const cy = ay + t * aby;
      d = Math.sqrt(cx * cx + cy * cy);
    }

    if (d < minDist) minDist = d;
  }

  return minDist;
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

    // Highway ways: perpendicular distance to nearest segment (requires geom).
    // Landuse ways: centroid distance (center only, no geom).
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < samplePoints.length; i++) {
      const d = isLanduse
        ? (el.center ? distMetres(samplePoints[i][0], samplePoints[i][1], el.center.lat, el.center.lon) : Infinity)
        : nearestSegmentDist(el, samplePoints[i][0], samplePoints[i][1]);
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
      // Sorting rules:
      // 1. Cycling infra (cycleway/path) vs road type → pure distance wins.
      //    The GPS track is either physically on the trail or on the road;
      //    perpendicular distance is the correct arbiter.
      // 2. Road vs road → within 15m prefer lower-traffic type, but demote
      //    service roads (driveways/alleys) to last so a nearby driveway
      //    entrance never beats the main road the cyclist is riding on.
      const ROAD_BAND = 15;
      const isCycleInfra = t => t === 'cycleway' || t === 'path';
      const ROAD_RANK = { residential: 0, tertiary: 1, secondary: 2, primary: 3, trunk: 4, motorway: 5, service: 99 };
      highwayGroup.sort((a, b) => {
        const ta = a.el.tags?.highway ?? '';
        const tb = b.el.tags?.highway ?? '';
        if (isCycleInfra(ta) !== isCycleInfra(tb)) return a.dist - b.dist;
        const band = Math.abs(a.dist - b.dist) <= ROAD_BAND;
        if (band) {
          const ra = ROAD_RANK[ta] ?? 50;
          const rb = ROAD_RANK[tb] ?? 50;
          if (ra !== rb) return ra - rb;
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
    // Scale sample count with route length: 1 sample per ~3 segments, clamped.
    const queryCount  = Math.min(MAX_QUERIES, Math.max(MIN_QUERIES, Math.ceil(points.length / 3)));
    const sampleIdxs = sampleIndices(points.length, queryCount);
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
      let doneCount = samplePts.length - uncachedPts.length; // pre-count cache hits

      // Split uncached points into sequential chunks so no single Overpass
      // request carries more than POINTS_PER_BATCH points (prevents timeouts
      // on dense routes that need 60 samples).
      for (let chunkStart = 0; chunkStart < uncachedPts.length; chunkStart += POINTS_PER_BATCH) {
        const chunkPts  = uncachedPts.slice(chunkStart, chunkStart + POINTS_PER_BATCH);
        const chunkIdxs = uncachedIdxs.slice(chunkStart, chunkStart + POINTS_PER_BATCH);

        let json;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt > 0) {
              console.warn(`[SafeRoute] Overpass chunk failed, retrying in ${RETRY_DELAY / 1000}s…`);
              await new Promise(r => setTimeout(r, RETRY_DELAY));
            }
            json = await fetchBatch(chunkPts);
            break;
          } catch {
            if (attempt === 1) {
              console.warn('[SafeRoute] Overpass chunk failed after retry — chunk results will be simulated.');
              json = { elements: [] };
            }
          }
        }

        const elements    = json.elements ?? [];
        const freshResults = matchWaysToPoints(elements, chunkPts);
        // Only cache null when the query actually returned data — prevents
        // cache poisoning from silent API failures (empty elements = possible timeout).
        const chunkReturnedData = elements.length > 0;

        chunkIdxs.forEach((sampleI, freshI) => {
          const result = freshResults[freshI] ?? null;
          if (result !== null || chunkReturnedData) {
            writeCache(samplePts[sampleI][0], samplePts[sampleI][1], result);
          }
          tagResults[sampleI] = result;
        });

        doneCount += chunkPts.length;
        onProgress?.(doneCount, samplePts.length);
      }
    }

    // Map every original point to its geographically nearest sample.
    // Geographic distance prevents a sample point from bleeding into
    // segments on a different road that happen to be adjacent by route index.
    return points.map(([lat, lon]) => {
      let nearest = 0, minDist = Infinity;
      for (let si = 0; si < sampleIdxs.length; si++) {
        const d = distMetres(lat, lon, samplePts[si][0], samplePts[si][1]);
        if (d < minDist) { minDist = d; nearest = si; }
      }
      return tagResults[nearest] ?? null;
    });

  } catch (err) {
    console.warn('[SafeRoute] Overpass failed, using simulated data:', err.message);
    return null;
  }
}
