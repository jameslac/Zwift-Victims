import type { ZwiftEventSubgroup, ZwiftPublicEvent } from '../api/zwiftCore';
import type { ZwiftPowerEventListItem } from '../api/zwiftPower';
import type { ZwiftRacingUpcomingEvent } from '../api/zwiftRacing';
import type { FavoriteRider } from './FavoritesContext';
import { decodeHtmlEntities, formatZwiftWorld, subgroupCategoryLabel } from './raceHistory';
import { lookupZwiftRoute } from './zwiftRoutes';

export type EventWindowDays = 1 | 3 | 7;
export type CalendarEventType = 'race' | 'tt' | 'ride' | 'workout' | 'run';
export type CalendarTerrain = 'flat' | 'hilly' | 'mountain';
export type DistanceBucket = 'all' | 'short' | 'medium' | 'long' | 'timed';
export type TimeOfDayBucket = 'all' | 'morning' | 'afternoon' | 'evening' | 'late_night';
export type CalendarSortKey = 'start' | 'signups' | 'shortest' | 'longest' | 'climbing';

export interface CalendarEventPen {
  label: string;
  signups: number;
}

export interface CalendarEvent {
  eventId: string;
  title: string;
  startSec: number;
  eventType: CalendarEventType;
  eventTypeLabel: string;
  subType?: string;
  world?: string;
  routeId?: string;
  routeName?: string;
  laps?: number;
  distanceKm?: number;
  elevationM?: number;
  durationSec?: number;
  terrain?: CalendarTerrain;
  pens: CalendarEventPen[];
  totalSignups: number;
  staggeredStart: boolean;
  womensOnly: boolean;
  organizer?: string;
  imageUrl?: string;
  badges: string[];
  dominantTerrainFactor?: string;
  hasZwiftRacing: boolean;
  hasZwiftPower: boolean;
}

export interface CalendarFilters {
  query: string;
  type: 'all' | CalendarEventType;
  victimsOnly: boolean;
  mySignupsOnly: boolean;
  womensOnly: boolean;
  minSignups: 0 | 5 | 20 | 50;
  world: string;
  terrain: 'all' | CalendarTerrain;
  categoryPen: string;
  distanceBucket: DistanceBucket;
  timeOfDay: TimeOfDayBucket;
  sortBy: CalendarSortKey;
}

export const DEFAULT_CALENDAR_FILTERS: CalendarFilters = {
  query: '',
  type: 'all',
  victimsOnly: false,
  mySignupsOnly: false,
  womensOnly: false,
  minSignups: 0,
  world: 'all',
  terrain: 'all',
  categoryPen: 'all',
  distanceBucket: 'all',
  timeOfDay: 'all',
  sortBy: 'start',
};

export interface VictimInEvent {
  rider: FavoriteRider;
  pen?: string;
}

const LIVE_EVENT_GRACE_SEC = 15 * 60;

const ZP_WORLD_TAG_MAP: Record<string, string> = {
  WORLD_WATOPIA: 'Watopia',
  WORLD_RICHMOND: 'Richmond',
  WORLD_LONDON: 'London',
  WORLD_NEWYORK: 'New York',
  WORLD_INNSBRUCK: 'Innsbruck',
  WORLD_BOL: 'Bologna',
  WORLD_BOLOGNA: 'Bologna',
  WORLD_YORKSHIRE: 'Yorkshire',
  WORLD_CRITCITY: 'Crit City',
  WORLD_MAKURI: 'Makuri Islands',
  WORLD_MAKURIISLANDS: 'Makuri Islands',
  WORLD_FRANCE: 'France',
  WORLD_PARIS: 'Paris',
  WORLD_GRAVELMOUNTAIN: 'Gravel Mountain',
  WORLD_SCOTLAND: 'Scotland',
};

const NUMERIC_PEN_LABELS: Record<number, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'D',
  5: 'E',
};

