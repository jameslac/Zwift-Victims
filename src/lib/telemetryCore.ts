import { Decoder, Stream } from '@garmin/fitsdk';
import type { LapMesg, RecordMesg } from '@garmin/fitsdk';
import { finiteNum, finitePositive, roundTo } from './activityExport';
import type { ParsedActivityTelemetry, TelemetryLap, TelemetrySample } from './activityExport';

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0, 0);
const FIT_SYSTEM_TIME_THRESHOLD = 0x10000000;
const SEMICIRCLES_TO_DEGREES = 180 / 2147483648;
const SINT32_MAX = 0x7fffffff;
const SINT32_MIN = -0x80000000;

export const TELEMETRY_STREAM_FIELDS = [
  'elapsed_sec',
  'timestamp_utc',
  'power_w',
  'wkg',
  'heart_rate_bpm',
  'cadence_rpm',
  'speed_kmh',
  'distance_m',
  'altitude_m',
  'grade_pct',
  'latitude_deg',
  'longitude_deg',
  'left_right_balance',
  'lap',
] as const;

export type TelemetryFieldKey = (typeof TELEMETRY_STREAM_FIELDS)[number];

export const DEFAULT_MCP_STREAM_FIELDS: readonly TelemetryFieldKey[] = [
  'elapsed_sec',
  'power_w',
  'wkg',
  'heart_rate_bpm',
  'cadence_rpm',
  'speed_kmh',
  'distance_m',
  'altitude_m',
  'grade_pct',
];

export interface TelemetryWindowSummary {
  sampleCount: number;
  durationSec: number;
  startSec?: number;
  endSec?: number;
  avgPowerW?: number;
  normalizedPowerW?: number;
  maxPowerW?: number;
  avgWkg?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  avgCadenceRpm?: number;
  avgSpeedKmh?: number;
  distanceM?: number;
  elevationGainM?: number;
}

export interface DetectedInterval {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  avgPowerW: number;
  maxPowerW?: number;
  normalizedPowerW?: number;
  avgWkg?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  avgCadenceRpm?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toTimestampMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= FIT_SYSTEM_TIME_THRESHOLD) {
    return FIT_EPOCH_MS + value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

function buildLapEndTimesMs(lapMesgs: LapMesg[]): number[] {
  const ends: number[] = [];
  for (const lap of lapMesgs) {
    const endMs = toTimestampMs(lap.timestamp);
    if (endMs !== undefined) {
      ends.push(endMs);
      continue;
    }
    const startMs = toTimestampMs(lap.startTime);
    const elapsed = finitePositive(lap.totalElapsedTime);
    if (startMs !== undefined && elapsed !== undefined) {
      ends.push(startMs + elapsed * 1000);
    }
  }
  return ends.sort((a, b) => a - b);
}

function resolveLapNumber(tsMs: number | undefined, lapEndsMs: number[]): number | undefined {
  if (tsMs === undefined || lapEndsMs.length === 0) return undefined;
  for (let i = 0; i < lapEndsMs.length; i++) {
    if (tsMs <= lapEndsMs[i]) return i + 1;
  }
  return lapEndsMs.length;
}

function extractStructuredLaps(
  lapMesgs: LapMesg[],
  firstTimestampMs: number | undefined,
): TelemetryLap[] {
  const laps: TelemetryLap[] = [];
  for (let i = 0; i < lapMesgs.length; i++) {
    const lap = lapMesgs[i];
    const lapRec = lap as Record<string, unknown>;
    const startMs = toTimestampMs(lap.startTime);
    const endMs = toTimestampMs(lap.timestamp);
    const elapsedSec = finitePositive(lap.totalElapsedTime) ?? finitePositive(lap.totalTimerTime);

    const startSec =
      startMs !== undefined && firstTimestampMs !== undefined
        ? Math.max(0, Math.round((startMs - firstTimestampMs) / 1000))
        : undefined;
    const endSec =
      endMs !== undefined && firstTimestampMs !== undefined
        ? Math.max(0, Math.round((endMs - firstTimestampMs) / 1000))
        : startSec !== undefined && elapsedSec !== undefined
          ? Math.round(startSec + elapsedSec)
          : undefined;

    const speedMps = finitePositive(lapRec.enhancedAvgSpeed) ?? finitePositive(lap.avgSpeed);

    laps.push({
      lapNumber: i + 1,
      startSec,
      endSec,
      durationSec: elapsedSec !== undefined ? roundTo(elapsedSec, 1) : undefined,
      distanceM:
        finiteNum(lap.totalDistance) !== undefined && finiteNum(lap.totalDistance)! >= 0
          ? roundTo(finiteNum(lap.totalDistance)!, 1)
          : undefined,
      avgPowerW:
        finiteNum(lap.avgPower) !== undefined && finiteNum(lap.avgPower)! >= 0 && finiteNum(lap.avgPower)! < 5000
          ? Math.round(finiteNum(lap.avgPower)!)
          : undefined,
      maxPowerW:
        finitePositive(lap.maxPower) !== undefined && finitePositive(lap.maxPower)! < 5000
          ? Math.round(finitePositive(lap.maxPower)!)
          : undefined,
      normalizedPowerW:
        finitePositive(lap.normalizedPower) !== undefined && finitePositive(lap.normalizedPower)! < 5000
          ? Math.round(finitePositive(lap.normalizedPower)!)
          : undefined,
      avgHrBpm:
        finitePositive(lap.avgHeartRate) !== undefined && finitePositive(lap.avgHeartRate)! < 255
          ? Math.round(finitePositive(lap.avgHeartRate)!)
          : undefined,
      maxHrBpm:
        finitePositive(lap.maxHeartRate) !== undefined && finitePositive(lap.maxHeartRate)! < 255
          ? Math.round(finitePositive(lap.maxHeartRate)!)
          : undefined,
      avgCadenceRpm:
        finiteNum(lap.avgCadence) !== undefined && finiteNum(lap.avgCadence)! >= 0 && finiteNum(lap.avgCadence)! < 255
          ? Math.round(finiteNum(lap.avgCadence)!)
          : undefined,
      avgSpeedKmh: speedMps !== undefined && speedMps < 200 ? roundTo(speedMps * 3.6, 2) : undefined,
      totalAscentM:
        finiteNum(lap.totalAscent) !== undefined && finiteNum(lap.totalAscent)! >= 0
          ? Math.round(finiteNum(lap.totalAscent)!)
          : undefined,
    });
  }
  return laps;
}

function computeMissingGrades(samples: TelemetrySample[]): void {
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    if (cur.gradePct !== undefined || cur.distanceM === undefined || cur.altitudeM === undefined) {
      continue;
    }
    for (let j = i - 1; j >= 0; j--) {
      const prev = samples[j];
      if (prev.distanceM === undefined || prev.altitudeM === undefined) continue;
      const deltaDist = cur.distanceM - prev.distanceM;
      if (deltaDist >= 15) {
        const rawGrade = ((cur.altitudeM - prev.altitudeM) / deltaDist) * 100;
        cur.gradePct = roundTo(clamp(rawGrade, -25, 30), 1);
        break;
      }
    }
  }
}

