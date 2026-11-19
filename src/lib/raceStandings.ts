import type {
  ZwiftActivityDetail,
  ZwiftEventSubgroup,
  ZwiftProfile,
  ZwiftPublicEvent,
  ZwiftRaceResultEntry,
} from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingEventPen, ZwiftRacingEventResponse, ZwiftRacingEventRider } from '../api/zwiftRacing';
import {
  decodeHtmlEntities,
  extractCoreZrs,
  formatZpRiderCategory,
  subgroupCategoryLabel,
  zpNum,
} from './raceHistory';

export type PenSystem = 'zrs' | 'category_enforcement' | 'category';

export interface PenOption {
  key: string;
  subgroupId: number | null;
  category?: string;
  label: string;
  rangeLabel?: string;
}

export interface SplitPair {
  w?: number;
  wkg?: number;
}

export const POWER_CURVE_INTERVALS = [
  { key: 's5', label: '5s' },
  { key: 's15', label: '15s' },
  { key: 's30', label: '30s' },
  { key: 'm1', label: '1m' },
  { key: 'm2', label: '2m' },
  { key: 'm5', label: '5m' },
  { key: 'm20', label: '20m' },
] as const;

export type PowerCurveKey = (typeof POWER_CURVE_INTERVALS)[number]['key'];
export type PowerCurveSplits = Record<PowerCurveKey, SplitPair>;

export interface UnifiedStandingRow {
  key: string;
  riderId: number;
  name: string;
  team?: string;
  rank?: number;
  zpPlace?: number;
  zpOverallPlace?: number;
  riderCategory?: string;
  zrsScore?: number;
  zrsDelta?: number;
  velo?: number;
  veloDelta?: number;
  expectedPosition?: number;
  overallExpectedPosition?: number;
  seedExpectedPosition?: number;
  expectedPlaceRange?: { low?: number; high?: number };
  phenotype?: string;
  weightGrams?: number;
  timeSec?: number;
  gapSec?: number;
  avgWatts?: number;
  np?: number;
  avgWkg?: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeedMps?: number;
  maxSpeedMps?: number;
  splits: PowerCurveSplits;
  didNotFinish: boolean;
  disqualified: boolean;
  penalty?: string;
  upg: boolean;
  flaggedCheating: boolean;
  flaggedSandbagging: boolean;
  hiddenOnZp: boolean;
  sources: {
    core: boolean;
    zr: boolean;
    zpView: boolean;
    zpZwift: boolean;
  };
}

const LABEL_TO_CAT: Record<string, string> = {
  '1': 'A',
  '2': 'B',
  '3': 'C',
  '4': 'D',
  '5': 'E',
};

const CAT_TO_LABEL: Record<string, string> = {
  A: '1',
  'A+': '1',
  B: '2',
  C: '3',
  D: '4',
  E: '5',
};

const PHENOTYPE_LABELS: Record<string, string> = {
  allrounder: 'All-Rounder',
  timetrialist: 'Time Trialist',
  tt: 'Time Trialist',
  sprinter: 'Sprinter',
  puncheur: 'Puncheur',
  pursuiter: 'Pursuiter',
  climber: 'Climber',
};

export function formatPhenotype(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return PHENOTYPE_LABELS[key] ?? raw;
}

function hasZrsBounds(text: string | null | undefined): boolean {
  if (!text) return false;
  const nums = text.match(/\d+/g);
  return Boolean(nums?.some((n) => Number(n) >= 50));
}

function normalizeRangeText(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s*\bMax\b\s*$/i, '').replace(/\s*-\s*/g, '–').trim();
  return cleaned || undefined;
}

function formatPaceRange(sg: ZwiftEventSubgroup | undefined, penSystem: PenSystem): string | undefined {
  if (!sg || penSystem === 'zrs') return undefined;
  const from = typeof sg.fromPaceValue === 'number' ? sg.fromPaceValue : 0;
  const to = typeof sg.toPaceValue === 'number' ? sg.toPaceValue : 0;
  if (to <= 0 || to > 10) return undefined;
  return from > 0 ? `${from.toFixed(1)}–${to.toFixed(1)} W/kg` : `≤${to.toFixed(1)} W/kg`;
}

