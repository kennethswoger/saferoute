/**
 * SafeRoute score gauge component.
 * Returns an SVG element + a label container — no DOM side effects.
 * Matches Sentinel Ethos design tokens from style.css.
 */

const TIERS = [
  { min: 80, label: 'Safe',        color: '#1D9E75', track: '#d1ffe8' },
  { min: 65, label: 'Mostly Safe', color: '#3a7d44', track: '#c8e6c9' },
  { min: 50, label: 'Use Caution', color: '#92570a', track: '#ffe0b8' },
  { min: 35, label: 'Risky',       color: '#c05a00', track: '#ffe0b8' },
  { min: 0,  label: 'Avoid',       color: '#ba1a1a', track: '#ffdad6' },
];

export function getTierForScore(score) {
  return TIERS.find(t => score >= t.min) || TIERS[TIERS.length - 1];
}

/**
 * Build a gauge SVG element.
 * @param {number} score  0–100
 * @param {number} width  SVG width in px (default 96)
 * @param {number} height SVG height in px (default 64)
 * @returns {SVGElement}
 */
export function buildGaugeSVG(score, width = 96, height = 64) {
  const tier = getTierForScore(score);
  const cx = width / 2;
  const cy = height * 0.78;
  const r  = width * 0.38;

  // Gauge arc spans 240° — from bottom-left (7 o'clock) over the top to bottom-right (5 o'clock)
  const startAngle = -210;
  const endAngle   = 30;
  const totalArc   = endAngle - startAngle; // 240
  const filledAngle = startAngle + totalArc * Math.min(score / 100, 1);

  const trackW = r * 0.22;

  function polar(deg, scale = 1) {
    const rad = deg * Math.PI / 180;
    return [cx + r * scale * Math.cos(rad), cy + r * scale * Math.sin(rad)];
  }

  function arcD(a1, a2) {
    const [x1, y1] = polar(a1);
    const [x2, y2] = polar(a2);
    const lg = Math.abs(a2 - a1) > 180 ? 1 : 0;
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${lg} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  }

  const ns  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width',  width);
  svg.setAttribute('height', height);
  svg.setAttribute('aria-hidden', 'true');

  // Background track
  const bgArc = document.createElementNS(ns, 'path');
  bgArc.setAttribute('d',               arcD(startAngle, endAngle));
  bgArc.setAttribute('fill',            'none');
  bgArc.setAttribute('stroke',          'var(--s3)');
  bgArc.setAttribute('stroke-width',    trackW);
  bgArc.setAttribute('stroke-linecap',  'round');
  svg.appendChild(bgArc);

  // Filled (scored) arc
  if (score > 0) {
    const fillArc = document.createElementNS(ns, 'path');
    fillArc.setAttribute('d',              arcD(startAngle, filledAngle));
    fillArc.setAttribute('fill',           'none');
    fillArc.setAttribute('stroke',         tier.color);
    fillArc.setAttribute('stroke-width',   trackW);
    fillArc.setAttribute('stroke-linecap', 'round');
    svg.appendChild(fillArc);
  }

  // Needle: thin line from center to just inside the track
  const needleScale = (r - trackW * 0.5 - r * 0.06) / r;
  const [nx, ny] = polar(filledAngle, needleScale);

  const needle = document.createElementNS(ns, 'line');
  needle.setAttribute('x1',             cx.toFixed(2));
  needle.setAttribute('y1',             cy.toFixed(2));
  needle.setAttribute('x2',             nx.toFixed(2));
  needle.setAttribute('y2',             ny.toFixed(2));
  needle.setAttribute('stroke',         tier.color);
  needle.setAttribute('stroke-width',   (r * 0.07).toFixed(2));
  needle.setAttribute('stroke-linecap', 'round');
  svg.appendChild(needle);

  // Tip dot at needle end
  const tip = document.createElementNS(ns, 'circle');
  tip.setAttribute('cx',   nx.toFixed(2));
  tip.setAttribute('cy',   ny.toFixed(2));
  tip.setAttribute('r',    (r * 0.09).toFixed(2));
  tip.setAttribute('fill', tier.color);
  svg.appendChild(tip);

  // Hub dot at pivot
  const hub = document.createElementNS(ns, 'circle');
  hub.setAttribute('cx',   cx.toFixed(2));
  hub.setAttribute('cy',   cy.toFixed(2));
  hub.setAttribute('r',    (r * 0.07).toFixed(2));
  hub.setAttribute('fill', tier.color);
  svg.appendChild(hub);

  return svg;
}

/**
 * Build a complete gauge widget: SVG + tier label + score number.
 * Returns a <div> ready to append to the DOM.
 * @param {number} score  0–100
 * @param {number} width  gauge width (default 96)
 * @param {number} height gauge height (default 64)
 * @returns {HTMLDivElement}
 */
export function buildGaugeWidget(score, width = 96, height = 64) {
  const tier = getTierForScore(score);

  const wrap = document.createElement('div');
  wrap.className = 'seg-gauge-wrap';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;flex-shrink:0;';

  wrap.appendChild(buildGaugeSVG(score, width, height));

  const tierLabel = document.createElement('div');
  tierLabel.style.cssText =
    `font-family:var(--font-label);font-size:0.72rem;font-weight:500;color:${tier.color};line-height:1.2;`;
  tierLabel.textContent = tier.label;
  wrap.appendChild(tierLabel);

  const scoreLabel = document.createElement('div');
  scoreLabel.style.cssText =
    'font-family:var(--font-mono);font-size:0.68rem;color:var(--muted);line-height:1.2;';
  scoreLabel.textContent = `score - ${score}`;
  wrap.appendChild(scoreLabel);

  return wrap;
}
