import type {
  ZwiftRacingOverview,
  ZwiftRacingRankingEntry,
  ZwiftRacingRider,
} from '../api/zwiftRacing';

export type VeloSystem = 'velo2' | 'velo2Women' | 'legacy' | 'legacyWomen';
export type VeloScaleMode = 'velo2' | 'legacy';

export interface VeloTier {
  number: number;
  name: string;
  min: number;
  max: number | null;
  backgroundColor: string;
  textColor: string;
}

export interface TierProgress {
  current: VeloTier;
  next: VeloTier | null;
  progressPct: number;
  pointsToNext: number | null;
}

export interface VisibleTierBand {
  tier: VeloTier;
  yBottom: number;
  yTop: number;
}

export interface VeloTimelinePoint {
  key: string;
  time: number;
  title: string;
  before?: number;
  after: number;
  delta?: number;
  eventRating?: number;
  expectedPosition?: number;
  positionInCategory?: number;
  penTotal?: number;
  didNotFinish?: boolean;
  disqualified?: boolean;
  isLive?: boolean;
}

export interface VeloSeriesResult {
  points: VeloTimelinePoint[];
  live?: number;
  seed?: number;
  netRaceCraft?: number;
  max30?: number;
  max90?: number;
  max30Derived: boolean;
  max90Derived: boolean;
  max30Expires?: number;
  max90Expires?: number;
  timeTrial?: number;
  handicap?: number;
}

export type PhenotypeRoleKey = 'sprinter' | 'puncheur' | 'pursuiter' | 'climber' | 'tt' | 'allRounder';
export type FactorId = 'sprint' | 'punch' | 'pursuit' | 'climb' | 'timeTrial' | 'endurance';

export interface PhenotypeAxis {
  id: Exclude<FactorId, 'endurance'>;
  roleKey: Exclude<PhenotypeRoleKey, 'allRounder'>;
  label: string;
  effortHint: string;
  rawValue?: number;
  normalized: number;
  deltaFromMean?: number;
  tier?: VeloTier;
}

export interface PhenotypeProfile {
  label: string;
  rawLabel: string;
  description: string;
  confidencePct?: number;
  confidenceBand?: 'Low' | 'Moderate' | 'High';
  value?: number;
  bias?: number;
  windowDays?: number;
  axes: PhenotypeAxis[];
  hasScores: boolean;
  scoresSource: 'phenotype' | 'seedFactors' | 'none';
  scaleMax: number;
  meanNormalized?: number;
}

export interface FactorBreakdownRow {
  id: FactorId;
  label: string;
  effortHint: string;
  seed?: number;
  skill?: number;
  total?: number;
  tier?: VeloTier;
}

export interface FactorBreakdown {
  rows: FactorBreakdownRow[];
  scaleMax: number;
  overallVelo?: number;
  overallSeed?: number;
  netRaceCraft?: number;
  hasData: boolean;
}

export interface RaceBreakdown {
  total: number;
  finishes: number;
  wins: number;
  otherPodiums: number;
  podiums: number;
  otherFinishes: number;
  dnfs: number;
  winPct: number | null;
  podiumPct: number | null;
  finishPct: number | null;
  dnfPct: number | null;
  hasData: boolean;
}

export interface DisciplineRankingSummary {
  id: 'gc' | 'sprint' | 'climb' | 'tt';
  label: string;
  percentile: number | null;
  delta7d: number | null;
  place?: number;
  total?: number;
  tier?: VeloTier;
}

export interface RankingsSummary {
  disciplines: DisciplineRankingSummary[];
  gcOverallPlace?: { rank: number; total: number };
  hasData: boolean;
}

export interface PowerModelMetric {
  key: 'CP' | 'AWC' | 'compoundScore' | 'powerRating';
  label: string;
  value: string;
}

interface TierMeta {
  number: number;
  name: string;
  backgroundColor: string;
  textColor: string;
}

