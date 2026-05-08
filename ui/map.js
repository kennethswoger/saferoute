// ui/map.js — Leaflet map, color-coded segment polylines, start/end markers
import { getRoadLabel } from './roadLabels.js';

const TILE_URL  = 'https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=86d0ff46166147298dc5fa47c9c31c9a';
const TILE_ATTR = '&copy; <a href="https://www.thunderforest.com">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

let tileLayer = null;

const TIER_COLOR = {
  safe:   '#1D9E75',
  warn:   '#ffb74d',
  danger: '#D85A30',
};

function segmentColor(seg) {
  return TIER_COLOR[seg.tierColor] ?? TIER_COLOR.warn;
}

function segmentWeight() { return 4; }

let map          = null;
let layerGroup   = null;
let polylines    = [];   // L.Polyline per segment, indexed by segment order
let segMeta      = [];   // { tierColor } for style restoration
let focusOutline = null; // extra wide polyline rendered behind the focused segment
let routeVisible = true;

export function focusSegment(idx) {
  if (!map) return;

  // Remove previous outline
  if (focusOutline) { layerGroup.removeLayer(focusOutline); focusOutline = null; }

  polylines.forEach((line, i) => {
    if (i === idx) {
      focusOutline = L.polyline(line.getLatLngs(), {
        color:    '#000000',
        weight:   18,
        opacity:  0.4,
        lineCap:  'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      const focusColor = TIER_COLOR[segMeta[idx]?.tierColor] ?? TIER_COLOR.warn;
      line.setStyle({ color: focusColor, weight: 8, opacity: 1.0 });
      line.bringToFront();
      map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 17 });
    } else {
      line.setStyle({
        color:   TIER_COLOR[segMeta[i]?.tierColor] ?? TIER_COLOR.warn,
        weight:  segmentWeight(),
        opacity: 0.22,
      });
    }
  });
  document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function clearFocus() {
  if (focusOutline) { layerGroup.removeLayer(focusOutline); focusOutline = null; }
  polylines.forEach((line, i) => {
    line.setStyle({
      color:   TIER_COLOR[segMeta[i]?.tierColor] ?? TIER_COLOR.warn,
      weight:  segmentWeight(),
      opacity: 0.88,
    });
  });
  // Let the results panel know to drop the active highlight
  document.getElementById('resultsPanel')
    ?.querySelectorAll('.seg-active')
    .forEach(el => el.classList.remove('seg-active'));
}

export function toggleRoute() {
  if (!map) return routeVisible;
  routeVisible = !routeVisible;
  const display = routeVisible ? '' : 'none';
  ['overlayPane', 'markerPane', 'shadowPane'].forEach(pane => {
    const el = map.getPane(pane);
    if (el) el.style.display = display;
  });
  return routeVisible;
}

export function initMap(segments) {
  routeVisible = true;
  if (map) {
    ['overlayPane', 'markerPane', 'shadowPane'].forEach(pane => {
      const el = map.getPane(pane);
      if (el) el.style.display = '';
    });
  }
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
      const segIdx = seg.index;
      const line = L.polyline(seg.points, {
        color:     segmentColor(seg),
        weight:    segmentWeight(),
        opacity:   0.88,
        lineCap:   'round',
        lineJoin:  'round',
      });
      line.bindTooltip(buildTooltip(seg), {
        sticky: true, className: 'sr-tooltip', offset: [12, 0],
      });
      line.on('click', e => {
        L.DomEvent.stopPropagation(e); // prevent map click → clearFocus firing

        const panel  = document.getElementById('resultsPanel');
        const segRow = panel?.querySelector(`[data-seg-idx="${segIdx}"]`);

        if (segRow?.classList.contains('seg-active')) {
          clearFocus();
          return;
        }

        focusSegment(segIdx);

        if (panel) {
          panel.querySelectorAll('[data-seg-idx]').forEach(el => el.classList.remove('seg-active'));
          panel.querySelectorAll(`[data-seg-idx="${segIdx}"]`).forEach(el => el.classList.add('seg-active'));
          segRow?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
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
    tileLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 22 }).addTo(map);
    map.on('click', clearFocus);
    addLayers();
  } else {
    // Fallback: container is still zero — wait for ResizeObserver
    const ro = new ResizeObserver(() => {
      if (mapEl.offsetWidth > 0) {
        ro.disconnect();
        map = L.map('map', { zoomControl: true, attributionControl: true });
        tileLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 22 }).addTo(map);
        map.on('click', clearFocus);
        addLayers();
      }
    });
    ro.observe(mapEl);
  }
}

// ── Tooltip content ────────────────────────────────────────────────────────────
function buildTooltip(seg) {
  const tierColor = TIER_COLOR[seg.tierColor] ?? '#6B8070';
  return `
    <div class="sr-tt-row">
      <span class="sr-tt-score" style="color:${tierColor}">${seg.score}</span>
      <span class="sr-tt-sep">/100</span>
    </div>
    <div class="sr-tt-meta">${getRoadLabel(seg.roadType)} · ${seg.speedLimit} mph · ${seg.width}m wide</div>
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
