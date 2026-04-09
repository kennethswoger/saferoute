// ui/map.js — Leaflet map, color-coded segment polylines, start/end markers

const TILE_URL  = 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const TIER_COLOR = {
  safe:   '#1D9E75',
  warn:   '#EF9F27',
  danger: '#D85A30',
};

function segmentColor(seg) {
  return TIER_COLOR[seg.tierColor] ?? '#EF9F27';
}

function segmentWeight(seg) {
  if (seg.tierColor === 'safe')   return 4;
  if (seg.tierColor === 'warn')   return 5;
  return 6;
}

let map        = null;
let layerGroup = null;
let polylines  = [];   // L.Polyline per segment, indexed by segment order
let segMeta    = [];   // { tierColor } for style restoration

export function focusSegment(idx) {
  if (!map) return;
  polylines.forEach((line, i) => {
    if (i === idx) {
      line.setStyle({ color: '#FFFFFF', weight: 8, opacity: 1.0 });
      line.bringToFront();
      map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 17 });
    } else {
      line.setStyle({
        color:   TIER_COLOR[segMeta[i]?.tierColor] ?? '#EF9F27',
        weight:  segmentWeight({ tierColor: segMeta[i]?.tierColor }),
        opacity: 0.22,
      });
    }
  });
  document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function clearFocus() {
  polylines.forEach((line, i) => {
    line.setStyle({
      color:   TIER_COLOR[segMeta[i]?.tierColor] ?? '#EF9F27',
      weight:  segmentWeight({ tierColor: segMeta[i]?.tierColor }),
      opacity: 0.88,
    });
  });
  // Let the results panel know to drop the active highlight
  document.getElementById('resultsPanel')
    ?.querySelectorAll('.seg-active')
    .forEach(el => el.classList.remove('seg-active'));
}

export function initMap(segments) {
  const allPoints = segments.flatMap(s => s.points);
  const bounds    = L.latLngBounds(allPoints);
  const mapEl     = document.getElementById('map');

  // Build layers into a function we can call once the map exists
  const addLayers = () => {
    if (layerGroup) layerGroup.clearLayers();
    layerGroup = L.layerGroup().addTo(map);
    polylines  = [];
    segMeta    = [];

    for (const seg of segments) {
      const line = L.polyline(seg.points, {
        color:     segmentColor(seg),
        weight:    segmentWeight(seg),
        opacity:   0.88,
        lineCap:   'round',
        lineJoin:  'round',
      });
      line.bindTooltip(buildTooltip(seg), {
        sticky: true, className: 'sr-tooltip', offset: [12, 0],
      });
      polylines.push(line);
      segMeta.push({ tierColor: seg.tierColor });
      layerGroup.addLayer(line);
    }

    L.marker(allPoints[0], { icon: markerIcon('#1D9E75', 'S') })
     .bindTooltip('Start', { className: 'sr-tooltip' })
     .addTo(layerGroup);

    L.marker(allPoints[allPoints.length - 1], { icon: markerIcon('#6B8070', 'E') })
     .bindTooltip('Finish', { className: 'sr-tooltip' })
     .addTo(layerGroup);

    map.fitBounds(bounds, { padding: [40, 40] });
  };

  // If map already exists (second route load), just swap layers
  if (map) {
    addLayers();
    return;
  }

  // First load — the map container was display:none until setState('results')
  // just ran. Accessing offsetWidth forces the browser to synchronously
  // recalculate layout, so by the time L.map() is called the container
  // has real pixel dimensions and Leaflet can request tiles correctly.
  void mapEl.offsetWidth; // force reflow

  if (mapEl.offsetWidth > 0) {
    map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(map);
    map.on('click', clearFocus);
    addLayers();
  } else {
    // Fallback: container is still zero — wait for ResizeObserver
    const ro = new ResizeObserver(() => {
      if (mapEl.offsetWidth > 0) {
        ro.disconnect();
        map = L.map('map', { zoomControl: true, attributionControl: true });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(map);
        map.on('click', clearFocus);
        addLayers();
      }
    });
    ro.observe(mapEl);
  }
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
    html: svg, className: '',
    iconSize: [28, 36], iconAnchor: [14, 36], tooltipAnchor: [14, -36],
  });
}
