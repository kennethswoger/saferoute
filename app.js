// SafeRoute — app.js
// Entry point: file handling + UI state machine
// State: 'idle' | 'loading' | 'results' | 'strava-picker'

const appEl           = document.getElementById('app');
const uploadZone      = document.getElementById('uploadZone');
const dropTarget      = document.getElementById('dropTarget');
const loadingZone     = document.getElementById('loadingZone');
const loadingLabel    = document.getElementById('loadingLabel');
const resultsZone     = document.getElementById('resultsZone');
const stravaZone      = document.getElementById('stravaZone');
const stravaRouteList = document.getElementById('stravaRouteList');
const fileInput         = document.getElementById('fileInput');
const demoBtn           = document.getElementById('demoBtn');
const stravaBtn         = document.getElementById('stravaBtn');
const disconnectBtn     = document.getElementById('disconnectBtn');
const profileSelector   = document.getElementById('profileSelector');

// ── Ride profile ──────────────────────────────────────────────────────────────
const PROFILE_KEYS = ['solo', 'club', 'large_group'];

function resolveProfileKey() {
  const urlParam = new URLSearchParams(window.location.search).get('profile');
  if (PROFILE_KEYS.includes(urlParam)) return urlParam;
  const stored = localStorage.getItem('sr-rider-profile');
  if (PROFILE_KEYS.includes(stored)) return stored;
  return 'club';
}

// Set initial radio state from localStorage / URL param
const initialProfileKey = resolveProfileKey();
const initialRadio = profileSelector.querySelector(`input[value="${initialProfileKey}"]`);
if (initialRadio) initialRadio.checked = true;

profileSelector.addEventListener('change', e => {
  if (e.target.name === 'riderProfile') localStorage.setItem('sr-rider-profile', e.target.value);
});

// ── State machine ──────────────────────────────────────────────────────────────
export async function setState(state) {
  appEl.dataset.state = state;
  uploadZone.hidden  = state !== 'idle';
  loadingZone.hidden = state !== 'loading';
  resultsZone.hidden = state !== 'results';
  stravaZone.hidden  = state !== 'strava-picker';
  if (state === 'idle') {
    const { clearShareHash } = await import('./ui/share.js');
    clearShareHash();
    updateStravaBtn();
  }
}

export function setLoadingLabel(text) {
  loadingLabel.textContent = text;
}

// ── File input ─────────────────────────────────────────────────────────────────
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

// ── Drag and drop ──────────────────────────────────────────────────────────────
document.addEventListener('dragover', e => {
  e.preventDefault();
  dropTarget.classList.add('drag-over');
});

document.addEventListener('dragleave', e => {
  // Only remove when leaving the window entirely
  if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
    dropTarget.classList.remove('drag-over');
  }
});

document.addEventListener('drop', e => {
  e.preventDefault();
  dropTarget.classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file) handleFile(file);
});

// ── Demo route ─────────────────────────────────────────────────────────────────
demoBtn.addEventListener('click', async () => {
  setState('loading');
  setLoadingLabel('Loading demo route…');
  try {
    const res = await fetch('./assets/demo-kc.gpx');
    if (!res.ok) throw new Error('Demo route file not found.');
    const text = await res.text();
    const { parseGPX } = await import('./parser/gpx.js');
    const route = parseGPX(text);
    await processRoute(route);
  } catch (err) {
    console.error('[SafeRoute]', err);
    showError(err.message ?? 'Could not load demo route.');
  }
});

// ── Connect / Import Strava ────────────────────────────────────────────────────
stravaBtn.addEventListener('click', async () => {
  const { isStravaConnected, getStravaToken, initiateStravaAuth } = await import('./js/strava.js');
  if (isStravaConnected()) {
    await loadStravaRoutes(getStravaToken());
  } else {
    await initiateStravaAuth();
  }
});

// ── Strava back button ─────────────────────────────────────────────────────────
document.getElementById('stravaBackBtn').addEventListener('click', () => setState('idle'));

// ── Disconnect Strava ──────────────────────────────────────────────────────────
disconnectBtn.addEventListener('click', async () => {
  const { disconnectStrava } = await import('./js/strava.js');
  disconnectStrava();
  stravaRouteList.innerHTML = '';
  setState('idle');
});

// ── Strava route picker ────────────────────────────────────────────────────────
stravaRouteList.addEventListener('click', async e => {
  const item = e.target.closest('.strava-route-item');
  if (!item) return;

  const routeId = item.dataset.routeId;
  setState('loading');
  setLoadingLabel('Fetching route from Strava…');

  try {
    const { getStravaToken, fetchStravaRouteGPX } = await import('./js/strava.js');
    const token = getStravaToken();
    if (!token) throw new Error('Strava session expired — please reconnect.');

    const gpxText = await fetchStravaRouteGPX(token, routeId);
    const { parseGPX } = await import('./parser/gpx.js');
    const route = parseGPX(gpxText);
    await processRoute(route);
  } catch (err) {
    console.error('[SafeRoute]', err);
    showError(err.message ?? 'Could not load route from Strava.');
  }
});

