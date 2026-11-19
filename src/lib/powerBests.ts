import type { ZwiftPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { isRaceEntry } from './raceHistory';

/**
 * Standard power-curve durations from 1 second up to 1 hour (3600 seconds),
 * covering Zwift Feed's intervals plus 2m (ZwiftPower) and 60m (1 hr).
 */
export const STANDARD_POWER_DURATIONS = [
  1, 5, 15, 30, 60, 120, 180, 300, 600, 720, 900, 1200, 1800, 2400, 3600,
] as const;

/** Default benchmark intervals shown as selectable markers on the chart. */
export const DEFAULT_MARKED_DURATIONS = [
  1, 5, 15, 30, 60, 180, 300, 600, 900, 1200, 2400, 3600,
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
  shortLabel: string;
  zwiftAllTime?: PowerEffort;
  zwift90Day?: PowerEffort;
  zpRaceBest?: PowerEffort;
}

export interface PowerProfileMetrics {
  zftp?: number;
  zmap?: number;
  vo2max?: number;
}

export function formatDurationSecondsLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds === 3600) return '60 min (1 hr)';
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem}s`;
}

export function formatDurationShortLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m${rem}s`;
}

function parsePositiveNumber(v: unknown): number | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function pickNumber(obj: Record<string, unknown> | undefined | null, keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const candidate = parsePositiveNumber(obj[key]);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

export function extractPowerProfileMetrics(
  powerProfile?: ZwiftPowerProfile | null,
): PowerProfileMetrics {
  if (!powerProfile) return {};
  return {
    zftp: pickNumber(powerProfile, ['zftp', 'zFtp', 'zFTP']),
    zmap: pickNumber(powerProfile, ['zmap', 'zMap', 'zMAP']),
    vo2max: pickNumber(powerProfile, ['vo2max', 'vo2Max', 'zvo2', 'VO2max']),
  };
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

function getZpRaceBest(
  races: ZwiftPowerRaceEntry[],
  sec: number,
  weightKg?: number,
): PowerEffort | undefined {
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
      const wkg =
        parsePositiveNumber(zp[`wkg${sec}`]) ??
        (watts !== undefined && weightKg ? watts / weightKg : undefined);
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
        const avgWkg =
          parsePositiveNumber(zp.avg_wkg) ??
          (avgWatts !== undefined && weightKg ? avgWatts / weightKg : undefined);
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
  weightGrams,
}: {
  powerProfile?: ZwiftPowerProfile | null;
  zpRaces: ZwiftPowerRaceEntry[];
  weightGrams?: number;
}): PowerBestRow[] {
  const coreWeightKg =
    typeof weightGrams === 'number' && Number.isFinite(weightGrams) && weightGrams > 0
      ? weightGrams / 1000
      : undefined;

  const zwiftAllTimeContainer =
    powerProfile?.cpBestEfforts ??
    (powerProfile?.pointsWatts || powerProfile?.pointsWkg ? powerProfile : undefined);
  const zwiftAllTimeMap = extractZwiftEffortMap(zwiftAllTimeContainer, coreWeightKg);
  const zwift90DayMap = extractZwiftEffortMap(powerProfile?.relevantCpEfforts, coreWeightKg);

  const raceEntries = zpRaces.filter((zp) => isRaceEntry(zp));

  const durations = new Set<number>(STANDARD_POWER_DURATIONS);
  for (const sec of zwiftAllTimeMap.keys()) durations.add(sec);
  for (const sec of zwift90DayMap.keys()) durations.add(sec);
  const sortedDurations = [...durations].sort((a, b) => a - b);

  return sortedDurations.map((seconds) => ({
    seconds,
    label: formatDurationSecondsLabel(seconds),
    shortLabel: formatDurationShortLabel(seconds),
    zwiftAllTime: zwiftAllTimeMap.get(seconds),
    zwift90Day: zwift90DayMap.get(seconds),
    zpRaceBest: getZpRaceBest(raceEntries, seconds, coreWeightKg),
  }));
}

export type PowerMetricUnit = 'watts' | 'wkg';
export type PowerSeriesKey = 'zwiftAllTime' | 'zwift90Day' | 'zpRaceBest';

export interface PowerSeriesConfig {
  key: PowerSeriesKey;
  label: string;
  color: string;
  ownOnly: boolean;
}

export const POWER_SERIES_CONFIGS: readonly PowerSeriesConfig[] = [
  { key: 'zwiftAllTime', label: 'Zwift All-Time', color: '#fc6719', ownOnly: true },
  { key: 'zwift90Day', label: 'Zwift 90-Day', color: '#38bdf8', ownOnly: true },
  { key: 'zpRaceBest', label: 'ZwiftPower Race Best', color: '#34d399', ownOnly: false },
];

const PREFERRED_LOG_TICKS = new Set([1, 5, 15, 30, 60, 180, 300, 600, 1200, 2400, 3600]);

export function getEffortMetricValue(
  effort: PowerEffort | undefined,
  unit: PowerMetricUnit,
): number | undefined {
  if (!effort) return undefined;
  return unit === 'watts' ? effort.watts : effort.wkg;
}

export function formatEffortPrimary(
  effort: PowerEffort | undefined,
  unit: PowerMetricUnit,
): string {
  if (!effort) return '—';
  if (unit === 'watts') {
    return effort.watts !== undefined ? `${Math.round(effort.watts)} W` : '—';
  }
  return effort.wkg !== undefined ? `${effort.wkg.toFixed(2)} W/kg` : '—';
}

export function formatEffortSecondary(
  effort: PowerEffort | undefined,
  unit: PowerMetricUnit,
): string | undefined {
  if (!effort) return undefined;
  if (unit === 'watts') {
    return effort.wkg !== undefined ? `${effort.wkg.toFixed(2)} W/kg` : undefined;
  }
  return effort.watts !== undefined ? `${Math.round(effort.watts)} W` : undefined;
}

export function formatEffortDate(date: string | number | undefined): string | undefined {
  if (date === undefined || date === null || date === '') return undefined;
  const parsed = typeof date === 'number' ? new Date(date * 1000) : new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function computeNiceYScale(
  maxVal: number,
  unit: PowerMetricUnit,
): { maxY: number; ticks: number[] } {
  const safeMax = maxVal > 0 ? maxVal : unit === 'watts' ? 400 : 6;
  const rawStep = safeMax / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / mag;
  const niceFactor =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = niceFactor * mag;
  const maxY = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= maxY + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(4)));
  }
  return { maxY, ticks };
}

export function pickLogAxisTicks(
  rows: PowerBestRow[],
  xFor: (seconds: number) => number,
  minPixelGap = 32,
): PowerBestRow[] {
  const candidates = rows.filter((r) => PREFERRED_LOG_TICKS.has(r.seconds));
  const pool = candidates.length >= 2 ? candidates : rows;
  const chosen: PowerBestRow[] = [];
  let lastX = -Infinity;
  for (const row of pool) {
    const x = xFor(row.seconds);
    if (x - lastX >= minPixelGap) {
      chosen.push(row);
      lastX = x;
    }
  }
  return chosen;
}