const TIER_METAS: readonly TierMeta[] = [
  { number: 1, name: 'Diamond', backgroundColor: '#b3ecf5', textColor: '#0a3a42' },
  { number: 2, name: 'Ruby', backgroundColor: '#9b1c2e', textColor: '#ffffff' },
  { number: 3, name: 'Emerald', backgroundColor: '#0d6b4c', textColor: '#ffffff' },
  { number: 4, name: 'Sapphire', backgroundColor: '#0d3d73', textColor: '#ffffff' },
  { number: 5, name: 'Amethyst', backgroundColor: '#7a3aa8', textColor: '#ffffff' },
  { number: 6, name: 'Platinum', backgroundColor: '#d8dfdf', textColor: '#4a4a4a' },
  { number: 7, name: 'Gold', backgroundColor: '#c4a046', textColor: '#1a1408' },
  { number: 8, name: 'Silver', backgroundColor: '#6f747a', textColor: '#ffffff' },
  { number: 9, name: 'Bronze', backgroundColor: '#9a6235', textColor: '#ffffff' },
  { number: 10, name: 'Copper', backgroundColor: '#c56a32', textColor: '#ffffff' },
];

const TIER_CUTS: Record<VeloSystem, Record<string, { min: number; max: number | null }>> = {
  velo2: {
    Diamond: { min: 880, max: null },
    Ruby: { min: 800, max: 879 },
    Emerald: { min: 720, max: 799 },
    Sapphire: { min: 640, max: 719 },
    Amethyst: { min: 580, max: 639 },
    Platinum: { min: 520, max: 579 },
    Gold: { min: 460, max: 519 },
    Silver: { min: 400, max: 459 },
    Bronze: { min: 350, max: 399 },
    Copper: { min: 0, max: 349 },
  },
  velo2Women: {
    Diamond: { min: 660, max: null },
    Ruby: { min: 605, max: 659 },
    Emerald: { min: 555, max: 604 },
    Sapphire: { min: 510, max: 554 },
    Amethyst: { min: 470, max: 509 },
    Platinum: { min: 430, max: 469 },
    Gold: { min: 385, max: 429 },
    Silver: { min: 335, max: 384 },
    Bronze: { min: 285, max: 334 },
    Copper: { min: 0, max: 284 },
  },
  legacy: {
    Diamond: { min: 2200, max: null },
    Ruby: { min: 1900, max: 2199 },
    Emerald: { min: 1650, max: 1899 },
    Sapphire: { min: 1450, max: 1649 },
    Amethyst: { min: 1300, max: 1449 },
    Platinum: { min: 1150, max: 1299 },
    Gold: { min: 1000, max: 1149 },
    Silver: { min: 850, max: 999 },
    Bronze: { min: 650, max: 849 },
    Copper: { min: 0, max: 649 },
  },
  legacyWomen: {
    Diamond: { min: 1450, max: null },
    Ruby: { min: 1250, max: 1449 },
    Emerald: { min: 1100, max: 1249 },
    Sapphire: { min: 950, max: 1099 },
    Amethyst: { min: 850, max: 949 },
    Platinum: { min: 750, max: 849 },
    Gold: { min: 650, max: 749 },
    Silver: { min: 550, max: 649 },
    Bronze: { min: 400, max: 549 },
    Copper: { min: 0, max: 399 },
  },
};

const TIER_TABLES: Record<VeloSystem, readonly VeloTier[]> = {
  velo2: buildTierTable('velo2'),
  velo2Women: buildTierTable('velo2Women'),
  legacy: buildTierTable('legacy'),
  legacyWomen: buildTierTable('legacyWomen'),
};

