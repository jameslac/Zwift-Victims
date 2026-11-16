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
  usedTruePlace: boolean;
}

export function isDqOrDnf(race: MergedRace): boolean {
  if (race.zr?.place?.didNotFinish) return true;
  if (race.zr?.place?.disqualified) return true;
  if (typeof race.zp?.penalty === 'string' && race.zp.penalty.trim() !== '') return true;
  return false;
}

function resolvePlacement(race: MergedRace): ResolvedPlacement {
  if (isDqOrDnf(race)) {
    return {
      status: race.zr?.place?.didNotFinish ? 'DNF' : race.zp?.penalty?.trim() || 'DQ',
      usedTruePlace: false,
    };
  }
  if (typeof race.truePlace === 'number' && race.truePlace > 0) {
    return {
      place: race.truePlace,
      status: ordinal(race.truePlace),
      usedTruePlace: true,
    };
  }
  if (typeof race.zpPlace === 'number' && race.zpPlace > 0) {
    return {
      place: race.zpPlace,
      status: ordinal(race.zpPlace),
      usedTruePlace: false,
    };
  }
  if (typeof race.zp?.pos === 'number' && race.zp.pos > 0) {
    return {
      place: race.zp.pos,
      status: ordinal(race.zp.pos),
      usedTruePlace: false,
    };
  }
  return { status: '—', usedTruePlace: false };
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
  profilePlace: number,
  friendRace: MergedRace,
  friendPlace: number,
): HeadToHeadOutcome {
  if (profilePlace !== friendPlace) {
    return profilePlace < friendPlace ? 'win' : 'loss';
  }
  const profileTime = extractRaceTimeSec(profileRace);
  const friendTime = extractRaceTimeSec(friendRace);
  if (profileTime != null && friendTime != null && profileTime !== friendTime) {
    return profileTime < friendTime ? 'win' : 'loss';
  }
  return 'tie';
}

export interface HeadToHeadOptions {
  includeTeamEvents?: boolean;
}

const TEAM_TITLE_RE =
  /\b(TTT|WTRL|ZRL|Zwift\s+Racing\s+League|Team\s+Time\s+Trial|Club\s+Ladder|Team\s+Race|Team\s+Series)\b/i;
const TEAM_TYPE_RE = /\b(ttt|team\s*time\s*trial|team)\b/i;
const EXPLICIT_ITT_RE = /\b(itt|individual\s+time\s+trial)\b/i;

export function isTeamEvent(race: MergedRace): boolean {
  const titles = [race.title, race.zp?.event_title, race.zr?.event?.title].filter(
    (t): t is string => typeof t === 'string' && t.trim() !== '',
  );
  const subType = race.zr?.event?.subType ?? '';
  const eventType = race.zr?.event?.type ?? '';
  const zpTags = race.zp?.f_t ?? '';

  if (titles.some((t) => TEAM_TITLE_RE.test(t))) return true;
  if (TEAM_TYPE_RE.test(subType) || TEAM_TYPE_RE.test(eventType)) return true;
  if (/\b(TYPE_TTT|TYPE_TEAM)\b/i.test(zpTags)) return true;

  const isExplicitItt =
    EXPLICIT_ITT_RE.test(subType) || titles.some((t) => EXPLICIT_ITT_RE.test(t));
  if (/\bTYPE_TT\b/i.test(zpTags) && !isExplicitItt) return true;

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
    if (isDqOrDnf(profileRace) || isDqOrDnf(friendRace)) continue;

    const profilePlacement = resolvePlacement(profileRace);
    const friendPlacement = resolvePlacement(friendRace);
    if (profilePlacement.place == null || friendPlacement.place == null) continue;

    const outcome = determineOutcome(
      profileRace,
      profilePlacement.place,
      friendRace,
      friendPlacement.place,
    );
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
