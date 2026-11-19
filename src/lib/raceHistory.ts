import type {
  ZwiftActivity,
  ZwiftActivityDetail,
  ZwiftEventSubgroup,
  ZwiftRaceResultEntry,
} from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRaceEntry } from '../api/zwiftRacing';
import { formatDurationMs } from './units';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: T };

export function zpVal(v: unknown): string | number | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  return String(raw);
}

export function zpNum(v: unknown): number | undefined {
  const val = zpVal(v);
  if (val === undefined) return undefined;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : undefined;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return 'Unknown date';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatUnixSeconds(sec: number | undefined): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return 'Unknown date';
  return new Date(sec * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatGapSeconds(gap: number | undefined): string {
  if (gap === undefined || gap === null || !Number.isFinite(gap)) return '—';
  if (gap === 0) return '0.0s';
  if (gap < 60) return `+${gap.toFixed(1)}s`;
  return `+${formatDurationMs(gap * 1000)}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(input: string | undefined): string {
  if (!input) return '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const cp = parseInt(entity.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
    }
    if (entity.startsWith('#')) {
      const cp = parseInt(entity.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
    }
    return NAMED_HTML_ENTITIES[entity] ?? full;
  });
}

const ZP_DIV_TO_CATEGORY: Record<number, string> = {
  5: 'A+',
  10: 'A',
  20: 'B',
  30: 'C',
  40: 'D',
  50: 'E',
};

export function zwiftPowerDivToCategory(div: unknown): string | undefined {
  const num = typeof div === 'number' ? div : Number(div);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return ZP_DIV_TO_CATEGORY[num];
}

export function formatZpRiderCategory(
  div: unknown,
  divw: unknown,
  male?: number,
): string | undefined {
  const open = zwiftPowerDivToCategory(div);
  const women = zwiftPowerDivToCategory(divw);
  if (male === 0 && women) {
    return open && open !== women ? `${women} (W) / ${open}` : `${women} (W)`;
  }
  return open ?? women;
}

function finiteNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function extractCoreZrs(entry: ZwiftRaceResultEntry | undefined): {
  score?: number;
  previousScore?: number;
  delta?: number;
  changeType?: string;
  hasEventScore: boolean;
} {
  if (!entry) return { hasEventScore: false };
  const profileRec = entry.profileData as Record<string, unknown> | undefined;
  const activityRec = entry.activityData as Record<string, unknown> | undefined;
  const metricsRec = entry.competitionMetrics as Record<string, unknown> | undefined;
  const rawHistory =
    entry.scoreHistory ??
    profileRec?.scoreHistory ??
    activityRec?.scoreHistory ??
    metricsRec?.scoreHistory;
  const sh = (
    Array.isArray(rawHistory) ? rawHistory[rawHistory.length - 1] : rawHistory
  ) as Record<string, unknown> | undefined;

  const newScore = sh
    ? finiteNum(sh.newScore ?? sh.scoreAfter ?? sh.after ?? sh.score)
    : undefined;
  const previousScore = sh
    ? finiteNum(sh.previousScore ?? sh.prevScore ?? sh.scoreBefore ?? sh.before)
    : undefined;
  const explicitDelta = sh ? finiteNum(sh.delta ?? sh.scoreDelta ?? sh.change) : undefined;
  const changeType =
    sh && typeof sh.scoreChangeType === 'string' && sh.scoreChangeType.trim()
      ? sh.scoreChangeType.trim()
      : undefined;

  const direct = [
    newScore,
    finiteNum(entry.racingScore),
    finiteNum(entry.competitionMetrics?.racingScore),
    finiteNum(entry.profileData?.competitionMetrics?.racingScore),
  ].find((v): v is number => v !== undefined && v > 0);

  const score = direct ?? previousScore;
  const delta =
    newScore != null && previousScore != null ? newScore - previousScore : explicitDelta;
  return {
    score,
    previousScore,
    delta,
    changeType,
    hasEventScore: score != null,
  };
}

export interface ActivityPhoto {
  url: string;
  label: string;
}

function pickUrlFromSnapshot(item: unknown): { url?: string; label?: string } {
  if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
    return { url: item };
  }
  if (!item || typeof item !== 'object') return {};
  const rec = item as Record<string, unknown>;
  const urlKeys = [
    'imageUrl',
    'fullImageUrl',
    'largeImageUrl',
    'url',
    'src',
    'thumbnailUrl',
  ];
  let url: string | undefined;
  for (const key of urlKeys) {
    const candidate = rec[key];
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim())) {
      url = candidate.trim();
      break;
    }
  }
  const milestone =
    typeof rec.milestoneType === 'string'
      ? rec.milestoneType
      : typeof rec.notableMomentType === 'string'
        ? rec.notableMomentType
        : typeof rec.type === 'string'
          ? rec.type
          : undefined;
  return { url, label: milestone };
}

export function extractActivityPhotos(
  activity?: ZwiftActivity,
  detail?: ZwiftActivityDetail,
): ActivityPhoto[] {
  const photos: ActivityPhoto[] = [];
  const seen = new Set<string>();

  function add(url: unknown, label: string) {
    if (typeof url !== 'string') return;
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    photos.push({ url: clean, label });
  }

  add(activity?.primaryImageUrl, 'Primary activity snapshot');
  add(detail?.primaryImageUrl, 'Primary activity snapshot');

  const collections: Array<[unknown, string]> = [
    [detail?.activitySnapshots, 'Activity snapshot'],
    [detail?.snapshots, 'Activity snapshot'],
    [detail?.images, 'Activity photo'],
    [(detail as Record<string, unknown> | undefined)?.activityImages, 'Activity photo'],
    [(detail as Record<string, unknown> | undefined)?.photos, 'Activity photo'],
    [(activity as Record<string, unknown> | undefined)?.activitySnapshots, 'Activity snapshot'],
    [(activity as Record<string, unknown> | undefined)?.snapshots, 'Activity snapshot'],
    [(activity as Record<string, unknown> | undefined)?.images, 'Activity photo'],
  ];

  for (const [list, fallbackLabel] of collections) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const picked = pickUrlFromSnapshot(item);
      if (picked.url) {
        const label = picked.label
          ? `${fallbackLabel} (${picked.label.replace(/_/g, ' ').toLowerCase()})`
          : fallbackLabel;
        add(picked.url, label);
      }
    }
  }

  return photos;
}

const NUMERIC_SUBGROUP_LABELS: Record<number, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'D',
  5: 'E',
};

export function subgroupCategoryLabel(sg: ZwiftEventSubgroup): string | undefined {
  if (typeof sg.subgroupLabel === 'string' && sg.subgroupLabel.trim()) {
    return sg.subgroupLabel.trim().toUpperCase();
  }
  if (typeof sg.label === 'number' && NUMERIC_SUBGROUP_LABELS[sg.label]) {
    return NUMERIC_SUBGROUP_LABELS[sg.label];
  }
  return undefined;
}

export function resolveSubgroupForCategory(
  subgroups: ZwiftEventSubgroup[] | undefined,
  category: string | undefined,
): ZwiftEventSubgroup | undefined {
  if (!subgroups || subgroups.length === 0 || !category) return undefined;
  const norm = category.trim().toUpperCase();
  const base = norm.replace(/\+$/, '');
  return (
    subgroups.find((sg) => subgroupCategoryLabel(sg) === norm) ??
    subgroups.find((sg) => subgroupCategoryLabel(sg) === base) ??
    subgroups.find(
      (sg) =>
        typeof sg.name === 'string' &&
        new RegExp(`\\(${base}\\)|\\bCat\\s*${base}\\b`, 'i').test(sg.name),
    )
  );
}

export function matchActivityForRace(
  activities: ZwiftActivity[],
  opts: { subgroupIds?: number[]; raceDateSec?: number; eventTitle?: string },
): ZwiftActivity | undefined {
  const ids = new Set((opts.subgroupIds ?? []).filter((id) => Number.isFinite(id) && id > 0));
  if (ids.size > 0) {
    const bySubgroup = activities.find(
      (a) => typeof a.eventSubgroupId === 'number' && ids.has(a.eventSubgroupId),
    );
    if (bySubgroup) return bySubgroup;
  }

  if (opts.raceDateSec != null && Number.isFinite(opts.raceDateSec)) {
    const windowMs = 3 * 60 * 60 * 1000;
    const targetMs = opts.raceDateSec * 1000;
    const candidates = activities
      .map((a) => {
        const startMs = a.startDate ? Date.parse(a.startDate) : NaN;
        const endMs = a.endDate ? Date.parse(a.endDate) : NaN;
        const diff = Math.min(
          Number.isFinite(startMs) ? Math.abs(startMs - targetMs) : Infinity,
          Number.isFinite(endMs) ? Math.abs(endMs - targetMs) : Infinity,
        );
        return { activity: a, diff };
      })
      .filter((c) => c.diff <= windowMs)
      .sort((a, b) => {
        const aEvent = a.activity.eventSubgroupId ? 0 : 1;
        const bEvent = b.activity.eventSubgroupId ? 0 : 1;
        if (aEvent !== bEvent) return aEvent - bEvent;
        if (opts.eventTitle) {
          const titleLower = opts.eventTitle.toLowerCase();
          const aMatch = (a.activity.name ?? '').toLowerCase().includes(titleLower) ? 0 : 1;
          const bMatch = (b.activity.name ?? '').toLowerCase().includes(titleLower) ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        return a.diff - b.diff;
      });
    if (candidates[0]) return candidates[0].activity;
  }

  return undefined;
}

/**
 * Activity category across ZwiftPower, ZwiftRacing, and Zwift Core activity feed.
 */
export type ActivityType = 'race' | 'ride' | 'workout' | 'free_ride';

/**
 * One race or activity, merged across ZwiftPower, ZwiftRacing.app, and Zwift Core.
 */
export interface MergedRace {
  key: string;
  eventId: string;
  /** 64-bit safe Zwift activity ID (`id_str`) when matched from the rider's activities. */
  activityId?: string;
  /** Matched or standalone Zwift Core activity payload when available. */
  activity?: ZwiftActivity;
  /** Normalized activity category for filtering & badges. */
  activityType?: ActivityType;
  /** Human-readable activity type badge label (e.g. "Race", "Time Trial", "Group Ride", "Workout", "Free Ride"). */
  activityTypeLabel?: string;
  /** unix seconds */
  date: number | undefined;
  title: string;
  zp?: ZwiftPowerRaceEntry;
  zr?: ZwiftRacingRaceEntry;
  /** Place within category counting every entrant (incl. private/hidden riders), from ZwiftRacing. */
  truePlace?: number;
  /** Total entrants in the category pen (incl. private/hidden riders), from ZwiftRacing. */
  fieldSize?: number;
  /** Category place as ZwiftPower reports it (hidden riders removed). */
  zpPlace?: number;
  /** How many places better ZwiftPower makes the result look (>0 means inflated). */
  placeInflation?: number;
}

const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export function buildZwiftActivityUrl(activityId: string): string {
  return `https://www.zwift.com/activity/${encodeURIComponent(activityId)}`;
}

export function buildZwiftPowerEventUrl(zid: string): string {
  return `https://zwiftpower.com/events.php?zid=${encodeURIComponent(zid)}`;
}

export function buildZwiftRacingEventUrl(eventId: string, subgroupId: string): string {
  return `https://zwiftracing.app/events/${encodeURIComponent(eventId)}/${encodeURIComponent(subgroupId)}`;
}

export function slugifyRouteName(routeName: string): string {
  return routeName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildZwifterBikesRouteUrl(routeName: string): string | undefined {
  const slug = slugifyRouteName(routeName);
  return slug ? `https://zwifterbikes.web.app/route/${encodeURIComponent(slug)}` : undefined;
}

export function buildZwiftToolsBikeComparisonUrl(activityId: string): string {
  return `https://zwifttools.azurewebsites.net/bike-comparison?activity=${encodeURIComponent(activityId)}`;
}

export function buildZwiftToolsRaceReplayUrl(activityId: string): string {
  return `https://zwifttools.azurewebsites.net/race-replay?activity_id=${encodeURIComponent(activityId)}`;
}

function asNumericIdString(val: unknown): string | undefined {
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) return val.trim();
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return String(val);
  return undefined;
}

export function getActivityIdStr(activity: ZwiftActivity | undefined): string | undefined {
  if (!activity) return undefined;
  return asNumericIdString(activity.id_str) ?? asNumericIdString(activity.id);
}

function parseIsoMs(iso: string | undefined): number {
  if (!iso) return NaN;
  const normalized = iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return Date.parse(normalized);
}

function zpNumericVal(v: unknown): number | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

function assignActivityIds(races: MergedRace[], activities: ZwiftActivity[]): Set<string> {
  const usedActivityIds = new Set<string>();
  if (races.length === 0 || activities.length === 0) return usedActivityIds;

  interface CandidateMatch {
    raceIndex: number;
    activityId: string;
    activity: ZwiftActivity;
    score: number;
  }

  const candidates: CandidateMatch[] = [];

  for (let raceIndex = 0; raceIndex < races.length; raceIndex++) {
    const race = races[raceIndex];
    if (race.date == null || !Number.isFinite(race.date)) continue;

    const raceStartMs = race.date * 1000;
    const raceDurSec = zpNumericVal(race.zp?.time) ?? race.zr?.race?.time;
    const raceEndMs =
      raceDurSec != null && raceDurSec > 0 ? raceStartMs + raceDurSec * 1000 : undefined;
    const raceTitleLower = race.title.trim().toLowerCase();

    for (const activity of activities) {
      const activityId = getActivityIdStr(activity);
      if (!activityId) continue;

      const startMs = parseIsoMs(activity.startDate);
      const endMs = parseIsoMs(activity.endDate);
      if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) continue;

      if (Number.isFinite(endMs) && endMs < raceStartMs - CLOCK_TOLERANCE_MS) continue;
      if (raceEndMs != null && Number.isFinite(startMs) && startMs > raceEndMs + CLOCK_TOLERANCE_MS) {
        continue;
      }

      const hasSubgroup =
        typeof activity.eventSubgroupId === 'number' && activity.eventSubgroupId > 0;
      if (!hasSubgroup && Number.isFinite(startMs) && startMs > raceStartMs + 10 * 60_000) {
        continue;
      }

      const diffMs = Number.isFinite(startMs)
        ? Math.abs(startMs - raceStartMs)
        : Math.abs(endMs - (raceEndMs ?? raceStartMs));
      if (diffMs > MATCH_WINDOW_MS) continue;

      const spansRaceStart =
        Number.isFinite(startMs) &&
        Number.isFinite(endMs) &&
        startMs <= raceStartMs + 2 * 60_000 &&
        endMs >= raceStartMs;
      const actTitleLower = (activity.name ?? '').trim().toLowerCase();
      const titleMatch =
        raceTitleLower.length >= 4 &&
        actTitleLower.length >= 4 &&
        (actTitleLower.includes(raceTitleLower) || raceTitleLower.includes(actTitleLower));

      const score =
        (titleMatch ? 0 : 10_000_000_000) +
        (spansRaceStart ? 0 : 1_000_000_000) +
        (hasSubgroup ? 0 : 100_000_000) +
        diffMs;

      candidates.push({ raceIndex, activityId, activity, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const matchedRaces = new Set<number>();
  for (const candidate of candidates) {
    if (matchedRaces.has(candidate.raceIndex) || usedActivityIds.has(candidate.activityId)) {
      continue;
    }
    matchedRaces.add(candidate.raceIndex);
    usedActivityIds.add(candidate.activityId);
    const target = races[candidate.raceIndex];
    target.activityId = candidate.activityId;
    target.activity = candidate.activity;
  }

  return usedActivityIds;
}

export function isRaceEntry(zp?: ZwiftPowerRaceEntry, zr?: ZwiftRacingRaceEntry): boolean {
  if (typeof zr?.event?.type === 'string' && zr.event.type.trim() !== '') {
    return /\b(race|tt|time\s*trial)\b/i.test(zr.event.type);
  }
  if (typeof zp?.f_t === 'string' && zp.f_t.trim() !== '') {
    return /\b(TYPE_RACE|TYPE_TT)\b/i.test(zp.f_t);
  }
  return true;
}

const ZWIFT_WORLD_NAMES: Record<number, string> = {
  1: 'Watopia',
  2: 'Richmond',
  3: 'London',
  4: 'New York',
  5: 'Innsbruck',
  6: 'Bologna',
  7: 'Yorkshire',
  8: 'Crit City',
  9: 'Makuri Islands',
  10: 'France',
  11: 'Paris',
  12: 'Gravel Mountain',
  13: 'Scotland',
};

export function formatZwiftWorld(worldId: number | undefined): string | undefined {
  if (typeof worldId !== 'number' || !Number.isFinite(worldId) || worldId <= 0) return undefined;
  return ZWIFT_WORLD_NAMES[worldId] ?? `World ${worldId}`;
}

export function parseDurationStringMs(duration: string | undefined): number | undefined {
  if (typeof duration !== 'string') return undefined;
  const trimmed = duration.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  if (parts.length === 3) {
    return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000;
  }
  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  return undefined;
}

const STANDALONE_WORKOUT_RE =
  /\b(workout|ftp\s*test|ramp\s*test|zone\s*benchmark|erg\s*mode|sst\b|sweet\s*spot|vo2\s*max|over[- ]?unders?|build\s*me\s*up|ftp\s*builder|za\s*workout|zwift\s*academy\s*workout)\b/i;
const STANDALONE_RACE_RE =
  /\b(race|zrl|wtrl|ttt|itt|time\s*trial|crit(?:erium)?|grand\s*prix|championship|chase\s*race|points\s*race|scratch\s*race|zwift\s*racing\s*league|tiny\s*race)\b/i;
const STANDALONE_RIDE_RE =
  /\b(group\s*ride|fondo|tour\s+de\s+zwift|tour\s+of\s+|stage\s+\d|social\s*ride|coffee\s*ride|recovery\s*ride|meetup|pacer\s*group|robopacer|pace\s*partner)\b/i;

/**
 * Classifies an activity across ZwiftPower, ZwiftRacing, and Zwift Core into
 * a normalized filter category and human-readable badge label.
 */
export function classifyActivity(
  zp?: ZwiftPowerRaceEntry,
  zr?: ZwiftRacingRaceEntry,
  activity?: ZwiftActivity | ZwiftActivityDetail,
): { activityType: ActivityType; activityTypeLabel: string } {
  if (zp || zr) {
    if (
      (typeof zp?.f_t === 'string' && /\bTYPE_WORKOUT\b/i.test(zp.f_t)) ||
      (typeof zr?.event?.type === 'string' && /\bworkout\b/i.test(zr.event.type))
    ) {
      return { activityType: 'workout', activityTypeLabel: 'Workout' };
    }

    if (isRaceEntry(zp, zr)) {
      const title = `${zp?.event_title ?? ''} ${zr?.event?.title ?? ''}`;
      const typeHints = `${zr?.event?.subType ?? ''} ${zr?.event?.type ?? ''} ${zp?.f_t ?? ''}`;
      if (/\bttt\b/i.test(zr?.event?.subType ?? '') || /\b(TTT|Team\s+Time\s+Trial)\b/i.test(title)) {
        return { activityType: 'race', activityTypeLabel: 'TTT' };
      }
      if (/\b(itt|time\s*trial|TYPE_TT)\b/i.test(`${typeHints} ${title}`)) {
        return { activityType: 'race', activityTypeLabel: 'Time Trial' };
      }
      return { activityType: 'race', activityTypeLabel: 'Race' };
    }

    return { activityType: 'ride', activityTypeLabel: 'Group Ride' };
  }

  const activityRecord = activity as Record<string, unknown> | undefined;
  const hasWorkoutMeta = Boolean(
    activityRecord?.workout || activityRecord?.workoutId || activityRecord?.workoutName,
  );
  const name = activity?.name ?? '';
  if (hasWorkoutMeta || STANDALONE_WORKOUT_RE.test(name)) {
    return { activityType: 'workout', activityTypeLabel: 'Workout' };
  }
  if (STANDALONE_RACE_RE.test(name)) {
    if (/\b(ttt|team\s+time\s+trial)\b/i.test(name)) {
      return { activityType: 'race', activityTypeLabel: 'TTT' };
    }
    if (/\b(itt|time\s*trial)\b/i.test(name)) {
      return { activityType: 'race', activityTypeLabel: 'Time Trial' };
    }
    return { activityType: 'race', activityTypeLabel: 'Race' };
  }
  const hasEventSubgroup =
    typeof activity?.eventSubgroupId === 'number' && activity.eventSubgroupId > 0;
  const hasClubId = typeof activity?.clubId === 'string' && activity.clubId.trim() !== '';
  if (hasEventSubgroup || hasClubId || STANDALONE_RIDE_RE.test(name)) {
    return { activityType: 'ride', activityTypeLabel: 'Group Ride' };
  }

  const isRunning = activity?.sport?.toUpperCase() === 'RUNNING';
  return {
    activityType: 'free_ride',
    activityTypeLabel: isRunning ? 'Run' : 'Free Ride',
  };
}

function dedupeActivities(activities: ZwiftActivity[]): ZwiftActivity[] {
  const seen = new Set<string>();
  const deduped: ZwiftActivity[] = [];
  for (const activity of activities) {
    const id = getActivityIdStr(activity);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(activity);
  }
  return deduped;
}

/**
 * Merges all rider activities across ZwiftPower (races, TTs, group rides, workouts),
 * ZwiftRacing.app, and standalone Zwift Core activity feed items, newest first.
 */
export function mergeActivities(
  zpRaces: ZwiftPowerRaceEntry[],
  zrRaces: ZwiftRacingRaceEntry[],
  activities: ZwiftActivity[] = [],
): MergedRace[] {
  const zrById = new Map<string, ZwiftRacingRaceEntry>();
  for (const zr of zrRaces) {
    const id = zr.event?.eventId;
    if (id) zrById.set(String(id), zr);
  }
  const used = new Set<string>();
  const merged: MergedRace[] = [];

  for (const zp of zpRaces) {
    const eventId = String(zp.zid ?? '');
    const zr = eventId ? zrById.get(eventId) : undefined;
    if (zr) used.add(eventId);
    merged.push(build(eventId, zp, zr, `zp-${zp.res_id ?? zp.uid ?? eventId}-${merged.length}`));
  }

  // Events ZwiftRacing knows about that ZwiftPower doesn't list.
  for (const [eventId, zr] of zrById) {
    if (!used.has(eventId)) {
      merged.push(build(eventId, undefined, zr, `zr-${eventId}`));
    }
  }

  const dedupedActivities = dedupeActivities(activities);
  const usedActivityIds = assignActivityIds(merged, dedupedActivities);

  for (const activity of dedupedActivities) {
    const activityId = getActivityIdStr(activity);
    if (!activityId || usedActivityIds.has(activityId)) continue;

    const startMs = parseIsoMs(activity.startDate);
    const endMs = parseIsoMs(activity.endDate);
    const dateSec = Number.isFinite(startMs)
      ? Math.floor(startMs / 1000)
      : Number.isFinite(endMs)
        ? Math.floor(endMs / 1000)
        : undefined;
    const { activityType, activityTypeLabel } = classifyActivity(undefined, undefined, activity);

    merged.push({
      key: `act-${activityId}`,
      eventId: '',
      activityId,
      activity,
      activityType,
      activityTypeLabel,
      date: dateSec,
      title: decodeHtmlEntities(activity.name?.trim()) || 'Zwift Activity',
    });
  }

  merged.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return merged;
}

/**
 * Merges race-only entries from ZwiftPower and ZwiftRacing (preserving head-to-head
 * semantics while still linking matching Zwift Core `activityId` values).
 */
export function mergeRaces(
  zpRaces: ZwiftPowerRaceEntry[],
  zrRaces: ZwiftRacingRaceEntry[],
  activities: ZwiftActivity[] = [],
): MergedRace[] {
  return mergeActivities(zpRaces, zrRaces, activities).filter(
    (entry) => Boolean(entry.zp || entry.zr) && isRaceEntry(entry.zp, entry.zr),
  );
}

function build(
  eventId: string,
  zp: ZwiftPowerRaceEntry | undefined,
  zr: ZwiftRacingRaceEntry | undefined,
  key: string,
): MergedRace {
  const truePlace = zr?.place?.positionInCategory;
  const fieldSize = zr?.place?.penTotal;
  const zpPlace = typeof zp?.position_in_cat === 'number' ? zp.position_in_cat : undefined;
  const placeInflation =
    truePlace != null && zpPlace != null ? truePlace - zpPlace : undefined;
  const { activityType, activityTypeLabel } = classifyActivity(zp, zr);
  return {
    key,
    eventId,
    activityType,
    activityTypeLabel,
    date: zp?.event_date ?? zr?.event?.time,
    title:
      decodeHtmlEntities(zp?.event_title || zr?.event?.title) ||
      (activityType === 'race' ? 'Untitled race' : 'Untitled event'),
    zp,
    zr,
    truePlace,
    fieldSize,
    zpPlace,
    placeInflation,
  };
}

export function isPodium(place: number | undefined): boolean {
  return place != null && place >= 1 && place <= 3;
}

export interface MergedSummary {
  total: number;
  enriched: number;
  /** podiums per ZwiftPower category place, among enriched races */
  zpPodiums: number;
  /** podiums per true (ZwiftRacing) place, among enriched races */
  truePodiums: number;
  /** enriched races where ZwiftPower overstates the placing */
  inflatedRaces: number;
}

export function summarize(races: MergedRace[]): MergedSummary {
  const enriched = races.filter((r) => r.truePlace != null && r.zpPlace != null);
  return {
    total: races.length,
    enriched: enriched.length,
    zpPodiums: enriched.filter((r) => isPodium(r.zpPlace)).length,
    truePodiums: enriched.filter((r) => isPodium(r.truePlace)).length,
    inflatedRaces: enriched.filter((r) => (r.placeInflation ?? 0) > 0).length,
  };
}