function mergeSampleValues(existing: TelemetrySample, incoming: TelemetrySample): TelemetrySample {
  return {
    elapsedSec: existing.elapsedSec,
    timestampIso: incoming.timestampIso ?? existing.timestampIso,
    powerW: incoming.powerW ?? existing.powerW,
    wkg: incoming.wkg ?? existing.wkg,
    heartRateBpm: incoming.heartRateBpm ?? existing.heartRateBpm,
    cadenceRpm: incoming.cadenceRpm ?? existing.cadenceRpm,
    speedKmh: incoming.speedKmh ?? existing.speedKmh,
    distanceM: incoming.distanceM ?? existing.distanceM,
    altitudeM: incoming.altitudeM ?? existing.altitudeM,
    gradePct: incoming.gradePct ?? existing.gradePct,
    latitudeDeg: incoming.latitudeDeg ?? existing.latitudeDeg,
    longitudeDeg: incoming.longitudeDeg ?? existing.longitudeDeg,
    leftRightBalance: incoming.leftRightBalance ?? existing.leftRightBalance,
    lap: incoming.lap ?? existing.lap,
  };
}

function normalizeAndSortSamples(rawSamples: TelemetrySample[]): TelemetrySample[] {
  const bySecond = new Map<number, TelemetrySample>();
  for (const sample of rawSamples) {
    const sec = Math.max(0, Math.round(sample.elapsedSec));
    const normalized: TelemetrySample = { ...sample, elapsedSec: sec };
    const prev = bySecond.get(sec);
    bySecond.set(sec, prev ? mergeSampleValues(prev, normalized) : normalized);
  }
  const sorted = Array.from(bySecond.values()).sort((a, b) => a.elapsedSec - b.elapsedSec);
  computeMissingGrades(sorted);
  return sorted;
}

/**
 * Decodes a binary Garmin FIT file into per-second telemetry samples and structured laps.
 */