async function loadStravaRoutes(token) {
  setState('loading');
  setLoadingLabel('Loading your Strava routes…');
  try {
    const { fetchStravaRoutes } = await import('./js/strava.js');
    const routes = await fetchStravaRoutes(token);
    renderStravaRoutes(routes);
    setState('strava-picker');
  } catch (err) {
    console.error('[SafeRoute]', err);
    showError(err.message ?? 'Could not load Strava routes.');
  }
}

async function updateStravaBtn() {
  const { isStravaConnected } = await import('./js/strava.js');
  const connected = isStravaConnected();
  const img = stravaBtn.querySelector('img');
  img.src = connected
    ? './assets/btn_strava_import_with_orange.svg'
    : './assets/btn_strava_connect_with_orange.svg';
  img.alt = connected ? 'Import from Strava' : 'Connect with Strava';
  stravaBtn.setAttribute('aria-label', img.alt);
}

function renderStravaRoutes(routes) {
  if (!routes.length) {
    stravaRouteList.innerHTML = '<p class="strava-no-routes">No saved routes found on your Strava account.</p>';
    return;
  }
  stravaRouteList.innerHTML = routes.map(r => {
    const miles = (r.distance * 0.000621371).toFixed(1);
    const date  = new Date(r.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    return `
      <button class="strava-route-item" data-route-id="${r.id}">
        <span class="strava-route-name">${escapeHtml(r.name)}</span>
        <div class="strava-route-chips">
          <span class="strava-chip">${miles} mi</span>
          <span class="strava-chip">${date}</span>
        </div>
      </button>`;
  }).join('');
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Handle file ────────────────────────────────────────────────────────────────
async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (!['gpx', 'tcx', 'fit'].includes(ext)) {
    showError(`Unsupported file type: .${ext}. Please use .gpx, .tcx, or .fit`);
    return;
  }

  setState('loading');
  setLoadingLabel('Parsing route…');

  try {
    const { parseFile } = await import('./parser/index.js');
    const route = await parseFile(file, ext);
    await processRoute(route);
  } catch (err) {
    console.error('[SafeRoute]', err);
    showError(err.message ?? 'Something went wrong — check the console.');
  }
}

// ── Retry support ──────────────────────────────────────────────────────────────
let _lastRoute = null;

export async function retryRoute() {
  if (!_lastRoute) return;
  setState('loading');
  setLoadingLabel('Querying road data…');
  try {
    await processRoute(_lastRoute);
  } catch (err) {
    showError(err.message ?? 'Something went wrong.');
  }
}

// ── Process parsed route ───────────────────────────────────────────────────────
async function processRoute(route) {
  _lastRoute = route;
  console.log(`[SafeRoute] Parsed "${route.name}" — ${route.points.length} points (${route.fileType})`);

  setLoadingLabel('Querying road data…');

  const { scoreRoute } = await import('./scoring/engine.js');
  const { RIDE_PROFILES } = await import('./scoring/profiles.js');
  const rideProfile = RIDE_PROFILES[resolveProfileKey()];

  const result = await scoreRoute(route, (done, total) => {
    if (total === 0) return;
    setLoadingLabel(done === total ? 'Scoring segments…' : 'Querying road data…');
  }, riderProfile);

  const { initMap }       = await import('./ui/map.js');
  const { renderResults } = await import('./ui/results.js');
  const { setShareHash }  = await import('./ui/share.js');

  setShareHash(route.points, route.name);
  setState('results');
  initMap(result.segments);
  renderResults(result);
}

// ── Error helper ───────────────────────────────────────────────────────────────
function showError(msg) {
  setState('idle');
  alert(msg);
}

// ── Theme toggle ──────────────────────────────────────────────────────────────
const themeBtn = document.getElementById('themeBtn');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';
  import('./ui/map.js').then(({ setTileTheme }) => setTileTheme(theme));
}

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('sr-theme', next);
  applyTheme(next);
});

// Restore saved preference, default to dark
applyTheme(localStorage.getItem('sr-theme') ?? 'dark');

// ── Startup ────────────────────────────────────────────────────────────────────
// Priority: (1) Strava OAuth callback, (2) shared hash, (3) existing Strava session
(async () => {
  const search = new URLSearchParams(window.location.search);

  if (search.has('code') || search.has('error')) {
    try {
      const { handleStravaCallback } = await import('./js/strava.js');
      const token = await handleStravaCallback();
      if (token) { await loadStravaRoutes(token); return; }
    } catch (err) {
      console.error('[SafeRoute]', err);
      showError(err.message ?? 'Strava connection failed.');
      return;
    }
  }

  if (window.location.hash.startsWith('#r=')) {
    const { decodeRoute } = await import('./ui/share.js');
    const decoded = decodeRoute(window.location.hash.slice(3));
    if (decoded) { processRoute({ ...decoded, fileType: 'shared' }); return; }
  }

  const { isStravaConnected, getStravaToken } = await import('./js/strava.js');
  if (isStravaConnected()) {
    const token = getStravaToken();
    if (token) { await loadStravaRoutes(token); return; }
  }
})();
