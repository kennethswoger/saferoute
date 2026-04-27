// js/strava.js — Strava OAuth PKCE flow for static GitHub Pages
//
// CLIENT_ID:     your Strava app's client ID (public — safe in frontend)
//                https://www.strava.com/settings/api
//
// PROXY_URL:     your deployed Cloudflare Worker URL
//                Run `wrangler deploy` inside worker/ to get this.
//                CLIENT_SECRET lives only in the worker's env vars — never here.
const CLIENT_ID = '231694';
const PROXY_URL = 'https://saferoute-strava-proxy.kswoger.workers.dev';

const SCOPES       = 'read,activity:read_all,profile:read_all';
const TOKEN_KEY    = 'sr-strava-token';
const VERIFIER_KEY = 'sr-strava-pkce-verifier';

function redirectUri() {
  return window.location.origin + window.location.pathname;
}

// ── PKCE helpers ───────────────────────────────────────────────────────────────

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeVerifier() {
  const buf = new Uint8Array(32); // 32 bytes → 43 base64url chars (RFC 7636 minimum)
  crypto.getRandomValues(buf);
  return base64url(buf);
}

async function makeChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(hash);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function initiateStravaAuth() {
  const verifier  = await makeVerifier();
  const challenge = await makeChallenge(verifier);
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          redirectUri(),
    response_type:         'code',
    approval_prompt:       'auto',
    scope:                 SCOPES,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `https://www.strava.com/oauth/authorize?${params}`;
}

export async function handleStravaCallback() {
  const search = new URLSearchParams(window.location.search);

  if (search.get('error')) {
    history.replaceState(null, '', redirectUri());
    return null;
  }

  const code = search.get('code');
  if (!code) return null;

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('PKCE verifier missing — please try connecting again.');

  sessionStorage.removeItem(VERIFIER_KEY);
  history.replaceState(null, '', redirectUri());

  // Token exchange goes through the Cloudflare Worker proxy — CLIENT_SECRET
  // never leaves the worker's environment and is never sent to the browser.
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Strava token exchange failed (${res.status}).`);
  }

  const { access_token, expires_at } = await res.json();
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token, expires_at }));
  return access_token;
}

export function isStravaConnected() {
  try {
    const { expires_at } = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return Math.floor(Date.now() / 1000) < expires_at;
  } catch {
    return false;
  }
}

export function getStravaToken() {
  try {
    const { access_token, expires_at } = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return Math.floor(Date.now() / 1000) < expires_at ? access_token : null;
  } catch {
    return null;
  }
}

export function disconnectStrava() {
  const token = getStravaToken();
  localStorage.removeItem(TOKEN_KEY);
  if (token) {
    fetch('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {}); // fire-and-forget, local clear already happened
  }
}

export async function fetchStravaRoutes(token) {
  const res = await fetch('https://www.strava.com/api/v3/athlete/routes?per_page=50', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load Strava routes (${res.status}).`);
  // Strava route IDs exceed Number.MAX_SAFE_INTEGER — read as text and stringify
  // any bare integer >= 16 digits before JSON.parse to avoid precision loss.
  const text = await res.text();
  return JSON.parse(text.replace(/:(\s*)(\d{16,})/g, ':$1"$2"'));
}

export async function fetchStravaRouteGPX(token, routeId) {
  const res = await fetch(`https://www.strava.com/api/v3/routes/${routeId}/export_gpx`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch GPX for route ${routeId} (${res.status}).`);
  return res.text();
}
