// ui/results.js — score ring, factor bars, segment table, hazard list

const RING_R = 54;
const RING_CIRC = 2 * Math.PI * RING_R; // ≈ 339.3

const TIER_CSS_COLOR = {
  safe:   'var(--safe)',
  warn:   'var(--caution-fixed)',
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
  if (score >= 50) return 'var(--caution-fixed)';
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

  const items = hazards.map(s => {
    const osmBadge   = s.source === 'osm'      ? `<span class="source-badge source-osm">OSM</span>`
                     : s.source === 'inferred' ? `<span class="source-badge source-inferred">Inferred</span>`
                     :                           `<span class="source-badge source-sim">Simulated</span>`;
    const nameStr    = s.streetName ? `<span class="detail-street">${s.streetName}</span>` : `<span class="detail-street detail-unnamed">—</span>`;
    const surfaceStr = s.surface    ? `<span class="detail-surface">${s.surface}</span>` : '';

    return `
    <div class="hazard-item" data-seg-idx="${s.index}">
      <div class="hazard-score" style="color:${scoreColor(s.score)}">${s.score}</div>
      <div class="hazard-detail">
        <span class="hazard-road">${s.roadType}</span>
        <span class="hazard-meta">${s.speedLimit} mph · ${s.width}m wide · ${fmtDist(s.dist)}</span>
      </div>
      <div class="hazard-tier" style="color:${scoreColor(s.score)}">${s.tier}</div>
      <span class="seg-chevron">›</span>
      <div class="hazard-expand">
        <div class="seg-detail-inner">
          ${osmBadge}${nameStr}${surfaceStr}
        </div>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="card hazards-card">
      <h3 class="card-title">Hazards <span class="hazard-count">${hazards.length}</span></h3>
      <div class="hazard-list">${items}</div>
    </div>`;
}

// ── Route summary card (replaces full segment table) ──────────────────────────
function buildSegmentSummary(segments) {
  const total     = segments.length;
  const safeCnt   = segments.filter(s => s.tierColor === 'safe').length;
  const warnCnt   = segments.filter(s => s.tierColor === 'warn').length;
  const dangerCnt = segments.filter(s => s.tierColor === 'danger').length;

  // Proportional color strip — ordered by route tier distribution
  const safeW   = (safeCnt   / total * 100).toFixed(1);
  const warnW   = (warnCnt   / total * 100).toFixed(1);
  const dangerW = (dangerCnt / total * 100).toFixed(1);
  const strip = `
    <div class="seg-strip">
      ${safeCnt   ? `<div class="seg-strip-block seg-strip-safe"   style="width:${safeW}%"></div>`   : ''}
      ${warnCnt   ? `<div class="seg-strip-block seg-strip-warn"   style="width:${warnW}%"></div>`   : ''}
      ${dangerCnt ? `<div class="seg-strip-block seg-strip-danger" style="width:${dangerW}%"></div>` : ''}
    </div>`;

  // Summary line vs tier pills
  const allSame = safeCnt === total || warnCnt === total || dangerCnt === total;
  let summaryHTML;

  if (allSame) {
    // Most common road type
    const freq = {};
    segments.forEach(s => { freq[s.roadType] = (freq[s.roadType] ?? 0) + 1; });
    const topRoad = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'road';
    const avgSpeed = Math.round(segments.reduce((n, s) => n + s.speedLimit, 0) / total);
    const tierLabel = safeCnt === total ? 'Safe' : warnCnt === total ? 'Caution' : 'Avoid';
    const tierColor = safeCnt === total ? 'var(--safe)' : warnCnt === total ? 'var(--caution-fixed)' : 'var(--danger)';
    summaryHTML = `
      <p class="seg-summary-line">
        <strong>${total}</strong> segments analyzed — all ${topRoad},
        ${avgSpeed}&thinsp;mph avg, consistently
        <span style="color:${tierColor};font-weight:500">${tierLabel}</span> throughout
      </p>`;
  } else {
    const safePct   = Math.round(safeCnt   / total * 100);
    const warnPct   = Math.round(warnCnt   / total * 100);
    const dangerPct = Math.round(dangerCnt / total * 100);
    summaryHTML = `
      <div class="seg-pills">
        ${safeCnt   ? `<span class="seg-pill seg-pill-safe">Safe ${safePct}%</span>`       : ''}
        ${warnCnt   ? `<span class="seg-pill seg-pill-warn">Caution ${warnPct}%</span>`   : ''}
        ${dangerCnt ? `<span class="seg-pill seg-pill-danger">Avoid ${dangerPct}%</span>` : ''}
      </div>`;
  }

  // Build a row for every segment — flagged ones visible, others hidden
  // Hidden rows surface when the map focuses them (seg-active class)
  function segRow(s, hidden = false) {
    const color      = scoreColor(s.score);
    const nameStr    = s.streetName ?? s.roadType;
    const osmBadge   = s.source === 'osm'      ? `<span class="source-badge source-osm">OSM</span>`
                     : s.source === 'inferred' ? `<span class="source-badge source-inferred">Inferred</span>`
                     :                           `<span class="source-badge source-sim">Simulated</span>`;
    const streetSpan = s.streetName
      ? `<span class="detail-street">${s.streetName}</span>`
      : `<span class="detail-street detail-unnamed">${s.roadType}</span>`;
    const surfaceStr = s.surface ? `<span class="detail-surface">${s.surface}</span>` : '';
    // Speed · width · distance shown only in the expand, not the compact row
    const detailMeta = `<span class="detail-surface">${s.speedLimit}&thinsp;mph · ${s.width}m · ${fmtDist(s.dist)}</span>`;
    return `
      <div class="flagged-row${hidden ? ' flagged-row--hidden' : ''}" data-seg-idx="${s.index}">
        <span class="seg-score" style="color:${color}">${s.score}</span>
        <span class="seg-flag-name">${nameStr}</span>
        <span class="seg-flag-tier" style="color:${color}">${s.tier}</span>
        <span class="seg-chevron">›</span>
        <div class="flagged-expand">
          <div class="seg-detail-inner">${osmBadge}${streetSpan}${detailMeta}${surfaceStr}</div>
        </div>
      </div>`;
  }

  const flagged  = segments.filter(s => s.score < 70).sort((a, b) => a.score - b.score);
  const unflagged = segments.filter(s => s.score >= 70);

  let flaggedHTML;
  if (flagged.length === 0) {
    flaggedHTML = `<p class="seg-clean">No flagged segments — this route is clean</p>`;
  } else {
    flaggedHTML = `
      <div class="seg-flag-list">
        <p class="seg-flag-header">Flagged segments <span class="seg-count">${flagged.length}</span></p>
        ${flagged.map(s => segRow(s, false)).join('')}
      </div>`;
  }

  // Hidden rows for all non-flagged segments — invisible until map activates them
  const hiddenRows = unflagged.map(s => segRow(s, true)).join('');

  return `
    <div class="card segments-card">
      <h3 class="card-title">Route Summary <span class="seg-count">${total}</span></h3>
      ${strip}
      ${summaryHTML}
      ${flaggedHTML}
      <div class="seg-hidden-pool">${hiddenRows}</div>
    </div>`;
}

// ── Data quality banner ───────────────────────────────────────────────────────
function buildDataQualityBanner(segments) {
  const total    = segments.length;
  const simCount = segments.filter(s => s.source === 'simulated').length;
  const simPct   = simCount / total;

  if (simPct < 0.5) return ''; // majority has real OSM data — no banner needed

  const allSim = simPct === 1;
  const msg    = allSim
    ? 'Road data unavailable — all scores are estimated defaults, not real road data.'
    : `Road data was limited — ${Math.round(simPct * 100)}% of segments used estimated defaults.`;

  return `
    <div class="data-quality-banner" id="dataQualityBanner">
      <span class="dq-icon">⚠</span>
      <div class="dq-body">
        <span class="dq-msg">${msg}</span>
        <span class="dq-hint">The Overpass API may be overloaded or rate-limited. Scores may not reflect real road conditions.</span>
      </div>
      <button class="dq-retry" id="retryBtn">Try again</button>
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
export async function renderResults(result) {
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
      <button class="btn-share" id="shareBtn">Share</button>
    </div>

    ${buildDataQualityBanner(segments)}

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
    ${buildSegmentSummary(segments)}
  `;

  // Resolve map functions once — avoids async yield inside the click handler
  // which caused a race: a second invocation could see seg-active mid-toggle
  const { focusSegment, clearFocus } = await import('./map.js');

  animateResults();

  document.getElementById('backBtn').addEventListener('click', () => {
    import('../app.js').then(({ setState }) => setState('idle'));
  });

  document.getElementById('retryBtn')?.addEventListener('click', () => {
    import('../app.js').then(({ retryRoute }) => retryRoute());
  });

  document.getElementById('shareBtn').addEventListener('click', async () => {
    const btn = document.getElementById('shareBtn');
    try {
      const { copyResultsText } = await import('./share.js');
      await copyResultsText(result);
      btn.textContent = 'Copied!';
      btn.classList.add('btn-share--copied');
    } catch {
      btn.textContent = 'Failed';
    }
    setTimeout(() => {
      btn.textContent = 'Share';
      btn.classList.remove('btn-share--copied');
    }, 2000);
  });

  // ── Segment / hazard → map focus (synchronous — no async yield) ───────────
  panel.addEventListener('click', e => {
    const target = e.target.closest('[data-seg-idx]');
    if (!target) return;

    const idx = parseInt(target.dataset.segIdx, 10);

    if (target.classList.contains('seg-active')) {
      clearFocus();
    } else {
      focusSegment(idx);
      panel.querySelectorAll('[data-seg-idx]').forEach(el => el.classList.remove('seg-active'));
      target.classList.add('seg-active');
    }
  });
}
