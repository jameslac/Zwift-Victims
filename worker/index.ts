import { extractZwiftRacingData, extractZwiftRacingEventData } from './seroval';

export interface Env {
  ASSETS: Fetcher;
}

const ZWIFT_AUTH_URL =
  'https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token';
const ZWIFT_API_BASE = 'https://us-or-rly101.zwift.com';
const ZWIFT_CLIENT_ID = 'Zwift_Mobile_Link';
const ZWIFTPOWER_BASE = 'https://zwiftpower.com';
const ZWIFTPOWER_COOKIE_SEED_URL =
  `${ZWIFTPOWER_BASE}/ucp.php?mode=login&login=external&oauth_service=oauthzpsso`;
const ZWIFTRACING_BASE = 'https://zwiftracing.app';

// Only these Zwift Core API paths may be relayed (keeps the proxy from being an open relay).
const ZWIFT_API_ALLOWLIST = [
  /^\/api\/profiles\/me$/,
  /^\/api\/profiles\/\d+(\/(followees|followers|activities(\/\d+)?))?$/,
  /^\/api\/activities\/\d+$/,
  /^\/api\/race-results\/entries$/,
  /^\/api\/public\/events\/\d+$/,
];
const ALLOWED_CORE_QUERY_PARAMS: Record<string, RegExp> = {
  start: /^\d+$/,
  limit: /^\d+$/,
  event_subgroup_id: /^\d+$/,
  fetchSnapshots: /^(true|false)$/,
  fetchEvent: /^(true|false)$/,
};

const ZWIFTPOWER_ALLOWLIST = [
  /^\/cache3\/profile\/\d+_all\.json$/,
  /^\/cache3\/results\/\d+_(view|zwift)\.json$/,
];

let cachedZpCookies: string | null = null;

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

async function handleCoreApi(
  request: Request,
  path: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  if (!ZWIFT_API_ALLOWLIST.some((re) => re.test(path))) return json({ error: 'not_allowed' }, 403);

  const auth = request.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const forwardedParams = new URLSearchParams();
  for (const [key, value] of searchParams) {
    const pattern = ALLOWED_CORE_QUERY_PARAMS[key];
    if (pattern && pattern.test(value)) {
      forwardedParams.set(key, value);
    }
  }
  const queryString = forwardedParams.toString();
  const targetUrl = `${ZWIFT_API_BASE}${path}${queryString ? `?${queryString}` : ''}`;

  const upstream = await fetch(targetUrl, {
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

async function getZwiftPowerCookies(forceRefresh = false): Promise<string | null> {
  if (cachedZpCookies && !forceRefresh) return cachedZpCookies;
  const res = await fetch(ZWIFTPOWER_COOKIE_SEED_URL, { redirect: 'manual' });
  await res.body?.cancel();
  const pairs = res.headers
    .getSetCookie()
    .map((header) => header.split(';', 1)[0]?.trim())
    .filter((pair): pair is string => Boolean(pair));
  if (pairs.length === 0) return null;
  cachedZpCookies = pairs.join('; ');
  return cachedZpCookies;
}

async function fetchZwiftPowerWithCookies(path: string, forceRefresh = false): Promise<Response> {
  const cookies = await getZwiftPowerCookies(forceRefresh);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cookies) headers.Cookie = cookies;
  return fetch(`${ZWIFTPOWER_BASE}${path}`, { headers });
}

async function handleZwiftPower(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  if (!ZWIFTPOWER_ALLOWLIST.some((re) => re.test(path))) return json({ error: 'not_allowed' }, 403);

  let upstream = await fetchZwiftPowerWithCookies(path, false);
  if (upstream.status === 403) {
    await upstream.body?.cancel();
    upstream = await fetchZwiftPowerWithCookies(path, true);
  }

  const contentType = upstream.headers.get('Content-Type') ?? 'application/json';
  if (upstream.status === 403 || upstream.status === 404 || contentType.includes('xml')) {
    await upstream.body?.cancel();
    return json({ error: 'zwiftpower_not_found' }, 404);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchZwiftRacingHtml(upstreamPath: string): Promise<string | Response> {
  const upstream = await fetch(`${ZWIFTRACING_BASE}${upstreamPath}`, {
    headers: { Accept: 'text/html' },
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return json({ error: 'zwiftracing_upstream_error', status: upstream.status }, upstream.status);
  }
  return upstream.text();
}

async function handleZwiftRacing(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const riderMatch = path.match(/^\/riders\/(\d+)$/);
  if (riderMatch) {
    const htmlOrErr = await fetchZwiftRacingHtml(`/riders/${riderMatch[1]}`);
    if (htmlOrErr instanceof Response) return htmlOrErr;
    const data = extractZwiftRacingData(htmlOrErr);
    if (!data.rider && !data.overview) {
      return json({ error: 'zwiftracing_rider_not_found' }, 404);
    }
    return json(data, 200);
  }

  const eventMatch = path.match(/^\/events\/(\d+)$/);
  if (eventMatch) {
    const htmlOrErr = await fetchZwiftRacingHtml(`/events/${eventMatch[1]}`);
    if (htmlOrErr instanceof Response) return htmlOrErr;
    const eventData = extractZwiftRacingEventData(htmlOrErr);
    if (!eventData) {
      return json({ error: 'zwiftracing_event_not_found' }, 404);
    }
    return json(eventData, 200);
  }

  return json({ error: 'not_allowed' }, 403);
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
      return handleCoreApi(request, url.pathname.slice('/api/zwift'.length), url.searchParams);
    }

    if (url.pathname.startsWith('/api/zwiftpower/')) {
      return handleZwiftPower(request, url.pathname.slice('/api/zwiftpower'.length));
    }

    if (url.pathname.startsWith('/api/zwiftracing/')) {
      return handleZwiftRacing(request, url.pathname.slice('/api/zwiftracing'.length));
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

    // Fallback to serving the static React PWA assets
    return env.ASSETS.fetch(request);
  },
};
