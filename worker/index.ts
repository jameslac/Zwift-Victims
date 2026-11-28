import { handleMcpEndpoint } from './mcp';
import { handleMcpTokensApi, sha256Hex } from './mcpAuth';
import type { McpEnv } from './mcpAuth';
import { extractZwiftRacingData, extractZwiftRacingEventData } from './seroval';
import {
  ZWIFT_API_BASE,
  ZWIFT_AUTH_URL,
  ZWIFT_CLIENT_ID,
  downloadActivityFitBuffer,
  extractBearerToken,
  fetchValidatedExternal,
  fetchZwiftActivityMeta,
  fetchZwiftPowerWithCookies,
  fetchZwiftRacingHtml,
  isForbiddenCrossOrigin,
  jsonResponse,
  validateExternalHttpsUrl,
} from './zwiftUpstream';

export interface Env extends McpEnv {
  ASSETS: Fetcher;
}

const VERIFIED_TOKEN_TTL_MS = 5 * 60_000;
const MAX_VERIFIED_TOKENS = 500;

type TokenVerifyResult = 'ok' | 'unauthorized' | 'upstream_unavailable';

// Only these Zwift Core API paths may be relayed (keeps the proxy from being an open relay).
const ZWIFT_API_ALLOWLIST = [
  /^\/api\/profiles\/me$/,
  /^\/api\/profiles\/\d+(\/(followees|followers|activities(\/\d+)?))?$/,
  /^\/api\/activities\/\d+$/,
  /^\/api\/race-results\/entries$/,
  /^\/api\/public\/events\/\d+$/,
  /^\/api\/power-curve\/(power-profile|best-all-time|all-time|best)$/,
  /^\/api\/competition-metrics\/\d+$/,
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

const verifiedTokens = new Map<string, number>();
const verifyInFlight = new Map<string, Promise<TokenVerifyResult>>();

function parseZwiftJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLength);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      exp?: unknown;
      iss?: unknown;
    };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    const expMs = payload.exp * 1000;
    if (expMs <= Date.now()) return null;
    if (typeof payload.iss !== 'string') return null;
    const issHost = new URL(payload.iss).hostname.toLowerCase();
    if (issHost !== 'secure.zwift.com' && !issHost.endsWith('.zwift.com')) return null;
    return expMs;
  } catch {
    return null;
  }
}

function cacheVerifiedToken(tokenHash: string, jwtExpMs: number): void {
  const now = Date.now();
  const expiresAt = Math.min(jwtExpMs, now + VERIFIED_TOKEN_TTL_MS);
  if (expiresAt <= now) return;
  if (verifiedTokens.has(tokenHash)) {
    verifiedTokens.delete(tokenHash);
  } else if (verifiedTokens.size >= MAX_VERIFIED_TOKENS) {
    for (const [k, exp] of verifiedTokens) {
      if (exp <= now) verifiedTokens.delete(k);
    }
    while (verifiedTokens.size >= MAX_VERIFIED_TOKENS) {
      const oldestKey = verifiedTokens.keys().next().value;
      if (oldestKey === undefined) break;
      verifiedTokens.delete(oldestKey);
    }
  }
  verifiedTokens.set(tokenHash, expiresAt);
}

