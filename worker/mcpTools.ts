import type {
  ZwiftActivity,
  ZwiftActivityDetail,
  ZwiftPowerProfile,
  ZwiftProfile,
  ZwiftPublicEvent,
  ZwiftRaceResultEntry,
} from '../src/api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../src/api/zwiftPower';
import type {
  ZwiftRacingEventPen,
  ZwiftRacingRiderResponse,
} from '../src/api/zwiftRacing';
import { finitePositive, mergedRaceToExportItem, roundTo } from '../src/lib/activityExport';
import { buildPowerBests, extractPowerProfileMetrics } from '../src/lib/powerBests';
import {
  formatZwiftWorld,
  getActivityIdStr,
  mergeActivities,
  zpNum,
} from '../src/lib/raceHistory';
import type { ActivityType, MergedRace } from '../src/lib/raceHistory';
import { buildPenOptions, formatPhenotype, mergePenStandings } from '../src/lib/raceStandings';
import {
  DEFAULT_MCP_STREAM_FIELDS,
  TELEMETRY_STREAM_FIELDS,
  decodeFitTelemetry,
  detectPowerIntervals,
  formatTelemetryStreamCsv,
  formatTelemetryStreamRows,
  parseFitnessDataTelemetry,
  resampleTelemetrySamples,
  summarizeTelemetrySamples,
} from '../src/lib/telemetryCore';
import type { TelemetryFieldKey } from '../src/lib/telemetryCore';
import type { McpSession } from './mcpAuth';
import {
  downloadActivityFitBuffer,
  downloadActivityFitnessJson,
  fetchZwiftActivityMeta,
  fetchZwiftCoreJson,
  fetchZwiftMeProfile,
  fetchZwiftPowerJson,
  fetchZwiftRacingEventData,
  fetchZwiftRacingRiderData,
} from './zwiftUpstream';

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'get_activities',
    title: 'List Zwift Activities & Races',
    description:
      'List the authenticated rider’s Zwift activities and races merged across Zwift Core, ZwiftPower, and ZwiftRacing.app. Filter by activity type, date range, or search keyword, and use activityId / eventId with detail, stream, interval, or race-result tools.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['all', 'race', 'ride', 'group_ride', 'workout', 'free_ride'],
          description: 'Filter by normalized activity type (default: "all").',
        },
        fromDate: {
          type: 'string',
          description: 'Inclusive start date (YYYY-MM-DD or ISO 8601 UTC timestamp).',
        },
        toDate: {
          type: 'string',
          description: 'Inclusive end date (YYYY-MM-DD or ISO 8601 UTC timestamp).',
        },
        search: {
          type: 'string',
          description: 'Case-insensitive keyword filter across title, route, world, category, or IDs.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 20,
          description: 'Maximum activities to return (1-50, default 20).',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Pagination offset into the matched activities list (default 0).',
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_activity_detail',
    title: 'Get Zwift Activity Detail',
    description:
      'Get full metadata, physiology metrics (avg/NP/max power, W/kg, % FTP, HR, cadence, speed, VAM, climbing density), and race enrichment (placing, category, vELO impact, power splits) for one activity owned by the authenticated rider.',
    inputSchema: {
      type: 'object',
      properties: {
        activityId: {
          type: 'string',
          description: '64-bit numeric Zwift activity ID (from get_activities).',
        },
      },
      required: ['activityId'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_activity_stream',
    title: 'Get Activity Telemetry Stream',
    description:
      'Decode and return time-series telemetry (power, W/kg, heart rate, cadence, speed, distance, altitude, grade, GPS, lap) from the rider’s FIT binary (with fitnessData fallback). Defaults to 5-second resampling and 720 rows to fit context windows; supports startSec/endSec slicing for per-second inspection.',
    inputSchema: {
      type: 'object',
      properties: {
        activityId: {
          type: 'string',
          description: '64-bit numeric Zwift activity ID owned by the authenticated rider.',
        },
        resample: {
          type: 'integer',
          minimum: 1,
          maximum: 60,
          default: 5,
          description: 'Resampling interval in seconds (1 = per-second, default 5, max 60).',
        },
        fields: {
          type: 'array',
          items: {
            type: 'string',
            enum: [...TELEMETRY_STREAM_FIELDS],
          },
          description: `Telemetry columns to include (defaults to ${DEFAULT_MCP_STREAM_FIELDS.join(', ')}).`,
        },
        startSec: {
          type: 'number',
          minimum: 0,
          description: 'Optional inclusive start offset in elapsed seconds.',
        },
        endSec: {
          type: 'number',
          minimum: 0,
          description: 'Optional inclusive end offset in elapsed seconds.',
        },
        maxRows: {
          type: 'integer',
          minimum: 1,
          maximum: 2000,
          default: 720,
          description: 'Maximum rows returned per call (1-2000, default 720).',
        },
        format: {
          type: 'string',
          enum: ['csv', 'json'],
          default: 'csv',
          description: 'Output format: compact RFC-4180 "csv" (default) or positional "json" rows.',
        },
      },
      required: ['activityId'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_power_curve',
    title: 'Get Rider Power Curve & Thresholds',
    description:
      'Retrieve the authenticated rider’s power duration curve (1s to 60m) and thresholds (FTP, zFTP, zMAP, VO2max, Racing Score, ZwiftRacing vELO & phenotype) across Zwift all-time, 90-day, and ZwiftPower race bests.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: ['all', 'all_time', '90d', 'race_best'],
          default: 'all',
          description: 'Which power curve series to include (default: "all").',
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_race_results',
    title: 'Get Event Standings & Ratings',
    description:
      'Fetch unified pen standings for a Zwift race event (merging Zwift Core unfiltered entries, ZwiftRacing.app vELO/expected rank/phenotype, and ZwiftPower splits/DQs). Automatically selects the authenticated rider’s category pen if category is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'Numeric Zwift event ID (zid).',
        },
        category: {
          type: 'string',
          description: 'Optional category pen filter (e.g., "A", "B", "C", "D", "E"). Defaults to the rider’s pen.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
          description: 'Maximum standings rows to return (1-100, default 50).',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Pagination offset into the pen standings (default 0).',
        },
      },
      required: ['eventId'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_intervals',
    title: 'Get Activity Laps & Power Intervals',
    description:
      'Extract recorded FIT laps and/or automatically detected high-intensity work intervals (with duration, avg/NP/max power, W/kg, HR, cadence) for one of the authenticated rider’s activities.',
    inputSchema: {
      type: 'object',
      properties: {
        activityId: {
          type: 'string',
          description: '64-bit numeric Zwift activity ID owned by the authenticated rider.',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'laps', 'efforts'],
          default: 'auto',
          description:
            '"auto" returns FIT laps plus detected efforts when <=1 lap exists; "laps" returns FIT laps; "efforts" detects threshold/above intervals.',
        },
        minEffortSec: {
          type: 'integer',
          minimum: 10,
          maximum: 600,
          default: 30,
          description: 'Minimum interval duration in seconds for effort detection (default 30).',
        },
      },
      required: ['activityId'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseNumericIdArg(value: unknown, fieldName: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
  } else if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  throw new McpToolError(`${fieldName} must be a positive numeric ID string.`);
}

function parseBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  fieldName: string,
): number {
  if (value === undefined || value === null) return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new McpToolError(`${fieldName} must be an integer between ${min} and ${max}.`);
  }
  return Math.min(max, Math.max(min, num));
}

function parseOptionalNonNegNum(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new McpToolError(`${fieldName} must be a non-negative number.`);
  }
  return num;
}

function parseDateBoundMs(value: unknown, isEnd: boolean, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new McpToolError(`${fieldName} must be an ISO date string (YYYY-MM-DD).`);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(`${trimmed}${isEnd ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`);
    if (Number.isFinite(ms)) return ms;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new McpToolError(`${fieldName} is not a valid ISO date: ${trimmed}`);
  }
  return ms;
}

