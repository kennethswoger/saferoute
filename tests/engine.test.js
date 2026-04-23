import { describe, it, expect } from 'vitest';
import {
  scoreWidth,
  scoreSpeed,
  scoreSegment,
  groupIntoSegments,
  resolveRoadAttrs,
} from '../scoring/engine.js';
import { SPEED_DEFAULTS, WIDTH_DEFAULTS } from '../scoring/profiles.js';

// ── scoreWidth ────────────────────────────────────────────────────────────────

describe('scoreWidth', () => {
  it('returns 95 for wide roads (>= 12m)', () => {
    expect(scoreWidth(12)).toBe(95);
    expect(scoreWidth(20)).toBe(95);
  });

  it('returns 78 for 8–11m', () => {
    expect(scoreWidth(8)).toBe(78);
    expect(scoreWidth(10)).toBe(78);
  });

  it('returns 72 for 6–7m', () => {
    expect(scoreWidth(6)).toBe(72);
    expect(scoreWidth(7)).toBe(72);
  });

  it('returns 55 for 3–5m (dedicated cycling path)', () => {
    expect(scoreWidth(3)).toBe(55);
    expect(scoreWidth(5)).toBe(55);
  });

  it('returns 30 for very narrow (< 3m)', () => {
    expect(scoreWidth(1)).toBe(30);
    expect(scoreWidth(2)).toBe(30);
  });
});

// ── scoreSpeed ────────────────────────────────────────────────────────────────

describe('scoreSpeed', () => {
  it('scores slow streets highest', () => {
    expect(scoreSpeed(15)).toBe(96);
    expect(scoreSpeed(10)).toBe(96);
  });

  it('scores residential speed well', () => {
    expect(scoreSpeed(25)).toBe(84);
  });

  it('scores arterial speeds lower', () => {
    expect(scoreSpeed(45)).toBe(40);
    expect(scoreSpeed(55)).toBe(22);
  });

  it('scores highway speeds lowest', () => {
    expect(scoreSpeed(70)).toBe(10);
  });

  it('scores are strictly decreasing as speed increases', () => {
    const speeds = [15, 25, 30, 35, 45, 55, 70];
    const scores = speeds.map(scoreSpeed);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });
});

// ── scoreSegment ──────────────────────────────────────────────────────────────

describe('scoreSegment', () => {
  it('returns a score between 0 and 100', () => {
    const { score } = scoreSegment('residential', 25, 6);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('cycleway scores higher than primary for same speed/width', () => {
    const cy = scoreSegment('cycleway', 15, 3);
    const pr = scoreSegment('primary', 15, 3);
    expect(cy.score).toBeGreaterThan(pr.score);
  });

  it('returns all five factor keys', () => {
    const { factors } = scoreSegment('tertiary', 35, 7);
    expect(factors).toHaveProperty('width');
    expect(factors).toHaveProperty('speed');
    expect(factors).toHaveProperty('traffic');
    expect(factors).toHaveProperty('infra');
    expect(factors).toHaveProperty('surface');
  });

  it('falls back to tertiary profile for unknown road type', () => {
    const known   = scoreSegment('tertiary', 35, 7);
    const unknown = scoreSegment('mystery_road', 35, 7);
    expect(unknown.score).toBe(known.score);
  });
});

// ── groupIntoSegments ─────────────────────────────────────────────────────────

// Points roughly 0.01° apart (≈ 0.69 miles each step) — easy to span segment target
const makePoints = (n, baseLat = 39.0, baseLon = -94.0) =>
  Array.from({ length: n }, (_, i) => [baseLat + i * 0.001, baseLon]);

describe('groupIntoSegments', () => {
  it('throws for fewer than 2 points', () => {
    expect(() => groupIntoSegments([[39.0, -94.0]])).toThrow();
    expect(() => groupIntoSegments([])).toThrow();
  });

  it('returns at least one segment for a minimal route', () => {
    const segs = groupIntoSegments([[39.0, -94.0], [39.01, -94.0]]);
    expect(segs.length).toBeGreaterThanOrEqual(1);
  });

  it('every segment has at least 2 points', () => {
    const segs = groupIntoSegments(makePoints(50));
    for (const seg of segs) {
      expect(seg.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('adjacent segments share their boundary point (overlap)', () => {
    const segs = groupIntoSegments(makePoints(50));
    for (let i = 1; i < segs.length; i++) {
      const lastOfPrev  = segs[i - 1][segs[i - 1].length - 1];
      const firstOfNext = segs[i][0];
      expect(lastOfPrev).toEqual(firstOfNext);
    }
  });

  it('covers all original points across all segments', () => {
    const pts  = makePoints(50);
    const segs = groupIntoSegments(pts);
    const flat = segs.flatMap(s => s);
    // First and last original points must appear
    expect(flat[0]).toEqual(pts[0]);
    expect(flat[flat.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

// ── resolveRoadAttrs ──────────────────────────────────────────────────────────

describe('resolveRoadAttrs', () => {
  const mid = [39.1, -94.5];

  it('uses OSM tags when highway is present', () => {
    const tags = { highway: 'tertiary', maxspeed: '35 mph', width: '8' };
    const res  = resolveRoadAttrs(mid, tags, 0, false);
    expect(res.roadType).toBe('tertiary');
    expect(res.speedLimit).toBe(35);
    expect(res.width).toBe(8);
    expect(res.source).toBe('osm');
  });

  it('marks landuse_inferred segments as inferred source', () => {
    const tags = { highway: 'residential', landuse_inferred: true };
    const res  = resolveRoadAttrs(mid, tags, 0, false);
    expect(res.source).toBe('inferred');
  });

  it('falls back to simulated residential when osmTags is null', () => {
    const res = resolveRoadAttrs(mid, null, 0, false);
    expect(res.roadType).toBe('residential');
    expect(res.source).toBe('simulated');
    expect(res.speedLimit).toBe(SPEED_DEFAULTS.residential);
    expect(res.width).toBe(WIDTH_DEFAULTS.residential);
  });

  it('uses SPEED_DEFAULTS when maxspeed tag is absent', () => {
    const tags = { highway: 'secondary' };
    const res  = resolveRoadAttrs(mid, tags, 0, false);
    expect(res.speedLimit).toBe(SPEED_DEFAULTS.secondary);
  });

  it('includes streetName from OSM name tag', () => {
    const tags = { highway: 'residential', name: 'Main St' };
    const res  = resolveRoadAttrs(mid, tags, 0, false);
    expect(res.streetName).toBe('Main St');
  });
});
