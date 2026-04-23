import { describe, it, expect } from 'vitest';
import { parseGPX, parseTCX } from '../parser/gpx.js';

// ── Minimal fixture strings ───────────────────────────────────────────────────

const GPX_MINIMAL = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Test Route</name>
    <trkseg>
      <trkpt lat="39.1" lon="-94.5"></trkpt>
      <trkpt lat="39.11" lon="-94.49"></trkpt>
      <trkpt lat="39.12" lon="-94.48"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const GPX_NO_NAME = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="39.1" lon="-94.5"></trkpt>
      <trkpt lat="39.11" lon="-94.49"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const TCX_MINIMAL = `<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity>
      <Id>Test TCX</Id>
      <Lap>
        <Track>
          <Trackpoint>
            <Position>
              <LatitudeDegrees>39.1</LatitudeDegrees>
              <LongitudeDegrees>-94.5</LongitudeDegrees>
            </Position>
          </Trackpoint>
          <Trackpoint>
            <Position>
              <LatitudeDegrees>39.11</LatitudeDegrees>
              <LongitudeDegrees>-94.49</LongitudeDegrees>
            </Position>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const TCX_WITH_NAME = `<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity>
      <Id>My Ride</Id>
      <Lap>
        <Track>
          <Trackpoint>
            <Position>
              <LatitudeDegrees>39.1</LatitudeDegrees>
              <LongitudeDegrees>-94.5</LongitudeDegrees>
            </Position>
          </Trackpoint>
          <Trackpoint>
            <Name>My Ride</Name>
            <Position>
              <LatitudeDegrees>39.11</LatitudeDegrees>
              <LongitudeDegrees>-94.49</LongitudeDegrees>
            </Position>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

// ── parseGPX ──────────────────────────────────────────────────────────────────

describe('parseGPX', () => {
  it('parses track points correctly', () => {
    const { points } = parseGPX(GPX_MINIMAL);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual([39.1, -94.5]);
    expect(points[1]).toEqual([39.11, -94.49]);
  });

  it('extracts the route name', () => {
    const { name } = parseGPX(GPX_MINIMAL);
    expect(name).toBe('Test Route');
  });

  it('falls back to "My Route" when name element is absent', () => {
    const { name } = parseGPX(GPX_NO_NAME);
    expect(name).toBe('My Route');
  });

  it('sets fileType to GPX', () => {
    expect(parseGPX(GPX_MINIMAL).fileType).toBe('GPX');
  });

  it('throws on invalid XML', () => {
    expect(() => parseGPX('<not valid xml<')).toThrow();
  });

  it('throws when no track points are found', () => {
    const empty = `<?xml version="1.0"?><gpx version="1.1"></gpx>`;
    expect(() => parseGPX(empty)).toThrow('No track points found');
  });
});

// ── parseTCX ──────────────────────────────────────────────────────────────────

describe('parseTCX', () => {
  it('parses trackpoints correctly', () => {
    const { points } = parseTCX(TCX_MINIMAL);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual([39.1, -94.5]);
    expect(points[1]).toEqual([39.11, -94.49]);
  });

  it('sets fileType to TCX', () => {
    expect(parseTCX(TCX_MINIMAL).fileType).toBe('TCX');
  });

  it('falls back to "My Route" when no Name element', () => {
    expect(parseTCX(TCX_MINIMAL).name).toBe('My Route');
  });

  it('throws on invalid XML', () => {
    expect(() => parseTCX('<bad')).toThrow();
  });

  it('throws when no trackpoints are found', () => {
    const empty = `<?xml version="1.0"?><TrainingCenterDatabase></TrainingCenterDatabase>`;
    expect(() => parseTCX(empty)).toThrow('No track points found');
  });
});