export function decodeFitTelemetry(
  buffer: ArrayBuffer,
  opts: { weightKg?: number } = {},
): ParsedActivityTelemetry {
  const stream = Stream.fromArrayBuffer(buffer);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) {
    throw new Error('Downloaded file is not a valid FIT binary.');
  }

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandComponents: true,
    expandSubFields: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  });

  const recordMesgs: RecordMesg[] = messages.recordMesgs ?? [];
  if (recordMesgs.length === 0) {
    const detail = errors.length > 0 ? ` (${errors[0].message})` : '';
    throw new Error(`FIT file contains no time-series record samples${detail}.`);
  }

  const lapMesgs: LapMesg[] = messages.lapMesgs ?? [];
  const lapEndsMs = buildLapEndTimesMs(lapMesgs);
  const weightKg = opts.weightKg && opts.weightKg > 0 ? opts.weightKg : undefined;

  let firstTimestampMs: number | undefined;
  for (const rec of recordMesgs) {
    const ts = toTimestampMs(rec.timestamp);
    if (ts !== undefined) {
      firstTimestampMs = ts;
      break;
    }
  }

  const rawSamples: TelemetrySample[] = [];
  for (let i = 0; i < recordMesgs.length; i++) {
    const rec = recordMesgs[i];
    const tsMs = toTimestampMs(rec.timestamp);
    const elapsedSec =
      tsMs !== undefined && firstTimestampMs !== undefined
        ? Math.max(0, Math.round((tsMs - firstTimestampMs) / 1000))
        : i;

    const powerRaw = finiteNum(rec.power);
    const powerW =
      powerRaw !== undefined && powerRaw >= 0 && powerRaw < 5000 ? Math.round(powerRaw) : undefined;
    const wkg =
      powerW !== undefined && weightKg !== undefined ? roundTo(powerW / weightKg, 2) : undefined;

    const hrRaw = finiteNum(rec.heartRate);
    const heartRateBpm =
      hrRaw !== undefined && hrRaw > 0 && hrRaw < 255 ? Math.round(hrRaw) : undefined;

    const cadRaw = finiteNum(rec.cadence);
    const cadenceRpm =
      cadRaw !== undefined && cadRaw >= 0 && cadRaw < 255 ? Math.round(cadRaw) : undefined;

    const enhancedSpeed = finiteNum(rec.enhancedSpeed);
    const baseSpeed = finiteNum(rec.speed);
    const speedMps =
      enhancedSpeed !== undefined && enhancedSpeed >= 0 && enhancedSpeed < 200
        ? enhancedSpeed
        : baseSpeed !== undefined && baseSpeed >= 0 && baseSpeed < 200
          ? baseSpeed
          : undefined;
    const speedKmh = speedMps !== undefined ? roundTo(speedMps * 3.6, 2) : undefined;

    const distRaw = finiteNum(rec.distance);
    const distanceM =
      distRaw !== undefined && distRaw >= 0 && distRaw < 10_000_000
        ? roundTo(distRaw, 1)
        : undefined;

    const enhancedAlt = finiteNum(rec.enhancedAltitude);
    const baseAlt = finiteNum(rec.altitude);
    const altRaw = enhancedAlt ?? baseAlt;
    const altitudeM =
      altRaw !== undefined && altRaw > -500 && altRaw < 15000 ? roundTo(altRaw, 1) : undefined;

    const gradeRaw = finiteNum(rec.grade);
    const gradePct =
      gradeRaw !== undefined && Math.abs(gradeRaw) < 100 ? roundTo(gradeRaw, 1) : undefined;

    let latitudeDeg: number | undefined;
    let longitudeDeg: number | undefined;
    const latSemi = finiteNum(rec.positionLat);
    const lonSemi = finiteNum(rec.positionLong);
    if (
      latSemi !== undefined &&
      lonSemi !== undefined &&
      latSemi !== SINT32_MAX &&
      latSemi !== SINT32_MIN &&
      lonSemi !== SINT32_MAX &&
      lonSemi !== SINT32_MIN
    ) {
      const lat = roundTo(latSemi * SEMICIRCLES_TO_DEGREES, 6);
      const lon = roundTo(lonSemi * SEMICIRCLES_TO_DEGREES, 6);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        latitudeDeg = lat;
        longitudeDeg = lon;
      }
    }

    let leftRightBalance: number | undefined;
    if (typeof rec.leftRightBalance === 'number' && Number.isFinite(rec.leftRightBalance)) {
      if (rec.leftRightBalance !== 0xff) {
        const pct = rec.leftRightBalance & 0x7f;
        if (pct <= 100) {
          leftRightBalance = pct;
        }
      }
    }

    rawSamples.push({
      elapsedSec,
      timestampIso: tsMs !== undefined ? new Date(tsMs).toISOString() : undefined,
      powerW,
      wkg,
      heartRateBpm,
      cadenceRpm,
      speedKmh,
      distanceM,
      altitudeM,
      gradePct,
      latitudeDeg,
      longitudeDeg,
      leftRightBalance,
      lap: resolveLapNumber(tsMs, lapEndsMs),
    });
  }

  const samples = normalizeAndSortSamples(rawSamples);
  if (samples.length === 0) {
    throw new Error('FIT file yielded 0 telemetry samples.');
  }

  const laps = extractStructuredLaps(lapMesgs, firstTimestampMs);

  return {
    source: 'fit',
    samples,
    sampleCount: samples.length,
    durationSec: samples[samples.length - 1].elapsedSec,
    fitBytes: new Uint8Array(buffer),
    laps: laps.length > 0 ? laps : undefined,
  };
}

function readArrayAt(arr: unknown, idx: number): unknown {
  return Array.isArray(arr) ? arr[idx] : undefined;
}

/**
 * Parses Zwift Core `fitnessData.fullDataUrl` / `smallDataUrl` JSON payloads into telemetry samples.
 */
