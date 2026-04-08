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
export function setState(state) {
  appEl.dataset.state = state;
  uploadZone.hidden  = state !== 'idle';
  loadingZone.hidden = state !== 'loading';
  resultsZone.hidden = state !== 'results';
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
  // Step 2 will fetch and parse assets/demo-kc.gpx
  // Placeholder for now:
  setTimeout(() => {
    console.log('[SafeRoute] Demo route clicked — parser not yet wired (step 2)');
    setState('idle');
  }, 800);
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
    // Parsers wired in step 2 — import dynamically so this scaffolds cleanly
    const { parseFile } = await import('./parser/index.js');
    const route = await parseFile(file, ext);

    setLoadingLabel('Scoring segments…');

    // Scoring engine wired in step 3
    const { scoreRoute } = await import('./scoring/engine.js');
    const result = await scoreRoute(route);

    // Map + results UI wired in steps 4 & 5
    const { renderResults } = await import('./ui/results.js');
    const { initMap } = await import('./ui/map.js');

    setState('results');
    initMap(result.segments);
    renderResults(result);

  } catch (err) {
    console.error('[SafeRoute]', err);
    showError(err.message ?? 'Something went wrong — check the console.');
  }
}

// ── Error helper ───────────────────────────────────────────────────────────────
function showError(msg) {
  setState('idle');
  // Simple inline error for now — can be upgraded to a toast in later steps
  alert(msg);
}