export function detectPenSystem(
  publicEvent?: ZwiftPublicEvent,
  zrEvent?: ZwiftRacingEventResponse | null,
): PenSystem {
  if (
    typeof publicEvent?.accessExpression === 'string' &&
    /scoring\./i.test(publicEvent.accessExpression)
  ) {
    return 'zrs';
  }
  if (hasZrsBounds(publicEvent?.rangeAccessLabel)) return 'zrs';
  if (publicEvent?.eventSubgroups?.some((sg) => hasZrsBounds(sg.rangeAccessLabel))) return 'zrs';
  if (zrEvent?.pens?.some((p) => hasZrsBounds(p.rangeLabel))) return 'zrs';
  if (publicEvent?.categoryEnforcement) return 'category_enforcement';
  return 'category';
}

function findMatchingZrPen(
  zrEvent: ZwiftRacingEventResponse | null | undefined,
  subgroupId: number | null,
  category: string | undefined,
): ZwiftRacingEventPen | undefined {
  const pens = zrEvent?.pens;
  if (!pens || pens.length === 0) return undefined;
  if (subgroupId != null) {
    const byId = pens.find((p) => Number(p.id) === subgroupId);
    if (byId) return byId;
  }
  if (category) {
    const base = category.trim().toUpperCase().replace(/\+$/, '');
    const byName = pens.find((p) => p.name?.trim().toUpperCase() === base);
    if (byName) return byName;
  }
  return undefined;
}

export function buildPenOptions(
  publicEvent?: ZwiftPublicEvent,
  zrEvent?: ZwiftRacingEventResponse | null,
  zpViewResults: ZwiftPowerRaceEntry[] = [],
  zpZwiftResults: ZwiftPowerRaceEntry[] = [],
): { penSystem: PenSystem; pens: PenOption[] } {
  const penSystem = detectPenSystem(publicEvent, zrEvent);
  const subgroups = publicEvent?.eventSubgroups ?? [];

  if (subgroups.length > 0) {
    const pens: PenOption[] = subgroups.map((sg) => {
      const cat = subgroupCategoryLabel(sg);
      const zrPen = findMatchingZrPen(zrEvent, sg.id, cat);
      const rangeLabel =
        normalizeRangeText(sg.rangeAccessLabel) ??
        normalizeRangeText(zrPen?.rangeLabel) ??
        formatPaceRange(sg, penSystem);
      const baseName = cat ? (penSystem === 'zrs' ? `Pen ${cat}` : `Cat ${cat}`) : sg.name || `Pen ${sg.id}`;
      return {
        key: `sg-${sg.id}`,
        subgroupId: sg.id,
        category: cat,
        label: rangeLabel ? `${baseName} · ${rangeLabel}` : baseName,
        rangeLabel,
      };
    });
    return { penSystem, pens };
  }

  const zrPens = zrEvent?.pens ?? [];
  if (zrPens.length > 0) {
    const pens: PenOption[] = zrPens.map((pen, idx) => {
      const cat = pen.name?.trim().toUpperCase() || undefined;
      const subgroupId = pen.id && /^\d+$/.test(String(pen.id)) ? Number(pen.id) : null;
      const rangeLabel = normalizeRangeText(pen.rangeLabel);
      const baseName = cat ? (penSystem === 'zrs' ? `Pen ${cat}` : `Cat ${cat}`) : `Pen ${idx + 1}`;
      return {
        key: `zr-${pen.id ?? cat ?? idx}`,
        subgroupId,
        category: cat,
        label: rangeLabel ? `${baseName} · ${rangeLabel}` : baseName,
        rangeLabel,
      };
    });
    return { penSystem, pens };
  }

  const fallbackCats = new Set<string>();
  for (const entry of zpViewResults) {
    const cat = entry.category?.trim().toUpperCase().replace(/\+$/, '');
    if (cat) fallbackCats.add(cat);
  }
  for (const entry of zpZwiftResults) {
    const lbl = entry.label != null ? LABEL_TO_CAT[String(entry.label).trim()] : undefined;
    if (lbl) fallbackCats.add(lbl);
  }

  const pens: PenOption[] = Array.from(fallbackCats)
    .sort()
    .map((cat) => ({
      key: `cat-${cat}`,
      subgroupId: null,
      category: cat,
      label: penSystem === 'zrs' ? `Pen ${cat}` : `Cat ${cat}`,
    }));
  return { penSystem, pens };
}