function buildTierTable(system: VeloSystem): VeloTier[] {
  const cuts = TIER_CUTS[system];
  return TIER_METAS.map((meta) => ({
    ...meta,
    min: cuts[meta.name].min,
    max: cuts[meta.name].max,
  }));
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function finitePositive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function finiteNonNegative(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getVeloTiers(system: VeloSystem): readonly VeloTier[] {
  return TIER_TABLES[system];
}

export function getVeloTier(rating: number, system: VeloSystem): VeloTier {
  const table = TIER_TABLES[system];
  for (const tier of table) {
    if (rating >= tier.min) return tier;
  }
  return table[table.length - 1];
}

export function getVeloTierByNumber(
  categoryNumber: number,
  system: VeloSystem,
): VeloTier | undefined {
  return TIER_TABLES[system].find((tier) => tier.number === categoryNumber);
}

export function getTierProgress(rating: number, system: VeloSystem): TierProgress {
  const table = TIER_TABLES[system];
  const current = getVeloTier(rating, system);
  const currentIdx = table.findIndex((tier) => tier.number === current.number);
  const next = currentIdx > 0 ? table[currentIdx - 1] : null;
  if (!next) {
    return {
      current,
      next: null,
      progressPct: 100,
      pointsToNext: null,
    };
  }
  const span = Math.max(1, next.min - current.min);
  const progressPct = clamp(0, 100, ((rating - current.min) / span) * 100);
  const pointsToNext = Math.max(0, next.min - rating);
  return { current, next, progressPct, pointsToNext };
}

export function getVisibleTiers(minY: number, maxY: number, system: VeloSystem): VisibleTierBand[] {
  const table = TIER_TABLES[system];
  const bands: VisibleTierBand[] = [];
  for (let i = 0; i < table.length; i++) {
    const tier = table[i];
    const nextTier = i > 0 ? table[i - 1] : null;
    const bandMin = tier.min;
    const bandMax = nextTier ? nextTier.min : Infinity;
    if (bandMax > minY && bandMin < maxY) {
      bands.push({
        tier,
        yBottom: Math.max(minY, bandMin),
        yTop: Math.min(maxY, bandMax),
      });
    }
  }
  return bands;
}

export function normalizeHexColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return undefined;
  return `#${trimmed}`;
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const cp = Number.parseInt(entity.slice(2), 16);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return match;
      }
      return String.fromCodePoint(cp);
    }
    if (entity.startsWith('#')) {
      const cp = Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return match;
      }
      return String.fromCodePoint(cp);
    }
    const lower = entity.toLowerCase();
    return Object.hasOwn(NAMED_HTML_ENTITIES, lower) ? NAMED_HTML_ENTITIES[lower] : match;
  });
}

export function buildZwiftRacingRiderUrl(riderId: number): string {
  return `https://zwiftracing.app/riders/${riderId}`;
}

const THIRTY_DAYS_SEC = 30 * 86400;
const NINETY_DAYS_SEC = 90 * 86400;

