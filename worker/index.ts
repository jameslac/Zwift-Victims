export interface Env {
  ASSETS: Fetcher;
}

const ZWIFT_AUTH_URL =
  'https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token';
const ZWIFT_API_BASE = 'https://us-or-rly101.zwift.com';
const ZWIFT_CLIENT_ID = 'Zwift_Mobile_Link';

// Only these Zwift Core API paths may be relayed (keeps the proxy from being an open relay).
const ZWIFT_API_ALLOWLIST = [/^\/api\/profiles\/me$/, /^\/api\/profiles\/\d+(\/followees)?$/];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Stateless relay for the Zwift token endpoint. Credentials are forwarded
 * upstream and never logged or stored. Only password/refresh_token grants allowed.
 */
async function handleToken(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const incoming = await request.formData().catch(() => null);
  if (!incoming) return json({ error: 'invalid_request' }, 400);

  const grantType = incoming.get('grant_type');
  const body = new URLSearchParams({ client_id: ZWIFT_CLIENT_ID });

  if (grantType === 'password') {
    body.set('grant_type', 'password');
    body.set('username', String(incoming.get('username') ?? ''));
    body.set('password', String(incoming.get('password') ?? ''));
  } else if (grantType === 'refresh_token') {
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', String(incoming.get('refresh_token') ?? ''));
  } else {
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  const upstream = await fetch(ZWIFT_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function handleCoreApi(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  if (!ZWIFT_API_ALLOWLIST.some((re) => re.test(path))) return json({ error: 'not_allowed' }, 403);

  const auth = request.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const upstream = await fetch(`${ZWIFT_API_BASE}${path}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        status: 'Online',
        service: 'zwift-victims-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/zwift/auth/token') return handleToken(request);

    if (url.pathname.startsWith('/api/zwift/')) {
      return handleCoreApi(request, url.pathname.slice('/api/zwift'.length));
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

    // Fallback to serving the static React PWA assets
    return env.ASSETS.fetch(request);
  },
};
