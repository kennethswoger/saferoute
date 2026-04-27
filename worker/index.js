// SafeRoute — Strava token exchange proxy
// Deployed as a Cloudflare Worker. Holds CLIENT_SECRET in env vars so it
// never touches the browser. Only forwards the authorization_code grant.
//
// Required env vars (set via `wrangler secret put` or the dashboard):
//   STRAVA_CLIENT_ID     — from https://www.strava.com/settings/api
//   STRAVA_CLIENT_SECRET — from https://www.strava.com/settings/api
//
// Required env vars (set in wrangler.toml [vars]):
//   ALLOWED_ORIGINS      — comma-separated list, e.g. "https://you.github.io,http://localhost:8080"

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(req, env) {
    const origin  = req.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim());

    if (!allowed.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });
    }

    let code, code_verifier;
    try {
      ({ code, code_verifier } = await req.json());
    } catch {
      return json({ message: 'Invalid JSON body.' }, 400, origin);
    }

    if (!code || !code_verifier) {
      return json({ message: 'Missing code or code_verifier.' }, 400, origin);
    }

    const stravaRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        code_verifier,
      }),
    });

    const data = await stravaRes.json();
    return json(data, stravaRes.status, origin);
  },
};
