// scoring/overpass.js — OSM Overpass API client + sessionStorage cache
//
// fetchRoadData(points) → array of road tag objects, one per input point,
// matched to the nearest OSM way. Returns null on total failure so the
// engine falls back to the simulated classifier.

import { WIDTH_DEFAULTS } from './profiles.js';

// Tried in order — first success wins. kumi.systems is more reliable
// than the public overpass-api.de instance under load.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const CLIENT_TIMEOUT = 8000; // ms — don't hang the spinner on a slow server
const BATCH_SIZE     = 15;   // points per Overpass query
const QUERY_RADIUS   = 30;   // metres around each cluster centroid
const REQUEST_DELAY  = 300;  // ms between requests (be a good citizen)

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

function readCache(lat, lon) {
  try {
    const raw = sessionStorage.getItem(cacheKey(lat, lon));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(lat, lon, data) {
  try {
    sessionStorage.setItem(cacheKey(lat, lon), JSON.stringify(data));
  } catch { /* storage full — silently skip */ }
}

// ── Overpass QL query ──────────────────────────────────────────────────────────
function buildQuery(lat, lon) {
  return `[out:json][timeout:10];
way(around:${QUERY_RADIUS},${lat},${lon})
  ["highway"]
  ["highway"!~"motorway_link|trunk_link|footway|steps|pedestrian"];
out tags;`;
}

// Pick the most relevant way from Overpass results.
// Prefer dedicated cycling infrastructure, then lower-traffic roads.
const HIGHWAY_RANK = [
  'cycleway','path','residential','service',
  'tertiary','secondary','primary','trunk','motorway',
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

// ── Single cluster fetch — tries each endpoint in order ───────────────────────
async function fetchCluster(lat, lon) {
  const cached = readCache(lat, lon);
  if (cached) return cached;

  const body = `data=${encodeURIComponent(buildQuery(lat, lon))}`;
  let lastErr;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        lastErr = new Error(`Overpass HTTP ${res.status} from ${endpoint}`);
        continue; // try next endpoint
      }

      const json = await res.json();
      const way  = bestWay(json.elements);
      const tags = way?.tags ?? null;

      const result = tags ? {
        highway:  tags.highway  ?? null,
        maxspeed: tags.maxspeed ?? null,
        width:    tags.width    ?? null,
        cycleway: tags.cycleway ?? null,
        surface:  tags.surface  ?? null,
        lanes:    tags.lanes    ?? null,
      } : null;

      writeCache(lat, lon, result);
      return result;

    } catch (err) {
      clearTimeout(timer);
      lastErr = err.name === 'AbortError'
        ? new Error(`Overpass timeout after ${CLIENT_TIMEOUT}ms (${endpoint})`)
        : err;
      // try next endpoint
    }
  }

  throw lastErr; // all endpoints failed — caught by fetchRoadData
}

// ── Delay helper ───────────────────────────────────────────────────────────────
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Main export ────────────────────────────────────────────────────────────────
// Samples the route into batches, queries one centroid per batch,
// then expands results back to per-point coverage.
//
// Returns an array the same length as `points`, each entry either a
// tags object or null (falls back to simulated classifier in engine).
//
// onProgress(done, total) — optional callback for loading label updates.
export async function fetchRoadData(points, onProgress) {
  try {
    // Sample one representative point per batch
    const batches = [];
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const slice = points.slice(i, Math.min(i + BATCH_SIZE, points.length));
      const mid   = slice[Math.floor(slice.length / 2)];
      batches.push({ start: i, end: i + slice.length, lat: mid[0], lon: mid[1] });
    }

    const results = new Array(points.length).fill(null);

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      onProgress?.(b, batches.length);

      const tags = await fetchCluster(batch.lat, batch.lon);

      // Expand: every point in this batch gets the same road data
      for (let i = batch.start; i < batch.end; i++) {
        results[i] = tags;
      }

      // Throttle — skip delay after last batch
      if (b < batches.length - 1) await delay(REQUEST_DELAY);
    }

    onProgress?.(batches.length, batches.length);
    return results;

  } catch (err) {
    console.warn('[SafeRoute] Overpass query failed, using simulated data:', err.message);
    return null;
  }
}
