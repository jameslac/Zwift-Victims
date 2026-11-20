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

function isAllowedTelemetryHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'zwift.com' ||
    lower.endsWith('.zwift.com') ||
    lower.endsWith('.amazonaws.com') ||
    lower.endsWith('.cloudfront.net')
  );
}

function isZwiftHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'zwift.com' || lower.endsWith('.zwift.com');
}

function validateExternalHttpsUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (!isAllowedTelemetryHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildTrustedFitS3Url(bucket: unknown, key: unknown): URL | null {
  if (typeof bucket !== 'string' || typeof key !== 'string') return null;
  const cleanBucket = bucket.trim();
  const cleanKey = key.trim();
  if (!cleanBucket || !cleanKey) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f?#\\/]/.test(cleanBucket)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f?#\\]/.test(cleanKey)) return null;

  const rawSegments = cleanKey.replace(/^\/+/, '').split('/');
  if (rawSegments.length === 0 || rawSegments.some((seg) => !seg || seg === '.' || seg === '..')) {
    return null;
  }
  const encodedKey = rawSegments.map((seg) => encodeURIComponent(seg)).join('/');

  if (cleanBucket.toLowerCase().endsWith('.amazonaws.com')) {
    if (!/^[a-z0-9.-]*zwift[a-z0-9.-]*\.s3([.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(cleanBucket)) {
      return null;
    }
    return validateExternalHttpsUrl(`https://${cleanBucket}/${encodedKey}`);
  }

  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(cleanBucket) || !/zwift/i.test(cleanBucket)) {
    return null;
  }
  return validateExternalHttpsUrl(`https://${cleanBucket}.s3.amazonaws.com/${encodedKey}`);
}

async function fetchValidatedExternal(
  initialUrl: URL,
  auth: string | null,
  accept: string,
): Promise<Response | null> {
  let currentUrl: URL | null = initialUrl;
  for (let hop = 0; hop < 4 && currentUrl; hop++) {
    const headers: Record<string, string> = { Accept: accept };
    // Never forward Zwift OIDC Bearer tokens to S3/CloudFront hosts.
    if (auth && isZwiftHost(currentUrl.hostname)) {
      headers.Authorization = auth;
    }
    const res = await fetch(currentUrl.toString(), { headers, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location');
      await res.body?.cancel();
      if (!location) return null;
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return null;
      }
      if (nextUrl.protocol !== 'https:' || !isAllowedTelemetryHost(nextUrl.hostname)) {
        return null;
      }
      currentUrl = nextUrl;
      continue;
    }
    return res;
  }
  return null;
}

interface ZwiftActivityMetaResult {
  meta?: Record<string, unknown>;
  errorResponse?: Response;
}

async function fetchZwiftActivityMeta(
  auth: string,
  activityId: string,
  riderId: string | null,
): Promise<ZwiftActivityMetaResult> {
  const primaryUrl = `${ZWIFT_API_BASE}/api/activities/${activityId}`;
  const primaryRes = await fetch(primaryUrl, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });

  if (primaryRes.status === 401) {
    await primaryRes.body?.cancel();
    return { errorResponse: json({ error: 'unauthorized', message: 'Session expired.' }, 401) };
  }

  let merged: Record<string, unknown> | undefined;
  if (primaryRes.ok) {
    const parsed = await primaryRes.json().catch(() => null);
    if (parsed && typeof parsed === 'object') {
      merged = parsed as Record<string, unknown>;
    }
  } else {
    await primaryRes.body?.cancel();
  }

  const hasFitCoords = Boolean(
    merged &&
      ((typeof merged.fitFileBucket === 'string' &&
        merged.fitFileBucket.trim() &&
        typeof merged.fitFileKey === 'string' &&
        merged.fitFileKey.trim()) ||
        typeof merged.fitFileUrl === 'string'),
  );
  const fitnessObj =
    merged?.fitnessData && typeof merged.fitnessData === 'object'
      ? (merged.fitnessData as Record<string, unknown>)
      : undefined;
  const hasFitnessUrls = Boolean(
    fitnessObj &&
      (typeof fitnessObj.fullDataUrl === 'string' || typeof fitnessObj.smallDataUrl === 'string'),
  );

  if ((!merged || !hasFitCoords || !hasFitnessUrls) && riderId && /^\d+$/.test(riderId)) {
    const fallbackUrl = `${ZWIFT_API_BASE}/api/profiles/${riderId}/activities/${activityId}`;
    const fallbackRes = await fetch(fallbackUrl, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (fallbackRes.status === 401) {
      await fallbackRes.body?.cancel();
      return { errorResponse: json({ error: 'unauthorized', message: 'Session expired.' }, 401) };
    }
    if (fallbackRes.ok) {
      const parsed = await fallbackRes.json().catch(() => null);
      if (parsed && typeof parsed === 'object') {
        const fallbackObj = parsed as Record<string, unknown>;
        if (!merged) {
          merged = fallbackObj;
        } else {
          for (const key of ['fitFileBucket', 'fitFileKey', 'fitFileUrl', 'fitnessData'] as const) {
            if (merged[key] == null && fallbackObj[key] != null) {
              merged[key] = fallbackObj[key];
            }
          }
        }
      }
    } else {
      await fallbackRes.body?.cancel();
    }
  }

  if (!merged) {
    const status =
      primaryRes.status === 404
        ? 404
        : primaryRes.status >= 400 && primaryRes.status < 500
          ? primaryRes.status
          : 502;
    return {
      errorResponse: json(
        {
          error: 'activity_not_found',
          upstreamStatus: primaryRes.status,
          message: `Failed to fetch activity metadata (${primaryRes.status}).`,
        },
        status,
      ),
    };
  }

  return { meta: merged };
}

function hasValidFitSignature(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 14) return false;
  const bytes = new Uint8Array(buf, 0, 12);
  return bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

async function handleActivityFit(
  request: Request,
  activityId: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const auth = request.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized', message: 'Authorization required.' }, 401);

  const riderId = searchParams.get('riderId');
  const { meta, errorResponse } = await fetchZwiftActivityMeta(auth, activityId, riderId);
  if (errorResponse) return errorResponse;

  const s3Url =
    buildTrustedFitS3Url(meta?.fitFileBucket, meta?.fitFileKey) ??
    validateExternalHttpsUrl(meta?.fitFileUrl);
  if (!s3Url) {
    return json(
      {
        error: 'fit_unavailable',
        message: 'Zwift did not return a downloadable FIT reference for this activity.',
      },
      404,
    );
  }

  const upstream = await fetchValidatedExternal(s3Url, auth, 'application/octet-stream,*/*');
  if (!upstream) {
    return json(
      {
        error: 'fit_upstream_blocked',
        message: 'FIT file download URL failed host validation.',
      },
      502,
    );
  }

  if (!upstream.ok) {
    await upstream.body?.cancel();
    const mappedStatus =
      upstream.status === 403 || upstream.status === 404 ? upstream.status : 502;
    const message =
      upstream.status === 403
        ? 'FIT file storage returned 403 Forbidden (private or access-restricted S3 object).'
        : upstream.status === 404
          ? 'FIT file not found in Zwift storage.'
          : `Failed to download FIT file (${upstream.status}).`;
    return json(
      {
        error: 'fit_upstream_error',
        upstreamStatus: upstream.status,
        message,
      },
      mappedStatus,
    );
  }

  const buffer = await upstream.arrayBuffer();
  if (!hasValidFitSignature(buffer)) {
    return json(
      {
        error: 'invalid_fit_payload',
        message: 'Upstream did not return a valid FIT binary.',
      },
      502,
    );
  }

  return new Response(buffer, {
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
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const auth = request.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized', message: 'Authorization required.' }, 401);

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
    return json(
      {
        error: 'fitness_data_unavailable',
        message: 'Zwift did not return a fitnessData stream URL for this activity.',
      },
      404,
    );
  }

  const upstream = await fetchValidatedExternal(targetUrl, auth, 'application/json');
  if (!upstream) {
    return json(
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
    return json(
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

    if (url.pathname === '/api/health') {
      return json({
        status: 'Online',
        service: 'zwift-victims-worker',
        timestamp: new Date().toISOString(),
      });
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

    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

    // Fallback to serving the static React PWA assets
    return env.ASSETS.fetch(request);
  },
};
