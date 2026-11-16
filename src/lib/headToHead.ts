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
  profileUsedTruePlace: boolean;
  friendUsedTruePlace: boolean;
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

function validPlace(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildResolved(place: number | undefined, usedTruePlace: boolean): ResolvedPlacement {
  if (place != null) {
    return { place, status: ordinal(place), usedTruePlace };
  }
  return { status: '—', usedTruePlace: false };
}

function resolveSinglePlacement(race: MergedRace): ResolvedPlacement {
  const truePlace = validPlace(race.truePlace);
  if (truePlace != null) return buildResolved(truePlace, true);

  const zpPlace = validPlace(race.zpPlace);
  if (zpPlace != null) return buildResolved(zpPlace, false);

  return buildResolved(validPlace(race.zp?.pos), false);
}

function resolvePairPlacements(
  profileRace: MergedRace,
  friendRace: MergedRace,
): { profile: ResolvedPlacement; friend: ResolvedPlacement } {
  const pTrue = validPlace(profileRace.truePlace);
  const fTrue = validPlace(friendRace.truePlace);
  if (pTrue != null && fTrue != null) {
    return { profile: buildResolved(pTrue, true), friend: buildResolved(fTrue, true) };
  }

  const pZp = validPlace(profileRace.zpPlace);
  const fZp = validPlace(friendRace.zpPlace);
  if (pZp != null && fZp != null) {
    return { profile: buildResolved(pZp, false), friend: buildResolved(fZp, false) };
  }

  const pPos = validPlace(profileRace.zp?.pos);
  const fPos = validPlace(friendRace.zp?.pos);
  if (pPos != null && fPos != null) {
    return { profile: buildResolved(pPos, false), friend: buildResolved(fPos, false) };
  }

  return {
    profile: resolveSinglePlacement(profileRace),
    friend: resolveSinglePlacement(friendRace),
  };
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

function compareRaceTimes(profileRace: MergedRace, friendRace: MergedRace): HeadToHeadOutcome | null {
  const profileTime = extractRaceTimeSec(profileRace);
  const friendTime = extractRaceTimeSec(friendRace);
  if (profileTime != null && friendTime != null && profileTime !== friendTime) {
    return profileTime < friendTime ? 'win' : 'loss';
  }
  return null;
}

function determineOutcome(
  profileRace: MergedRace,
  profilePlacement: ResolvedPlacement & { place: number },
  friendRace: MergedRace,
  friendPlacement: ResolvedPlacement & { place: number },
): HeadToHeadOutcome {
  if (profilePlacement.usedTruePlace !== friendPlacement.usedTruePlace) {
    const timeOutcome = compareRaceTimes(profileRace, friendRace);
    if (timeOutcome) return timeOutcome;
  }
  if (profilePlacement.place !== friendPlacement.place) {
    return profilePlacement.place < friendPlacement.place ? 'win' : 'loss';
  }
  return compareRaceTimes(profileRace, friendRace) ?? 'tie';
}

export interface HeadToHeadOptions {
  includeTeamEvents?: boolean;
}

const TEAM_TITLE_RE =
  /\b(TTT|WTRL|ZRL|Zwift\s+Racing\s+League|Team\s+Time\s+Trial|Club\s+Ladder|Team\s+Race|Team\s+Series)\b/i;
const TEAM_TYPE_RE = /\b(ttt|team\s*time\s*trial|team)\b/i;
const EXPLICIT_ITT_RE = /\b(itt|individual\s+time\s+trial)\b/i;

function getRaceTitles(race: MergedRace): string[] {
  return [race.title, race.zp?.event_title, race.zr?.event?.title].filter(
    (t): t is string => typeof t === 'string' && t.trim() !== '',
  );
}

function isExplicitIndividualTimeTrial(race: MergedRace): boolean {
  const subType = race.zr?.event?.subType ?? '';
  return EXPLICIT_ITT_RE.test(subType) || getRaceTitles(race).some((t) => EXPLICIT_ITT_RE.test(t));
}

export function isTeamEvent(race: MergedRace): boolean {
  const titles = getRaceTitles(race);
  const subType = race.zr?.event?.subType ?? '';
  const eventType = race.zr?.event?.type ?? '';
  const zpTags = race.zp?.f_t ?? '';

  if (titles.some((t) => TEAM_TITLE_RE.test(t))) return true;
  if (TEAM_TYPE_RE.test(subType) || TEAM_TYPE_RE.test(eventType)) return true;
  if (/\b(TYPE_TTT|TYPE_TEAM)\b/i.test(zpTags)) return true;

  return false;
}

function normalizeTeamValue(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isSharedTeamTimeTrial(profileRace: MergedRace, friendRace: MergedRace): boolean {
  const hasTypeTt =
    /\bTYPE_TT\b/i.test(profileRace.zp?.f_t ?? '') ||
    /\bTYPE_TT\b/i.test(friendRace.zp?.f_t ?? '');
  if (!hasTypeTt) return false;
  if (isExplicitIndividualTimeTrial(profileRace) || isExplicitIndividualTimeTrial(friendRace)) {
    return false;
  }

  const profileTid = normalizeTeamValue(profileRace.zp?.tid);
  const friendTid = normalizeTeamValue(friendRace.zp?.tid);
  if (profileTid && friendTid) {
    return profileTid === friendTid;
  }

  const profileTname = normalizeTeamValue(profileRace.zp?.tname);
  const friendTname = normalizeTeamValue(friendRace.zp?.tname);
  if (profileTname && friendTname) {
    return profileTname === friendTname;
  }

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
  if (Boolean(profileCat) !== Boolean(friendCat)) {
    return false;
  }
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

    if (
      !includeTeamEvents &&
      (isTeamEvent(profileRace) ||
        isTeamEvent(friendRace) ||
        isSharedTeamTimeTrial(profileRace, friendRace))
    ) {
      continue;
    }
    if (!isSameCategory(profileRace, friendRace)) continue;
    if (isDqOrDnf(profileRace) || isDqOrDnf(friendRace)) continue;

    const { profile: profilePlacement, friend: friendPlacement } = resolvePairPlacements(
      profileRace,
      friendRace,
    );
    if (profilePlacement.place == null || friendPlacement.place == null) continue;

    const outcome = determineOutcome(
      profileRace,
      { ...profilePlacement, place: profilePlacement.place },
      friendRace,
      { ...friendPlacement, place: friendPlacement.place },
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
      profileUsedTruePlace: profilePlacement.usedTruePlace,
      friendUsedTruePlace: friendPlacement.usedTruePlace,
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
