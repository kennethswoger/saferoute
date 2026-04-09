// ui/results.js — score ring, factor bars, segment table, hazard list

const RING_R = 54;
const RING_CIRC = 2 * Math.PI * RING_R; // ≈ 339.3

const TIER_CSS_COLOR = {
  safe:   'var(--safe)',
  warn:   'var(--warn-mid)',
  danger: 'var(--danger)',
};

const FACTORS = [
  { key: 'traffic', label: 'Traffic Exposure', weight: '28%' },
  { key: 'width',   label: 'Road Width',        weight: '25%' },
  { key: 'speed',   label: 'Speed Limit',        weight: '25%' },
  { key: 'infra',   label: 'Infrastructure',     weight: '12%' },
  { key: 'surface', label: 'Surface Quality',    weight: '10%' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 75) return 'var(--safe)';
  if (score >= 50) return 'var(--warn-mid)';
  return 'var(--danger)';
}

function tierDot(tierColor) {
  return `<span class="tier-dot" style="background:${TIER_CSS_COLOR[tierColor] ?? 'var(--muted)'}"></span>`;
}

function fmtDist(miles) {
  return miles >= 0.1 ? `${miles.toFixed(1)} mi` : `${(miles * 5280).toFixed(0)} ft`;
}

// ── Score ring SVG ─────────────────────────────────────────────────────────────
function buildRing(score, tierColor) {
  const color  = TIER_CSS_COLOR[tierColor] ?? 'var(--muted)';
  const offset = RING_CIRC * (1 - score / 100);
  return `
    <div class="score-ring-wrap">
      <svg class="score-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-track" cx="60" cy="60" r="${RING_R}"/>
        <circle class="ring-fill" cx="60" cy="60" r="${RING_R}"
          stroke="${color}"
          stroke-dasharray="${RING_CIRC.toFixed(2)}"
          stroke-dashoffset="${RING_CIRC.toFixed(2)}"
          data-offset="${offset.toFixed(2)}"/>
      </svg>
      <div class="ring-inner">
        <span class="ring-score">${score}</span>
        <span class="ring-denom">/100</span>
      </div>
    </div>`;
}

// ── Factor bars ────────────────────────────────────────────────────────────────
function buildFactors(factors) {
  const rows = FACTORS.map(f => {
    const val   = factors[f.key] ?? 0;
    const color = scoreColor(val);
    return `
      <div class="factor-row">
        <div class="factor-meta">
          <span class="factor-label">${f.label}</span>
          <span class="factor-weight">${f.weight}</span>
        </div>
        <div class="factor-track">
          <div class="factor-fill" style="--fill-color:${color}" data-width="${val}"></div>
        </div>
        <span class="factor-val" style="color:${color}">${val}</span>
      </div>`;
  }).join('');

  return `
    <div class="card factors-card">
      <h3 class="card-title">Score Breakdown</h3>
      ${rows}
    </div>`;
}

// ── Hazard list ────────────────────────────────────────────────────────────────
function buildHazards(segments) {
  const hazards = segments.filter(s => s.score < 50);

  if (hazards.length === 0) {
    return `
      <div class="card hazards-card">
        <h3 class="card-title">Hazards</h3>
        <p class="no-hazards">No high-risk segments on this route.</p>
      </div>`;
  }

  const items = hazards.map(s => `
    <div class="hazard-item" data-seg-idx="${s.index}">
      <div class="hazard-score" style="color:${scoreColor(s.score)}">${s.score}</div>
      <div class="hazard-detail">
        <span class="hazard-road">${s.roadType}</span>
        <span class="hazard-meta">${s.speedLimit} mph · ${s.width}m wide · ${fmtDist(s.dist)}</span>
      </div>
      <div class="hazard-tier" style="color:${scoreColor(s.score)}">${s.tier}</div>
    </div>`).join('');

  return `
    <div class="card hazards-card">
      <h3 class="card-title">Hazards <span class="hazard-count">${hazards.length}</span></h3>
      <div class="hazard-list">${items}</div>
    </div>`;
}

// ── Segment table ──────────────────────────────────────────────────────────────
function buildSegmentTable(segments) {
  const rows = segments.map(s => {
    const color = scoreColor(s.score);
    return `
      <tr class="seg-row" data-seg-idx="${s.index}">
        <td><span class="seg-score" style="color:${color}">${s.score}</span></td>
        <td>${tierDot(s.tierColor)} ${s.tier}</td>
        <td class="mono">${s.roadType}</td>
        <td class="mono">${s.speedLimit} mph</td>
        <td class="mono">${fmtDist(s.dist)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="card segments-card">
      <h3 class="card-title">All Segments <span class="seg-count">${segments.length}</span></h3>
      <div class="table-scroll">
        <table class="seg-table">
          <thead>
            <tr>
              <th>Score</th><th>Tier</th><th>Road</th><th>Speed</th><th>Dist</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Animate in ────────────────────────────────────────────────────────────────
function animateResults() {
  // Score ring — animate dashoffset after paint
  requestAnimationFrame(() => {
    document.querySelectorAll('.ring-fill').forEach(el => {
      el.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.4, 0, 0.2, 1)';
      el.style.strokeDashoffset = el.dataset.offset;
    });

    // Factor bars — stagger each bar
    document.querySelectorAll('.factor-fill').forEach((el, i) => {
      setTimeout(() => {
        el.style.width = `${el.dataset.width}%`;
      }, i * 80);
    });
  });
}

// ── Main export ────────────────────────────────────────────────────────────────
export function renderResults(result) {
  const panel = document.getElementById('resultsPanel');
  const { name, fileType, overall, tier, totalDist, segments } = result;

  // Pick representative factors from the median segment for the breakdown card
  const sorted  = [...segments].sort((a, b) => a.score - b.score);
  const median  = sorted[Math.floor(sorted.length / 2)];
  const factors = median?.factors ?? { width: 0, speed: 0, traffic: 0, infra: 0, surface: 0 };

  const tierColor = tier?.color ?? 'safe';
  const tierLabel = tier?.label ?? '';

  panel.innerHTML = `
    <div class="results-header">
      <button class="btn-back" id="backBtn">← New route</button>
    </div>

    <div class="card score-card">
      ${buildRing(overall, tierColor)}
      <div class="score-meta">
        <div class="score-tier" style="color:${TIER_CSS_COLOR[tierColor]}">${tierLabel}</div>
        <div class="score-name">${name}</div>
        <div class="score-dist">${fmtDist(totalDist)} &middot; <span class="mono">${fileType}</span></div>
      </div>
    </div>

    ${buildFactors(factors)}
    ${buildHazards(segments)}
    ${buildSegmentTable(segments)}
  `;

  animateResults();

  document.getElementById('backBtn').addEventListener('click', () => {
    import('../app.js').then(({ setState }) => setState('idle'));
  });

  // ── Segment / hazard → map focus ───────────────────────────────────────────
  panel.addEventListener('click', async e => {
    const target = e.target.closest('[data-seg-idx]');
    if (!target) return;

    const idx = parseInt(target.dataset.segIdx, 10);
    const { focusSegment, clearFocus } = await import('./map.js');

    if (target.classList.contains('seg-active')) {
      clearFocus();
    } else {
      focusSegment(idx);
      panel.querySelectorAll('[data-seg-idx]').forEach(el => el.classList.remove('seg-active'));
      target.classList.add('seg-active');
    }
  });
}