function matchesZpViewPen(
  entry: ZwiftPowerRaceEntry,
  pen: PenOption | null,
  totalPens: number,
): boolean {
  if (!pen) return true;
  if (pen.subgroupId != null && typeof entry.uid === 'string' && entry.uid.startsWith(String(pen.subgroupId))) {
    return true;
  }
  const penCat = pen.category?.trim().toUpperCase().replace(/\+$/, '');
  if (penCat && typeof entry.category === 'string' && entry.category.trim()) {
    return entry.category.trim().toUpperCase().replace(/\+$/, '') === penCat;
  }
  const expectedLbl = penCat ? CAT_TO_LABEL[penCat] : undefined;
  if (expectedLbl && entry.label != null && String(entry.label).trim() !== '') {
    return String(entry.label).trim() === expectedLbl;
  }
  return totalPens <= 1;
}

function matchesZpZwiftPen(
  entry: ZwiftPowerRaceEntry,
  pen: PenOption | null,
  totalPens: number,
): boolean {
  if (!pen) return true;
  const penCat = pen.category?.trim().toUpperCase().replace(/\+$/, '');
  const expectedLbl = penCat ? CAT_TO_LABEL[penCat] : undefined;
  if (expectedLbl && entry.label != null && String(entry.label).trim() !== '') {
    return String(entry.label).trim() === expectedLbl;
  }
  return totalPens <= 1;
}

function positiveNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

export function makeSplit(
  zpWatts: unknown,
  zpWkg: unknown,
  zrWkg: number | undefined,
  coreWatts: number | undefined,
  weightKg: number | undefined,
): SplitPair {
  let w = zpNum(zpWatts) ?? (coreWatts != null && coreWatts > 0 ? Math.round(coreWatts) : undefined);
  let wkg = zpNum(zpWkg) ?? (zrWkg != null && zrWkg > 0 ? zrWkg : undefined);
  if (w === undefined && wkg !== undefined && weightKg && weightKg > 0) {
    w = Math.round(wkg * weightKg);
  }
  if (wkg === undefined && w !== undefined && weightKg && weightKg > 0) {
    wkg = w / weightKg;
  }
  return { w, wkg };
}

function profileActualCategory(profile: ZwiftProfile | null | undefined): string | undefined {
  if (!profile) return undefined;
  const metrics = profile.competitionMetrics;
  const open = metrics?.category?.trim() || undefined;
  const women = metrics?.categoryWomen?.trim() || undefined;
  if (profile.male === false && women) {
    return open && open !== women ? `${women} (W) / ${open}` : `${women} (W)`;
  }
  return open ?? women;
}

