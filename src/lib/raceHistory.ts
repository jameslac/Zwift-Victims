import type { ZwiftActivity } from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRaceEntry } from '../api/zwiftRacing';

/**
 * One race, merged across sources. ZwiftPower is the primary race list;
 * ZwiftRacing.app enriches by matching ZwiftPower `zid` to ZwiftRacing `event.eventId`.
 */
export interface MergedRace {
  key: string;
  eventId: string;
  /** 64-bit safe Zwift activity ID (`id_str`) when matched from the rider's activities. */
  activityId?: string;
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

function assignActivityIds(races: MergedRace[], activities: ZwiftActivity[]): void {
  if (races.length === 0 || activities.length === 0) return;

  interface CandidateMatch {
    raceIndex: number;
    activityId: string;
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

      candidates.push({ raceIndex, activityId, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const matchedRaces = new Set<number>();
  const usedActivityIds = new Set<string>();
  for (const candidate of candidates) {
    if (matchedRaces.has(candidate.raceIndex) || usedActivityIds.has(candidate.activityId)) {
      continue;
    }
    matchedRaces.add(candidate.raceIndex);
    usedActivityIds.add(candidate.activityId);
    races[candidate.raceIndex].activityId = candidate.activityId;
  }
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

export function mergeRaces(
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
    if (!isRaceEntry(zp, zr)) continue;
    merged.push(build(eventId, zp, zr, `zp-${zp.res_id ?? zp.uid ?? eventId}-${merged.length}`));
  }

  // Races ZwiftRacing knows about that ZwiftPower doesn't list.
  for (const [eventId, zr] of zrById) {
    if (!used.has(eventId) && isRaceEntry(undefined, zr)) {
      merged.push(build(eventId, undefined, zr, `zr-${eventId}`));
    }
  }

  merged.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  assignActivityIds(merged, activities);
  return merged;
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
  return {
    key,
    eventId,
    date: zp?.event_date ?? zr?.event?.time,
    title: zp?.event_title || zr?.event?.title || 'Untitled race',
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