const FACTOR_LABELS: Record<string, string> = {
  sprint: 'Sprint',
  punch: 'Punchy',
  pursuit: 'Pursuit',
  climb: 'Climber',
  timeTrial: 'Time Trial',
  endurance: 'Endurance',
};

const CORE_RULE_LABELS: Record<string, string> = {
  NO_DRAFTING: 'No Drafting',
  NO_POWERUPS: 'No Power-Ups',
  NO_TT_BIKES: 'No TT Bikes',
  ALLOWS_LATE_JOIN: 'Late Join',
  ENFORCE_HRM: 'HR Monitor Required',
  ENFORCE_NO_ZPOWER: 'Power Meter Required',
  SHOW_RACE_RESULTS: 'Race Results',
  RUBBERBANDING: 'Keep Together',
  LADIES_ONLY: 'Women Only',
  DISABLE_STEERING: 'No Steering',
};

export function buildZwiftCompanionEventUrl(eventId: string | number): string {
  return `https://www.zwift.com/events/view/${encodeURIComponent(String(eventId))}`;
}

export function penLabelFromNumber(label: unknown): string | undefined {
  const num = typeof label === 'number' ? label : Number(String(label ?? '').trim());
  if (!Number.isInteger(num) || num <= 0) return undefined;
  return NUMERIC_PEN_LABELS[num];
}

