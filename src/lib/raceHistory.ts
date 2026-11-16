import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRaceEntry } from '../api/zwiftRacing';

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