async function withZwiftAuthRetry<T extends { status?: number; upstreamStatus?: number }>(
  session: McpSession,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const first = await fn(session.zwiftAccessToken);
  const status = first.status ?? first.upstreamStatus;
  if (status !== 401) return first;

  const refreshed = await session.refreshZwiftToken();
  if (!refreshed) {
    throw new McpToolError(
      'Your Zwift session expired and could not be refreshed. Generate a new MCP token in Zwift Victims.',
    );
  }
  return fn(refreshed);
}

async function fetchZwiftActivitiesPage(
  session: McpSession,
  start: number,
  limit: number,
): Promise<ZwiftActivity[]> {
  const res = await withZwiftAuthRetry(session, (token) =>
    fetchZwiftCoreJson<ZwiftActivity[] | { activities?: ZwiftActivity[] }>(
      token,
      `/api/profiles/${session.riderId}/activities`,
      { start: String(start), limit: String(limit) },
    ),
  );
  if (!res.ok || !res.data) return [];
  if (Array.isArray(res.data)) return res.data;
  return Array.isArray(res.data.activities) ? res.data.activities : [];
}

async function fetchAuthorizedActivityMeta(
  session: McpSession,
  activityId: string,
  opts: { fetchSnapshots?: boolean; fetchEvent?: boolean } = {},
): Promise<Record<string, unknown>> {
  const result = await withZwiftAuthRetry(session, async (token) => {
    const res = await fetchZwiftActivityMeta(
      `Bearer ${token}`,
      activityId,
      String(session.riderId),
      opts,
    );
    return {
      status: res.upstreamStatus ?? res.errorResponse?.status,
      res,
    };
  });

  if (result.res.meta) {
    await assertOwnActivity(session, activityId, result.res.meta);
    return result.res.meta;
  }

  const status = result.status ?? 502;
  if (status === 404) {
    throw new McpToolError(`Activity ${activityId} was not found.`);
  }
  if (status === 403) {
    throw new McpToolError('Access denied: you can only inspect your own Zwift activities.');
  }
  throw new McpToolError(`Failed to load activity ${activityId} from Zwift Core (${status}).`);
}

async function assertOwnActivity(
  session: McpSession,
  activityId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const nestedProfile =
    meta.profile && typeof meta.profile === 'object'
      ? (meta.profile as Record<string, unknown>)
      : undefined;
  const ownerRaw = meta.profileId ?? nestedProfile?.id;
  const ownerId =
    typeof ownerRaw === 'number' && Number.isFinite(ownerRaw)
      ? ownerRaw
      : typeof ownerRaw === 'string' && /^\d+$/.test(ownerRaw.trim())
        ? Number(ownerRaw.trim())
        : undefined;

  if (ownerId !== undefined) {
    if (ownerId !== session.riderId) {
      throw new McpToolError('Access denied: this activity belongs to another rider.');
    }
    return;
  }

  const ownershipCheck = await withZwiftAuthRetry(session, (token) =>
    fetchZwiftCoreJson<Record<string, unknown>>(
      token,
      `/api/profiles/${session.riderId}/activities/${activityId}`,
    ),
  );
  if (!ownershipCheck.ok) {
    throw new McpToolError('Access denied: unable to verify this activity belongs to your account.');
  }
}

