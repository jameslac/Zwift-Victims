import type { MergedRace } from './raceHistory';

export type HeadToHeadOutcome = 'win' | 'loss' | 'tie';

export interface HeadToHeadRace {
  eventId: string;
  date: number | undefined;
  title: string;
  profilePlace?: number;
  friendPlace?: number;
  profileStatus: string;
  friendStatus: string;
  outcome: HeadToHeadOutcome;
  category?: string;
  usedTruePlace: boolean;
}

export interface HeadToHeadSummary {
  wins: number;
  losses: number;
  ties: number;
  races: HeadToHeadRace[];
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

interface ResolvedPlacement {
  place?: number;
  status: string;
  dnfOrDq: boolean;
  usedTruePlace: boolean;
}

function resolvePlacement(race: MergedRace): ResolvedPlacement {
  if (race.zr?.place?.didNotFinish) {
    return { status: 'DNF', dnfOrDq: true, usedTruePlace: false };
  }
  if (race.zr?.place?.disqualified || race.zp?.penalty === 'DQ') {
    return { status: 'DQ', dnfOrDq: true, usedTruePlace: false };
  }
  if (typeof race.truePlace === 'number' && race.truePlace > 0) {
    return {
      place: race.truePlace,
      status: ordinal(race.truePlace),
      dnfOrDq: false,
      usedTruePlace: true,
    };
  }
  if (typeof race.zpPlace === 'number' && race.zpPlace > 0) {
    return {
      place: race.zpPlace,
      status: ordinal(race.zpPlace),
      dnfOrDq: false,
      usedTruePlace: false,
    };
  }
  if (typeof race.zp?.pos === 'number' && race.zp.pos > 0) {
    return {
      place: race.zp.pos,
      status: ordinal(race.zp.pos),
      dnfOrDq: false,
      usedTruePlace: false,
    };
  }
  return { status: '—', dnfOrDq: false, usedTruePlace: false };
}

function extractRaceTimeSec(race: MergedRace): number | undefined {
  const rawZpTime = Array.isArray(race.zp?.time) ? race.zp.time[0] : race.zp?.time;
  if (typeof rawZpTime === 'number' && Number.isFinite(rawZpTime) && rawZpTime > 0) {
    return rawZpTime;
  }
  const zrTime = race.zr?.race?.time;
  if (typeof zrTime === 'number' && Number.isFinite(zrTime) && zrTime > 0) {
    return zrTime;
  }
  return undefined;
}

function determineOutcome(
  profileRace: MergedRace,
  profilePlacement: ResolvedPlacement,
  friendRace: MergedRace,
  friendPlacement: ResolvedPlacement,
): HeadToHeadOutcome {
  if (profilePlacement.place != null && friendPlacement.place != null) {
    if (profilePlacement.place !== friendPlacement.place) {
      return profilePlacement.place < friendPlacement.place ? 'win' : 'loss';
    }
    const profileTime = extractRaceTimeSec(profileRace);
    const friendTime = extractRaceTimeSec(friendRace);
    if (profileTime != null && friendTime != null && profileTime !== friendTime) {
      return profileTime < friendTime ? 'win' : 'loss';
    }
    return 'tie';
  }
  if (profilePlacement.place != null && friendPlacement.dnfOrDq) {
    return 'win';
  }
  if (friendPlacement.place != null && profilePlacement.dnfOrDq) {
    return 'loss';
  }
  return 'tie';
}

export interface HeadToHeadOptions {
  includeTeamEvents?: boolean;
}

export function isTeamEvent(race: MergedRace): boolean {
  if (/\bttt\b/i.test(race.zr?.event?.subType ?? '')) return true;
  if (/\bttt\b/i.test(race.zr?.event?.type ?? '')) return true;
  if (/\bTYPE_TTT\b/i.test(race.zp?.f_t ?? '')) return true;
  if (/\b(TTT|WTRL|ZRL|Team\s+Time\s+Trial)\b/i.test(race.title)) return true;
  return false;
}

function normalizeCategory(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isSameCategory(profileRace: MergedRace, friendRace: MergedRace): boolean {
  const profileSubgroup = normalizeCategory(profileRace.zr?.event?.subgroupId);
  const friendSubgroup = normalizeCategory(friendRace.zr?.event?.subgroupId);
  if (profileSubgroup && friendSubgroup) {
    return profileSubgroup === friendSubgroup;
  }

  const profileZpCat = normalizeCategory(profileRace.zp?.category);
  const friendZpCat = normalizeCategory(friendRace.zp?.category);
  if (profileZpCat && friendZpCat) {
    return profileZpCat === friendZpCat;
  }

  const profileCat = profileZpCat || profileSubgroup;
  const friendCat = friendZpCat || friendSubgroup;
  if (profileCat && friendCat) {
    return profileCat === friendCat;
  }

  return true;
}

/**
 * Computes head-to-head race records between the profile rider and a friend
 * by matching shared `eventId` entries in the same category, ordered descending by race date.
 */
export function computeHeadToHead(
  profileRaces: MergedRace[],
  friendRaces: MergedRace[],
  options: HeadToHeadOptions = {},
): HeadToHeadSummary {
  const { includeTeamEvents = false } = options;
  const friendByEventId = new Map<string, MergedRace>();
  for (const race of friendRaces) {
    if (!race.eventId) continue;
    const existing = friendByEventId.get(race.eventId);
    if (!existing || (existing.truePlace == null && race.truePlace != null)) {
      friendByEventId.set(race.eventId, race);
    }
  }

  const seenEventIds = new Set<string>();
  const matched: HeadToHeadRace[] = [];

  for (const profileRace of profileRaces) {
    const eventId = profileRace.eventId;
    if (!eventId || seenEventIds.has(eventId)) continue;
    const friendRace = friendByEventId.get(eventId);
    if (!friendRace) continue;
    seenEventIds.add(eventId);

    if (!includeTeamEvents && (isTeamEvent(profileRace) || isTeamEvent(friendRace))) continue;
    if (!isSameCategory(profileRace, friendRace)) continue;

    const profilePlacement = resolvePlacement(profileRace);
    const friendPlacement = resolvePlacement(friendRace);
    const outcome = determineOutcome(profileRace, profilePlacement, friendRace, friendPlacement);
    const title =
      profileRace.title && profileRace.title !== 'Untitled race'
        ? profileRace.title
        : friendRace.title || 'Untitled race';

    matched.push({
      eventId,
      date: profileRace.date ?? friendRace.date,
      title,
      profilePlace: profilePlacement.place,
      friendPlace: friendPlacement.place,
      profileStatus: profilePlacement.status,
      friendStatus: friendPlacement.status,
      outcome,
      category: profileRace.zp?.category ?? profileRace.zr?.event?.subgroupId,
      usedTruePlace: profilePlacement.usedTruePlace && friendPlacement.usedTruePlace,
    });
  }

  matched.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const race of matched) {
    if (race.outcome === 'win') wins += 1;
    else if (race.outcome === 'loss') losses += 1;
    else ties += 1;
  }

  return { wins, losses, ties, races: matched };
}
