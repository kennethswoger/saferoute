// SafeRoute — app.js
// Entry point: file handling + UI state machine
// State: 'idle' | 'loading' | 'results'

const appEl      = document.getElementById('app');
const uploadZone = document.getElementById('uploadZone');
const dropTarget = document.getElementById('dropTarget');
const loadingZone = document.getElementById('loadingZone');
const loadingLabel = document.getElementById('loadingLabel');
const resultsZone  = document.getElementById('resultsZone');
const fileInput    = document.getElementById('fileInput');
const demoBtn      = document.getElementById('demoBtn');

// ── State machine ──────────────────────────────────────────────────────────────
export async function setState(state) {
  appEl.dataset.state = state;
  uploadZone.hidden  = state !== 'idle';
  loadingZone.hidden = state !== 'loading';
  resultsZone.hidden = state !== 'results';
  if (state === 'idle') {
    const { clearShareHash } = await import('./ui/share.js');
    clearShareHash();
  }
}

export function setLoadingLabel(text) {
  loadingLabel.textContent = text;
}

// ── File input ─────────────────────────────────────────────────────────────────
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  fileInput.value = ''; // reset so same file can be re-dropped
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

// ── Retry support ─────────────────────────────────────────────────────────────
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

  const result = await scoreRoute(route, (done, total) => {
    if (total === 0) return;
    setLoadingLabel(done === total ? 'Scoring segments…' : 'Querying road data…');
  });

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

// ── Auto-load from shared URL hash ────────────────────────────────────────────
// If the page was opened with #r=<encoded>, decode and score immediately.
const initialHash = window.location.hash;
if (initialHash.startsWith('#r=')) {
  import('./ui/share.js').then(({ decodeRoute }) => {
    const decoded = decodeRoute(initialHash.slice(3));
    if (decoded) {
      processRoute({ ...decoded, fileType: 'shared' });
    }
  });
}
