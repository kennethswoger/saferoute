// ui/share.js — URL hash route encoding/decoding + clipboard copy
//
// URL format: #r=<base64url>
// Binary layout:
//   [version: u8][nameLen: u16 LE][name: utf8][nPts: u32 LE]
//   [lat0: i32 LE][lon0: i32 LE][(dlat: i16 LE, dlon: i16 LE) × (n-1)]
//
// Lat/lon quantised to 1e-5 degrees (~1.1m precision).
// Delta encoding keeps each pair in 4 bytes; cycling routes won't exceed ±0.32°
// between consecutive GPS points so int16 is safe.

const VERSION = 1;
const SCALE   = 1e5;

// ── Encode route → base64url ───────────────────────────────────────────────────
export function encodeRoute(points, name) {
  if (!points?.length) return null;
  const nameBytes = new TextEncoder().encode(name ?? '');
  const n = points.length;

  const byteLen = 1 + 2 + nameBytes.length + 4 + 4 + 4 + (n - 1) * 4;
  const buf  = new ArrayBuffer(byteLen);
  const view = new DataView(buf);
  let off = 0;

  view.setUint8(off++, VERSION);
  view.setUint16(off, nameBytes.length, true); off += 2;
  nameBytes.forEach(b => view.setUint8(off++, b));
  view.setUint32(off, n, true); off += 4;

  let prevLat = Math.round(points[0][0] * SCALE);
  let prevLon = Math.round(points[0][1] * SCALE);
  view.setInt32(off, prevLat, true); off += 4;
  view.setInt32(off, prevLon, true); off += 4;

  for (let i = 1; i < n; i++) {
    const lat  = Math.round(points[i][0] * SCALE);
    const lon  = Math.round(points[i][1] * SCALE);
    view.setInt16(off, Math.max(-32768, Math.min(32767, lat - prevLat)), true); off += 2;
    view.setInt16(off, Math.max(-32768, Math.min(32767, lon - prevLon)), true); off += 2;
    prevLat = lat;
    prevLon = lon;
  }

  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Decode base64url → { name, points } ───────────────────────────────────────
export function decodeRoute(encoded) {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bin  = atob(b64);
    const buf  = new ArrayBuffer(bin.length);
    const u8   = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

    const view = new DataView(buf);
    let off = 0;

    if (view.getUint8(off++) !== VERSION) return null;

    const nameLen = view.getUint16(off, true); off += 2;
    const name    = new TextDecoder().decode(new Uint8Array(buf, off, nameLen)); off += nameLen;
    const n       = view.getUint32(off, true); off += 4;

    let prevLat = view.getInt32(off, true); off += 4;
    let prevLon = view.getInt32(off, true); off += 4;
    const points = [[prevLat / SCALE, prevLon / SCALE]];

    for (let i = 1; i < n; i++) {
      prevLat += view.getInt16(off, true); off += 2;
      prevLon += view.getInt16(off, true); off += 2;
      points.push([prevLat / SCALE, prevLon / SCALE]);
    }

    return { name, points };
  } catch {
    return null;
  }
}

// ── URL hash helpers ───────────────────────────────────────────────────────────
export function setShareHash(points, name) {
  const encoded = encodeRoute(points, name);
  if (encoded) history.replaceState(null, '', `#r=${encoded}`);
}

export function clearShareHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

// ── Copy text summary + URL to clipboard ──────────────────────────────────────
export async function copyResultsText(result) {
  const { name, overall, tier, totalDist, segments } = result;

  const ORDER  = ['Safe', 'Mostly Safe', 'Use Caution', 'Risky', 'Avoid'];
  const counts = {};
  const dists  = {};
  for (const s of segments) {
    counts[s.tier] = (counts[s.tier] ?? 0) + 1;
    dists[s.tier]  = (dists[s.tier]  ?? 0) + s.dist;
  }

  const tierLabel = tier?.label ?? tier ?? '';
  const lines = ORDER
    .filter(t => counts[t])
    .map(t => `  ${t.padEnd(13)}  ${counts[t]} seg${counts[t] !== 1 ? 's' : ''} · ${dists[t].toFixed(1)} mi`);

  const text = [
    `SafeRoute — ${name}`,
    `Score: ${overall}/100 (${tierLabel})`,
    `Distance: ${totalDist.toFixed(1)} mi`,
    '',
    ...lines,
    '',
    `View route: ${window.location.href}`,
  ].join('\n');

  await navigator.clipboard.writeText(text);
}