function finiteNum(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function positiveNum(value: unknown): number | undefined {
  const num = finiteNum(value);
  return num !== undefined && num > 0 ? num : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const num = finiteNum(value);
  if (num === undefined || num <= 0) return undefined;
  return Math.round(num);
}

function cleanStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parsePensFromStrings(
  zpCats?: string,
  zpSignups?: string,
  zrCats?: string,
  zrSignups?: string,
): CalendarEventPen[] {
  const penOrder: string[] = [];
  const counts = new Map<string, number>();

  function ingest(catsRaw?: string, signupsRaw?: string) {
    if (!catsRaw) return;
    const cats = catsRaw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const nums = (signupsRaw ?? '')
      .split(',')
      .map((s) => Math.max(0, Math.round(Number(s.trim()) || 0)));

    cats.forEach((label, idx) => {
      if (!counts.has(label)) {
        penOrder.push(label);
        counts.set(label, 0);
      }
      const nextCount = nums[idx] ?? 0;
      counts.set(label, Math.max(counts.get(label) ?? 0, nextCount));
    });
  }

  ingest(zpCats, zpSignups);
  ingest(zrCats, zrSignups);

  return penOrder.map((label) => ({
    label,
    signups: counts.get(label) ?? 0,
  }));
}

function deriveTerrain(
  distanceKm: number | undefined,
  elevationM: number | undefined,
  zpRouteTag?: string,
): CalendarTerrain | undefined {
  if (
    distanceKm !== undefined &&
    distanceKm > 0 &&
    elevationM !== undefined &&
    elevationM >= 0
  ) {
    const mPerKm = elevationM / distanceKm;
    if (mPerKm >= 18) return 'mountain';
    if (mPerKm >= 9) return 'hilly';
    return 'flat';
  }
  const tag = zpRouteTag?.trim().toUpperCase();
  if (tag === 'ROUTE_HILLY') return 'hilly';
  if (tag === 'ROUTE_MOUNTAIN') return 'mountain';
  if (tag === 'ROUTE_FLAT') return 'flat';
  return undefined;
}

function extractDominantFactor(factorWeights: Record<string, unknown> | undefined): string | undefined {
  if (!factorWeights) return undefined;
  let bestKey: string | undefined;
  let bestVal = 0;
  for (const [key, raw] of Object.entries(factorWeights)) {
    if (!(key in FACTOR_LABELS)) continue;
    const val = finiteNum(raw);
    if (val !== undefined && val > bestVal) {
      bestVal = val;
      bestKey = key;
    }
  }
  if (!bestKey || bestVal < 0.3) return undefined;
  return FACTOR_LABELS[bestKey];
}

function classifyZpEvent(
  zp: ZwiftPowerEventListItem,
  title: string,
  zr?: ZwiftRacingUpcomingEvent,
): { eventType: CalendarEventType; eventTypeLabel: string; womensOnly: boolean } {
  const ft = typeof zp.f_t === 'string' ? zp.f_t : '';
  const rtype = typeof zp.rtype === 'string' ? zp.rtype.toLowerCase() : '';
  const zrType = typeof zr?.type === 'string' ? zr.type : '';
  const zrSub = typeof zr?.subType === 'string' ? zr.subType : '';

  const womensOnly =
    /\bTYPE_WOMENS\b/i.test(ft) || /\bwomen(?:'s|s)?\b|\blad(?:y|ies)\b/i.test(title);

  if (/\bTYPE_RUN\b/i.test(ft) || rtype === 'run' || /\brun\b/i.test(zrType)) {
    return { eventType: 'run', eventTypeLabel: 'Run', womensOnly };
  }
  if (/\bTYPE_WORKOUT\b/i.test(ft) || rtype === 'workout' || /\bworkout\b/i.test(zrType)) {
    return { eventType: 'workout', eventTypeLabel: 'Workout', womensOnly };
  }
  if (
    /\bTYPE_TEAM_TIME_TRIAL\b/i.test(ft) ||
    /\bttt\b/i.test(zrSub) ||
    /\b(ttt|team\s+time\s+trial)\b/i.test(title)
  ) {
    return { eventType: 'tt', eventTypeLabel: 'TTT', womensOnly };
  }
  if (
    /\bTYPE_TIME_TRIAL\b/i.test(ft) ||
    rtype === 'time_trial' ||
    /\b(itt|time\s*trial)\b/i.test(`${zrSub} ${title}`)
  ) {
    return { eventType: 'tt', eventTypeLabel: 'Time Trial', womensOnly };
  }
  if (
    /\bTYPE_RACE\b/i.test(ft) ||
    rtype === 'road_race' ||
    /\brace\b/i.test(zrType)
  ) {
    return { eventType: 'race', eventTypeLabel: 'Race', womensOnly };
  }
  return { eventType: 'ride', eventTypeLabel: 'Group Ride', womensOnly };
}

function buildRuleBadges(options: {
  staggeredStart: boolean;
  womensOnly: boolean;
  zpRuleTag?: string;
}): string[] {
  const badges: string[] = [];
  if (options.womensOnly) badges.push('Women Only');
  if (options.staggeredStart) badges.push('Staggered Start');
  const codes = new Set((options.zpRuleTag ?? '').split(/\s+/).filter(Boolean));
  if (codes.has('R_1')) badges.push('No Drafting');
  if (codes.has('R_4')) badges.push('No Power-Ups');
  if (codes.has('R_7') || codes.has('R_8')) badges.push('Cat Enforced');
  return badges;
}

export function buildLiveRouteMap(
  zrEvents: ZwiftRacingUpcomingEvent[],
): Map<string, { name: string; world?: string }> {
  const map = new Map<string, { name: string; world?: string }>();
  for (const ev of zrEvents) {
    const id = cleanStr(ev.route?.routeId) ?? cleanStr(ev.routeId);
    const name = cleanStr(ev.route?.name);
    if (!id || !name) continue;
    const world = cleanStr(ev.route?.world);
    map.set(id, { name, world });
  }
  return map;
}

export function normalizeZpEventToCalendarEvent(
  zp: ZwiftPowerEventListItem,
  zr?: ZwiftRacingUpcomingEvent,
  liveRouteMap?: Map<string, { name: string; world?: string }>,
): CalendarEvent | null {
  const rawId = zp.zid ?? zp.DT_RowId;
  const eventId = rawId !== undefined && rawId !== null ? String(rawId).trim() : '';
  const startSec = finiteNum(zp.tm) ?? finiteNum(zr?.time);
  if (!eventId || startSec === undefined || startSec <= 0) return null;

  const title =
    decodeHtmlEntities(cleanStr(zp.t) ?? cleanStr(zr?.title)) || `Event #${eventId}`;
  const { eventType, eventTypeLabel, womensOnly } = classifyZpEvent(zp, title, zr);

  const routeId =
    cleanStr(zp.rt !== undefined && zp.rt !== null ? String(zp.rt) : undefined) ??
    cleanStr(zr?.route?.routeId) ??
    cleanStr(zr?.routeId);
  const staticRoute = lookupZwiftRoute(routeId);
  const liveRoute = routeId ? liveRouteMap?.get(routeId) : undefined;

  const laps = positiveInt(zp.laps) ?? positiveInt(zr?.numLaps);
  const routeName = cleanStr(zr?.route?.name) ?? liveRoute?.name ?? staticRoute?.name;

  const worldIdNum = positiveInt(zp.w);
  const zpWorldTag = cleanStr(zp.f_w)?.toUpperCase();
  const world =
    cleanStr(zr?.route?.world) ??
    formatZwiftWorld(worldIdNum) ??
    (zpWorldTag ? ZP_WORLD_TAG_MAP[zpWorldTag] : undefined) ??
    liveRoute?.world ??
    staticRoute?.world;

  // ZwiftPower event list `km` field is reported in METERS (e.g. 18123 = 18.123 km).
  const zpMeters = positiveNum(zp.km);
  const zpDistanceKm = zpMeters !== undefined ? zpMeters / 1000 : undefined;
  const zrDistanceKm = positiveNum(zr?.distance);
  const staticDistanceKm =
    staticRoute && staticRoute.distanceKm > 0
      ? staticRoute.distanceKm * (laps ?? 1)
      : undefined;
  const distanceKm = zpDistanceKm ?? zrDistanceKm ?? staticDistanceKm;

  const zrElevationM = finiteNum(zr?.elevation);
  const elevationM =
    zrElevationM !== undefined && zrElevationM >= 0
      ? Math.round(zrElevationM)
      : staticRoute && staticRoute.elevationM >= 0
        ? Math.round(staticRoute.elevationM * (laps ?? 1))
        : undefined;

  const durationSec = positiveNum(zp.dur);
  const terrain = deriveTerrain(distanceKm, elevationM, cleanStr(zp.f_r));
  const pens = parsePensFromStrings(
    cleanStr(zp.cats),
    cleanStr(zp.signups),
    cleanStr(zr?.categories),
    cleanStr(zr?.signups),
  );
  const totalSignups = pens.reduce((sum, pen) => sum + pen.signups, 0);
  const staggeredStart = zp.stag === 1 || zr?.staggeredStart === true;

  return {
    eventId,
    title,
    startSec,
    eventType,
    eventTypeLabel,
    subType: cleanStr(zr?.subType),
    world,
    routeId,
    routeName,
    laps,
    distanceKm,
    elevationM,
    durationSec,
    terrain,
    pens,
    totalSignups,
    staggeredStart,
    womensOnly,
    organizer: cleanStr(zp.rid),
    imageUrl: cleanStr(zr?.imageUrl),
    badges: buildRuleBadges({
      staggeredStart,
      womensOnly,
      zpRuleTag: cleanStr(zp.f_ru),
    }),
    dominantTerrainFactor: extractDominantFactor(zr?.velo?.factorWeights),
    hasZwiftRacing: Boolean(zr),
    hasZwiftPower: true,
  };
}

function normalizeZrOnlyEvent(zr: ZwiftRacingUpcomingEvent): CalendarEvent | null {
  const eventId = cleanStr(zr.eventId);
  const startSec = finiteNum(zr.time);
  if (!eventId || startSec === undefined || startSec <= 0) return null;

  const title = decodeHtmlEntities(cleanStr(zr.title)) || `Event #${eventId}`;
  const zrType = cleanStr(zr.type) ?? '';
  const zrSub = cleanStr(zr.subType) ?? '';
  const womensOnly = /\bwomen(?:'s|s)?\b|\blad(?:y|ies)\b/i.test(title);

  let eventType: CalendarEventType = 'race';
  let eventTypeLabel = 'Race';
  if (/\brun\b/i.test(zrType)) {
    eventType = 'run';
    eventTypeLabel = 'Run';
  } else if (/\bworkout\b/i.test(zrType)) {
    eventType = 'workout';
    eventTypeLabel = 'Workout';
  } else if (/\bttt\b/i.test(zrSub) || /\b(ttt|team\s+time\s+trial)\b/i.test(title)) {
    eventType = 'tt';
    eventTypeLabel = 'TTT';
  } else if (/\b(itt|time\s*trial)\b/i.test(`${zrSub} ${title}`)) {
    eventType = 'tt';
    eventTypeLabel = 'Time Trial';
  } else if (/\bride\b/i.test(zrType)) {
    eventType = 'ride';
    eventTypeLabel = 'Group Ride';
  }

  const routeId = cleanStr(zr.route?.routeId) ?? cleanStr(zr.routeId);
  const staticRoute = lookupZwiftRoute(routeId);
  const laps = positiveInt(zr.numLaps);
  const distanceKm = positiveNum(zr.distance) ?? (staticRoute ? staticRoute.distanceKm * (laps ?? 1) : undefined);
  const zrElev = finiteNum(zr.elevation);
  const elevationM =
    zrElev !== undefined && zrElev >= 0
      ? Math.round(zrElev)
      : staticRoute
        ? Math.round(staticRoute.elevationM * (laps ?? 1))
        : undefined;
  const pens = parsePensFromStrings(undefined, undefined, cleanStr(zr.categories), cleanStr(zr.signups));
  const totalSignups = pens.reduce((sum, p) => sum + p.signups, 0);
  const staggeredStart = zr.staggeredStart === true;

  return {
    eventId,
    title,
    startSec,
    eventType,
    eventTypeLabel,
    subType: zrSub || undefined,
    world: cleanStr(zr.route?.world) ?? staticRoute?.world,
    routeId,
    routeName: cleanStr(zr.route?.name) ?? staticRoute?.name,
    laps,
    distanceKm,
    elevationM,
    terrain: deriveTerrain(distanceKm, elevationM),
    pens,
    totalSignups,
    staggeredStart,
    womensOnly,
    imageUrl: cleanStr(zr.imageUrl),
    badges: buildRuleBadges({ staggeredStart, womensOnly }),
    dominantTerrainFactor: extractDominantFactor(zr.velo?.factorWeights),
    hasZwiftRacing: true,
    hasZwiftPower: false,
  };
}

export function mergeCalendarEvents(
  zpEvents: ZwiftPowerEventListItem[],
  zrEvents: ZwiftRacingUpcomingEvent[],
  nowMs = Date.now(),
): CalendarEvent[] {
  const cutoffSec = Math.floor(nowMs / 1000) - LIVE_EVENT_GRACE_SEC;
  const liveRouteMap = buildLiveRouteMap(zrEvents);
  const zrById = new Map<string, ZwiftRacingUpcomingEvent>();
  for (const zr of zrEvents) {
    const id = cleanStr(zr.eventId);
    if (id) zrById.set(id, zr);
  }

  const byId = new Map<string, CalendarEvent>();
  for (const zp of zpEvents) {
    const id = cleanStr(zp.zid !== undefined && zp.zid !== null ? String(zp.zid) : zp.DT_RowId);
    const zr = id ? zrById.get(id) : undefined;
    const normalized = normalizeZpEventToCalendarEvent(zp, zr, liveRouteMap);
    if (!normalized || normalized.startSec < cutoffSec) continue;
    if (!byId.has(normalized.eventId)) {
      byId.set(normalized.eventId, normalized);
    }
  }

  for (const zr of zrEvents) {
    const normalized = normalizeZrOnlyEvent(zr);
    if (!normalized || normalized.startSec < cutoffSec) continue;
    if (!byId.has(normalized.eventId)) {
      byId.set(normalized.eventId, normalized);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.startSec - b.startSec);
}

export function normalizeCoreUpcomingEvents(
  coreEvents: ZwiftPublicEvent[],
  zrEvents: ZwiftRacingUpcomingEvent[] = [],
  nowMs = Date.now(),
): CalendarEvent[] {
  const cutoffSec = Math.floor(nowMs / 1000) - LIVE_EVENT_GRACE_SEC;
  const liveRouteMap = buildLiveRouteMap(zrEvents);
  const zrById = new Map<string, ZwiftRacingUpcomingEvent>();
  for (const zr of zrEvents) {
    const id = cleanStr(zr.eventId);
    if (id) zrById.set(id, zr);
  }

  const byId = new Map<string, CalendarEvent>();
  for (const ev of coreEvents) {
    if (typeof ev.id !== 'number' || !Number.isFinite(ev.id)) continue;
    const eventId = String(ev.id);
    if (byId.has(eventId)) continue;
    const startMs = ev.eventStart ? Date.parse(ev.eventStart.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN;
    if (!Number.isFinite(startMs)) continue;
    const startSec = Math.floor(startMs / 1000);
    if (startSec < cutoffSec) continue;

    const zr = zrById.get(eventId);
    const title = decodeHtmlEntities(cleanStr(ev.name) ?? cleanStr(zr?.title)) || `Event #${eventId}`;
    const sport = cleanStr(ev.sport)?.toUpperCase();
    const rawType = cleanStr(ev.eventType)?.toUpperCase();
    const womensOnly =
      /\bwomen(?:'s|s)?\b|\blad(?:y|ies)\b/i.test(title) ||
      Boolean(ev.rulesSet?.includes('LADIES_ONLY'));

    let eventType: CalendarEventType = 'ride';
    let eventTypeLabel = 'Group Ride';
    if (sport === 'RUNNING') {
      eventType = 'run';
      eventTypeLabel = 'Run';
    } else if (rawType === 'WORKOUT') {
      eventType = 'workout';
      eventTypeLabel = 'Workout';
    } else if (rawType === 'TEAM_TIME_TRIAL' || /\b(ttt|team\s+time\s+trial)\b/i.test(title)) {
      eventType = 'tt';
      eventTypeLabel = 'TTT';
    } else if (rawType === 'TIME_TRIAL') {
      eventType = 'tt';
      eventTypeLabel = 'Time Trial';
    } else if (rawType === 'RACE') {
      eventType = 'race';
      eventTypeLabel = 'Race';
    }

    const sg0 = ev.eventSubgroups?.[0];
    const routeNum = positiveInt(ev.routeId) ?? positiveInt(sg0?.routeId);
    const routeId = routeNum !== undefined ? String(routeNum) : cleanStr(zr?.routeId);
    const staticRoute = lookupZwiftRoute(routeId);
    const liveRoute = routeId ? liveRouteMap.get(routeId) : undefined;
    const laps = positiveInt(ev.laps) ?? positiveInt(sg0?.laps) ?? positiveInt(zr?.numLaps);

    const meters = positiveNum(ev.distanceInMeters) ?? positiveNum(sg0?.distanceInMeters);
    const distanceKm =
      meters !== undefined
        ? meters / 1000
        : positiveNum(zr?.distance) ?? (staticRoute ? staticRoute.distanceKm * (laps ?? 1) : undefined);
    const durationSec = positiveNum(ev.durationInSeconds) ?? positiveNum(sg0?.durationInSeconds);
    const zrElev = finiteNum(zr?.elevation);
    const elevationM =
      zrElev !== undefined && zrElev >= 0
        ? Math.round(zrElev)
        : staticRoute
          ? Math.round(staticRoute.elevationM * (laps ?? 1))
          : undefined;

    const pens: CalendarEventPen[] = [];
    for (const sg of ev.eventSubgroups ?? []) {
      const label = subgroupCategoryLabel(sg);
      if (!label) continue;
      const count = Math.max(
        0,
        Math.round(finiteNum(sg.totalSignedUpCount) ?? finiteNum(sg.totalEntrantCount) ?? 0),
      );
      pens.push({ label, signups: count });
    }
    const coreTotal = Math.max(
      pens.reduce((sum, p) => sum + p.signups, 0),
      Math.round(finiteNum((ev as Record<string, unknown>).totalSignedUpCount) ?? 0),
    );

    const rules = new Set(ev.rulesSet ?? []);
    const badges: string[] = [];
    if (womensOnly) badges.push('Women Only');
    if (zr?.staggeredStart) badges.push('Staggered Start');
    if (rules.has('NO_DRAFTING')) badges.push('No Drafting');
    if (rules.has('NO_POWERUPS')) badges.push('No Power-Ups');
    if (ev.categoryEnforcement) badges.push('Cat Enforced');

    byId.set(eventId, {
      eventId,
      title,
      startSec,
      eventType,
      eventTypeLabel,
      subType: cleanStr(zr?.subType),
      world:
        cleanStr(zr?.route?.world) ??
        formatZwiftWorld(positiveInt(ev.worldId)) ??
        liveRoute?.world ??
        staticRoute?.world,
      routeId,
      routeName: cleanStr(zr?.route?.name) ?? liveRoute?.name ?? staticRoute?.name,
      laps,
      distanceKm,
      elevationM,
      durationSec,
      terrain: deriveTerrain(distanceKm, elevationM),
      pens,
      totalSignups: coreTotal,
      staggeredStart: Boolean(zr?.staggeredStart),
      womensOnly,
      imageUrl: cleanStr(zr?.imageUrl) ?? cleanStr(ev.imageUrl),
      badges,
      dominantTerrainFactor: extractDominantFactor(zr?.velo?.factorWeights),
      hasZwiftRacing: Boolean(zr),
      hasZwiftPower: false,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.startSec - b.startSec);
}

function matchesTimeOfDay(startSec: number, bucket: TimeOfDayBucket): boolean {
  if (bucket === 'all') return true;
  const hour = new Date(startSec * 1000).getHours();
  switch (bucket) {
    case 'morning':
      return hour >= 5 && hour < 12;
    case 'afternoon':
      return hour >= 12 && hour < 17;
    case 'evening':
      return hour >= 17 && hour < 22;
    case 'late_night':
      return hour >= 22 || hour < 5;
  }
}

function matchesDistanceBucket(ev: CalendarEvent, bucket: DistanceBucket): boolean {
  if (bucket === 'all') return true;
  if (bucket === 'timed') {
    return ev.durationSec !== undefined && ev.durationSec > 0 && ev.distanceKm === undefined;
  }
  if (ev.distanceKm === undefined || ev.distanceKm <= 0) return false;
  switch (bucket) {
    case 'short':
      return ev.distanceKm < 20;
    case 'medium':
      return ev.distanceKm >= 20 && ev.distanceKm <= 40;
    case 'long':
      return ev.distanceKm > 40;
  }
}

export function filterAndSortCalendarEvents(
  events: CalendarEvent[],
  filters: CalendarFilters,
  context: {
    victimsByEventId: Map<string, VictimInEvent[]>;
    mySignedUpEventIds: Set<string>;
  },
): CalendarEvent[] {
  const q = filters.query.trim().toLowerCase();

  const filtered = events.filter((ev) => {
    if (filters.type !== 'all' && ev.eventType !== filters.type) return false;
    const victims = context.victimsByEventId.get(ev.eventId);
    if (filters.victimsOnly && (!victims || victims.length === 0)) return false;
    if (filters.mySignupsOnly && !context.mySignedUpEventIds.has(ev.eventId)) return false;
    if (filters.womensOnly && !ev.womensOnly) return false;
    if (filters.minSignups > 0 && ev.totalSignups < filters.minSignups) return false;
    if (filters.world !== 'all' && ev.world !== filters.world) return false;
    if (filters.terrain !== 'all' && ev.terrain !== filters.terrain) return false;
    if (
      filters.categoryPen !== 'all' &&
      !ev.pens.some((p) => p.label.replace(/\+$/, '') === filters.categoryPen)
    ) {
      return false;
    }
    if (!matchesDistanceBucket(ev, filters.distanceBucket)) return false;
    if (!matchesTimeOfDay(ev.startSec, filters.timeOfDay)) return false;

    if (q) {
      const haystacks = [
        ev.title,
        ev.routeName,
        ev.world,
        ev.organizer,
        ev.eventId,
        ev.subType,
        ev.eventTypeLabel,
        ...(victims?.map((v) => v.rider.name) ?? []),
      ];
      if (!haystacks.some((val) => typeof val === 'string' && val.toLowerCase().includes(q))) {
        return false;
      }
    }

    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (filters.sortBy) {
      case 'signups':
        return b.totalSignups - a.totalSignups || a.startSec - b.startSec;
      case 'shortest':
        return (
          (a.distanceKm ?? Number.POSITIVE_INFINITY) -
            (b.distanceKm ?? Number.POSITIVE_INFINITY) || a.startSec - b.startSec
        );
      case 'longest':
        return (b.distanceKm ?? -1) - (a.distanceKm ?? -1) || a.startSec - b.startSec;
      case 'climbing':
        return (b.elevationM ?? -1) - (a.elevationM ?? -1) || a.startSec - b.startSec;
      case 'start':
      default:
        return a.startSec - b.startSec;
    }
  });

  return sorted;
}

export function formatEventClockTime(startSec: number): string {
  return new Date(startSec * 1000).toLocaleTimeString(undefined, { timeStyle: 'short' });
}

export function formatEventDateTimeShort(startSec: number): string {
  return new Date(startSec * 1000).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatEventCountdown(startSec: number, nowMs = Date.now()): string {
  const diffSec = startSec - Math.floor(nowMs / 1000);
  if (diffSec <= 0 && diffSec >= -LIVE_EVENT_GRACE_SEC) return 'Live';
  if (diffSec < -LIVE_EVENT_GRACE_SEC) return 'Started';
  if (diffSec < 60) return 'In <1m';
  const totalMinutes = Math.floor(diffSec / 60);
  if (totalMinutes < 60) return `In ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `In ${hours}h ${mins}m` : `In ${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `In ${days}d ${remHours}h` : `In ${days}d`;
}

export function getLocalDayKey(startSec: number): string {
  const d = new Date(startSec * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLocalDayHeading(dayKey: string, nowMs = Date.now()): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1);
  const formatted = target.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const today = new Date(nowMs);
  const todayKey = getLocalDayKey(Math.floor(today.getTime() / 1000));
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const tomorrowKey = getLocalDayKey(Math.floor(tomorrow.getTime() / 1000));

  if (dayKey === todayKey) return `Today — ${formatted}`;
  if (dayKey === tomorrowKey) return `Tomorrow — ${formatted}`;
  return formatted;
}

export function formatDurationSecondsCompact(sec: number | undefined): string | undefined {
  if (sec === undefined || sec <= 0 || !Number.isFinite(sec)) return undefined;
  const totalMins = Math.round(sec / 60);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${totalMins}m`;
}

export function formatCoreRuleLabel(rule: string): string {
  const trimmed = rule.trim().toUpperCase();
  if (CORE_RULE_LABELS[trimmed]) return CORE_RULE_LABELS[trimmed];
  return trimmed
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatSubgroupPaceRange(sg: ZwiftEventSubgroup): string | undefined {
  const explicit = cleanStr(sg.rangeAccessLabel);
  if (explicit) return explicit;
  const from = finiteNum(sg.fromPaceValue);
  const to = finiteNum(sg.toPaceValue);
  if (from === undefined && to === undefined) return undefined;
  const isWkg = sg.paceType === 1;
  const suffix = isWkg ? ' W/kg' : '';
  if (from !== undefined && to !== undefined) {
    if (from === 0 && to === 0) return undefined;
    return `${from.toFixed(1)}–${to.toFixed(1)}${suffix}`;
  }
  const single = from ?? to;
  return single !== undefined ? `${single.toFixed(1)}${suffix}` : undefined;
}
