// parser/gpx.js — GPX and TCX parsing via browser DOMParser
// Returns { points: [[lat, lon], ...], name, fileType }

export function parseGPX(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Invalid GPX file — could not parse XML.');

  const points = [...doc.querySelectorAll('trkpt, rtept')]
    .map(p => [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon'))])
    .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));

  if (points.length === 0) throw new Error('No track points found in GPX file.');

  const name = doc.querySelector('name')?.textContent?.trim() || 'My Route';
  return { points, name, fileType: 'GPX' };
}

export function parseTCX(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Invalid TCX file — could not parse XML.');

  const points = [...doc.querySelectorAll('Trackpoint')]
    .map(p => {
      const lat = p.querySelector('LatitudeDegrees')?.textContent;
      const lon = p.querySelector('LongitudeDegrees')?.textContent;
      return [parseFloat(lat), parseFloat(lon)];
    })
    .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));

  if (points.length === 0) throw new Error('No track points found in TCX file.');

  const name = doc.querySelector('Name')?.textContent?.trim() || 'My Route';
  return { points, name, fileType: 'TCX' };
}