export function parseFitnessDataTelemetry(
  raw: unknown,
  opts: { startDateIso?: string; weightKg?: number } = {},
): ParsedActivityTelemetry {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Fitness stream payload was empty or invalid.');
  }

  const weightKg = opts.weightKg && opts.weightKg > 0 ? opts.weightKg : undefined;
  const startMs = opts.startDateIso ? Date.parse(opts.startDateIso) : NaN;
  const baseStartMs = Number.isFinite(startMs) ? startMs : undefined;

  const rawSamples: TelemetrySample[] = [];
  const rec = raw as Record<string, unknown>;

  const objectArray = Array.isArray(raw)
    ? raw
    : Array.isArray(rec.samples)
      ? rec.samples
      : Array.isArray(rec.records)
        ? rec.records
        : Array.isArray(rec.data)
          ? rec.data
          : null;

  if (objectArray && objectArray.length > 0 && typeof objectArray[0] === 'object') {
    for (let i = 0; i < objectArray.length; i++) {
      const item = objectArray[i];
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;

      const elapsedSec =
        finiteNum(row.timeInSec ?? row.elapsedSec ?? row.seconds ?? row.time) ?? i;
      const tsMs =
        toTimestampMs(row.timestamp ?? row.timestampIso) ??
        (baseStartMs !== undefined ? baseStartMs + Math.round(elapsedSec) * 1000 : undefined);

      const powerRaw = finiteNum(row.watts ?? row.power ?? row.wattsInWatts ?? row.powerW);
      const powerW =
        powerRaw !== undefined && powerRaw >= 0 && powerRaw < 5000
          ? Math.round(powerRaw)
          : undefined;
      const wkg =
        powerW !== undefined && weightKg !== undefined ? roundTo(powerW / weightKg, 2) : undefined;

      const hrRaw = finiteNum(row.heartRate ?? row.heartrate ?? row.heartRateBpm ?? row.hr);
      const heartRateBpm =
        hrRaw !== undefined && hrRaw > 0 && hrRaw < 255 ? Math.round(hrRaw) : undefined;

      const cadRaw = finiteNum(row.cadence ?? row.cadenceRpm);
      const cadenceRpm =
        cadRaw !== undefined && cadRaw >= 0 && cadRaw < 255 ? Math.round(cadRaw) : undefined;

      const speedKmhExplicit = finiteNum(row.speedKmh);
      const speedCmPerSec = finiteNum(row.speedInCmPerSec);
      const speedMps = finiteNum(row.speed ?? row.speedMps);
      const speedKmh =
        speedKmhExplicit !== undefined && speedKmhExplicit >= 0
          ? roundTo(speedKmhExplicit, 2)
          : speedCmPerSec !== undefined && speedCmPerSec >= 0
            ? roundTo(speedCmPerSec * 0.036, 2)
            : speedMps !== undefined && speedMps >= 0
              ? roundTo(speedMps * 3.6, 2)
              : undefined;

      const distMExplicit = finiteNum(row.distanceM);
      const distCm = finiteNum(row.distanceInCm);
      const distRaw = finiteNum(row.distance);
      const distanceM =
        distMExplicit !== undefined && distMExplicit >= 0
          ? roundTo(distMExplicit, 1)
          : distCm !== undefined && distCm >= 0
            ? roundTo(distCm / 100, 1)
            : distRaw !== undefined && distRaw >= 0
              ? roundTo(distRaw, 1)
              : undefined;

      const altMExplicit = finiteNum(row.altitudeM);
      const altCm = finiteNum(row.altitudeInCm);
      const altRaw = finiteNum(row.altitude ?? row.elevation);
      const altitudeM =
        altMExplicit !== undefined
          ? roundTo(altMExplicit, 1)
          : altCm !== undefined
            ? roundTo(altCm / 100, 1)
            : altRaw !== undefined
              ? roundTo(altRaw, 1)
              : undefined;

      const gradeRaw = finiteNum(row.gradePct ?? row.grade);
      const gradePct =
        gradeRaw !== undefined && Math.abs(gradeRaw) < 100 ? roundTo(gradeRaw, 1) : undefined;

      let latitudeDeg = finiteNum(row.latitudeDeg ?? row.lat ?? row.latitude);
      let longitudeDeg = finiteNum(row.longitudeDeg ?? row.lng ?? row.lon ?? row.longitude);
      if (
        (latitudeDeg === undefined || longitudeDeg === undefined) &&
        Array.isArray(row.latlng) &&
        row.latlng.length >= 2
      ) {
        latitudeDeg = finiteNum(row.latlng[0]);
        longitudeDeg = finiteNum(row.latlng[1]);
      }

      rawSamples.push({
        elapsedSec,
        timestampIso: tsMs !== undefined ? new Date(tsMs).toISOString() : undefined,
        powerW,
        wkg,
        heartRateBpm,
        cadenceRpm,
        speedKmh,
        distanceM,
        altitudeM,
        gradePct,
        latitudeDeg: latitudeDeg !== undefined ? roundTo(latitudeDeg, 6) : undefined,
        longitudeDeg: longitudeDeg !== undefined ? roundTo(longitudeDeg, 6) : undefined,
      });
    }
  } else {
    const timeArr = rec.timeInSec ?? rec.time ?? rec.elapsedSec;
    const wattsArr = rec.watts ?? rec.power ?? rec.wattsInWatts;
    const hrArr = rec.heartRate ?? rec.heartrate ?? rec.hr;
    const cadArr = rec.cadence;
    const speedCmArr = rec.speedInCmPerSec;
    const speedMpsArr = rec.speed;
    const distCmArr = rec.distanceInCm;
    const distMArr = rec.distance;
    const altCmArr = rec.altitudeInCm;
    const altMArr = rec.altitude ?? rec.elevation;
    const gradeArr = rec.grade ?? rec.gradePct;
    const latlngArr = rec.latlng ?? rec.latLng ?? rec.coordinates;

    const length = Math.max(
      Array.isArray(timeArr) ? timeArr.length : 0,
      Array.isArray(wattsArr) ? wattsArr.length : 0,
      Array.isArray(hrArr) ? hrArr.length : 0,
      Array.isArray(cadArr) ? cadArr.length : 0,
      Array.isArray(speedCmArr) ? speedCmArr.length : 0,
      Array.isArray(speedMpsArr) ? speedMpsArr.length : 0,
      Array.isArray(distCmArr) ? distCmArr.length : 0,
      Array.isArray(distMArr) ? distMArr.length : 0,
      Array.isArray(altCmArr) ? altCmArr.length : 0,
      Array.isArray(altMArr) ? altMArr.length : 0,
    );

    for (let i = 0; i < length; i++) {
      const elapsedSec = finiteNum(readArrayAt(timeArr, i)) ?? i;
      const tsMs =
        baseStartMs !== undefined ? baseStartMs + Math.round(elapsedSec) * 1000 : undefined;

      const powerRaw = finiteNum(readArrayAt(wattsArr, i));
      const powerW =
        powerRaw !== undefined && powerRaw >= 0 && powerRaw < 5000
          ? Math.round(powerRaw)
          : undefined;
      const wkg =
        powerW !== undefined && weightKg !== undefined ? roundTo(powerW / weightKg, 2) : undefined;

      const hrRaw = finiteNum(readArrayAt(hrArr, i));
      const heartRateBpm =
        hrRaw !== undefined && hrRaw > 0 && hrRaw < 255 ? Math.round(hrRaw) : undefined;

      const cadRaw = finiteNum(readArrayAt(cadArr, i));
      const cadenceRpm =
        cadRaw !== undefined && cadRaw >= 0 && cadRaw < 255 ? Math.round(cadRaw) : undefined;

      const speedCm = finiteNum(readArrayAt(speedCmArr, i));
      const speedMps = finiteNum(readArrayAt(speedMpsArr, i));
      const speedKmh =
        speedCm !== undefined && speedCm >= 0
          ? roundTo(speedCm * 0.036, 2)
          : speedMps !== undefined && speedMps >= 0
            ? roundTo(speedMps * 3.6, 2)
            : undefined;

      const distCm = finiteNum(readArrayAt(distCmArr, i));
      const distM = finiteNum(readArrayAt(distMArr, i));
      const distanceM =
        distCm !== undefined && distCm >= 0
          ? roundTo(distCm / 100, 1)
          : distM !== undefined && distM >= 0
            ? roundTo(distM, 1)
            : undefined;

      const altCm = finiteNum(readArrayAt(altCmArr, i));
      const altM = finiteNum(readArrayAt(altMArr, i));
      const altitudeM =
        altCm !== undefined
          ? roundTo(altCm / 100, 1)
          : altM !== undefined
            ? roundTo(altM, 1)
            : undefined;

      const gradeRaw = finiteNum(readArrayAt(gradeArr, i));
      const gradePct =
        gradeRaw !== undefined && Math.abs(gradeRaw) < 100 ? roundTo(gradeRaw, 1) : undefined;

      let latitudeDeg: number | undefined;
      let longitudeDeg: number | undefined;
      const coord = readArrayAt(latlngArr, i);
      if (Array.isArray(coord) && coord.length >= 2) {
        const lat = finiteNum(coord[0]);
        const lon = finiteNum(coord[1]);
        if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          latitudeDeg = roundTo(lat, 6);
          longitudeDeg = roundTo(lon, 6);
        }
      }

      rawSamples.push({
        elapsedSec,
        timestampIso: tsMs !== undefined ? new Date(tsMs).toISOString() : undefined,
        powerW,
        wkg,
        heartRateBpm,
        cadenceRpm,
        speedKmh,
        distanceM,
        altitudeM,
        gradePct,
        latitudeDeg,
        longitudeDeg,
      });
    }
  }

  const samples = normalizeAndSortSamples(rawSamples);
  if (samples.length === 0) {
    throw new Error('Fitness stream contained no usable telemetry points.');
  }

  return {
    source: 'fitness_data',
    samples,
    sampleCount: samples.length,
    durationSec: samples[samples.length - 1].elapsedSec,
  };
}

