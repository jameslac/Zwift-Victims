import type { ZwiftCompetitionMetrics, ZwiftProfile } from '../src/api/zwiftCore';
import type { ZwiftRacingEventResponse, ZwiftRacingRiderResponse } from '../src/api/zwiftRacing';
import { extractZwiftRacingData, extractZwiftRacingEventData } from './seroval';

export const ZWIFT_AUTH_URL =
  'https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token';
export const ZWIFT_API_BASE = 'https://us-or-rly101.zwift.com';
export const ZWIFT_CLIENT_ID = 'Zwift_Mobile_Link';
export const ZWIFTPOWER_BASE = 'https://zwiftpower.com';
export const ZWIFTPOWER_COOKIE_SEED_URL =
  `${ZWIFTPOWER_BASE}/ucp.php?mode=login&login=external&oauth_service=oauthzpsso`;
export const ZWIFTRACING_BASE = 'https://zwiftracing.app';
export const MAX_FIT_BYTES = 12 * 1024 * 1024;

let cachedZpCookies: string | null = null;

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function isForbiddenCrossOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return true;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;
  return false;
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(\S+)$/);
  return match?.[1] ?? null;
}

export interface RefreshedZwiftTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function refreshZwiftAccessToken(
  refreshToken: string,
): Promise<RefreshedZwiftTokens | null> {
  if (!refreshToken.trim()) return null;
  const body = new URLSearchParams({
    client_id: ZWIFT_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  try {
    const res = await fetch(ZWIFT_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const payload = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) {
      return null;
    }
    const expiresInSec =
      typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
        ? payload.expires_in
        : 3600;
    const nextRefresh =
      typeof payload.refresh_token === 'string' && payload.refresh_token
        ? payload.refresh_token
        : refreshToken;
    return {
      accessToken: payload.access_token,
      refreshToken: nextRefresh,
      expiresAt: Date.now() + expiresInSec * 1000,
    };
  } catch {
    return null;
  }
}

export async function fetchZwiftCoreJson<T>(
  accessToken: string,
  path: string,
  query?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data?: T }> {
  const qs = query ? new URLSearchParams(query).toString() : '';
  const targetUrl = `${ZWIFT_API_BASE}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(targetUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, status: res.status };
  }
  const data = (await res.json().catch(() => undefined)) as T | undefined;
  return { ok: data !== undefined, status: res.status, data };
}

function mergeZwiftProfiles(primary: ZwiftProfile, secondary: ZwiftProfile): ZwiftProfile {
  const merged: ZwiftProfile = { ...secondary };
  for (const [key, value] of Object.entries(primary)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  if (primary.competitionMetrics || secondary.competitionMetrics) {
    const mergedMetrics: ZwiftCompetitionMetrics = { ...secondary.competitionMetrics };
    if (primary.competitionMetrics) {
      for (const [key, value] of Object.entries(primary.competitionMetrics)) {
        if (value !== null && value !== undefined) {
          mergedMetrics[key] = value;
        }
      }
    }
    merged.competitionMetrics = mergedMetrics;
  }
  return merged;
}

export async function fetchZwiftMeProfile(
  accessToken: string,
): Promise<{ ok: boolean; status: number; profile?: ZwiftProfile }> {
  const meRes = await fetchZwiftCoreJson<ZwiftProfile>(accessToken, '/api/profiles/me');
  if (!meRes.ok || !meRes.data) {
    return { ok: false, status: meRes.status };
  }

  const me = meRes.data;
  const metrics = me.competitionMetrics;
  const missingZrs = metrics?.racingScore == null;
  const missingCat = metrics?.category == null && metrics?.categoryWomen == null;

  if (typeof me.id === 'number' && (missingZrs || missingCat)) {
    const publicRes = await fetchZwiftCoreJson<ZwiftProfile>(
      accessToken,
      `/api/profiles/${me.id}`,
    );
    if (publicRes.ok && publicRes.data) {
      return { ok: true, status: 200, profile: mergeZwiftProfiles(me, publicRes.data) };
    }
  }

  return { ok: true, status: 200, profile: me };
}

export async function getZwiftPowerCookies(forceRefresh = false): Promise<string | null> {
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

export async function fetchZwiftPowerWithCookies(
  path: string,
  forceRefresh = false,
): Promise<Response> {
  const cookies = await getZwiftPowerCookies(forceRefresh);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cookies) headers.Cookie = cookies;
  return fetch(`${ZWIFTPOWER_BASE}${path}`, { headers });
}

export async function fetchZwiftPowerJson<T>(path: string): Promise<T | null> {
  let upstream = await fetchZwiftPowerWithCookies(path, false);
  if (upstream.status === 403) {
    await upstream.body?.cancel();
    upstream = await fetchZwiftPowerWithCookies(path, true);
  }
  const contentType = upstream.headers.get('Content-Type') ?? 'application/json';
  if (!upstream.ok || upstream.status === 403 || upstream.status === 404 || contentType.includes('xml')) {
    await upstream.body?.cancel();
    return null;
  }
  const parsed = (await upstream.json().catch(() => null)) as T | null;
  return parsed;
}

export async function fetchZwiftRacingHtml(upstreamPath: string): Promise<string | Response> {
  const upstream = await fetch(`${ZWIFTRACING_BASE}${upstreamPath}`, {
    headers: { Accept: 'text/html' },
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return jsonResponse({ error: 'zwiftracing_upstream_error', status: upstream.status }, upstream.status);
  }
  return upstream.text();
}

export async function fetchZwiftRacingRiderData(
  riderId: number,
): Promise<ZwiftRacingRiderResponse> {
  const htmlOrErr = await fetchZwiftRacingHtml(`/riders/${riderId}`);
  if (htmlOrErr instanceof Response) {
    await htmlOrErr.body?.cancel();
    return { rider: null, overview: null };
  }
  const extracted = extractZwiftRacingData(htmlOrErr);
  return extracted as unknown as ZwiftRacingRiderResponse;
}

export async function fetchZwiftRacingEventData(
  eventId: string,
): Promise<ZwiftRacingEventResponse | null> {
  const htmlOrErr = await fetchZwiftRacingHtml(`/events/${encodeURIComponent(eventId)}`);
  if (htmlOrErr instanceof Response) {
    await htmlOrErr.body?.cancel();
    return null;
  }
  const extracted = extractZwiftRacingEventData(htmlOrErr);
  return extracted as unknown as ZwiftRacingEventResponse | null;
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

export function validateExternalHttpsUrl(rawUrl: unknown): URL | null {
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

export function buildTrustedFitS3Url(bucket: unknown, key: unknown): URL | null {
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

export async function fetchValidatedExternal(
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

export interface ZwiftActivityMetaResult {
  meta?: Record<string, unknown>;
  upstreamStatus?: number;
  errorResponse?: Response;
}

export async function fetchZwiftActivityMeta(
  auth: string,
  activityId: string,
  riderId: string | null,
  opts: { fetchSnapshots?: boolean; fetchEvent?: boolean } = {},
): Promise<ZwiftActivityMetaResult> {
  const qs = new URLSearchParams();
  if (opts.fetchSnapshots) qs.set('fetchSnapshots', 'true');
  if (opts.fetchEvent) qs.set('fetchEvent', 'true');
  const query = qs.toString();
  const primaryUrl = `${ZWIFT_API_BASE}/api/activities/${activityId}${query ? `?${query}` : ''}`;

  const primaryRes = await fetch(primaryUrl, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });

  if (primaryRes.status === 401) {
    await primaryRes.body?.cancel();
    return {
      upstreamStatus: 401,
      errorResponse: jsonResponse({ error: 'unauthorized', message: 'Session expired.' }, 401),
    };
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
      return {
        upstreamStatus: 401,
        errorResponse: jsonResponse({ error: 'unauthorized', message: 'Session expired.' }, 401),
      };
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
      upstreamStatus: status,
      errorResponse: jsonResponse(
        {
          error: 'activity_not_found',
          upstreamStatus: primaryRes.status,
          message: `Failed to fetch activity metadata (${primaryRes.status}).`,
        },
        status,
      ),
    };
  }

  return { meta: merged, upstreamStatus: 200 };
}

export function hasValidFitSignature(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 14) return false;
  const bytes = new Uint8Array(buf, 0, 12);
  return bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

export async function downloadActivityFitBuffer(
  auth: string,
  meta: Record<string, unknown>,
): Promise<
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; status: number; error: string; message: string }
> {
  const s3Url =
    buildTrustedFitS3Url(meta.fitFileBucket, meta.fitFileKey) ??
    validateExternalHttpsUrl(meta.fitFileUrl);
  if (!s3Url) {
    return {
      ok: false,
      status: 404,
      error: 'fit_unavailable',
      message: 'Zwift did not return a downloadable FIT reference for this activity.',
    };
  }

  const upstream = await fetchValidatedExternal(s3Url, auth, 'application/octet-stream,*/*');
  if (!upstream) {
    return {
      ok: false,
      status: 502,
      error: 'fit_upstream_blocked',
      message: 'FIT file download URL failed host validation.',
    };
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
    return {
      ok: false,
      status: mappedStatus,
      error: 'fit_upstream_error',
      message,
    };
  }

  const contentLenRaw = upstream.headers.get('Content-Length');
  const contentLen = contentLenRaw ? Number(contentLenRaw) : NaN;
  if (Number.isFinite(contentLen) && contentLen > MAX_FIT_BYTES) {
    await upstream.body?.cancel();
    return {
      ok: false,
      status: 413,
      error: 'fit_too_large',
      message: `FIT file exceeds ${Math.round(MAX_FIT_BYTES / (1024 * 1024))} MB limit.`,
    };
  }

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > MAX_FIT_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'fit_too_large',
      message: `FIT file exceeds ${Math.round(MAX_FIT_BYTES / (1024 * 1024))} MB limit.`,
    };
  }

  if (!hasValidFitSignature(buffer)) {
    return {
      ok: false,
      status: 502,
      error: 'invalid_fit_payload',
      message: 'Upstream did not return a valid FIT binary.',
    };
  }

  return { ok: true, buffer };
}

export async function downloadActivityFitnessJson(
  auth: string,
  meta: Record<string, unknown>,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; message: string }
> {
  const fitnessData =
    meta.fitnessData && typeof meta.fitnessData === 'object'
      ? (meta.fitnessData as Record<string, unknown>)
      : undefined;
  const targetUrl =
    validateExternalHttpsUrl(fitnessData?.fullDataUrl) ??
    validateExternalHttpsUrl(fitnessData?.smallDataUrl);

  if (!targetUrl) {
    return {
      ok: false,
      status: 404,
      error: 'fitness_data_unavailable',
      message: 'Zwift did not return a fitnessData stream URL for this activity.',
    };
  }

  const upstream = await fetchValidatedExternal(targetUrl, auth, 'application/json');
  if (!upstream) {
    return {
      ok: false,
      status: 502,
      error: 'fitness_data_upstream_blocked',
      message: 'Fitness stream URL failed host validation.',
    };
  }

  if (!upstream.ok) {
    await upstream.body?.cancel();
    const mappedStatus =
      upstream.status === 401 || upstream.status === 403 || upstream.status === 404
        ? upstream.status
        : 502;
    return {
      ok: false,
      status: mappedStatus,
      error: 'fitness_data_upstream_error',
      message: `Failed to fetch activity fitness stream (${upstream.status}).`,
    };
  }

  const data = await upstream.json().catch(() => null);
  if (!data) {
    return {
      ok: false,
      status: 502,
      error: 'invalid_fitness_payload',
      message: 'Activity fitness stream returned an unexpected non-JSON format.',
    };
  }
  return { ok: true, data };
}
