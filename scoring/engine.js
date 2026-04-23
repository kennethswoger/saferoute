// scoring/engine.js — safety scoring formula + deterministic segment classifier
//
// scoreRoute(route) → {
//   name, fileType, overall, tier, totalDist,
//   segments: [{ index, points, midpoint, roadType, speedLimit, width,
//                score, dist, tier, factors: { width, speed, traffic, infra, surface } }]
// }

import {
  ROAD_PROFILES, WIDTH_DEFAULTS, SPEED_DEFAULTS, ROAD_WEIGHTS, getTier,
} from './profiles.js';
import { fetchRoadData, parseSpeed, parseWidth } from './overpass.js';

// ── Haversine distance (miles) ─────────────────────────────────────────────────
function haversine([lat1, lon1], [lat2, lon2]) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function totalDistance(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

// ── Seeded deterministic road classifier ──────────────────────────────────────
// idx is mixed in so segments at similar coordinates don't all collapse to
// the same hash bucket (geographic bias observed for certain US regions).
function coordHash(lat, lon, idx) {
  const gLat = Math.round(lat * 1000);
  const gLon = Math.round(lon * 1000);
  let h = (Math.imul(gLat, 0x16561EDC) ^ Math.imul(gLon, 0x7A3BC5F7) ^ Math.imul(idx + 1, 0xC4CEB9FE)) >>> 0;
  h ^= h >>> 13;
  h  = Math.imul(h, 0x85EBCA6B) >>> 0;
  h ^= h >>> 11;
  h  = Math.imul(h, 0xC2B2AE35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000; // [0, 1)
}

function classifyRoadType(lat, lon, idx = 0) {
  const v = coordHash(lat, lon, idx);
  return (ROAD_WEIGHTS.find(w => v < w.cum) ?? ROAD_WEIGHTS[ROAD_WEIGHTS.length - 1]).type;
}

// ── Factor scoring functions ───────────────────────────────────────────────────
export function scoreWidth(meters) {
  if (meters >= 12) return 95;
  if (meters >= 8)  return 78;
  if (meters >= 6)  return 72;
  if (meters >= 3)  return 55; // dedicated cycling path / narrow lane
  return 30;
}

export function scoreSpeed(mph) {
  if (mph <= 15) return 96;
  if (mph <= 25) return 84;
  if (mph <= 30) return 72;
  if (mph <= 35) return 58;
  if (mph <= 45) return 40;
  if (mph <= 55) return 22;
  return 10;
}

// ── Segment scorer ─────────────────────────────────────────────────────────────
export function scoreSegment(roadType, speedLimit, width) {
  const profile = ROAD_PROFILES[roadType] ?? ROAD_PROFILES.tertiary;
  const factors = {
    width:   scoreWidth(width),
    speed:   scoreSpeed(speedLimit),
    traffic: profile.trafficScore,
    infra:   profile.infraScore,
    surface: profile.surfaceScore,
  };
  const score = Math.round(
    factors.width   * 0.25 +
    factors.speed   * 0.25 +
    factors.traffic * 0.28 +
    factors.infra   * 0.12 +
    factors.surface * 0.10
  );
  return { score, factors };
}

// ── Segment grouping ───────────────────────────────────────────────────────────
// Aim for segments of roughly SEGMENT_TARGET_MILES each.
// Minimum 2 points per segment; never splits a pair.
const SEGMENT_TARGET_MILES = 0.15;

export function groupIntoSegments(points) {
  if (points.length < 2) throw new Error('Route needs at least 2 GPS points.');

  const segments = [];
  let current = [points[0]];

  for (let i = 1; i < points.length; i++) {
    current.push(points[i]);
    const d = totalDistance(current);
    const last = i === points.length - 1;

    if ((d >= SEGMENT_TARGET_MILES || last) && current.length >= 2) {
      segments.push(current);
      current = [points[i]]; // overlap: last point of prev = first of next
    }
  }

  // Merge a trailing stub (< 2 points) into the previous segment
  if (current.length > 1 && segments.length > 0) {
    const last = segments[segments.length - 1];
    segments[segments.length - 1] = [...last, ...current.slice(1)];
  }

  return segments;
}

// ── Resolve road attributes for a segment ─────────────────────────────────────
// Uses OSM tags when available, falls back to simulated classifier.
// osmFailed = true when Overpass returned nothing at all (total API failure);
// in that case default to residential rather than risk hash-bucket bias.
export function resolveRoadAttrs(mid, osmTags, idx, osmFailed) {
  if (osmTags?.highway) {
    const roadType   = osmTags.highway;
    const speedLimit = parseSpeed(osmTags.maxspeed) ?? SPEED_DEFAULTS[roadType] ?? 35;
    const width      = parseWidth(osmTags.width, roadType);
    // landuse_inferred = highway was synthesised from a residential landuse polygon,
    // not a direct highway way — show as Inferred rather than OSM in the UI.
    const source     = osmTags.landuse_inferred ? 'inferred' : 'osm';
    return { roadType, speedLimit, width, source, streetName: osmTags.name ?? null, surface: osmTags.surface ?? null };
  }
  // Total failure or partial miss — residential is the safest default for cycling routes
  return { roadType: 'residential', speedLimit: SPEED_DEFAULTS.residential, width: WIDTH_DEFAULTS.residential, source: 'simulated', streetName: null, surface: null };
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function scoreRoute(route, onProgress) {
  const { points, name, fileType } = route;
  const groups = groupIntoSegments(points);

  // Fetch real OSM data — falls back to null if Overpass is unavailable
  const midpoints = groups.map(pts => pts[Math.floor(pts.length / 2)]);
  const osmData   = await fetchRoadData(midpoints, onProgress);

  const osmFailed = osmData === null;

  const segments = groups.map((pts, i) => {
    const dist = totalDistance(pts);
    const mid  = pts[Math.floor(pts.length / 2)];

    const { roadType, speedLimit, width, source, streetName, surface } =
      resolveRoadAttrs(mid, osmData?.[i] ?? null, i, osmFailed);

    const { score, factors } = scoreSegment(roadType, speedLimit, width);
    const tier = getTier(score);

    return {
      index: i,
      points: pts,
      midpoint: mid,
      roadType,
      speedLimit,
      width,
      score,
      dist,
      tier: tier.label,
      tierColor: tier.color,
      factors,
      source,
      streetName,
      surface,
    };
  });

  // ── Neighbor inference pass ────────────────────────────────────────────────
  // Simulated segments sandwiched between OSM segments inherit road type and
  // speed from the nearest OSM neighbor on either side. This covers the common
  // case where a midpoint GPS coordinate misses its road centroid by a few
  // metres but the segments on each side of the gap came back from OSM.
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].source !== 'simulated') continue;

    let left = null, right = null;
    for (let j = i - 1; j >= 0; j--) {
      if (segments[j].source === 'osm') { left = segments[j]; break; }
    }
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].source === 'osm') { right = segments[j]; break; }
    }

    // Pick the nearer neighbor; if equidistant prefer left
    const neighbor = (left && right)
      ? (i - left.index <= right.index - i ? left : right)
      : (left ?? right);

    if (!neighbor) continue;

    const { score, factors } = scoreSegment(neighbor.roadType, neighbor.speedLimit, neighbor.width);
    const tier = getTier(score);
    segments[i] = {
      ...segments[i],
      roadType:   neighbor.roadType,
      speedLimit: neighbor.speedLimit,
      width:      neighbor.width,
      score,
      factors,
      tier:       tier.label,
      tierColor:  tier.color,
      source:     'inferred',
      streetName: null,   // never inherit neighbor's street name — different road
    };
  }

  const totalDist = segments.reduce((s, sg) => s + sg.dist, 0);
  const overall   = Math.round(
    segments.reduce((s, sg) => s + sg.score * (sg.dist / totalDist), 0)
  );

  const osmCount      = segments.filter(s => s.source === 'osm').length;
  const inferredCount = segments.filter(s => s.source === 'inferred').length;
  const simCount      = segments.length - osmCount - inferredCount;
  console.log(`[SafeRoute] Scored ${segments.length} segments — ${osmCount} OSM, ${inferredCount} inferred, ${simCount} simulated`);

  return {
    name,
    fileType,
    overall,
    tier: getTier(overall),
    totalDist,
    segments,
  };
}
