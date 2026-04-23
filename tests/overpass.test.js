import { describe, it, expect } from 'vitest';
import {
  parseSpeed,
  parseWidth,
  matchWaysToPoints,
  sampleIndices,
  buildHighwayQuery,
} from '../scoring/overpass.js';

// ── parseSpeed ────────────────────────────────────────────────────────────────

describe('parseSpeed', () => {
  it('parses bare km/h number and converts to mph', () => {
    expect(parseSpeed('50')).toBe(31);   // Math.round(50 * 0.621)
    expect(parseSpeed('30')).toBe(19);
  });

  it('parses explicit mph values without conversion', () => {
    expect(parseSpeed('25 mph')).toBe(25);
    expect(parseSpeed('35 mph')).toBe(35);
  });

  it('parses knots and converts to mph', () => {
    expect(parseSpeed('10 knots')).toBe(12); // Math.round(10 * 1.151)
  });

  it('returns null for null / undefined / empty', () => {
    expect(parseSpeed(null)).toBeNull();
    expect(parseSpeed(undefined)).toBeNull();
    expect(parseSpeed('')).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(parseSpeed('US:urban')).toBeNull();
    expect(parseSpeed('walk')).toBeNull();
  });
});

// ── parseWidth ────────────────────────────────────────────────────────────────

describe('parseWidth', () => {
  it('parses a numeric string', () => {
    expect(parseWidth('3.5', 'residential')).toBe(3.5);
    expect(parseWidth('10', 'primary')).toBe(10);
  });

  it('falls back to WIDTH_DEFAULTS for null/undefined', () => {
    expect(parseWidth(null, 'residential')).toBe(6);
    expect(parseWidth(undefined, 'cycleway')).toBe(3);
  });

  it('falls back to 6 when road type is unknown', () => {
    expect(parseWidth(null, 'unknown_type')).toBe(6);
  });

  it('falls back to default when string is non-numeric', () => {
    expect(parseWidth('wide', 'tertiary')).toBe(7);
  });
});

// ── sampleIndices ─────────────────────────────────────────────────────────────

describe('sampleIndices', () => {
  it('returns all indices when length <= n', () => {
    expect(sampleIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleIndices(3, 3)).toEqual([0, 1, 2]);
  });

  it('always includes first and last index', () => {
    const idxs = sampleIndices(100, 15);
    expect(idxs[0]).toBe(0);
    expect(idxs[idxs.length - 1]).toBe(99);
  });

  it('returns exactly n indices when length > n', () => {
    expect(sampleIndices(100, 15)).toHaveLength(15);
    expect(sampleIndices(50, 5)).toHaveLength(5);
  });

  it('indices are in ascending order', () => {
    const idxs = sampleIndices(100, 15);
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
    }
  });
});

// ── buildHighwayQuery ─────────────────────────────────────────────────────────

describe('buildHighwayQuery', () => {
  const pts = [[39.1, -94.5], [39.11, -94.49]];

  it('contains [out:json]', () => {
    expect(buildHighwayQuery(pts)).toContain('[out:json]');
  });

  it('includes sample point coordinates', () => {
    const q = buildHighwayQuery(pts);
    expect(q).toContain('39.1');
    expect(q).toContain('-94.5');
  });

  it('includes a bbox clip', () => {
    // out tags geom(south,west,north,east)
    expect(buildHighwayQuery(pts)).toMatch(/out tags geom\(/);
  });

  it('bbox south < north and west < east', () => {
    const q = buildHighwayQuery(pts);
    const match = q.match(/out tags geom\(([\d.,-]+)\)/);
    expect(match).not.toBeNull();
    const [south, west, north, east] = match[1].split(',').map(Number);
    expect(south).toBeLessThan(north);
    expect(west).toBeLessThan(east);
  });

  it('excludes motorway_link and footway', () => {
    const q = buildHighwayQuery(pts);
    expect(q).toContain('motorway_link');
    expect(q).toContain('footway');
  });
});

// ── matchWaysToPoints ─────────────────────────────────────────────────────────

// Helpers to build fake Overpass way elements
function hwWay(id, nodes, tags) {
  return { id, type: 'way', geometry: nodes.map(([lat, lon]) => ({ lat, lon })), tags };
}

function luWay(id, centerLat, centerLon) {
  return { id, type: 'way', center: { lat: centerLat, lon: centerLon }, tags: { landuse: 'residential' } };
}

describe('matchWaysToPoints', () => {
  it('returns null for each point when no elements', () => {
    const result = matchWaysToPoints([], [[39.0, -94.0], [39.1, -94.1]]);
    expect(result).toEqual([null, null]);
  });

  it('assigns a nearby highway way to the closest sample point', () => {
    const pt = [39.1, -94.5];
    const way = hwWay(1, [[39.1, -94.5]], { highway: 'residential' });
    const [res] = matchWaysToPoints([way], [pt]);
    expect(res?.highway).toBe('residential');
  });

  it('discards a highway way beyond MAX_HIGHWAY_DIST (50m)', () => {
    // 0.001 degrees lat ≈ 111m — well beyond the 50m cap
    const pt  = [39.1, -94.5];
    const way = hwWay(1, [[39.101, -94.5]], { highway: 'residential' });
    const [res] = matchWaysToPoints([way], [pt]);
    expect(res).toBeNull();
  });

  it('assigns way to the nearest of two sample points', () => {
    const pts = [[39.1, -94.5], [39.2, -94.5]];
    // Node is exactly on first point
    const way = hwWay(1, [[39.1, -94.5]], { highway: 'tertiary' });
    const [r0, r1] = matchWaysToPoints([way], pts);
    expect(r0?.highway).toBe('tertiary');
    expect(r1).toBeNull();
  });

  it('prefers cycling-friendly road within 12m proximity band', () => {
    const pt = [39.1, -94.5];
    // Both nodes are within a few metres — cycleway should win over primary
    const cycleway = hwWay(1, [[39.1, -94.5]],          { highway: 'cycleway' });
    const primary  = hwWay(2, [[39.10005, -94.5]],      { highway: 'primary' });
    const [res] = matchWaysToPoints([cycleway, primary], [pt]);
    expect(res?.highway).toBe('cycleway');
  });

  it('infers residential from landuse when no highway found', () => {
    const pt  = [39.1, -94.5];
    const lu  = luWay(1, 39.1, -94.5);
    const [res] = matchWaysToPoints([lu], [pt]);
    expect(res?.highway).toBe('residential');
    expect(res?.landuse_inferred).toBe(true);
  });

  it('prefers explicit highway over landuse inference', () => {
    const pt  = [39.1, -94.5];
    const way = hwWay(1, [[39.1, -94.5]], { highway: 'tertiary' });
    const lu  = luWay(2, 39.1, -94.5);
    const [res] = matchWaysToPoints([way, lu], [pt]);
    expect(res?.highway).toBe('tertiary');
    expect(res?.landuse_inferred).toBeUndefined();
  });
});