function avgBucket(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Keeps 1-second samples or averages/aggregates them into N-second interval buckets.
 */
export function resampleTelemetrySamples(
  samples: TelemetrySample[],
  intervalSec: number,
): TelemetrySample[] {
  if (samples.length === 0) return [];
  const step = Math.max(1, Math.round(intervalSec));
  const sorted = [...samples].sort((a, b) => a.elapsedSec - b.elapsedSec);
  if (step === 1) return sorted;

  const buckets = new Map<number, TelemetrySample[]>();
  for (const s of sorted) {
    const bucketSec = Math.floor(s.elapsedSec / step) * step;
    const list = buckets.get(bucketSec);
    if (list) list.push(s);
    else buckets.set(bucketSec, [s]);
  }

  const resampled: TelemetrySample[] = [];
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  for (const bucketSec of keys) {
    const group = buckets.get(bucketSec)!;
    const powers: number[] = [];
    const wkgs: number[] = [];
    const hrs: number[] = [];
    const cads: number[] = [];
    const speeds: number[] = [];
    const grades: number[] = [];
    const lrs: number[] = [];

    let lastTs: string | undefined;
    let lastDist: number | undefined;
    let lastAlt: number | undefined;
    let lastLat: number | undefined;
    let lastLon: number | undefined;
    let lastLap: number | undefined;

    for (const item of group) {
      if (item.powerW !== undefined) powers.push(item.powerW);
      if (item.wkg !== undefined) wkgs.push(item.wkg);
      if (item.heartRateBpm !== undefined) hrs.push(item.heartRateBpm);
      if (item.cadenceRpm !== undefined) cads.push(item.cadenceRpm);
      if (item.speedKmh !== undefined) speeds.push(item.speedKmh);
      if (item.gradePct !== undefined) grades.push(item.gradePct);
      if (item.leftRightBalance !== undefined) lrs.push(item.leftRightBalance);

      if (item.timestampIso !== undefined) lastTs = item.timestampIso;
      if (item.distanceM !== undefined) lastDist = item.distanceM;
      if (item.altitudeM !== undefined) lastAlt = item.altitudeM;
      if (item.latitudeDeg !== undefined) lastLat = item.latitudeDeg;
      if (item.longitudeDeg !== undefined) lastLon = item.longitudeDeg;
      if (item.lap !== undefined) lastLap = item.lap;
    }

    const avgPower = avgBucket(powers);
    const avgWkg = avgBucket(wkgs);
    const avgHr = avgBucket(hrs);
    const avgCad = avgBucket(cads);
    const avgSpeed = avgBucket(speeds);
    const avgGrade = avgBucket(grades);
    const avgLr = avgBucket(lrs);

    resampled.push({
      elapsedSec: bucketSec,
      timestampIso: lastTs,
      powerW: avgPower !== undefined ? Math.round(avgPower) : undefined,
      wkg: avgWkg !== undefined ? roundTo(avgWkg, 2) : undefined,
      heartRateBpm: avgHr !== undefined ? Math.round(avgHr) : undefined,
      cadenceRpm: avgCad !== undefined ? Math.round(avgCad) : undefined,
      speedKmh: avgSpeed !== undefined ? roundTo(avgSpeed, 2) : undefined,
      distanceM: lastDist,
      altitudeM: lastAlt,
      gradePct: avgGrade !== undefined ? roundTo(avgGrade, 1) : undefined,
      latitudeDeg: lastLat,
      longitudeDeg: lastLon,
      leftRightBalance: avgLr !== undefined ? Math.round(avgLr) : undefined,
      lap: lastLap,
    });
  }

  return resampled;
}

/**
 * Computes Coggan Normalized Power (30-second rolling mean power raised to 4th power)
 * over telemetry samples. Returns undefined if fewer than 30 seconds of power exist.
 */
export function computeNormalizedPower(samples: TelemetrySample[]): number | undefined {
  const powerSamples = samples.filter((s) => s.powerW !== undefined);
  if (powerSamples.length < 30) return undefined;

  let windowSum = 0;
  let left = 0;
  let fourthPowerSum = 0;
  let fourthPowerCount = 0;

  for (let right = 0; right < powerSamples.length; right++) {
    const cur = powerSamples[right];
    if (right > 0 && cur.elapsedSec - powerSamples[right - 1].elapsedSec > 15) {
      // Reset rolling buffer across long pauses so paused gaps don't distort rolling power.
      left = right;
      windowSum = 0;
    }

    windowSum += cur.powerW!;
    while (cur.elapsedSec - powerSamples[left].elapsedSec >= 30) {
      windowSum -= powerSamples[left].powerW!;
      left++;
    }

    const windowLen = right - left + 1;
    const spanSec = cur.elapsedSec - powerSamples[left].elapsedSec;
    if (spanSec >= 29 || windowLen >= 30) {
      const avg30 = windowSum / windowLen;
      fourthPowerSum += avg30 ** 4;
      fourthPowerCount++;
    }
  }

  if (fourthPowerCount === 0) return undefined;
  return Math.round((fourthPowerSum / fourthPowerCount) ** 0.25);
}

/**
 * Summarizes telemetry metrics for a full activity or sliced window.
 */
export function summarizeTelemetrySamples(
  samples: TelemetrySample[],
  weightKg?: number,
): TelemetryWindowSummary {
  if (samples.length === 0) {
    return { sampleCount: 0, durationSec: 0 };
  }

  const powers: number[] = [];
  const hrs: number[] = [];
  const cads: number[] = [];
  const speeds: number[] = [];
  let maxPowerW: number | undefined;
  let maxHrBpm: number | undefined;
  let firstDist: number | undefined;
  let lastDist: number | undefined;
  let prevAlt: number | undefined;
  let elevationGain = 0;

  for (const s of samples) {
    if (s.powerW !== undefined) {
      powers.push(s.powerW);
      if (maxPowerW === undefined || s.powerW > maxPowerW) maxPowerW = s.powerW;
    }
    if (s.heartRateBpm !== undefined) {
      hrs.push(s.heartRateBpm);
      if (maxHrBpm === undefined || s.heartRateBpm > maxHrBpm) maxHrBpm = s.heartRateBpm;
    }
    if (s.cadenceRpm !== undefined) cads.push(s.cadenceRpm);
    if (s.speedKmh !== undefined) speeds.push(s.speedKmh);
    if (s.distanceM !== undefined) {
      if (firstDist === undefined) firstDist = s.distanceM;
      lastDist = s.distanceM;
    }
    if (s.altitudeM !== undefined) {
      if (prevAlt !== undefined && s.altitudeM > prevAlt) {
        elevationGain += s.altitudeM - prevAlt;
      }
      prevAlt = s.altitudeM;
    }
  }

  const startSec = samples[0].elapsedSec;
  const endSec = samples[samples.length - 1].elapsedSec;
  const durationSec = Math.max(0, endSec - startSec);
  const avgPowerRaw = avgBucket(powers);
  const avgPowerW = avgPowerRaw !== undefined ? Math.round(avgPowerRaw) : undefined;
  const avgWkg =
    avgPowerRaw !== undefined && weightKg && weightKg > 0
      ? roundTo(avgPowerRaw / weightKg, 2)
      : undefined;
  const avgHrRaw = avgBucket(hrs);
  const avgCadRaw = avgBucket(cads);
  const avgSpeedRaw = avgBucket(speeds);
  const distanceM =
    firstDist !== undefined && lastDist !== undefined
      ? roundTo(Math.max(0, lastDist - (startSec > 5 ? firstDist : 0)), 1)
      : undefined;

  return {
    sampleCount: samples.length,
    durationSec,
    startSec,
    endSec,
    avgPowerW,
    normalizedPowerW: computeNormalizedPower(samples),
    maxPowerW,
    avgWkg,
    avgHrBpm: avgHrRaw !== undefined ? Math.round(avgHrRaw) : undefined,
    maxHrBpm,
    avgCadenceRpm: avgCadRaw !== undefined ? Math.round(avgCadRaw) : undefined,
    avgSpeedKmh: avgSpeedRaw !== undefined ? roundTo(avgSpeedRaw, 2) : undefined,
    distanceM,
    elevationGainM: prevAlt !== undefined ? Math.round(elevationGain) : undefined,
  };
}

/**
 * Detects sustained hard efforts / work intervals from 1s power samples using a 10s rolling average.
 */
export function detectPowerIntervals(
  samples: TelemetrySample[],
  opts: {
    thresholdW?: number;
    weightKg?: number;
    minEffortSec?: number;
    mergeGapSec?: number;
  } = {},
): DetectedInterval[] {
  const withPower = samples.filter((s) => s.powerW !== undefined);
  if (withPower.length === 0) return [];

  const avgAll = avgBucket(withPower.map((s) => s.powerW!)) ?? 0;
  const thresholdW =
    opts.thresholdW && opts.thresholdW > 0
      ? opts.thresholdW
      : Math.max(100, Math.round(avgAll * 1.12));
  const minEffortSec = Math.max(10, Math.round(opts.minEffortSec ?? 30));
  const mergeGapSec = Math.max(0, Math.round(opts.mergeGapSec ?? 8));
  const weightKg = opts.weightKg && opts.weightKg > 0 ? opts.weightKg : undefined;

  const rawRanges: Array<{ startSec: number; endSec: number }> = [];
  let rollingSum = 0;
  let left = 0;
  let activeStartSec: number | null = null;
  let lastActiveSec = 0;

  for (let right = 0; right < withPower.length; right++) {
    const cur = withPower[right];
    if (right > 0 && cur.elapsedSec - withPower[right - 1].elapsedSec > 15) {
      if (activeStartSec !== null) {
        rawRanges.push({ startSec: activeStartSec, endSec: lastActiveSec });
        activeStartSec = null;
      }
      left = right;
      rollingSum = 0;
    }

    rollingSum += cur.powerW!;
    while (cur.elapsedSec - withPower[left].elapsedSec >= 10) {
      rollingSum -= withPower[left].powerW!;
      left++;
    }

    const avg10 = rollingSum / (right - left + 1);
    if (avg10 >= thresholdW) {
      if (activeStartSec === null) {
        activeStartSec = withPower[left].elapsedSec;
      }
      lastActiveSec = cur.elapsedSec;
    } else if (activeStartSec !== null) {
      rawRanges.push({ startSec: activeStartSec, endSec: lastActiveSec });
      activeStartSec = null;
    }
  }
  if (activeStartSec !== null) {
    rawRanges.push({ startSec: activeStartSec, endSec: lastActiveSec });
  }

  const merged: Array<{ startSec: number; endSec: number }> = [];
  for (const range of rawRanges) {
    const prev = merged[merged.length - 1];
    if (prev && range.startSec - prev.endSec <= mergeGapSec) {
      prev.endSec = Math.max(prev.endSec, range.endSec);
    } else {
      merged.push({ ...range });
    }
  }

  const scored = merged
    .map((range) => {
      const seg = samples.filter(
        (s) => s.elapsedSec >= range.startSec && s.elapsedSec <= range.endSec,
      );
      let firstIdx = 0;
      while (firstIdx < seg.length && (seg[firstIdx].powerW ?? 0) < thresholdW) {
        firstIdx++;
      }
      let lastIdx = seg.length - 1;
      while (lastIdx >= firstIdx && (seg[lastIdx].powerW ?? 0) < thresholdW) {
        lastIdx--;
      }
      if (firstIdx > lastIdx) return null;
      const segment = seg.slice(firstIdx, lastIdx + 1);
      const startSec = segment[0].elapsedSec;
      const endSec = segment[segment.length - 1].elapsedSec;
      const durationSec = Math.max(1, endSec - startSec + 1);
      if (durationSec < minEffortSec) return null;

      const summary = summarizeTelemetrySamples(segment, weightKg);
      const avgPowerW = summary.avgPowerW ?? 0;
      return {
        range: { startSec, endSec },
        durationSec,
        summary,
        avgPowerW,
        workScore: avgPowerW * durationSec,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const capped =
    scored.length > 30
      ? [...scored]
          .sort((a, b) => b.workScore - a.workScore)
          .slice(0, 30)
          .sort((a, b) => a.range.startSec - b.range.startSec)
      : scored;

  return capped.map((entry, idx) => ({
    index: idx + 1,
    startSec: entry.range.startSec,
    endSec: entry.range.endSec,
    durationSec: entry.durationSec,
    avgPowerW: entry.avgPowerW,
    maxPowerW: entry.summary.maxPowerW,
    normalizedPowerW: entry.summary.normalizedPowerW,
    avgWkg: entry.summary.avgWkg,
    avgHrBpm: entry.summary.avgHrBpm,
    maxHrBpm: entry.summary.maxHrBpm,
    avgCadenceRpm: entry.summary.avgCadenceRpm,
  }));
}

export function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function readTelemetryField(
  sample: TelemetrySample,
  field: TelemetryFieldKey,
): string | number | undefined {
  switch (field) {
    case 'elapsed_sec':
      return sample.elapsedSec;
    case 'timestamp_utc':
      return sample.timestampIso;
    case 'power_w':
      return sample.powerW;
    case 'wkg':
      return sample.wkg;
    case 'heart_rate_bpm':
      return sample.heartRateBpm;
    case 'cadence_rpm':
      return sample.cadenceRpm;
    case 'speed_kmh':
      return sample.speedKmh;
    case 'distance_m':
      return sample.distanceM;
    case 'altitude_m':
      return sample.altitudeM;
    case 'grade_pct':
      return sample.gradePct;
    case 'latitude_deg':
      return sample.latitudeDeg;
    case 'longitude_deg':
      return sample.longitudeDeg;
    case 'left_right_balance':
      return sample.leftRightBalance;
    case 'lap':
      return sample.lap;
  }
}

/**
 * Formats telemetry samples as RFC-4180 CSV with only the requested columns.
 */
export function formatTelemetryStreamCsv(
  samples: TelemetrySample[],
  fields: readonly TelemetryFieldKey[],
): string {
  const activeFields = fields.length > 0 ? fields : DEFAULT_MCP_STREAM_FIELDS;
  const lines = [activeFields.join(',')];
  for (const sample of samples) {
    lines.push(activeFields.map((f) => csvCell(readTelemetryField(sample, f))).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Formats telemetry samples as compact positional JSON arrays matching `fields`.
 */
export function formatTelemetryStreamRows(
  samples: TelemetrySample[],
  fields: readonly TelemetryFieldKey[],
): Array<Array<string | number | null>> {
  const activeFields = fields.length > 0 ? fields : DEFAULT_MCP_STREAM_FIELDS;
  return samples.map((sample) =>
    activeFields.map((f) => {
      const val = readTelemetryField(sample, f);
      return val === undefined ? null : val;
    }),
  );
}
