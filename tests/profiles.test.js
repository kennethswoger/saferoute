import { describe, it, expect } from 'vitest';
import { getTier, ROAD_PROFILES, ROAD_WEIGHTS, SPEED_DEFAULTS, WIDTH_DEFAULTS } from '../scoring/profiles.js';

describe('getTier', () => {
  it('returns Safe for 80+', () => {
    expect(getTier(80).label).toBe('Safe');
    expect(getTier(95).label).toBe('Safe');
    expect(getTier(100).label).toBe('Safe');
  });

  it('returns Mostly Safe for 65–79', () => {
    expect(getTier(65).label).toBe('Mostly Safe');
    expect(getTier(72).label).toBe('Mostly Safe');
    expect(getTier(79).label).toBe('Mostly Safe');
  });

  it('returns Use Caution for 50–64', () => {
    expect(getTier(50).label).toBe('Use Caution');
    expect(getTier(57).label).toBe('Use Caution');
    expect(getTier(64).label).toBe('Use Caution');
  });

  it('returns Risky for 35–49', () => {
    expect(getTier(35).label).toBe('Risky');
    expect(getTier(42).label).toBe('Risky');
    expect(getTier(49).label).toBe('Risky');
  });

  it('returns Avoid for 0–34', () => {
    expect(getTier(0).label).toBe('Avoid');
    expect(getTier(20).label).toBe('Avoid');
    expect(getTier(34).label).toBe('Avoid');
  });

  it('returns correct tierColor', () => {
    expect(getTier(85).color).toBe('safe');
    expect(getTier(70).color).toBe('safe');
    expect(getTier(55).color).toBe('warn');
    expect(getTier(40).color).toBe('danger');
    expect(getTier(10).color).toBe('danger');
  });
});

describe('ROAD_PROFILES', () => {
  it('has entries for all expected road types', () => {
    const types = ['cycleway', 'path', 'residential', 'service', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
    for (const t of types) {
      expect(ROAD_PROFILES[t], `missing profile for ${t}`).toBeDefined();
    }
  });

  it('cycleway scores higher than primary on all factors', () => {
    const cy = ROAD_PROFILES.cycleway;
    const pr = ROAD_PROFILES.primary;
    expect(cy.trafficScore).toBeGreaterThan(pr.trafficScore);
    expect(cy.infraScore).toBeGreaterThan(pr.infraScore);
  });
});

describe('ROAD_WEIGHTS', () => {
  it('final cumulative weight is 1.0', () => {
    expect(ROAD_WEIGHTS[ROAD_WEIGHTS.length - 1].cum).toBe(1.0);
  });

  it('weights are monotonically increasing', () => {
    for (let i = 1; i < ROAD_WEIGHTS.length; i++) {
      expect(ROAD_WEIGHTS[i].cum).toBeGreaterThan(ROAD_WEIGHTS[i - 1].cum);
    }
  });
});

describe('SPEED_DEFAULTS and WIDTH_DEFAULTS', () => {
  it('residential speed is 25 mph', () => {
    expect(SPEED_DEFAULTS.residential).toBe(25);
  });

  it('cycleway is narrower than primary', () => {
    expect(WIDTH_DEFAULTS.cycleway).toBeLessThan(WIDTH_DEFAULTS.primary);
  });
});
