import type { ZwiftPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRider } from '../api/zwiftRacing';
import { isRaceEntry } from './raceHistory';

/**
 * Standard power-curve durations from 5 seconds up to 1 hour (3600 seconds),
 * covering Zwift Feed's 5s–40m intervals plus 2m (ZP/ZR) and 60m (1 hr).
 */
export const STANDARD_POWER_DURATIONS = [
  5, 15, 30, 60, 120, 180, 300, 600, 720, 900, 1200, 1800, 2400, 3600,
] as const;

const ZP_SPLIT_DURATIONS = new Set([5, 15, 30, 60, 120, 300, 1200]);

export interface PowerEffort {
  watts?: number;
  wkg?: number;
  date?: string | number;
  eventTitle?: string;
  /** True when derived from a full-race average over a race lasting >= target duration. */
  isSustainedRaceAvg?: boolean;
}

export interface PowerBestRow {
  seconds: number;
  label: string;
  zwiftAllTime?: PowerEffort;
  zwiftRecent?: PowerEffort;
  zpRaceBest?: PowerEffort;
  zr90d?: PowerEffort;
  zrCpModel?: PowerEffort;
  /** Best observed watts across real efforts (or CP model fallback) for bar visualization. */
  peakWatts?: number;
}

export function formatDurationSecondsLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds === 3600) return '60 min (1 hr)';
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem}s`;
}

function parsePositiveNumber(v: unknown): number | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function parseDurationKey(rawKey: string): number | null {
  const key = rawKey.trim();
  if (/^\d+$/.test(key)) return Number(key);
  const secMatch = key.match(/^(\d+)\s*s(?:ec)?$/i) ?? key.match(/^PT(\d+)S$/i);
  if (secMatch) return Number(secMatch[1]);
  const minMatch = key.match(/^(\d+)\s*m(?:in)?$/i) ?? key.match(/^PT(\d+)M$/i);
  if (minMatch) return Number(minMatch[1]) * 60;
  const hrMatch = key.match(/^(\d+)\s*h(?:r|ours?)?$/i) ?? key.match(/^PT(\d+)H$/i);
  if (hrMatch) return Number(hrMatch[1]) * 3600;
  return null;
}

function extractPointValue(
  raw: unknown,
  preferredKeys: Array<'watts' | 'wkg'>,
): { value?: number; date?: string } {
  if (typeof raw === 'number') {
    return { value: Number.isFinite(raw) && raw > 0 ? raw : undefined };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  let value: number | undefined;
  for (const key of [...preferredKeys, 'value', 'power']) {
    const candidate = parsePositiveNumber(rec[key]);
    if (candidate !== undefined) {
      value = candidate;
      break;
    }
  }
  const dateRaw = rec.date ?? rec.timestamp;
  const date = typeof dateRaw === 'string' && dateRaw.trim() !== '' ? dateRaw : undefined;
  return { value, date };
}

function addEffortPoint(
  map: Map<number, PowerEffort>,
  sec: number,
  patch: Partial<PowerEffort>,
): void {
  if (!Number.isFinite(sec) || sec <= 0 || sec > 3600) return;
  const prev = map.get(sec) ?? {};
  map.set(sec, {
    watts: patch.watts ?? prev.watts,
    wkg: patch.wkg ?? prev.wkg,
    date: patch.date ?? prev.date,
    eventTitle: patch.eventTitle ?? prev.eventTitle,
    isSustainedRaceAvg: patch.isSustainedRaceAvg ?? prev.isSustainedRaceAvg,
  });
}

function extractZwiftEffortMap(container: unknown, weightKg?: number): Map<number, PowerEffort> {
  const map = new Map<number, PowerEffort>();
  if (!container || typeof container !== 'object') return map;

  if (Array.isArray(container)) {
    for (const item of container) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const rawDur = rec.duration ?? rec.seconds ?? rec.time ?? rec.interval;
      const sec =
        typeof rawDur === 'number'
          ? rawDur
          : typeof rawDur === 'string'
            ? parseDurationKey(rawDur)
            : null;
      if (sec == null) continue;
      const watts = parsePositiveNumber(rec.watts ?? rec.power ?? rec.value);
      const wkg = parsePositiveNumber(rec.wkg);
      const dateRaw = rec.date ?? rec.timestamp;
      const date = typeof dateRaw === 'string' && dateRaw.trim() !== '' ? dateRaw : undefined;
      if (watts !== undefined || wkg !== undefined) {
        addEffortPoint(map, sec, { watts, wkg, date });
      }
    }
  } else {
    const rec = container as Record<string, unknown>;
    const pointsWatts = rec.pointsWatts;
    const pointsWkg = rec.pointsWkg;

    if (pointsWatts && typeof pointsWatts === 'object' && !Array.isArray(pointsWatts)) {
      for (const [key, raw] of Object.entries(pointsWatts as Record<string, unknown>)) {
        const sec = parseDurationKey(key);
        if (sec == null) continue;
        const { value, date } = extractPointValue(raw, ['watts']);
        if (value !== undefined) addEffortPoint(map, sec, { watts: value, date });
      }
    }
    if (pointsWkg && typeof pointsWkg === 'object' && !Array.isArray(pointsWkg)) {
      for (const [key, raw] of Object.entries(pointsWkg as Record<string, unknown>)) {
        const sec = parseDurationKey(key);
        if (sec == null) continue;
        const { value, date } = extractPointValue(raw, ['wkg']);
        if (value !== undefined) addEffortPoint(map, sec, { wkg: value, date });
      }
    }

    // Fallback when container itself is keyed by duration seconds.
    if (!pointsWatts && !pointsWkg) {
      for (const [key, raw] of Object.entries(rec)) {
        const sec = parseDurationKey(key);
        if (sec == null) continue;
        const { value, date } = extractPointValue(raw, ['watts']);
        const wkgDirect =
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? parsePositiveNumber((raw as Record<string, unknown>).wkg)
            : undefined;
        if (value !== undefined || wkgDirect !== undefined) {
          addEffortPoint(map, sec, { watts: value, wkg: wkgDirect, date });
        }
      }
    }
  }

  if (weightKg && weightKg > 0) {
    for (const [sec, effort] of map) {
      if (effort.watts !== undefined && effort.wkg === undefined) {
        map.set(sec, { ...effort, wkg: effort.watts / weightKg });
      }
    }
  }

  return map;
}

function getZpRaceBest(races: ZwiftPowerRaceEntry[], sec: number): PowerEffort | undefined {
  let best: PowerEffort | undefined;
  let bestScore = -1;

  function consider(candidate: PowerEffort): void {
    const score = candidate.watts ?? (candidate.wkg !== undefined ? candidate.wkg * 100 : -1);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  for (const zp of races) {
    if (ZP_SPLIT_DURATIONS.has(sec)) {
      const watts = parsePositiveNumber(zp[`w${sec}`]);
      const wkg = parsePositiveNumber(zp[`wkg${sec}`]);
      if (watts !== undefined || wkg !== undefined) {
        consider({
          watts,
          wkg,
          date: zp.event_date,
          eventTitle: zp.event_title,
          isSustainedRaceAvg: false,
        });
      }
    }

    if (sec >= 180) {
      const raceTimeSec = parsePositiveNumber(zp.time);
      if (raceTimeSec !== undefined && raceTimeSec >= sec) {
        const avgWatts = parsePositiveNumber(zp.avg_power);
        const avgWkg = parsePositiveNumber(zp.avg_wkg);
        if (avgWatts !== undefined || avgWkg !== undefined) {
          consider({
            watts: avgWatts,
            wkg: avgWkg,
            date: zp.event_date,
            eventTitle: zp.event_title,
            isSustainedRaceAvg: true,
          });
        }
      }
    }
  }

  return best;
}

export function buildPowerBests({
  powerProfile,
  zpRaces,
  zrRider,
  weightGrams,
}: {
  powerProfile?: ZwiftPowerProfile | null;
  zpRaces: ZwiftPowerRaceEntry[];
  zrRider?: ZwiftRacingRider | null;
  weightGrams?: number;
}): PowerBestRow[] {
  const coreWeightKg =
    typeof weightGrams === 'number' && Number.isFinite(weightGrams) && weightGrams > 0
      ? weightGrams / 1000
      : undefined;

  const zrWeightKg =
    typeof zrRider?.weight === 'number' && Number.isFinite(zrRider.weight) && zrRider.weight > 0
      ? zrRider.weight > 300
        ? zrRider.weight / 1000
        : zrRider.weight
      : coreWeightKg;

  const zwiftAllTimeContainer =
    powerProfile?.cpBestEfforts ??
    (powerProfile?.pointsWatts || powerProfile?.pointsWkg ? powerProfile : undefined);
  const zwiftAllTimeMap = extractZwiftEffortMap(zwiftAllTimeContainer, coreWeightKg);
  const zwiftRecentMap = extractZwiftEffortMap(powerProfile?.relevantCpEfforts, coreWeightKg);

  const raceEntries = zpRaces.filter((zp) => isRaceEntry(zp));

  const durations = new Set<number>(STANDARD_POWER_DURATIONS);
  for (const sec of zwiftAllTimeMap.keys()) durations.add(sec);
  for (const sec of zwiftRecentMap.keys()) durations.add(sec);
  const sortedDurations = [...durations].sort((a, b) => a - b);

  const cp = parsePositiveNumber(zrRider?.power?.CP);
  const awcRaw =
    typeof zrRider?.power?.AWC === 'number' &&
    Number.isFinite(zrRider.power.AWC) &&
    zrRider.power.AWC >= 0
      ? zrRider.power.AWC
      : undefined;
  const awcJoules = awcRaw !== undefined ? (awcRaw < 200 ? awcRaw * 1000 : awcRaw) : undefined;

  return sortedDurations.map((seconds) => {
    const zwiftAllTime = zwiftAllTimeMap.get(seconds);
    const zwiftRecent = zwiftRecentMap.get(seconds);
    const zpRaceBest = getZpRaceBest(raceEntries, seconds);

    let zr90d: PowerEffort | undefined;
    if (ZP_SPLIT_DURATIONS.has(seconds) && zrRider?.power) {
      const watts = parsePositiveNumber(zrRider.power[`w${seconds}`]);
      const wkgDirect = parsePositiveNumber(zrRider.power[`wkg${seconds}`]);
      const wkg = wkgDirect ?? (watts !== undefined && zrWeightKg ? watts / zrWeightKg : undefined);
      if (watts !== undefined || wkg !== undefined) {
        zr90d = { watts, wkg };
      }
    }

    let zrCpModel: PowerEffort | undefined;
    if (seconds >= 180 && !zr90d && cp !== undefined && awcJoules !== undefined) {
      const watts = Math.round(cp + awcJoules / seconds);
      zrCpModel = {
        watts,
        wkg: zrWeightKg ? watts / zrWeightKg : undefined,
      };
    }

    const peakWatts = Math.max(
      zwiftAllTime?.watts ?? 0,
      zwiftRecent?.watts ?? 0,
      zpRaceBest?.watts ?? 0,
      zr90d?.watts ?? 0,
      zrCpModel?.watts ?? 0,
    );

    return {
      seconds,
      label: formatDurationSecondsLabel(seconds),
      zwiftAllTime,
      zwiftRecent,
      zpRaceBest,
      zr90d,
      zrCpModel,
      peakWatts: peakWatts > 0 ? peakWatts : undefined,
    };
  });
}