async function verifyZwiftBearerToken(request: Request): Promise<TokenVerifyResult> {
  const token = extractBearerToken(request);
  if (!token) return 'unauthorized';
  const jwtExpMs = parseZwiftJwtExp(token);
  if (jwtExpMs === null) return 'unauthorized';

  const tokenHash = await sha256Hex(token);
  const cachedExp = verifiedTokens.get(tokenHash);
  if (cachedExp !== undefined) {
    if (cachedExp > Date.now()) return 'ok';
    verifiedTokens.delete(tokenHash);
  }

  const existing = verifyInFlight.get(tokenHash);
  if (existing) return existing;

  const check = (async (): Promise<TokenVerifyResult> => {
    try {
      const res = await fetch(`${ZWIFT_API_BASE}/api/profiles/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      await res.body?.cancel();
      if (res.ok) {
        cacheVerifiedToken(tokenHash, jwtExpMs);
        return 'ok';
      }
      if (res.status === 401 || res.status === 403) {
        verifiedTokens.delete(tokenHash);
        return 'unauthorized';
      }
      return 'upstream_unavailable';
    } catch {
      return 'upstream_unavailable';
    } finally {
      verifyInFlight.delete(tokenHash);
    }
  })();

  verifyInFlight.set(tokenHash, check);
  return check;
}

async function requireVerifiedZwiftAuth(request: Request): Promise<Response | null> {
  const status = await verifyZwiftBearerToken(request);
  if (status === 'unauthorized') return jsonResponse({ error: 'unauthorized' }, 401);
  if (status === 'upstream_unavailable') {
    return jsonResponse({ error: 'auth_verification_unavailable' }, 503);
  }
  return null;
}

/**
 * Stateless relay for the Zwift token endpoint. Credentials are forwarded
 * upstream and never logged or stored. Only password/refresh_token grants allowed.
 */
async function handleToken(request: Request): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const incoming = await request.formData().catch(() => null);
  if (!incoming) return jsonResponse({ error: 'invalid_request' }, 400);

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
    return jsonResponse({ error: 'unsupported_grant_type' }, 400);
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
  if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (!ZWIFT_API_ALLOWLIST.some((re) => re.test(path))) {
    return jsonResponse({ error: 'not_allowed' }, 403);
  }

  const token = extractBearerToken(request);
  if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  if (upstream.ok) {
    const jwtExpMs = parseZwiftJwtExp(token);
    if (jwtExpMs !== null) {
      cacheVerifiedToken(await sha256Hex(token), jwtExpMs);
    }
  } else if (upstream.status === 401) {
    verifiedTokens.delete(await sha256Hex(token));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleZwiftPower(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (!ZWIFTPOWER_ALLOWLIST.some((re) => re.test(path))) {
    return jsonResponse({ error: 'not_allowed' }, 403);
  }

  const authError = await requireVerifiedZwiftAuth(request);
  if (authError) return authError;

  let upstream = await fetchZwiftPowerWithCookies(path, false);
  if (upstream.status === 403) {
    await upstream.body?.cancel();
    upstream = await fetchZwiftPowerWithCookies(path, true);
  }

  const contentType = upstream.headers.get('Content-Type') ?? 'application/json';
  if (upstream.status === 403 || upstream.status === 404 || contentType.includes('xml')) {
    await upstream.body?.cancel();
    return jsonResponse({ error: 'zwiftpower_not_found' }, 404);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}

async function handleZwiftRacing(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const riderMatch = path.match(/^\/riders\/(\d+)$/);
  const eventMatch = riderMatch ? null : path.match(/^\/events\/(\d+)$/);
  if (!riderMatch && !eventMatch) return jsonResponse({ error: 'not_allowed' }, 403);

  const authError = await requireVerifiedZwiftAuth(request);
  if (authError) return authError;

  if (riderMatch) {
    const htmlOrErr = await fetchZwiftRacingHtml(`/riders/${riderMatch[1]}`);
    if (htmlOrErr instanceof Response) return htmlOrErr;
    const data = extractZwiftRacingData(htmlOrErr);
    if (!data.rider && !data.overview) {
      return jsonResponse({ error: 'zwiftracing_rider_not_found' }, 404);
    }
    return jsonResponse(data, 200);
  }

  if (eventMatch) {
    const htmlOrErr = await fetchZwiftRacingHtml(`/events/${eventMatch[1]}`);
    if (htmlOrErr instanceof Response) return htmlOrErr;
    const eventData = extractZwiftRacingEventData(htmlOrErr);
    if (!eventData) {
      return jsonResponse({ error: 'zwiftracing_event_not_found' }, 404);
    }
    return jsonResponse(eventData, 200);
  }

  return jsonResponse({ error: 'not_allowed' }, 403);
}

async function handleActivityFit(
  request: Request,
  activityId: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: 'unauthorized', message: 'Authorization required.' }, 401);
  }
  const auth = `Bearer ${token}`;

  const riderId = searchParams.get('riderId');
  const { meta, errorResponse } = await fetchZwiftActivityMeta(auth, activityId, riderId);
  if (errorResponse) return errorResponse;
  if (!meta) return jsonResponse({ error: 'activity_not_found' }, 404);

  const fitRes = await downloadActivityFitBuffer(auth, meta);
  if (!fitRes.ok) {
    return jsonResponse({ error: fitRes.error, message: fitRes.message }, fitRes.status);
  }

  return new Response(fitRes.buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="zwift-${activityId}.fit"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function handleActivityFitnessData(
  request: Request,
  activityId: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: 'unauthorized', message: 'Authorization required.' }, 401);
  }
  const auth = `Bearer ${token}`;

  const riderId = searchParams.get('riderId');
  const { meta, errorResponse } = await fetchZwiftActivityMeta(auth, activityId, riderId);
  if (errorResponse) return errorResponse;

  const fitnessData =
    meta?.fitnessData && typeof meta.fitnessData === 'object'
      ? (meta.fitnessData as Record<string, unknown>)
      : undefined;
  const targetUrl =
    validateExternalHttpsUrl(fitnessData?.fullDataUrl) ??
    validateExternalHttpsUrl(fitnessData?.smallDataUrl);

  if (!targetUrl) {
    return jsonResponse(
      {
        error: 'fitness_data_unavailable',
        message: 'Zwift did not return a fitnessData stream URL for this activity.',
      },
      404,
    );
  }

  const upstream = await fetchValidatedExternal(targetUrl, auth, 'application/json');
  if (!upstream) {
    return jsonResponse(
      {
        error: 'fitness_data_upstream_blocked',
        message: 'Fitness stream URL failed host validation.',
      },
      502,
    );
  }

  if (!upstream.ok) {
    await upstream.body?.cancel();
    const mappedStatus =
      upstream.status === 401 || upstream.status === 403 || upstream.status === 404
        ? upstream.status
        : 502;
    return jsonResponse(
      {
        error: 'fitness_data_upstream_error',
        upstreamStatus: upstream.status,
        message: `Failed to fetch activity fitness stream (${upstream.status}).`,
      },
      mappedStatus,
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      return handleMcpEndpoint(request, env);
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({
        status: 'Online',
        service: 'zwift-victims-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname.startsWith('/api/') && isForbiddenCrossOrigin(request, url)) {
      return jsonResponse({ error: 'forbidden_origin' }, 403);
    }

    if (url.pathname === '/api/mcp/tokens' || url.pathname.startsWith('/api/mcp/tokens/')) {
      return handleMcpTokensApi(request, env, url.pathname.slice('/api/mcp/tokens'.length));
    }

    if (url.pathname === '/api/zwift/auth/token') return handleToken(request);

    const fitMatch = url.pathname.match(/^\/api\/zwift\/activities\/(\d+)\/fit$/);
    if (fitMatch) {
      return handleActivityFit(request, fitMatch[1], url.searchParams);
    }

    const fitnessDataMatch = url.pathname.match(/^\/api\/zwift\/activities\/(\d+)\/fitness-data$/);
    if (fitnessDataMatch) {
      return handleActivityFitnessData(request, fitnessDataMatch[1], url.searchParams);
    }

    if (url.pathname.startsWith('/api/zwift/')) {
      return handleCoreApi(request, url.pathname.slice('/api/zwift'.length), url.searchParams);
    }

    if (url.pathname.startsWith('/api/zwiftpower/')) {
      return handleZwiftPower(request, url.pathname.slice('/api/zwiftpower'.length));
    }

    if (url.pathname.startsWith('/api/zwiftracing/')) {
      return handleZwiftRacing(request, url.pathname.slice('/api/zwiftracing'.length));
    }

    if (url.pathname.startsWith('/api/')) return jsonResponse({ error: 'not_found' }, 404);

    // Fallback to serving the static React PWA assets
    return env.ASSETS.fetch(request);
  },
};
