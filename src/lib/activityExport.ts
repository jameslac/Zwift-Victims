import { formatZwiftWorld, zpNum } from './raceHistory';
import type { MergedRace } from './raceHistory';

export interface TelemetrySample {
  elapsedSec: number;
  timestampIso?: string;
  powerW?: number;
  wkg?: number;
  heartRateBpm?: number;
  cadenceRpm?: number;
  speedKmh?: number;
  distanceM?: number;
  altitudeM?: number;
  gradePct?: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
  leftRightBalance?: number;
  lap?: number;
}

export type TelemetrySource = 'fit' | 'fitness_data';
export type ExportFormat = 'csv' | 'fit' | 'both';
export type CsvPackaging = 'combined' | 'separate_zip';
export type SamplingIntervalSec = 1 | 5 | 10;

export interface ActivityExportRiderContext {
  riderId: number;
  riderName: string;
  weightKg?: number;
  ftpW?: number;
  category?: string;
  zrs?: number;
}

export interface ActivityExportItem {
  key: string;
  activityId: string;
  eventId?: string;
  riderId: number;
  title: string;
  activityTypeLabel?: string;
  dateSec?: number;
  startDateIso?: string;
  worldName?: string;
  routeName?: string;
  category?: string;
  subType?: string;
  truePlace?: number;
  fieldSize?: number;
  zpPlace?: number;
  durationSec?: number;
  distanceM?: number;
  elevationM?: number;
  avgPowerW?: number;
  normalizedPowerW?: number;
  maxPowerW?: number;
  avgWkg?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  avgCadenceRpm?: number;
  weightKg?: number;
  ftpW?: number;
  veloBefore?: number;
  veloAfter?: number;
  sof?: number;
}

export interface ParsedActivityTelemetry {
  source: TelemetrySource;
  samples: TelemetrySample[];
  sampleCount: number;
  durationSec?: number;
  fitBytes?: Uint8Array;
}

export interface CsvFormatOptions {
  includeGps: boolean;
  includeWkg: boolean;
  includeLap: boolean;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function finiteNum(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function finitePositive(value: unknown): number | undefined {
  const n = finiteNum(value);
  return n !== undefined && n > 0 ? n : undefined;
}

export function mergedRaceToExportItem(
  race: MergedRace,
  riderId: number,
  rider?: ActivityExportRiderContext,
): ActivityExportItem | null {
  if (!race.activityId) return null;

  const { zp, zr, activity } = race;
  const movingSec =
    typeof activity?.movingTimeInMs === 'number' && activity.movingTimeInMs > 0
      ? Math.round(activity.movingTimeInMs / 1000)
      : undefined;
  const durationSec = zpNum(zp?.time) ?? zr?.race?.time ?? movingSec;

  const distKm = zp?.distance ?? zr?.race?.distance ?? zr?.event?.distance;
  const distanceM =
    typeof distKm === 'number' && Number.isFinite(distKm) && distKm > 0
      ? distKm * 1000
      : finitePositive(activity?.distanceInMeters);

  const elevationM =
    zr?.event?.elevation ??
    (typeof activity?.totalElevation === 'number' && Number.isFinite(activity.totalElevation)
      ? activity.totalElevation
      : undefined);

  const avgPowerRaw = zpNum(zp?.avg_power) ?? finitePositive(activity?.avgWatts);
  const avgPowerW = avgPowerRaw !== undefined ? Math.round(avgPowerRaw) : undefined;
  const npRaw = zpNum(zp?.np);
  const normalizedPowerW = npRaw !== undefined ? Math.round(npRaw) : undefined;
  const maxWattsRaw = finitePositive(activity?.maxWatts);
  const maxPowerW = maxWattsRaw !== undefined ? Math.round(maxWattsRaw) : undefined;

  const activityProfileWeightG = finitePositive(
    (activity?.profile as Record<string, unknown> | undefined)?.weight,
  );
  const weightKg =
    zpNum(zp?.weight) ??
    zr?.race?.weight ??
    (activityProfileWeightG !== undefined ? activityProfileWeightG / 1000 : undefined) ??
    rider?.weightKg;

  const avgWkg =
    zpNum(zp?.avg_wkg) ??
    zr?.race?.wkgAvg ??
    (avgPowerW !== undefined && weightKg !== undefined && weightKg > 0
      ? roundTo(avgPowerW / weightKg, 2)
      : undefined);

  const avgHrRaw = zpNum(zp?.avg_hr) ?? finitePositive(activity?.avgHeartRate);
  const maxHrRaw = zpNum(zp?.max_hr) ?? finitePositive(activity?.maxHeartRate);
  const avgCadRaw = finitePositive(activity?.avgCadence);
  const ftpW = zpNum(zp?.wftp) ?? zpNum(zp?.ftp) ?? rider?.ftpW;

  return {
    key: race.key,
    activityId: race.activityId,
    eventId: race.eventId || undefined,
    riderId,
    title: race.title,
    activityTypeLabel: race.activityTypeLabel,
    dateSec: race.date,
    startDateIso:
      activity?.startDate ??
      (race.date !== undefined ? new Date(race.date * 1000).toISOString() : undefined),
    worldName: formatZwiftWorld(activity?.worldId),
    routeName: zr?.event?.routeName,
    category: zp?.category ?? zr?.event?.subgroupId,
    subType: zr?.event?.subType,
    truePlace: race.truePlace,
    fieldSize: race.fieldSize,
    zpPlace: race.zpPlace,
    durationSec,
    distanceM,
    elevationM,
    avgPowerW,
    normalizedPowerW,
    maxPowerW,
    avgWkg,
    avgHrBpm: avgHrRaw !== undefined ? Math.round(avgHrRaw) : undefined,
    maxHrBpm: maxHrRaw !== undefined ? Math.round(maxHrRaw) : undefined,
    avgCadenceRpm: avgCadRaw !== undefined ? Math.round(avgCadRaw) : undefined,
    weightKg,
    ftpW,
    veloBefore: zr?.velo?.elo?.before,
    veloAfter: zr?.velo?.elo?.after,
    sof: zr?.velo?.elo?.eventRating,
  };
}
