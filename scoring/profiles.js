// scoring/profiles.js — road type profiles, defaults, and classifier weights

// Per road type: traffic exposure, infrastructure quality, surface quality
export const ROAD_PROFILES = {
  cycleway:    { trafficScore: 95, infraScore: 98, surfaceScore: 90 },
  path:        { trafficScore: 92, infraScore: 88, surfaceScore: 65 },
  residential: { trafficScore: 72, infraScore: 55, surfaceScore: 80 },
  service:     { trafficScore: 80, infraScore: 40, surfaceScore: 60 },
  tertiary:    { trafficScore: 60, infraScore: 45, surfaceScore: 75 },
  secondary:   { trafficScore: 42, infraScore: 35, surfaceScore: 70 },
  primary:     { trafficScore: 28, infraScore: 20, surfaceScore: 72 },
  trunk:       { trafficScore: 12, infraScore:  8, surfaceScore: 80 },
  motorway:    { trafficScore:  2, infraScore:  0, surfaceScore: 85 },
};

// Fallback road width in meters when OSM width tag is absent
export const WIDTH_DEFAULTS = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8,
  tertiary: 7,  residential: 6, service: 4.5,
  cycleway: 3,  path: 2.5,
};

// Typical speed limits in mph per road type
export const SPEED_DEFAULTS = {
  cycleway: 15, path: 15, service: 15,
  residential: 25, tertiary: 35,
  secondary: 45, primary: 55,
  trunk: 65,    motorway: 70,
};

// Cumulative probability thresholds for seeded road type selection.
// Distribution reflects a realistic cycling route mix.
// trunk/motorway excluded — cyclists won't route onto them, and if OSM
// genuinely tags a road as trunk the real Overpass data will be used instead.
export const ROAD_WEIGHTS = [
  { type: 'cycleway',    cum: 0.08 },
  { type: 'path',        cum: 0.15 },
  { type: 'residential', cum: 0.47 },
  { type: 'service',     cum: 0.52 },
  { type: 'tertiary',    cum: 0.74 },
  { type: 'secondary',   cum: 0.91 },
  { type: 'primary',     cum: 1.00 },
];

// Score tier thresholds
export const TIERS = [
  { min: 80,  label: 'Safe',        color: 'safe'   },
  { min: 65,  label: 'Mostly Safe', color: 'safe'   },
  { min: 50,  label: 'Use Caution', color: 'warn'   },
  { min: 35,  label: 'Risky',       color: 'danger' },
  { min:  0,  label: 'Avoid',       color: 'danger' },
];

export function getTier(score) {
  return TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1];
}
