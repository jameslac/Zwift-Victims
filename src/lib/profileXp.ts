import type { ZwiftProfile } from '../api/zwiftCore';

/**
 * Cumulative XP thresholds required to reach Zwift cycling Levels 1–100
 * (index 0 = Level 1 = 0 XP, index 99 = Level 100 = 807,000 XP).
 */
export const ZWIFT_LEVEL_XP: readonly number[] = [
  0, 750, 1500, 2500, 3500, 5000, 6500, 8000, 9500, 11000,
  13000, 15000, 17000, 19000, 21000, 23500, 26000, 28500, 31000, 33500,
  36500, 39500, 42500, 45500, 48500, 52000, 55500, 59500, 64000, 68500,
  73000, 78500, 84000, 89500, 95000, 101500, 108000, 114500, 121000, 127500,
  134500, 142500, 150500, 158500, 166500, 175500, 184500, 193500, 202500, 212000,
  221500, 231000, 240500, 250000, 260000, 270000, 280000, 290000, 300000, 310500,
  321000, 331500, 342000, 352500, 363500, 374500, 385500, 396500, 407500, 418500,
  429500, 441000, 452500, 464000, 475500, 487000, 498500, 510000, 522000, 534000,
  546000, 558000, 570000, 582000, 594000, 606500, 619000, 631500, 644000, 657000,
  670000, 683500, 697000, 711000, 725000, 739500, 755000, 771000, 787000, 807000,
];

export interface XpProgress {
  level: number | null;
  totalXp: number | null;
  nextLevelXp: number | null;
  xpRemaining: number | null;
  progressPct: number;
}

function levelFromXp(totalXp: number): number {
  let level = 1;
  for (let i = 0; i < ZWIFT_LEVEL_XP.length; i += 1) {
    if (totalXp >= ZWIFT_LEVEL_XP[i]) {
      level = i + 1;
    } else {
      break;
    }
  }
  return level;
}

/** Derive rider level, total XP, next level target, and percentage progress from a Zwift profile. */
export function getXpProgress(profile: ZwiftProfile): XpProgress | null {
  const rawAchievement =
    typeof profile.achievementLevel === 'number' && Number.isFinite(profile.achievementLevel)
      ? profile.achievementLevel
      : null;
  const totalXp =
    typeof profile.totalExperiencePoints === 'number' &&
    Number.isFinite(profile.totalExperiencePoints)
      ? Math.max(0, Math.round(profile.totalExperiencePoints))
      : null;
  const rawTarget =
    typeof profile.targetExperiencePoints === 'number' &&
    Number.isFinite(profile.targetExperiencePoints)
      ? Math.round(profile.targetExperiencePoints)
      : null;

  if ((rawAchievement === null || rawAchievement <= 0) && totalXp === null) {
    return null;
  }

  let level: number | null = null;
  let encodedPct = 0;

  if (rawAchievement !== null && rawAchievement > 0) {
    if (rawAchievement >= 100) {
      level = Math.floor(rawAchievement / 100);
      encodedPct = Math.round(rawAchievement % 100);
    } else {
      level = Math.floor(rawAchievement);
    }
  } else if (totalXp !== null) {
    level = levelFromXp(totalXp);
  }

  let levelFloorXp: number | null = null;
  let nextLevelXp: number | null = null;

  if (level !== null && level >= 1 && level < ZWIFT_LEVEL_XP.length) {
    const floor = ZWIFT_LEVEL_XP[level - 1];
    const next = ZWIFT_LEVEL_XP[level];
    if (totalXp === null || (totalXp >= floor && totalXp < next)) {
      levelFloorXp = floor;
      nextLevelXp = next;
    }
  } else if (level !== null && level >= 100 && level < 200) {
    const floor = 807000 + (level - 100) * 20000;
    const next = floor + 20000;
    if (totalXp !== null && totalXp >= floor && totalXp < next) {
      levelFloorXp = floor;
      nextLevelXp = next;
    }
  }

  // Zwift's /profiles/me often sets targetExperiencePoints to 0 or equal to totalExperiencePoints.
  if (
    nextLevelXp === null &&
    rawTarget !== null &&
    rawTarget > 0 &&
    (totalXp === null || rawTarget > totalXp)
  ) {
    nextLevelXp = rawTarget;
    if (level !== null && level >= 1 && level <= ZWIFT_LEVEL_XP.length) {
      const floor = ZWIFT_LEVEL_XP[level - 1];
      if (floor < nextLevelXp && (totalXp === null || floor <= totalXp)) {
        levelFloorXp = floor;
      }
    }
  }

  let progressPct = 0;
  if (encodedPct > 0) {
    progressPct = encodedPct;
  } else if (
    nextLevelXp !== null &&
    levelFloorXp !== null &&
    nextLevelXp > levelFloorXp &&
    totalXp !== null
  ) {
    progressPct = Math.round(((totalXp - levelFloorXp) / (nextLevelXp - levelFloorXp)) * 100);
  } else if (level !== null && level >= 100 && encodedPct === 0) {
    progressPct = 100;
  }

  const clampedPct = Math.max(0, Math.min(100, progressPct));
  const xpRemaining =
    nextLevelXp !== null && totalXp !== null && nextLevelXp > totalXp
      ? nextLevelXp - totalXp
      : null;

  return {
    level,
    totalXp,
    nextLevelXp,
    xpRemaining,
    progressPct: clampedPct,
  };
}