async function loadActivityTelemetryWithFallback(
  session: McpSession,
  meta: Record<string, unknown>,
  weightKg?: number,
): Promise<{
  source: 'fit' | 'fitness_data';
  samples: ReturnType<typeof decodeFitTelemetry>['samples'];
  laps?: ReturnType<typeof decodeFitTelemetry>['laps'];
  durationSec?: number;
}> {
  const startDateIso = typeof meta.startDate === 'string' ? meta.startDate : undefined;
  let fitFailure: string | undefined;

  const fitDownload = await downloadActivityFitBuffer(
    `Bearer ${session.zwiftAccessToken}`,
    meta,
  );
  if (fitDownload.ok) {
    try {
      const decoded = decodeFitTelemetry(fitDownload.buffer, { weightKg });
      return {
        source: decoded.source,
        samples: decoded.samples,
        laps: decoded.laps,
        durationSec: decoded.durationSec,
      };
    } catch (err) {
      fitFailure = err instanceof Error ? err.message : 'FIT decode failed.';
    }
  } else {
    fitFailure = fitDownload.message;
  }

  const fitnessDownload = await downloadActivityFitnessJson(
    `Bearer ${session.zwiftAccessToken}`,
    meta,
  );
  if (!fitnessDownload.ok) {
    throw new McpToolError(
      `Unable to load telemetry stream (${fitFailure}; fallback: ${fitnessDownload.message}).`,
    );
  }

  try {
    const parsed = parseFitnessDataTelemetry(fitnessDownload.data, { startDateIso, weightKg });
    return {
      source: parsed.source,
      samples: parsed.samples,
      durationSec: parsed.durationSec,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Fitness stream parse failed.';
    throw new McpToolError(`Unable to parse telemetry stream (${fitFailure}; fallback: ${msg}).`);
  }
}

function resolveActivityWeightKg(
  meta: Record<string, unknown>,
  profile?: ZwiftProfile,
): number | undefined {
  const nestedProfile =
    meta.profile && typeof meta.profile === 'object'
      ? (meta.profile as Record<string, unknown>)
      : undefined;
  const grams = finitePositive(nestedProfile?.weight) ?? finitePositive(profile?.weight);
  return grams !== undefined ? roundTo(grams / 1000, 2) : undefined;
}

function normalizeTypeFilter(rawType: unknown): ActivityType | 'all' {
  if (rawType === undefined || rawType === null || rawType === 'all') return 'all';
  if (rawType === 'group_ride' || rawType === 'ride') return 'ride';
  if (rawType === 'race' || rawType === 'workout' || rawType === 'free_ride') return rawType;
  throw new McpToolError(
    `Invalid type "${String(rawType)}". Expected one of: all, race, ride, group_ride, workout, free_ride.`,
  );
}

function formatActivitySummary(entry: MergedRace, riderId: number) {
  const item = mergedRaceToExportItem(entry, riderId);
  const dateUtc =
    item?.startDateIso ??
    (entry.date !== undefined ? new Date(entry.date * 1000).toISOString() : undefined);
  const durationSec =
    item?.durationSec ??
    zpNum(entry.zp?.time) ??
    entry.zr?.race?.time ??
    (typeof entry.activity?.movingTimeInMs === 'number' && entry.activity.movingTimeInMs > 0
      ? Math.round(entry.activity.movingTimeInMs / 1000)
      : undefined);
  const distKm =
    item?.distanceM !== undefined
      ? roundTo(item.distanceM / 1000, 2)
      : entry.zp?.distance ?? entry.zr?.race?.distance ?? entry.zr?.event?.distance;
  const elevM =
    item?.elevationM ??
    entry.zr?.event?.elevation ??
    (typeof entry.activity?.totalElevation === 'number' ? entry.activity.totalElevation : undefined);
  const avgPowerW =
    item?.avgPowerW ??
    zpNum(entry.zp?.avg_power) ??
    (finitePositive(entry.activity?.avgWatts) !== undefined
      ? Math.round(finitePositive(entry.activity?.avgWatts)!)
      : undefined);
  const npW = item?.normalizedPowerW ?? zpNum(entry.zp?.np);
  const avgWkg = item?.avgWkg ?? zpNum(entry.zp?.avg_wkg) ?? entry.zr?.race?.wkgAvg;
  const veloBefore = entry.zr?.velo?.elo?.before;
  const veloAfter = entry.zr?.velo?.elo?.after;
  const veloDelta =
    entry.zr?.velo?.elo?.adjustedChange ??
    (veloBefore !== undefined && veloAfter !== undefined ? veloAfter - veloBefore : undefined);

  return {
    activityId: entry.activityId ?? null,
    eventId: entry.eventId || null,
    dateUtc: dateUtc ?? null,
    title: entry.title,
    type: entry.activityType ?? 'free_ride',
    typeLabel: entry.activityTypeLabel ?? 'Activity',
    world: formatZwiftWorld(entry.activity?.worldId) ?? null,
    route: entry.zr?.event?.routeName ?? null,
    category: entry.zp?.category ?? entry.zr?.event?.subgroupId ?? null,
    subType: entry.zr?.event?.subType ?? null,
    placing: entry.truePlace ?? null,
    fieldSize: entry.fieldSize ?? null,
    zpPlace: entry.zpPlace ?? null,
    durationSec: durationSec !== undefined ? Math.round(durationSec) : null,
    distanceKm: distKm !== undefined ? roundTo(distKm, 2) : null,
    elevationM: elevM !== undefined ? Math.round(elevM) : null,
    avgPowerW: avgPowerW ?? null,
    normalizedPowerW: npW !== undefined ? Math.round(npW) : null,
    avgWkg: avgWkg !== undefined ? roundTo(avgWkg, 2) : null,
    avgHrBpm: item?.avgHrBpm ?? zpNum(entry.zp?.avg_hr) ?? null,
    maxHrBpm: item?.maxHrBpm ?? zpNum(entry.zp?.max_hr) ?? null,
    veloBefore: veloBefore !== undefined ? roundTo(veloBefore, 1) : null,
    veloAfter: veloAfter !== undefined ? roundTo(veloAfter, 1) : null,
    veloDelta: veloDelta !== undefined ? roundTo(veloDelta, 1) : null,
    sof: entry.zr?.velo?.elo?.eventRating !== undefined ? Math.round(entry.zr.velo.elo.eventRating) : null,
    hasStream: Boolean(entry.activityId),
  };
}

async function handleGetActivities(args: Record<string, unknown>, session: McpSession) {
  const typeFilter = normalizeTypeFilter(args.type);
  const fromMs = parseDateBoundMs(args.fromDate, false, 'fromDate');
  const toMs = parseDateBoundMs(args.toDate, true, 'toDate');
  if (fromMs !== undefined && toMs !== undefined && toMs < fromMs) {
    throw new McpToolError('toDate must be on or after fromDate.');
  }
  const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
  const limit = parseBoundedInt(args.limit, 20, 1, 50, 'limit');
  const offset = parseBoundedInt(args.offset, 0, 0, 1000, 'offset');

  const [zpPayload, zrData, page0, page1] = await Promise.all([
    fetchZwiftPowerJson<{ data?: ZwiftPowerRaceEntry[] }>(
      `/cache3/profile/${session.riderId}_all.json`,
    ).catch(() => null),
    fetchZwiftRacingRiderData(session.riderId).catch(
      (): ZwiftRacingRiderResponse => ({ rider: null, overview: null }),
    ),
    fetchZwiftActivitiesPage(session, 0, 50),
    fetchZwiftActivitiesPage(session, 50, 50),
  ]);

  let activities = [...page0, ...page1];
  const oldestMs = activities.reduce((min, act) => {
    const ms = act.startDate ? Date.parse(act.startDate) : NaN;
    return Number.isFinite(ms) && ms < min ? ms : min;
  }, Infinity);

  const needsOlderPages =
    page1.length >= 50 &&
    ((fromMs !== undefined && oldestMs > fromMs) || offset + limit > 80);

  if (needsOlderPages) {
    const [page2, page3] = await Promise.all([
      fetchZwiftActivitiesPage(session, 100, 50),
      fetchZwiftActivitiesPage(session, 150, 50),
    ]);
    activities = [...activities, ...page2, ...page3];
  }

  const zpRaces = Array.isArray(zpPayload?.data) ? zpPayload.data : [];
  const zrHistory = Array.isArray(zrData.overview?.history) ? zrData.overview.history : [];
  const merged = mergeActivities(zpRaces, zrHistory, activities);

  const filtered = merged.filter((entry) => {
    if (typeFilter !== 'all' && entry.activityType !== typeFilter) return false;
    if (fromMs !== undefined || toMs !== undefined) {
      if (entry.date === undefined) return false;
      const entryMs = entry.date * 1000;
      if (fromMs !== undefined && entryMs < fromMs) return false;
      if (toMs !== undefined && entryMs > toMs) return false;
    }
    if (search) {
      const haystack = [
        entry.title,
        entry.zr?.event?.routeName,
        formatZwiftWorld(entry.activity?.worldId),
        entry.zp?.category,
        entry.zr?.event?.subgroupId,
        entry.zp?.tname,
        entry.eventId,
        entry.activityId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const page = filtered.slice(offset, offset + limit);
  return {
    riderId: session.riderId,
    riderName: session.riderName,
    totalMatched: filtered.length,
    offset,
    returned: page.length,
    hasMore: offset + page.length < filtered.length,
    activities: page.map((entry) => formatActivitySummary(entry, session.riderId)),
  };
}

async function handleGetActivityDetail(args: Record<string, unknown>, session: McpSession) {
  const activityId = parseNumericIdArg(args.activityId, 'activityId');
  const meta = await fetchAuthorizedActivityMeta(session, activityId, {
    fetchSnapshots: true,
    fetchEvent: true,
  });
  const detail = meta as ZwiftActivityDetail;
  const activityCandidate: ZwiftActivity = {
    ...(meta as ZwiftActivity),
    id: typeof detail.id === 'number' ? detail.id : 0,
    id_str: getActivityIdStr(meta as ZwiftActivity) ?? activityId,
  };

  const [meRes, zpPayload, zrData] = await Promise.all([
    withZwiftAuthRetry(session, (token) => fetchZwiftMeProfile(token)),
    fetchZwiftPowerJson<{ data?: ZwiftPowerRaceEntry[] }>(
      `/cache3/profile/${session.riderId}_all.json`,
    ).catch(() => null),
    fetchZwiftRacingRiderData(session.riderId).catch(
      (): ZwiftRacingRiderResponse => ({ rider: null, overview: null }),
    ),
  ]);

  const profile = meRes.ok ? meRes.profile : undefined;
  const zpRaces = Array.isArray(zpPayload?.data) ? zpPayload.data : [];
  const zrHistory = Array.isArray(zrData.overview?.history) ? zrData.overview.history : [];
  const merged = mergeActivities(zpRaces, zrHistory, [activityCandidate]);

  const linkedEventId = detail.eventInfo?.id ? String(detail.eventInfo.id) : undefined;
  const matched =
    merged.find((m) => m.activityId === activityId) ??
    (linkedEventId ? merged.find((m) => m.eventId === linkedEventId) : undefined);

  const startMs = detail.startDate ? Date.parse(detail.startDate) : NaN;
  const endMs = detail.endDate ? Date.parse(detail.endDate) : NaN;
  const elapsedSec =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.round((endMs - startMs) / 1000)
      : undefined;
  const movingSec =
    finitePositive(detail.movingTimeInMs) !== undefined
      ? Math.round(detail.movingTimeInMs! / 1000)
      : matched?.zp
        ? zpNum(matched.zp.time)
        : matched?.zr?.race?.time ?? elapsedSec;

  const distanceM =
    finitePositive(detail.distanceInMeters) ??
    (matched?.zp?.distance ? matched.zp.distance * 1000 : undefined) ??
    (matched?.zr?.race?.distance ? matched.zr.race.distance * 1000 : undefined);
  const elevationM =
    typeof detail.totalElevation === 'number' && Number.isFinite(detail.totalElevation)
      ? detail.totalElevation
      : matched?.zr?.event?.elevation;
  const avgWatts = finitePositive(detail.avgWatts) ?? zpNum(matched?.zp?.avg_power);
  const maxWatts = finitePositive(detail.maxWatts);
  const npWatts = finitePositive(detail.normalizedPower) ?? zpNum(matched?.zp?.np);
  const weightKg = resolveActivityWeightKg(meta, profile);
  const avgWkg =
    avgWatts !== undefined && weightKg
      ? roundTo(avgWatts / weightKg, 2)
      : zpNum(matched?.zp?.avg_wkg) ?? matched?.zr?.race?.wkgAvg;
  const ftpW = finitePositive(detail.profileFtp) ?? zpNum(matched?.zp?.wftp) ?? finitePositive(profile?.ftp);
  const intensityPctFtp =
    avgWatts !== undefined && ftpW ? Math.round((avgWatts / ftpW) * 100) : undefined;
  const workKj =
    avgWatts !== undefined && movingSec !== undefined
      ? Math.round((avgWatts * movingSec) / 1000)
      : undefined;

  const avgHr = finitePositive(detail.avgHeartRate) ?? zpNum(matched?.zp?.avg_hr);
  const maxHr = finitePositive(detail.maxHeartRate) ?? zpNum(matched?.zp?.max_hr);
  const avgCadence =
    finitePositive(detail.avgCadenceInRotationsPerMinute) ?? finitePositive(detail.avgCadence);
  const maxCadence =
    finitePositive(detail.maxCadenceInRotationsPerMinute) ?? finitePositive(detail.maxCadence);
  const avgSpeedMps =
    finitePositive(detail.avgSpeedInMetersPerSecond) ??
    (distanceM !== undefined && movingSec && movingSec > 0 ? distanceM / movingSec : undefined);
  const maxSpeedMps = finitePositive(detail.maxSpeedInMetersPerSecond);

  const climbingDensityMPerKm =
    elevationM !== undefined && distanceM !== undefined && distanceM > 0
      ? roundTo(elevationM / (distanceM / 1000), 1)
      : undefined;
  const vamMPerHr =
    elevationM !== undefined && elevationM > 0 && movingSec && movingSec > 0
      ? Math.round((elevationM / movingSec) * 3600)
      : undefined;

  const hasFitFile = Boolean(
    (typeof detail.fitFileBucket === 'string' && detail.fitFileBucket.trim() && detail.fitFileKey) ||
      typeof meta.fitFileUrl === 'string',
  );
  const hasFitnessData = Boolean(detail.fitnessData?.fullDataUrl || detail.fitnessData?.smallDataUrl);

  return {
    activityId,
    eventId: matched?.eventId || linkedEventId || null,
    title: detail.name?.trim() || matched?.title || `Zwift Activity ${activityId}`,
    description: detail.description?.trim() || null,
    type: matched?.activityType ?? 'free_ride',
    typeLabel: matched?.activityTypeLabel ?? 'Activity',
    sport: detail.sport ?? null,
    world: formatZwiftWorld(detail.worldId) ?? null,
    route: matched?.zr?.event?.routeName ?? null,
    startDate: detail.startDate ?? null,
    endDate: detail.endDate ?? null,
    privacy: detail.privacy ?? null,
    effort: {
      movingTimeSec: movingSec !== undefined ? Math.round(movingSec) : null,
      elapsedTimeSec: elapsedSec ?? null,
      distanceKm: distanceM !== undefined ? roundTo(distanceM / 1000, 2) : null,
      elevationM: elevationM !== undefined ? Math.round(elevationM) : null,
      avgPowerW: avgWatts !== undefined ? Math.round(avgWatts) : null,
      normalizedPowerW: npWatts !== undefined ? Math.round(npWatts) : null,
      maxPowerW: maxWatts !== undefined ? Math.round(maxWatts) : null,
      avgWkg: avgWkg !== undefined ? roundTo(avgWkg, 2) : null,
      ftpW: ftpW !== undefined ? Math.round(ftpW) : null,
      intensityPctFtp: intensityPctFtp ?? null,
      workKj: workKj ?? null,
      calories: finitePositive(detail.calories) !== undefined ? Math.round(detail.calories!) : null,
      avgHrBpm: avgHr !== undefined ? Math.round(avgHr) : null,
      maxHrBpm: maxHr !== undefined ? Math.round(maxHr) : null,
      hrEfficiencyWPerBpm:
        avgWatts !== undefined && avgHr ? roundTo(avgWatts / avgHr, 2) : null,
      avgCadenceRpm: avgCadence !== undefined ? Math.round(avgCadence) : null,
      maxCadenceRpm: maxCadence !== undefined ? Math.round(maxCadence) : null,
      avgSpeedKmh: avgSpeedMps !== undefined ? roundTo(avgSpeedMps * 3.6, 1) : null,
      maxSpeedKmh: maxSpeedMps !== undefined ? roundTo(maxSpeedMps * 3.6, 1) : null,
      climbingDensityMPerKm: climbingDensityMPerKm ?? null,
      vamMPerHr: vamMPerHr ?? null,
      weightKg: weightKg ?? null,
    },
    race:
      matched?.zp || matched?.zr || detail.eventInfo
        ? {
            category: matched?.zp?.category ?? matched?.zr?.event?.subgroupId ?? null,
            subType: matched?.zr?.event?.subType ?? null,
            placing: matched?.truePlace ?? null,
            fieldSize:
              matched?.fieldSize ?? detail.eventInfo?.subgroupTotalEntrantCount ?? null,
            zpPlace: matched?.zpPlace ?? null,
            gapSec: matched?.zp?.gap ?? matched?.zr?.race?.gap ?? null,
            team: matched?.zp?.tname ?? null,
            penalty: matched?.zp?.penalty || null,
            upg: matched?.zp?.upg === 1,
            velo: matched?.zr?.velo?.elo
              ? {
                  before: matched.zr.velo.elo.before ?? null,
                  after: matched.zr.velo.elo.after ?? null,
                  delta: matched.zr.velo.elo.adjustedChange ?? null,
                  expectedPosition: matched.zr.velo.elo.expectedPosition ?? null,
                  sof: matched.zr.velo.elo.eventRating ?? null,
                  intensity: matched.zr.velo.intensity ?? null,
                }
              : null,
            splitsWatts: matched?.zp
              ? {
                  s5: zpNum(matched.zp.w5) ?? null,
                  s15: zpNum(matched.zp.w15) ?? null,
                  s30: zpNum(matched.zp.w30) ?? null,
                  m1: zpNum(matched.zp.w60) ?? null,
                  m2: zpNum(matched.zp.w120) ?? null,
                  m5: zpNum(matched.zp.w300) ?? null,
                  m20: zpNum(matched.zp.w1200) ?? null,
                }
              : null,
          }
        : null,
    telemetry: {
      hasFitFile,
      hasFitnessData,
    },
  };
}

function validateFieldsArg(rawFields: unknown): TelemetryFieldKey[] {
  if (rawFields === undefined || rawFields === null) {
    return [...DEFAULT_MCP_STREAM_FIELDS];
  }
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw new McpToolError('fields must be a non-empty array of telemetry column names.');
  }
  const allowed = new Set<string>(TELEMETRY_STREAM_FIELDS);
  const selected: TelemetryFieldKey[] = [];
  for (const item of rawFields) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      throw new McpToolError(
        `Invalid stream field "${String(item)}". Valid fields: ${TELEMETRY_STREAM_FIELDS.join(', ')}.`,
      );
    }
    const typed = item as TelemetryFieldKey;
    if (!selected.includes(typed)) selected.push(typed);
  }
  return selected;
}

async function handleGetActivityStream(args: Record<string, unknown>, session: McpSession) {
  const activityId = parseNumericIdArg(args.activityId, 'activityId');
  const resampleSec = parseBoundedInt(args.resample, 5, 1, 60, 'resample');
  const maxRows = parseBoundedInt(args.maxRows, 720, 1, 2000, 'maxRows');
  const startSec = parseOptionalNonNegNum(args.startSec, 'startSec');
  const endSec = parseOptionalNonNegNum(args.endSec, 'endSec');
  if (startSec !== undefined && endSec !== undefined && endSec < startSec) {
    throw new McpToolError('endSec must be greater than or equal to startSec.');
  }
  const fields = validateFieldsArg(args.fields);
  const format = args.format === undefined ? 'csv' : args.format;
  if (format !== 'csv' && format !== 'json') {
    throw new McpToolError('format must be "csv" or "json".');
  }

  const meta = await fetchAuthorizedActivityMeta(session, activityId);
  let weightKg = resolveActivityWeightKg(meta);
  if (weightKg === undefined) {
    const me = await withZwiftAuthRetry(session, (token) => fetchZwiftMeProfile(token));
    if (me.ok) weightKg = resolveActivityWeightKg(meta, me.profile);
  }

  const telemetry = await loadActivityTelemetryWithFallback(session, meta, weightKg);
  const sliced = telemetry.samples.filter((s) => {
    if (startSec !== undefined && s.elapsedSec < startSec) return false;
    if (endSec !== undefined && s.elapsedSec > endSec) return false;
    return true;
  });

  const windowSummary = summarizeTelemetrySamples(sliced, weightKg);
  const resampled = resampleTelemetrySamples(sliced, resampleSec);
  const truncated = resampled.length > maxRows;
  const returnedSamples = truncated ? resampled.slice(0, maxRows) : resampled;
  const nextStartSec = truncated ? resampled[maxRows].elapsedSec : null;

  return {
    activityId,
    title: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : `Zwift Activity ${activityId}`,
    source: telemetry.source,
    resampleSec,
    fields,
    totalSamplesInWindow: sliced.length,
    totalResampledRows: resampled.length,
    returnedRows: returnedSamples.length,
    truncated,
    nextStartSec,
    hint: truncated
      ? `Output capped at ${maxRows} rows. Call get_activity_stream again with startSec=${nextStartSec} (or a larger resample interval) to read further.`
      : undefined,
    windowSummary,
    ...(format === 'csv'
      ? { csv: formatTelemetryStreamCsv(returnedSamples, fields) }
      : { rows: formatTelemetryStreamRows(returnedSamples, fields) }),
  };
}

async function handleGetPowerCurve(args: Record<string, unknown>, session: McpSession) {
  const range = args.range === undefined ? 'all' : args.range;
  if (range !== 'all' && range !== 'all_time' && range !== '90d' && range !== 'race_best') {
    throw new McpToolError('range must be one of: all, all_time, 90d, race_best.');
  }

  const [meRes, powerProfileRes, zpPayload, zrData] = await Promise.all([
    withZwiftAuthRetry(session, (token) => fetchZwiftMeProfile(token)),
    withZwiftAuthRetry(session, (token) =>
      fetchZwiftCoreJson<ZwiftPowerProfile>(token, '/api/power-curve/power-profile'),
    ),
    fetchZwiftPowerJson<{ data?: ZwiftPowerRaceEntry[] }>(
      `/cache3/profile/${session.riderId}_all.json`,
    ).catch(() => null),
    fetchZwiftRacingRiderData(session.riderId).catch(
      (): ZwiftRacingRiderResponse => ({ rider: null, overview: null }),
    ),
  ]);

  const profile = meRes.ok ? meRes.profile : undefined;
  const powerProfile = powerProfileRes.ok ? powerProfileRes.data : null;
  const zpRaces = Array.isArray(zpPayload?.data) ? zpPayload.data : [];
  const thresholds = extractPowerProfileMetrics(powerProfile);
  const rows = buildPowerBests({
    powerProfile,
    zpRaces,
    weightGrams: profile?.weight,
  });

  const formatEffort = (effort?: {
    watts?: number;
    wkg?: number;
    date?: string | number;
    eventTitle?: string;
    isSustainedRaceAvg?: boolean;
  }) => {
    if (!effort || (effort.watts === undefined && effort.wkg === undefined)) return null;
    return {
      watts: effort.watts !== undefined ? Math.round(effort.watts) : null,
      wkg: effort.wkg !== undefined ? roundTo(effort.wkg, 2) : null,
      date:
        typeof effort.date === 'number'
          ? new Date(effort.date * 1000).toISOString().slice(0, 10)
          : effort.date ?? null,
      ...(effort.eventTitle ? { eventTitle: effort.eventTitle } : {}),
      ...(effort.isSustainedRaceAvg ? { isSustainedRaceAvg: true } : {}),
    };
  };

  const formattedDurations = rows
    .map((row) => {
      const base: Record<string, unknown> = {
        seconds: row.seconds,
        label: row.shortLabel,
      };
      if (range === 'all' || range === 'all_time') {
        base.zwiftAllTime = formatEffort(row.zwiftAllTime);
      }
      if (range === 'all' || range === '90d') {
        base.zwift90Day = formatEffort(row.zwift90Day);
      }
      if (range === 'all' || range === 'race_best') {
        base.zpRaceBest = formatEffort(row.zpRaceBest);
      }
      return base;
    })
    .filter((row) =>
      Object.entries(row).some(([k, v]) => k !== 'seconds' && k !== 'label' && v !== null),
    );

  return {
    riderId: session.riderId,
    riderName: session.riderName,
    range,
    thresholds: {
      ftpW: profile?.ftp ?? null,
      zftpW: thresholds.zftp !== undefined ? Math.round(thresholds.zftp) : null,
      zmapW: thresholds.zmap !== undefined ? Math.round(thresholds.zmap) : null,
      vo2max: thresholds.vo2max !== undefined ? roundTo(thresholds.vo2max, 1) : null,
      weightKg: profile?.weight ? roundTo(profile.weight / 1000, 1) : null,
      zrs: profile?.competitionMetrics?.racingScore ?? null,
      category:
        profile?.competitionMetrics?.category ??
        profile?.competitionMetrics?.categoryWomen ??
        null,
      zrVelo: zrData.rider?.velo?.race !== undefined ? roundTo(zrData.rider.velo.race, 1) : null,
      zrPhenotype: formatPhenotype(zrData.rider?.phenotype?.label) ?? null,
    },
    durations: formattedDurations,
  };
}

function resolvePenSof(pen: ZwiftRacingEventPen | undefined): number | undefined {
  if (!pen) return undefined;
  const direct = finitePositive(pen.points?.sof) ?? finitePositive(pen.avgRating);
  if (direct !== undefined) return Math.round(direct);
  const ratings = (pen.riders ?? [])
    .map((r) => finitePositive(r.ratingBefore) ?? finitePositive(r.velo?.elo?.before) ?? finitePositive(r.rating))
    .filter((n): n is number => n !== undefined);
  if (ratings.length === 0) return undefined;
  const sum = ratings.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / ratings.length);
}

async function handleGetRaceResults(args: Record<string, unknown>, session: McpSession) {
  const eventId = parseNumericIdArg(args.eventId, 'eventId');
  const requestedCategory =
    typeof args.category === 'string' && args.category.trim()
      ? args.category.trim().toUpperCase()
      : undefined;
  const limit = parseBoundedInt(args.limit, 50, 1, 100, 'limit');
  const offset = parseBoundedInt(args.offset, 0, 0, 2000, 'offset');

  const [publicEventRes, zrEvent, zpViewPayload, zpZwiftPayload, meRes] = await Promise.all([
    withZwiftAuthRetry(session, (token) =>
      fetchZwiftCoreJson<ZwiftPublicEvent>(token, `/api/public/events/${eventId}`),
    ),
    fetchZwiftRacingEventData(eventId).catch(() => null),
    fetchZwiftPowerJson<ZwiftPowerRaceEntry[] | { data?: ZwiftPowerRaceEntry[] }>(
      `/cache3/results/${eventId}_view.json`,
    ).catch(() => null),
    fetchZwiftPowerJson<ZwiftPowerRaceEntry[] | { data?: ZwiftPowerRaceEntry[] }>(
      `/cache3/results/${eventId}_zwift.json`,
    ).catch(() => null),
    withZwiftAuthRetry(session, (token) => fetchZwiftMeProfile(token)),
  ]);

  const publicEvent = publicEventRes.ok ? publicEventRes.data : undefined;
  const zpViewResults = Array.isArray(zpViewPayload)
    ? zpViewPayload
    : Array.isArray(zpViewPayload?.data)
      ? zpViewPayload.data
      : [];
  const zpZwiftResults = Array.isArray(zpZwiftPayload)
    ? zpZwiftPayload
    : Array.isArray(zpZwiftPayload?.data)
      ? zpZwiftPayload.data
      : [];

  const { penSystem, pens } = buildPenOptions(publicEvent, zrEvent, zpViewResults, zpZwiftResults);
  if (pens.length === 0 && !publicEvent && !zrEvent && zpViewResults.length === 0) {
    throw new McpToolError(`No race event data found for eventId ${eventId}.`);
  }

  let selectedPen = pens[0] ?? null;
  if (requestedCategory) {
    const base = requestedCategory.replace(/\+$/, '');
    const match = pens.find(
      (p) => p.category?.toUpperCase() === requestedCategory || p.category?.toUpperCase() === base,
    );
    if (!match && pens.length > 0) {
      const available = pens.map((p) => p.category ?? p.label).join(', ');
      throw new McpToolError(
        `Category "${requestedCategory}" not found for event ${eventId}. Available pens: ${available}.`,
      );
    }
    if (match) selectedPen = match;
  } else if (pens.length > 1) {
    const zrMatchedPen = zrEvent?.pens?.find((p) =>
      p.riders?.some((r) => Number(r.riderId) === session.riderId),
    );
    const zpMatchedRow = zpViewResults.find((r) => Number(r.zwid) === session.riderId);
    const candidateCat = zrMatchedPen?.name?.trim().toUpperCase() ?? zpMatchedRow?.category?.trim().toUpperCase();
    const byId = zrMatchedPen?.id
      ? pens.find((p) => p.subgroupId != null && p.subgroupId === Number(zrMatchedPen.id))
      : undefined;
    const byCat = candidateCat
      ? pens.find((p) => p.category?.toUpperCase() === candidateCat.replace(/\+$/, ''))
      : undefined;
    selectedPen = byId ?? byCat ?? pens[0];
  }

  let coreResults: ZwiftRaceResultEntry[] = [];
  if (selectedPen?.subgroupId != null) {
    const coreRes = await withZwiftAuthRetry(session, (token) =>
      fetchZwiftCoreJson<ZwiftRaceResultEntry[] | { entries?: ZwiftRaceResultEntry[] }>(
        token,
        '/api/race-results/entries',
        { event_subgroup_id: String(selectedPen.subgroupId) },
      ),
    );
    if (coreRes.ok && coreRes.data) {
      coreResults = Array.isArray(coreRes.data)
        ? coreRes.data
        : Array.isArray(coreRes.data.entries)
          ? coreRes.data.entries
          : [];
    }
  }

  const subgroupMatch =
    selectedPen?.subgroupId != null
      ? publicEvent?.eventSubgroups?.find((sg) => sg.id === selectedPen.subgroupId)
      : undefined;
  const eventDistanceMeters =
    subgroupMatch?.distanceInMeters ??
    publicEvent?.distanceInMeters ??
    (zrEvent?.distance ? zrEvent.distance * 1000 : undefined);

  const standings = mergePenStandings({
    selectedPen,
    totalPensCount: pens.length,
    coreResults,
    zrEvent,
    zpViewResults,
    zpZwiftResults,
    zpViewLoaded: zpViewResults.length > 0,
    targetRiderId: session.riderId,
    targetProfile: meRes.ok ? meRes.profile : undefined,
    loggedInProfile: meRes.ok ? meRes.profile : undefined,
    eventDistanceMeters,
  });

  const zrPen = (zrEvent?.pens ?? []).find(
    (p) =>
      (selectedPen?.subgroupId != null && Number(p.id) === selectedPen.subgroupId) ||
      (selectedPen?.category && p.name?.trim().toUpperCase() === selectedPen.category.toUpperCase()),
  );

  const formatRow = (row: (typeof standings)[number]) => ({
    rank: row.rank ?? null,
    zpPlace: row.zpPlace ?? null,
    riderId: row.riderId > 0 ? row.riderId : null,
    name: row.name,
    team: row.team ?? null,
    riderCategory: row.riderCategory ?? null,
    zrsScore: row.zrsScore ?? null,
    zrsDelta: row.zrsDelta ?? null,
    velo: row.velo !== undefined ? roundTo(row.velo, 1) : null,
    veloDelta: row.veloDelta !== undefined ? roundTo(row.veloDelta, 1) : null,
    expectedPosition: row.expectedPosition !== undefined ? roundTo(row.expectedPosition, 1) : null,
    phenotype: row.phenotype ?? null,
    timeSec: row.timeSec !== undefined ? roundTo(row.timeSec, 1) : null,
    gapSec: row.gapSec !== undefined ? roundTo(row.gapSec, 1) : null,
    avgWatts: row.avgWatts ?? null,
    np: row.np ?? null,
    avgWkg: row.avgWkg !== undefined ? roundTo(row.avgWkg, 2) : null,
    avgHr: row.avgHr ?? null,
    maxHr: row.maxHr ?? null,
    avgSpeedKmh: row.avgSpeedMps !== undefined ? roundTo(row.avgSpeedMps * 3.6, 1) : null,
    splitsWkg: {
      s5: row.splits.s5.wkg !== undefined ? roundTo(row.splits.s5.wkg, 2) : null,
      s15: row.splits.s15.wkg !== undefined ? roundTo(row.splits.s15.wkg, 2) : null,
      m1: row.splits.m1.wkg !== undefined ? roundTo(row.splits.m1.wkg, 2) : null,
      m5: row.splits.m5.wkg !== undefined ? roundTo(row.splits.m5.wkg, 2) : null,
      m20: row.splits.m20.wkg !== undefined ? roundTo(row.splits.m20.wkg, 2) : null,
    },
    didNotFinish: row.didNotFinish,
    disqualified: row.disqualified,
    penalty: row.penalty ?? null,
    hiddenOnZp: row.hiddenOnZp,
    isAuthenticatedRider: row.riderId === session.riderId,
  });

  const myRow = standings.find((r) => r.riderId === session.riderId);
  const page = standings.slice(offset, offset + limit);

  return {
    eventId,
    title: zrEvent?.title ?? publicEvent?.name ?? `Event ${eventId}`,
    route: zrEvent?.route?.name ?? null,
    world:
      zrEvent?.route?.world ??
      formatZwiftWorld(publicEvent?.worldId) ??
      null,
    distanceKm:
      eventDistanceMeters !== undefined ? roundTo(eventDistanceMeters / 1000, 2) : null,
    elevationM: zrEvent?.elevation ?? null,
    penSystem,
    pens: pens.map((p) => ({
      category: p.category ?? null,
      subgroupId: p.subgroupId,
      label: p.label,
    })),
    selectedPen: selectedPen
      ? {
          category: selectedPen.category ?? null,
          subgroupId: selectedPen.subgroupId,
          label: selectedPen.label,
        }
      : null,
    sof: resolvePenSof(zrPen) ?? null,
    totalFinishers: standings.length,
    offset,
    returned: page.length,
    hasMore: offset + page.length < standings.length,
    myResult: myRow ? formatRow(myRow) : null,
    standings: page.map(formatRow),
  };
}

async function handleGetIntervals(args: Record<string, unknown>, session: McpSession) {
  const activityId = parseNumericIdArg(args.activityId, 'activityId');
  const mode = args.mode === undefined ? 'auto' : args.mode;
  if (mode !== 'auto' && mode !== 'laps' && mode !== 'efforts') {
    throw new McpToolError('mode must be one of: auto, laps, efforts.');
  }
  const minEffortSec = parseBoundedInt(args.minEffortSec, 30, 10, 600, 'minEffortSec');

  const meta = await fetchAuthorizedActivityMeta(session, activityId);
  let weightKg = resolveActivityWeightKg(meta);
  let ftpW = finitePositive(meta.profileFtp);

  if (weightKg === undefined || ftpW === undefined) {
    const me = await withZwiftAuthRetry(session, (token) => fetchZwiftMeProfile(token));
    if (me.ok && me.profile) {
      weightKg = weightKg ?? resolveActivityWeightKg(meta, me.profile);
      ftpW = ftpW ?? finitePositive(me.profile.ftp);
    }
  }

  const telemetry = await loadActivityTelemetryWithFallback(session, meta, weightKg);
  const summary = summarizeTelemetrySamples(telemetry.samples, weightKg);
  const laps = telemetry.laps ?? [];

  const includeLaps = mode === 'laps' || (mode === 'auto' && laps.length > 0);
  const includeEfforts =
    mode === 'efforts' || (mode === 'auto' && laps.length <= 1);

  const thresholdWUsed = ftpW ? Math.round(ftpW * 0.95) : undefined;
  const detectedEfforts = includeEfforts
    ? detectPowerIntervals(telemetry.samples, {
        thresholdW: thresholdWUsed,
        weightKg,
        minEffortSec,
      })
    : [];

  return {
    activityId,
    title:
      typeof meta.name === 'string' && meta.name.trim()
        ? meta.name.trim()
        : `Zwift Activity ${activityId}`,
    source: telemetry.source,
    mode,
    ftpW: ftpW ? Math.round(ftpW) : null,
    weightKg: weightKg ?? null,
    thresholdWUsed:
      thresholdWUsed ??
      (summary.avgPowerW ? Math.max(100, Math.round(summary.avgPowerW * 1.12)) : null),
    summary,
    ...(includeLaps ? { laps } : {}),
    detectedEfforts,
  };
}

export async function executeMcpTool(
  name: string,
  rawArgs: unknown,
  session: McpSession,
): Promise<unknown> {
  const args = asRecord(rawArgs);
  switch (name) {
    case 'get_activities':
      return handleGetActivities(args, session);
    case 'get_activity_detail':
      return handleGetActivityDetail(args, session);
    case 'get_activity_stream':
      return handleGetActivityStream(args, session);
    case 'get_power_curve':
      return handleGetPowerCurve(args, session);
    case 'get_race_results':
      return handleGetRaceResults(args, session);
    case 'get_intervals':
      return handleGetIntervals(args, session);
    default:
      throw new McpToolError(`Unknown tool "${name}".`);
  }
}