export function mergePenStandings(opts: {
  selectedPen: PenOption | null;
  totalPensCount: number;
  coreResults: ZwiftRaceResultEntry[];
  zrEvent?: ZwiftRacingEventResponse | null;
  zpViewResults: ZwiftPowerRaceEntry[];
  zpZwiftResults: ZwiftPowerRaceEntry[];
  zpViewLoaded: boolean;
  targetRiderId: number;
  targetProfile?: ZwiftProfile;
  loggedInProfile?: ZwiftProfile | null;
  eventDistanceMeters?: number;
  targetActivityDetail?: ZwiftActivityDetail;
}): UnifiedStandingRow[] {
  const {
    selectedPen,
    totalPensCount,
    coreResults,
    zrEvent,
    zpViewResults,
    zpZwiftResults,
    zpViewLoaded,
    targetRiderId,
    targetProfile,
    loggedInProfile,
    eventDistanceMeters,
    targetActivityDetail,
  } = opts;

  const zrPen = findMatchingZrPen(
    zrEvent,
    selectedPen?.subgroupId ?? null,
    selectedPen?.category,
  );
  const zrRiders = zrPen?.riders ?? [];
  const zpViewPen = zpViewResults.filter((e) => matchesZpViewPen(e, selectedPen, totalPensCount));
  const zpZwiftPen = zpZwiftResults.filter((e) => matchesZpZwiftPen(e, selectedPen, totalPensCount));

  interface Bundle {
    riderId: number;
    core?: ZwiftRaceResultEntry;
    zr?: ZwiftRacingEventRider;
    zpView?: ZwiftPowerRaceEntry;
    zpZwift?: ZwiftPowerRaceEntry;
  }

  const byRider = new Map<number, Bundle>();
  let syntheticId = -1;

  function ensure(idVal: unknown): Bundle {
    const parsed = Number(idVal);
    const id = Number.isFinite(parsed) && parsed > 0 ? parsed : syntheticId--;
    let b = byRider.get(id);
    if (!b) {
      b = { riderId: id };
      byRider.set(id, b);
    }
    return b;
  }

  for (const core of coreResults) ensure(core.profileId).core = core;
  for (const zr of zrRiders) ensure(zr.riderId).zr = zr;
  for (const zpView of zpViewPen) ensure(zpView.zwid).zpView = zpView;
  for (const zpZwift of zpZwiftPen) ensure(zpZwift.zwid).zpZwift = zpZwift;

  const rows: UnifiedStandingRow[] = [];

  for (const bundle of byRider.values()) {
    const { riderId, core, zr, zpView, zpZwift } = bundle;
    const zpZwiftRec = zpZwift as Record<string, unknown> | undefined;

    const coreName = [core?.profileData?.firstName, core?.profileData?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const rawName =
      coreName ||
      zpView?.name ||
      zr?.name ||
      zpZwift?.name ||
      (riderId > 0 ? `Rider ${riderId}` : 'Unknown rider');
    const name = decodeHtmlEntities(rawName).trim() || `Rider ${riderId}`;
    const rawTeam = zpView?.tname || zr?.club?.name || undefined;
    const team = rawTeam ? decodeHtmlEntities(rawTeam).trim() || undefined : undefined;

    const zpZwiftDq =
      typeof zpZwiftRec?.dq_cat === 'string' && zpZwiftRec.dq_cat.trim() !== ''
        ? zpZwiftRec.dq_cat.trim()
        : undefined;
    const penalty = zpView?.penalty?.trim() || zpZwiftDq || undefined;
    const didNotFinish = Boolean(zr?.didNotFinish);
    const disqualified = Boolean(
      zr?.disqualified || (penalty && /\b(dq|wkg|hr|upg)\b/i.test(penalty)),
    );

    const coreRank =
      typeof core?.rank === 'number' && Number.isFinite(core.rank) && core.rank > 0
        ? core.rank
        : undefined;
    const zrRank =
      !didNotFinish &&
      !disqualified &&
      typeof zr?.position === 'number' &&
      Number.isFinite(zr.position) &&
      zr.position > 0
        ? zr.position
        : undefined;
    const zpPlace =
      typeof zpView?.position_in_cat === 'number' && zpView.position_in_cat > 0
        ? zpView.position_in_cat
        : undefined;
    const zpZwiftPos =
      zpZwift?.pos != null && Number(zpZwift.pos) > 0 ? Number(zpZwift.pos) : undefined;
    const zpOverallPlace =
      typeof zpView?.pos === 'number' && zpView.pos > 0 ? zpView.pos : zpZwiftPos;

    const rank = coreRank ?? zrRank ?? zpPlace ?? zpZwiftPos;

    const weightGrams =
      core?.profileData?.weightInGrams ??
      (zpNum(zpView?.weight) != null ? zpNum(zpView?.weight)! * 1000 : undefined) ??
      (zr?.weight != null && zr.weight > 0 ? zr.weight * 1000 : undefined);
    const weightKg = weightGrams && weightGrams > 0 ? weightGrams / 1000 : undefined;

    const coreTimeSec =
      core?.activityData?.durationInMilliseconds != null &&
      core.activityData.durationInMilliseconds > 0
        ? core.activityData.durationInMilliseconds / 1000
        : undefined;
    const timeSec =
      coreTimeSec ?? zpNum(zpView?.time) ?? zr?.time ?? zpNum(zpZwiftRec?.race_time);

    const gapSec =
      zpView?.gap ??
      zr?.gap ??
      (typeof zpZwiftRec?.time_diff === 'number' && Number.isFinite(zpZwiftRec.time_diff)
        ? (zpZwiftRec.time_diff as number)
        : undefined);

    const coreWatts =
      core?.sensorData?.avgWatts != null ? Math.round(core.sensorData.avgWatts) : undefined;
    const zrWatts =
      zr?.wkgAvg != null && weightKg ? Math.round(zr.wkgAvg * weightKg) : undefined;
    const avgWatts = zpNum(zpView?.avg_power) ?? coreWatts ?? zpNum(zpZwiftRec?.watts) ?? zrWatts;

    const np =
      zpNum(zpView?.np) ??
      (typeof zr?.np === 'number' && zr.np > 0 ? Math.round(zr.np) : undefined);

    const avgWkg =
      zpNum(zpView?.avg_wkg) ??
      zr?.wkgAvg ??
      zpNum(zpZwiftRec?.wkg) ??
      (avgWatts != null && weightKg ? avgWatts / weightKg : undefined);

    const avgHr =
      zpNum(zpView?.avg_hr) ??
      core?.sensorData?.heartRateData?.avgHeartRate ??
      zpNum(zpZwiftRec?.bpm);
    const maxHr = zpNum(zpView?.max_hr) ?? core?.sensorData?.heartRateData?.maxHeartRate;

    let avgSpeedMps: number | undefined;
    if (typeof zr?.avgSpeed === 'number' && Number.isFinite(zr.avgSpeed) && zr.avgSpeed > 0) {
      avgSpeedMps = zr.avgSpeed / 3.6;
    } else if (
      core?.activityData?.segmentDistanceInCentimeters != null &&
      core.activityData.segmentDistanceInCentimeters > 0 &&
      core?.activityData?.durationInMilliseconds != null &&
      core.activityData.durationInMilliseconds > 0
    ) {
      avgSpeedMps =
        core.activityData.segmentDistanceInCentimeters /
        100 /
        (core.activityData.durationInMilliseconds / 1000);
    } else if (!didNotFinish && timeSec != null && timeSec > 30) {
      const rowDistMeters =
        zr?.distance != null && zr.distance > 0
          ? zr.distance * 1000
          : zpView?.distance != null && zpView.distance > 0
            ? zpView.distance * 1000
            : eventDistanceMeters;
      if (rowDistMeters != null && rowDistMeters > 100) {
        const mps = rowDistMeters / timeSec;
        if (mps > 0 && mps < 30) avgSpeedMps = mps;
      }
    }
    if (
      avgSpeedMps == null &&
      riderId === targetRiderId &&
      targetActivityDetail?.avgSpeedInMetersPerSecond != null &&
      targetActivityDetail.avgSpeedInMetersPerSecond > 0
    ) {
      avgSpeedMps = targetActivityDetail.avgSpeedInMetersPerSecond;
    }

    const maxSpeedMps =
      riderId === targetRiderId
        ? positiveNum(targetActivityDetail?.maxSpeedInMetersPerSecond)
        : undefined;

    const coreZrs = extractCoreZrs(core);
    const profileZrsFallback =
      riderId === targetRiderId
        ? (targetProfile?.competitionMetrics?.racingScore ?? undefined)
        : riderId === loggedInProfile?.id
          ? (loggedInProfile?.competitionMetrics?.racingScore ?? undefined)
          : undefined;
    const zrsScore = coreZrs.score ?? profileZrsFallback ?? undefined;

    const profileCatFallback =
      riderId === targetRiderId
        ? profileActualCategory(targetProfile)
        : riderId === loggedInProfile?.id
          ? profileActualCategory(loggedInProfile)
          : undefined;
    const riderCategory =
      formatZpRiderCategory(zpView?.div, zpView?.divw, zpView?.male) ?? profileCatFallback;

    const veloAfter = zr?.velo?.elo?.after ?? zr?.riderVelo?.race;
    const veloBefore = zr?.velo?.elo?.before;
    const veloDelta =
      zr?.velo?.elo?.adjustedChange ??
      zr?.velo?.elo?.rawChange ??
      (veloAfter != null && veloBefore != null ? veloAfter - veloBefore : undefined);

    const eventExpectedPos = positiveNum(zr?.velo?.elo?.expectedPosition);
    const overallExpectedPos = positiveNum(zr?.expectedPosition);
    const seedExpectedPos = positiveNum(zr?.velo?.seed?.expectedPosition);

    const hiddenOnZp = zpViewLoaded && !zpView && (Boolean(core) || Boolean(zr) || Boolean(zpZwift));

    rows.push({
      key: `rider-${riderId}`,
      riderId,
      name,
      team,
      rank,
      zpPlace,
      zpOverallPlace,
      riderCategory,
      zrsScore,
      zrsDelta: coreZrs.delta,
      velo: veloAfter,
      veloDelta,
      expectedPosition: eventExpectedPos ?? overallExpectedPos,
      overallExpectedPosition:
        eventExpectedPos != null &&
        overallExpectedPos != null &&
        Math.round(eventExpectedPos) !== Math.round(overallExpectedPos)
          ? overallExpectedPos
          : undefined,
      seedExpectedPosition: seedExpectedPos,
      expectedPlaceRange: zr?.expectedPlaceRange,
      phenotype: formatPhenotype(zr?.phenotype?.label),
      weightGrams,
      timeSec,
      gapSec,
      avgWatts,
      np,
      avgWkg,
      avgHr,
      maxHr,
      avgSpeedMps,
      maxSpeedMps,
      splits: {
        s5: makeSplit(zpView?.w5, zpView?.wkg5, zr?.wkg5, undefined, weightKg),
        s15: makeSplit(
          zpView?.w15,
          zpView?.wkg15,
          zr?.wkg15,
          core?.criticalP?.criticalP15Seconds,
          weightKg,
        ),
        s30: makeSplit(zpView?.w30, zpView?.wkg30, zr?.wkg30, undefined, weightKg),
        m1: makeSplit(
          zpView?.w60,
          zpView?.wkg60,
          zr?.wkg60,
          core?.criticalP?.criticalP1Minute,
          weightKg,
        ),
        m2: makeSplit(zpView?.w120, zpView?.wkg120, zr?.wkg120, undefined, weightKg),
        m5: makeSplit(
          zpView?.w300,
          zpView?.wkg300,
          zr?.wkg300,
          core?.criticalP?.criticalP5Minutes,
          weightKg,
        ),
        m20: makeSplit(
          zpView?.w1200,
          zpView?.wkg1200,
          zr?.wkg1200,
          core?.criticalP?.criticalP20Minutes,
          weightKg,
        ),
      },
      didNotFinish,
      disqualified,
      penalty,
      upg: zpView?.upg === 1,
      flaggedCheating: Boolean(core?.flaggedCheating),
      flaggedSandbagging: Boolean(core?.flaggedSandbagging),
      hiddenOnZp,
      sources: {
        core: Boolean(core),
        zr: Boolean(zr),
        zpView: Boolean(zpView),
        zpZwift: Boolean(zpZwift),
      },
    });
  }

  const leaderTime = rows
    .filter((r) => !r.didNotFinish && !r.disqualified && r.timeSec != null && r.timeSec > 0)
    .reduce<number | undefined>((min, r) => (min == null || r.timeSec! < min ? r.timeSec! : min), undefined);

  if (leaderTime != null) {
    for (const row of rows) {
      if (row.gapSec == null && !row.didNotFinish && row.timeSec != null && row.timeSec >= leaderTime) {
        row.gapSec = row.timeSec - leaderTime;
      }
    }
  }

  return rows.sort((a, b) => {
    const aOut = a.didNotFinish || a.disqualified ? 1 : 0;
    const bOut = b.didNotFinish || b.disqualified ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;

    const aRank = a.rank ?? Number.MAX_SAFE_INTEGER;
    const bRank = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;

    const aTime = a.timeSec ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.timeSec ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;

    return a.name.localeCompare(b.name);
  });
}
