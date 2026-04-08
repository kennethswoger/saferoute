// ui/map.js — Leaflet map, color-coded segment polylines, start/end markers

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_matter_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Color by score using design-system values
function segmentColor(score) {
  if (score >= 75) return '#1D9E75'; // --safe
  if (score >= 50) return '#EF9F27'; // --warn-mid
  return '#D85A30';                  // --danger
}

// Weight by road importance (wider lines for busier/riskier roads)
function segmentWeight(score) {
  if (score >= 75) return 4;
  if (score >= 50) return 5;
  return 6;
}

let map = null;
let layerGroup = null;

export function initMap(segments) {
  // Collect all points for bounds
  const allPoints = segments.flatMap(s => s.points);

  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
  }

  // Clear previous route layers
  if (layerGroup) layerGroup.clearLayers();
  layerGroup = L.layerGroup().addTo(map);

  // Draw segment polylines
  for (const seg of segments) {
    const color  = segmentColor(seg.score);
    const weight = segmentWeight(seg.score);

    const line = L.polyline(seg.points, {
      color,
      weight,
      opacity: 0.88,
      lineCap: 'round',
      lineJoin: 'round',
    });

    line.bindTooltip(buildTooltip(seg), {
      sticky: true,
      className: 'sr-tooltip',
      offset: [12, 0],
    });

    layerGroup.addLayer(line);
  }

  // Start marker — green pin
  const startIcon = markerIcon('#1D9E75', 'S');
  L.marker(allPoints[0], { icon: startIcon })
   .bindTooltip('Start', { permanent: false, className: 'sr-tooltip' })
   .addTo(layerGroup);

  // End marker — muted pin
  const endIcon = markerIcon('#6B8070', 'E');
  L.marker(allPoints[allPoints.length - 1], { icon: endIcon })
   .bindTooltip('Finish', { permanent: false, className: 'sr-tooltip' })
   .addTo(layerGroup);

  // Fit map to route bounds with padding
  map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
}

// ── Tooltip content ────────────────────────────────────────────────────────────
function buildTooltip(seg) {
  const tierColor = { safe: '#1D9E75', warn: '#EF9F27', danger: '#D85A30' }[seg.tierColor] ?? '#6B8070';
  return `
    <div class="sr-tt-row">
      <span class="sr-tt-score" style="color:${tierColor}">${seg.score}</span>
      <span class="sr-tt-sep">/100</span>
    </div>
    <div class="sr-tt-meta">${seg.roadType} · ${seg.speedLimit} mph · ${seg.width}m wide</div>
    <div class="sr-tt-tier" style="color:${tierColor}">${seg.tier}</div>
  `;
}

// ── Custom marker icon ─────────────────────────────────────────────────────────
function markerIcon(color, label) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.625 14 22 14 22S28 23.625 28 14C28 6.27 21.73 0 14 0z"
            fill="${color}"/>
      <text x="14" y="18" text-anchor="middle" dominant-baseline="middle"
            font-family="DM Mono, monospace" font-size="11" font-weight="500"
            fill="#fff">${label}</text>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    tooltipAnchor: [14, -36],
  });
}
