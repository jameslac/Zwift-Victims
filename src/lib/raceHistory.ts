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

/** Flatten nested JSON into dotted-key/value string pairs for display. */
export function flatten(obj: unknown, prefix = ''): [string, string][] {
  if (obj === null || typeof obj !== 'object') return [[prefix, String(obj)]];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return [[prefix, Array.isArray(obj) ? '[]' : '{}']];
  return entries.flatMap(([k, v]) => {
    const key = prefix ? (Array.isArray(obj) ? `${prefix}[${k}]` : `${prefix}.${k}`) : k;
    return v !== null && typeof v === 'object' ? flatten(v, key) : [[key, String(v)] as [string, string]];
  });
}

export function collectKeys(items: unknown[], excludePrefix?: string): string[] {
  return Array.from(
    new Set(
      items.flatMap((item) =>
        flatten(item)
          .map(([key]) => key)
          .filter((key) =>
            excludePrefix ? !key.startsWith(`${excludePrefix}.`) && key !== excludePrefix : true,
          ),
      ),
    ),
  ).sort();
}

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

export function extractCoreZrs(entry: ZwiftRaceResultEntry | undefined): {
  score?: number;
  previousScore?: number;
  delta?: number;
} {
  if (!entry) return {};
  const sh = entry.scoreHistory;
  const newScore =
    typeof sh?.newScore === 'number' && Number.isFinite(sh.newScore) ? sh.newScore : undefined;
  const previousScore =
    typeof sh?.previousScore === 'number' && Number.isFinite(sh.previousScore)
      ? sh.previousScore
      : undefined;
  const direct = [
    newScore,
    entry.racingScore,
    entry.competitionMetrics?.racingScore,
    entry.profileData?.competitionMetrics?.racingScore,
  ].find((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const score = direct ?? previousScore;
  const delta =
    newScore != null && previousScore != null ? newScore - previousScore : undefined;
  return { score, previousScore, delta };
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