export function buildVeloSeries(
  rider: ZwiftRacingRider | null,
  overview: ZwiftRacingOverview | null,
  scale: VeloScaleMode,
  nowSec: number = Math.floor(Date.now() / 1000),
): VeloSeriesResult {
  if (scale === 'legacy') {
    const byKey = new Map<string, VeloTimelinePoint>();

    for (const entry of overview?.history ?? []) {
      const time = finitePositive(entry.event?.time);
      const after = finitePositive(entry.legacy?.rating);
      if (time === undefined || after === undefined) continue;
      const eventId = entry.event?.eventId ? String(entry.event.eventId).trim() : '';
      const title = entry.event?.title?.trim() || 'Untitled race';
      const key = eventId || `legacy-${time}-${title}`;
      const before = finitePositive(entry.legacy?.ratingBefore);
      const delta =
        finiteNumber(entry.legacy?.ratingDelta) ??
        (before !== undefined ? after - before : undefined);

      byKey.set(key, {
        key,
        time,
        title,
        before,
        after,
        delta,
        eventRating: finitePositive(entry.legacy?.eventRating),
        expectedPosition: finitePositive(entry.velo?.elo?.expectedPosition),
        positionInCategory: finitePositive(entry.place?.positionInCategory),
        penTotal: finitePositive(entry.place?.penTotal),
        didNotFinish: Boolean(entry.place?.didNotFinish),
        disqualified: Boolean(entry.place?.disqualified),
      });
    }

    for (const entry of overview?.legacyHistory ?? []) {
      const time = finitePositive(entry.event?.time);
      const after = finitePositive(entry.rating);
      if (time === undefined || after === undefined) continue;
      const eventId = entry.event?.eventId ? String(entry.event.eventId).trim() : '';
      const title = entry.event?.title?.trim() || 'Untitled race';
      const key = eventId || `legacy-${time}-${title}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        time,
        title,
        after,
      });
    }

    const points = [...byKey.values()].sort((a, b) => a.time - b.time);
    const live = finitePositive(overview?.legacyRatings?.live);
    const latestTime = points.length > 0 ? points[points.length - 1].time : 0;
    const refTime = Math.max(nowSec, latestTime);

    if (live !== undefined && points.length > 0) {
      const last = points[points.length - 1];
      if (Math.abs(live - last.after) >= 0.05 || refTime - last.time > 86400) {
        points.push({
          key: 'live',
          time: refTime,
          title: 'Current live rating',
          before: last.after,
          after: live,
          delta: live - last.after,
          isLive: true,
        });
      }
    }

    return {
      points,
      live,
      max30: finitePositive(overview?.legacyRatings?.max30),
      max90: finitePositive(overview?.legacyRatings?.max90),
      max30Derived: false,
      max90Derived: false,
      max30Expires: finitePositive(overview?.legacyRatings?.max30Expires),
      max90Expires: finitePositive(overview?.legacyRatings?.max90Expires),
    };
  }

  // vELO v2
  const racePoints: VeloTimelinePoint[] = [];
  for (const entry of overview?.history ?? []) {
    const time = finitePositive(entry.event?.time);
    const after = finitePositive(entry.velo?.elo?.after);
    if (time === undefined || after === undefined) continue;
    const eventId = entry.event?.eventId ? String(entry.event.eventId).trim() : '';
    const title = entry.event?.title?.trim() || 'Untitled race';
    const key = eventId ? `v2-${eventId}-${time}` : `v2-${time}-${title}`;
    const before = finitePositive(entry.velo?.elo?.before);
    const delta =
      finiteNumber(entry.velo?.elo?.adjustedChange) ??
      (before !== undefined ? after - before : undefined);

    racePoints.push({
      key,
      time,
      title,
      before,
      after,
      delta,
      eventRating: finitePositive(entry.velo?.elo?.eventRating),
      expectedPosition: finitePositive(entry.velo?.elo?.expectedPosition),
      positionInCategory: finitePositive(entry.place?.positionInCategory),
      penTotal: finitePositive(entry.place?.penTotal),
      didNotFinish: Boolean(entry.place?.didNotFinish),
      disqualified: Boolean(entry.place?.disqualified),
    });
  }

  racePoints.sort((a, b) => a.time - b.time);

  const live = finitePositive(rider?.velo?.race);
  const seed = finitePositive(rider?.seed?.race);
  const netRaceCraft = live !== undefined && seed !== undefined ? live - seed : undefined;
  const latestTime = racePoints.length > 0 ? racePoints[racePoints.length - 1].time : 0;
  const refTime = Math.max(nowSec, latestTime);

  const explicitMax30 = finitePositive(rider?.velo?.max30);
  const explicitMax90 = finitePositive(rider?.velo?.max90);

  const deriveWindowPeak = (windowSec: number): number | undefined => {
    const candidates = racePoints
      .filter((pt) => refTime - pt.time <= windowSec)
      .map((pt) => pt.after);
    if (live !== undefined) candidates.push(live);
    if (candidates.length === 0) return undefined;
    return Math.max(...candidates);
  };

  const max30 = explicitMax30 ?? deriveWindowPeak(THIRTY_DAYS_SEC);
  const max90 = explicitMax90 ?? deriveWindowPeak(NINETY_DAYS_SEC);

  const points = [...racePoints];
  if (live !== undefined && points.length > 0) {
    const last = points[points.length - 1];
    if (Math.abs(live - last.after) >= 0.05 || refTime - last.time > 86400) {
      points.push({
        key: 'live',
        time: refTime,
        title: 'Current live rating',
        before: last.after,
        after: live,
        delta: live - last.after,
        isLive: true,
      });
    }
  }

  return {
    points,
    live,
    seed,
    netRaceCraft,
    max30,
    max90,
    max30Derived: explicitMax30 === undefined && max30 !== undefined,
    max90Derived: explicitMax90 === undefined && max90 !== undefined,
    timeTrial: finitePositive(rider?.velo?.timeTrial),
    handicap: finiteNumber(rider?.velo?.handicap),
  };
}

export function buildVeloSummary(
  rider: ZwiftRacingRider | null,
  overview: ZwiftRacingOverview | null,
  nowSec: number = Math.floor(Date.now() / 1000),
): {
  velo2: VeloSeriesResult;
  legacy: VeloSeriesResult;
  hasVelo2Data: boolean;
  hasLegacyData: boolean;
} {
  const velo2 = buildVeloSeries(rider, overview, 'velo2', nowSec);
  const legacy = buildVeloSeries(rider, overview, 'legacy', nowSec);

  const hasVelo2Data =
    velo2.live !== undefined || velo2.seed !== undefined || velo2.points.length > 0;
  const hasLegacyData =
    legacy.live !== undefined ||
    legacy.max30 !== undefined ||
    legacy.max90 !== undefined ||
    legacy.points.length > 0;

  return { velo2, legacy, hasVelo2Data, hasLegacyData };
}

const PHENOTYPE_METADATA: Record<
  PhenotypeRoleKey,
  { label: string; description: string }
> = {
  sprinter: {
    label: 'Sprinter',
    description: '5- to 30-second explosive power stands out most against other factors.',
  },
  puncheur: {
    label: 'Puncheur',
    description: '1- and 2-minute anaerobic power stands out most against other factors.',
  },
  pursuiter: {
    label: 'Pursuiter',
    description: '5-minute sustained power stands out most against other factors.',
  },
  climber: {
    label: 'Climber',
    description: '5- and 20-minute W/kg stands out most against other factors.',
  },
  tt: {
    label: 'Time Trialist',
    description: 'Solo sustained FTP (weight and height adjusted) stands out most.',
  },
  allRounder: {
    label: 'All-Rounder',
    description: 'Balanced across power durations with no single standout outlier.',
  },
};

function resolvePhenotypeMeta(rawLabel: string | undefined): {
  label: string;
  description: string;
} {
  const normalized = (rawLabel ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'sprinter') return PHENOTYPE_METADATA.sprinter;
  if (normalized === 'puncheur') return PHENOTYPE_METADATA.puncheur;
  if (normalized === 'pursuiter') return PHENOTYPE_METADATA.pursuiter;
  if (normalized === 'climber') return PHENOTYPE_METADATA.climber;
  if (normalized === 'tt' || normalized === 'timetrialist' || normalized === 'timetrial') {
    return PHENOTYPE_METADATA.tt;
  }
  if (normalized === 'allrounder') return PHENOTYPE_METADATA.allRounder;
  if (rawLabel && rawLabel.trim()) {
    return {
      label: rawLabel.trim(),
      description: 'Rider power shape derived from recent race and power-curve efforts.',
    };
  }
  return {
    label: 'Unclassified',
    description: 'Not enough recent power data yet to classify phenotype.',
  };
}

const PHENOTYPE_AXIS_SPECS: ReadonlyArray<{
  id: Exclude<FactorId, 'endurance'>;
  roleKey: Exclude<PhenotypeRoleKey, 'allRounder'>;
  label: string;
  effortHint: string;
}> = [
  { id: 'sprint', roleKey: 'sprinter', label: 'Sprint', effortHint: '5–30s' },
  { id: 'punch', roleKey: 'puncheur', label: 'Punch', effortHint: '1–2m' },
  { id: 'pursuit', roleKey: 'pursuiter', label: 'Pursuit', effortHint: '5m' },
  { id: 'climb', roleKey: 'climber', label: 'Climb', effortHint: '5m & 20m W/kg' },
  { id: 'timeTrial', roleKey: 'tt', label: 'Time Trial', effortHint: 'Solo zFTP' },
];

export function buildPhenotypeProfile(
  rider: ZwiftRacingRider | null,
  system: VeloSystem = 'velo2',
): PhenotypeProfile {
  const pheno = rider?.phenotype;
  const rawLabel = pheno?.label ?? '';
  const meta = resolvePhenotypeMeta(pheno?.label);

  const rawConf = finiteNonNegative(pheno?.confidence);
  let confidencePct: number | undefined;
  let confidenceBand: PhenotypeProfile['confidenceBand'];
  if (rawConf !== undefined) {
    const conf01 = rawConf <= 1 ? rawConf : clamp(0, 1, rawConf / 100);
    confidencePct = Math.round(conf01 * 100);
    confidenceBand = conf01 < 0.4 ? 'Low' : conf01 < 0.75 ? 'Moderate' : 'High';
  }

  // Prefer explicit phenotype.scores if populated; otherwise fall back to seed.factors / velo.factors.
  const scoreSourceObj = pheno?.scores;
  const fromPhenotype = PHENOTYPE_AXIS_SPECS.map((spec) => {
    if (!scoreSourceObj || typeof scoreSourceObj !== 'object') return undefined;
    return finitePositive(scoreSourceObj[spec.roleKey]) ?? finitePositive(scoreSourceObj[spec.id]);
  });

  const hasPhenoScores = fromPhenotype.some((v) => v !== undefined);
  let scoresSource: PhenotypeProfile['scoresSource'] = 'none';
  let rawValues: Array<number | undefined>;
  let scaleMax = 1000;

  if (hasPhenoScores) {
    scoresSource = 'phenotype';
    rawValues = fromPhenotype;
    const maxRaw = Math.max(...fromPhenotype.filter((v): v is number => v !== undefined));
    scaleMax = maxRaw <= 1 ? 1 : maxRaw <= 100 ? 100 : Math.max(1000, maxRaw);
  } else {
    const fromSeed = PHENOTYPE_AXIS_SPECS.map((spec) =>
      finitePositive(rider?.seed?.factors?.[spec.id]),
    );
    const fromVelo = PHENOTYPE_AXIS_SPECS.map((spec) =>
      finitePositive(rider?.velo?.factors?.[spec.id]),
    );
    const hasSeed = fromSeed.some((v) => v !== undefined);
    const hasVelo = fromVelo.some((v) => v !== undefined);
    if (hasSeed || hasVelo) {
      scoresSource = 'seedFactors';
      rawValues = hasSeed ? fromSeed : fromVelo;
      const valid = rawValues.filter((v): v is number => v !== undefined);
      scaleMax = Math.max(1000, ...valid);
    } else {
      rawValues = PHENOTYPE_AXIS_SPECS.map(() => undefined);
    }
  }

  const validValues = rawValues.filter((v): v is number => v !== undefined);
  const hasScores = validValues.length > 0;
  const meanRaw = hasScores
    ? validValues.reduce((sum, v) => sum + v, 0) / validValues.length
    : undefined;
  const meanNormalized = meanRaw !== undefined ? clamp(0, 1, meanRaw / scaleMax) : undefined;

  const axes: PhenotypeAxis[] = PHENOTYPE_AXIS_SPECS.map((spec, idx) => {
    const rawValue = rawValues[idx];
    const normalized = rawValue !== undefined ? clamp(0, 1, rawValue / scaleMax) : 0;
    const deltaFromMean =
      rawValue !== undefined && meanRaw !== undefined ? rawValue - meanRaw : undefined;
    const tier =
      rawValue !== undefined && scaleMax >= 1000 ? getVeloTier(rawValue, system) : undefined;
    return {
      ...spec,
      rawValue,
      normalized,
      deltaFromMean,
      tier,
    };
  });

  return {
    label: meta.label,
    rawLabel,
    description: meta.description,
    confidencePct,
    confidenceBand,
    value: finiteNumber(pheno?.value),
    bias: finiteNumber(pheno?.bias),
    windowDays: finitePositive(pheno?.windowDays),
    axes,
    hasScores,
    scoresSource,
    scaleMax,
    meanNormalized,
  };
}

const FACTOR_SPECS: ReadonlyArray<{ id: FactorId; label: string; effortHint: string }> = [
  { id: 'sprint', label: 'Sprint', effortHint: '5–30s peak' },
  { id: 'punch', label: 'Punch', effortHint: '1–2m peak' },
  { id: 'pursuit', label: 'Pursuit', effortHint: '5m peak' },
  { id: 'climb', label: 'Climb', effortHint: '5m & 20m W/kg' },
  { id: 'timeTrial', label: 'Time Trial', effortHint: 'Solo zFTP' },
  { id: 'endurance', label: 'Endurance', effortHint: 'Race zFTP' },
];

export function buildFactorBreakdown(
  rider: ZwiftRacingRider | null,
  system: VeloSystem = 'velo2',
): FactorBreakdown {
  const rows: FactorBreakdownRow[] = FACTOR_SPECS.map((spec) => {
    const seed = finiteNonNegative(rider?.seed?.factors?.[spec.id]);
    let skill = finiteNumber(rider?.velo?.skill?.[spec.id]);
    const veloFactor = finiteNonNegative(rider?.velo?.factors?.[spec.id]);
    const total = veloFactor ?? (seed !== undefined ? seed + (skill ?? 0) : undefined);
    if (skill === undefined && total !== undefined && seed !== undefined) {
      skill = total - seed;
    }
    const tierRef = total ?? seed;
    const tier = tierRef !== undefined ? getVeloTier(tierRef, system) : undefined;
    return {
      ...spec,
      seed,
      skill,
      total,
      tier,
    };
  });

  const overallVelo = finitePositive(rider?.velo?.race);
  const overallSeed = finitePositive(rider?.seed?.race);
  const netRaceCraft =
    overallVelo !== undefined && overallSeed !== undefined ? overallVelo - overallSeed : undefined;

  const numericMaxes = rows
    .flatMap((r) => [r.total, r.seed])
    .filter((v): v is number => v !== undefined);
  if (overallVelo !== undefined) numericMaxes.push(overallVelo);

  const scaleMax = Math.max(1000, ...numericMaxes);
  const hasData = rows.some((r) => r.total !== undefined || r.seed !== undefined);

  return {
    rows,
    scaleMax,
    overallVelo,
    overallSeed,
    netRaceCraft,
    hasData,
  };
}

export function buildRaceBreakdown(rider: ZwiftRacingRider | null): RaceBreakdown {
  const race = rider?.race;
  const hasAny =
    race != null &&
    [race.finishes, race.wins, race.podiums, race.dnfs].some((v) => finiteNonNegative(v) !== undefined);

  if (!hasAny) {
    return {
      total: 0,
      finishes: 0,
      wins: 0,
      otherPodiums: 0,
      podiums: 0,
      otherFinishes: 0,
      dnfs: 0,
      winPct: null,
      podiumPct: null,
      finishPct: null,
      dnfPct: null,
      hasData: false,
    };
  }

  const finishes = Math.max(0, Math.round(finiteNonNegative(race.finishes) ?? 0));
  const dnfs = Math.max(0, Math.round(finiteNonNegative(race.dnfs) ?? 0));
  const wins = Math.min(finishes, Math.max(0, Math.round(finiteNonNegative(race.wins) ?? 0)));
  const podiums = Math.min(
    finishes,
    Math.max(wins, Math.round(finiteNonNegative(race.podiums) ?? 0)),
  );
  const otherPodiums = podiums - wins;
  const otherFinishes = finishes - podiums;
  const total = finishes + dnfs;

  const pct = (part: number): number | null =>
    total > 0 ? Math.round((part / total) * 100) : null;

  return {
    total,
    finishes,
    wins,
    otherPodiums,
    podiums,
    otherFinishes,
    dnfs,
    winPct: pct(wins),
    podiumPct: pct(podiums),
    finishPct: pct(finishes),
    dnfPct: pct(dnfs),
    hasData: true,
  };
}

const RANKING_SPECS: ReadonlyArray<{
  id: DisciplineRankingSummary['id'];
  label: string;
}> = [
  { id: 'gc', label: 'GC' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'climb', label: 'Climb' },
  { id: 'tt', label: 'TT' },
];

export function buildRankingsSummary(
  overview: ZwiftRacingOverview | null,
  male: boolean | undefined,
): RankingsSummary {
  const rankings = overview?.rankings;
  const isWomen = male === false;
  const tierSystem: VeloSystem = isWomen ? 'velo2Women' : 'velo2';

  const disciplines: DisciplineRankingSummary[] = RANKING_SPECS.map((spec) => {
    const entry = rankings?.[spec.id] as ZwiftRacingRankingEntry | undefined;
    const rawPct = finiteNonNegative(entry?.ranking);
    const percentile = rawPct !== undefined ? clamp(0, 100, rawPct) : null;
    const delta7d = finiteNumber(entry?.delta7d) ?? null;
    const standing = isWomen && entry?.women ? entry.women : (entry?.open ?? entry?.women);
    const place = finitePositive(standing?.place);
    const total = finitePositive(standing?.total);
    const catNum = finitePositive(standing?.category);
    const tier = catNum !== undefined ? getVeloTierByNumber(catNum, tierSystem) : undefined;

    return {
      id: spec.id,
      label: spec.label,
      percentile,
      delta7d,
      place,
      total,
      tier,
    };
  });

  let gcOverallPlace: RankingsSummary['gcOverallPlace'];
  const rawOverall = overview?.gcOverallPlace;
  if (rawOverall && typeof rawOverall === 'object') {
    const rank = finitePositive(rawOverall.rank);
    const total = finitePositive(rawOverall.total);
    if (rank !== undefined && total !== undefined) {
      gcOverallPlace = { rank, total };
    }
  }

  const hasData =
    gcOverallPlace !== undefined || disciplines.some((d) => d.percentile !== null);

  return {
    disciplines,
    gcOverallPlace,
    hasData,
  };
}

export function extractPowerModelMetrics(rider: ZwiftRacingRider | null): PowerModelMetric[] {
  const power = rider?.power;
  if (!power) return [];

  const metrics: PowerModelMetric[] = [];
  const cp = finitePositive(power.CP);
  if (cp !== undefined) {
    metrics.push({ key: 'CP', label: 'Critical Power (CP)', value: `${Math.round(cp)} W` });
  }

  const awc = finitePositive(power.AWC);
  if (awc !== undefined) {
    const awcKj = awc >= 1000 ? awc / 1000 : awc;
    metrics.push({
      key: 'AWC',
      label: 'Anaerobic Work (AWC)',
      value: `${awcKj.toFixed(1)} kJ`,
    });
  }

  const compoundScore = finiteNumber(power.compoundScore);
  if (compoundScore !== undefined) {
    metrics.push({
      key: 'compoundScore',
      label: 'Compound Score',
      value: compoundScore.toFixed(1),
    });
  }

  const powerRating = finiteNumber(power.powerRating);
  if (powerRating !== undefined) {
    metrics.push({
      key: 'powerRating',
      label: 'Power Rating',
      value: powerRating.toFixed(1),
    });
  }

  return metrics;
}
