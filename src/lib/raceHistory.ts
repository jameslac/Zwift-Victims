import type { ZwiftActivity, ZwiftEventSubgroup } from '../api/zwiftCore';
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

  return merged.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
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
