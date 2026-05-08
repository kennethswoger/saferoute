/**
 * OSM highway type → US-friendly display label
 * Used only for UI display. Scoring engine uses OSM keys internally.
 */
export const ROAD_LABELS = {
  motorway:      'Interstate / Highway',
  motorway_link: 'Highway On-Ramp',
  trunk:         'Major Highway',
  trunk_link:    'Major Highway Ramp',
  primary:       'Main Road',
  primary_link:  'Main Road Connector',
  secondary:     'County Road',
  secondary_link:'County Road Connector',
  tertiary:      'Minor Road',
  tertiary_link: 'Minor Road Connector',
  residential:   'Residential Street',
  living_street: 'Shared Street',
  service:       'Service Road',
  cycleway:      'Bike Path',
  path:          'Shared Path',
  footway:       'Footpath',
  track:         'Unpaved Track',
  unclassified:  'Local Road',
};

/**
 * Returns a US-friendly display label for an OSM highway type.
 * Falls back to a title-cased version of the raw tag if not in the map.
 * Never returns undefined — safe to use directly in UI.
 *
 * @param {string} osmType - e.g. 'tertiary', 'residential', 'cycleway'
 * @returns {string}
 */
export function getRoadLabel(osmType) {
  if (!osmType) return 'Unknown Road';
  return ROAD_LABELS[osmType]
    ?? osmType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
