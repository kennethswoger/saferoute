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
const CLIENT_TIMEOUT = 5000; // ms per attempt — fail fast so fallback kicks in
const MAX_QUERIES    = 30;   // hard cap: sample at most 30 points per route
const CONCURRENCY    = 3;    // parallel requests per round
const QUERY_RADIUS   = 30;   // metres radius around each sample point
const REQUEST_DELAY  = 300;  // ms between rounds (be a good citizen)

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
        continue;
      }

      let json;
      try {
        json = await res.json();
      } catch {
        // Server returned 200 with an HTML error body (e.g. "runtime error: open64")
        lastErr = new Error(`Overpass returned non-JSON from ${endpoint}`);
        continue;
      }

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

// ── Evenly sample at most N indices from an array ─────────────────────────────
function sampleIndices(length, n) {
  if (length <= n) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: n }, (_, i) =>
    Math.round(i * (length - 1) / (n - 1))
  );
}

// ── Main export ────────────────────────────────────────────────────────────────
// Samples the route to at most MAX_QUERIES evenly-spaced points, queries
// CONCURRENCY at a time, then maps each original point to its nearest sample.
//
// Returns an array the same length as `points`, each entry a tags object
// or null. Returning null for the whole array signals total failure and
// tells the engine to use the simulated classifier for every segment.
//
// onProgress(done, total) — optional callback for loading label updates.
export async function fetchRoadData(points, onProgress) {
  if (!points?.length) return null;

  try {
    const sampleIdxs = sampleIndices(points.length, MAX_QUERIES);
    const total      = sampleIdxs.length;
    const tagResults = new Array(total).fill(null);
    let done = 0;

    // Query in rounds of CONCURRENCY — parallel within a round, delay between rounds
    for (let i = 0; i < total; i += CONCURRENCY) {
      const chunk = sampleIdxs.slice(i, i + CONCURRENCY);

      const chunkTags = await Promise.all(
        chunk.map(idx =>
          fetchCluster(points[idx][0], points[idx][1]).catch(() => null)
        )
      );

      for (let j = 0; j < chunk.length; j++) {
        tagResults[i + j] = chunkTags[j];
      }

      done += chunk.length;
      onProgress?.(done, total);

      if (i + CONCURRENCY < total) await delay(REQUEST_DELAY);
    }

    // Map each original point to the nearest sample by route index
    return points.map((_, pi) => {
      let nearest = 0;
      let minDist = Infinity;
      for (let si = 0; si < sampleIdxs.length; si++) {
        const d = Math.abs(sampleIdxs[si] - pi);
        if (d < minDist) { minDist = d; nearest = si; }
        // sampleIdxs is sorted — once distance grows we've passed the closest
        if (sampleIdxs[si] > pi) break;
      }
      return tagResults[nearest];
    });

  } catch (err) {
    console.warn('[SafeRoute] Overpass failed, using simulated data:', err.message);
    return null;
  }
}
