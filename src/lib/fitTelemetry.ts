import { Decoder, Stream } from '@garmin/fitsdk';
import type { LapMesg, RecordMesg } from '@garmin/fitsdk';
import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { finiteNum, finitePositive, roundTo } from './activityExport';
import type {
  ActivityExportItem,
  ActivityExportRiderContext,
  CsvFormatOptions,
  ParsedActivityTelemetry,
  SamplingIntervalSec,
  TelemetrySample,
} from './activityExport';

export { mergedRaceToExportItem } from './activityExport';
export type {
  ActivityExportItem,
  ActivityExportRiderContext,
  CsvFormatOptions,
  CsvPackaging,
  ExportFormat,
  ParsedActivityTelemetry,
  SamplingIntervalSec,
  TelemetrySample,
  TelemetrySource,
} from './activityExport';

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0, 0);
const FIT_SYSTEM_TIME_THRESHOLD = 0x10000000;
const SEMICIRCLES_TO_DEGREES = 180 / 2147483648;
const SINT32_MAX = 0x7fffffff;
const SINT32_MIN = -0x80000000;

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
 * Decodes a binary Garmin FIT file into per-second telemetry samples.
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

  const lapEndsMs = buildLapEndTimesMs(messages.lapMesgs ?? []);
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

  return {
    source: 'fit',
    samples,
    sampleCount: samples.length,
    durationSec: samples[samples.length - 1].elapsedSec,
    fitBytes: new Uint8Array(buffer),
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
 * Keeps 1-second samples or aggregates them into 5s / 10s interval buckets.
 */
export function resampleTelemetrySamples(
  samples: TelemetrySample[],
  intervalSec: SamplingIntervalSec,
): TelemetrySample[] {
  if (samples.length === 0) return [];
  const sorted = [...samples].sort((a, b) => a.elapsedSec - b.elapsedSec);
  if (intervalSec === 1) return sorted;

  const buckets = new Map<number, TelemetrySample[]>();
  for (const s of sorted) {
    const bucketSec = Math.floor(s.elapsedSec / intervalSec) * intervalSec;
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

function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildTelemetryCsvHeaders(opts: CsvFormatOptions): string[] {
  const headers = ['elapsed_sec', 'timestamp_utc', 'power_w'];
  if (opts.includeWkg) headers.push('wkg');
  headers.push('heart_rate_bpm', 'cadence_rpm', 'speed_kmh', 'distance_m', 'altitude_m', 'grade_pct');
  if (opts.includeGps) headers.push('latitude_deg', 'longitude_deg');
  if (opts.includeLap) headers.push('lap');
  return headers;
}

function buildTelemetryCsvCells(
  s: TelemetrySample,
  opts: CsvFormatOptions,
): Array<string | number | undefined> {
  const row: Array<string | number | undefined> = [s.elapsedSec, s.timestampIso ?? '', s.powerW];
  if (opts.includeWkg) row.push(s.wkg);
  row.push(s.heartRateBpm, s.cadenceRpm, s.speedKmh, s.distanceM, s.altitudeM, s.gradePct);
  if (opts.includeGps) row.push(s.latitudeDeg, s.longitudeDeg);
  if (opts.includeLap) row.push(s.lap);
  return row;
}

/**
 * Formats a single activity's telemetry samples as clean RFC-4180 CSV (no comment preamble).
 */
export function formatActivityCsv(
  samples: TelemetrySample[],
  opts: CsvFormatOptions,
): string {
  const headers = buildTelemetryCsvHeaders(opts);
  const lines = [headers.join(',')];
  for (const s of samples) {
    lines.push(buildTelemetryCsvCells(s, opts).map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function getItemDateIso(item: ActivityExportItem): string {
  if (item.startDateIso) return item.startDateIso;
  if (item.dateSec !== undefined) return new Date(item.dateSec * 1000).toISOString();
  return '';
}

/**
 * Formats multiple activities into a single combined RFC-4180 CSV keyed by `activity_id`.
 */
export function formatCombinedActivitiesCsv(
  entries: Array<{ item: ActivityExportItem; samples: TelemetrySample[] }>,
  opts: CsvFormatOptions,
): string {
  const headers = [
    'activity_id',
    'activity_date',
    'activity_title',
    'activity_type',
    ...buildTelemetryCsvHeaders(opts),
  ];
  const lines = [headers.join(',')];
  for (const { item, samples } of entries) {
    const actDate = getItemDateIso(item);
    const actType = item.activityTypeLabel ?? '';
    for (const s of samples) {
      const cells: Array<string | number | undefined> = [
        item.activityId,
        actDate,
        item.title,
        actType,
        ...buildTelemetryCsvCells(s, opts),
      ];
      lines.push(cells.map(csvCell).join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Formats a 1-row-per-activity summary metadata CSV for multi-file ZIP archives.
 */
export function formatActivitiesSummaryCsv(
  entries: Array<{
    item: ActivityExportItem;
    telemetry?: ParsedActivityTelemetry;
    fileName?: string;
  }>,
): string {
  const headers = [
    'activity_id',
    'event_id',
    'date_utc',
    'title',
    'type',
    'category',
    'route',
    'world',
    'placing',
    'field_size',
    'duration_sec',
    'distance_km',
    'elevation_m',
    'avg_power_w',
    'np_w',
    'max_power_w',
    'avg_wkg',
    'avg_hr_bpm',
    'max_hr_bpm',
    'avg_cadence_rpm',
    'weight_kg',
    'ftp_w',
    'velo_before',
    'velo_after',
    'sof',
    'telemetry_source',
    'sample_count',
    'file_name',
  ];
  const lines = [headers.join(',')];

  for (const { item, telemetry, fileName } of entries) {
    const durationSec = item.durationSec ?? telemetry?.durationSec;
    const lastDistM = telemetry?.samples[telemetry.samples.length - 1]?.distanceM;
    const distanceM = item.distanceM ?? lastDistM;
    const distanceKm = distanceM !== undefined ? roundTo(distanceM / 1000, 2) : undefined;
    const placing = item.truePlace ?? item.zpPlace;
    const row = [
      item.activityId,
      item.eventId ?? '',
      getItemDateIso(item),
      item.title,
      item.activityTypeLabel ?? '',
      item.category ?? '',
      item.routeName ?? '',
      item.worldName ?? '',
      placing,
      item.fieldSize,
      durationSec !== undefined ? Math.round(durationSec) : undefined,
      distanceKm,
      item.elevationM !== undefined ? Math.round(item.elevationM) : undefined,
      item.avgPowerW !== undefined ? Math.round(item.avgPowerW) : undefined,
      item.normalizedPowerW !== undefined ? Math.round(item.normalizedPowerW) : undefined,
      item.maxPowerW !== undefined ? Math.round(item.maxPowerW) : undefined,
      item.avgWkg !== undefined ? roundTo(item.avgWkg, 2) : undefined,
      item.avgHrBpm !== undefined ? Math.round(item.avgHrBpm) : undefined,
      item.maxHrBpm !== undefined ? Math.round(item.maxHrBpm) : undefined,
      item.avgCadenceRpm !== undefined ? Math.round(item.avgCadenceRpm) : undefined,
      item.weightKg !== undefined ? roundTo(item.weightKg, 1) : undefined,
      item.ftpW !== undefined ? Math.round(item.ftpW) : undefined,
      item.veloBefore !== undefined ? roundTo(item.veloBefore, 1) : undefined,
      item.veloAfter !== undefined ? roundTo(item.veloAfter, 1) : undefined,
      item.sof !== undefined ? Math.round(item.sof) : undefined,
      telemetry?.source ?? '',
      telemetry?.sampleCount,
      fileName ?? '',
    ];
    lines.push(row.map(csvCell).join(','));
  }

  return `${lines.join('\n')}\n`;
}

function formatSecHms(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
    : `${m}m ${String(s).padStart(2, '0')}s`;
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Generates a concise Markdown summary & CSV schema legend to paste into Gemini/Claude
 * alongside the attached CSV / FIT export.
 */
export function buildAiContextMarkdown(
  rider: ActivityExportRiderContext,
  items: ActivityExportItem[],
  opts: { intervalSec?: SamplingIntervalSec; includeGps?: boolean; includeWkg?: boolean } = {},
): string {
  const riderMeta: string[] = [`**${rider.riderName}** (Zwift ID \`${rider.riderId}\`)`];
  if (rider.weightKg) riderMeta.push(`Weight: ${rider.weightKg.toFixed(1)} kg`);
  if (rider.ftpW) riderMeta.push(`FTP: ${Math.round(rider.ftpW)} W`);
  if (rider.category) riderMeta.push(`Cat: ${rider.category}`);
  if (rider.zrs != null) riderMeta.push(`ZRS: ${Math.round(rider.zrs)}`);

  const lines: string[] = [
    '## Zwift Activity Telemetry Context',
    riderMeta.join(' · '),
    '',
    '| Date (UTC) | Activity | Type | Placing | Duration | Distance | Elev | Avg / NP Power | Avg W/kg | Avg / Max HR | vELO |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  ];

  for (const item of items) {
    const dateIso = getItemDateIso(item);
    const dateShort = dateIso ? dateIso.slice(0, 10) : '—';
    const placeStr =
      item.truePlace != null
        ? item.fieldSize
          ? `${item.truePlace}/${item.fieldSize}`
          : String(item.truePlace)
        : item.zpPlace != null
          ? `${item.zpPlace} (ZP*)`
          : '—';
    const distStr = item.distanceM != null ? `${(item.distanceM / 1000).toFixed(1)} km` : '—';
    const elevStr = item.elevationM != null ? `${Math.round(item.elevationM)} m` : '—';
    const avgP = item.avgPowerW != null ? `${Math.round(item.avgPowerW)}W` : '—';
    const npP = item.normalizedPowerW != null ? `${Math.round(item.normalizedPowerW)}W` : '—';
    const powerStr =
      item.avgPowerW != null || item.normalizedPowerW != null ? `${avgP} / ${npP}` : '—';
    const wkgStr = item.avgWkg != null ? item.avgWkg.toFixed(2) : '—';
    const hrStr =
      item.avgHrBpm != null || item.maxHrBpm != null
        ? `${item.avgHrBpm != null ? Math.round(item.avgHrBpm) : '—'} / ${item.maxHrBpm != null ? Math.round(item.maxHrBpm) : '—'}`
        : '—';
    const veloStr =
      item.veloBefore != null && item.veloAfter != null
        ? `${item.veloBefore.toFixed(1)} → ${item.veloAfter.toFixed(1)}`
        : '—';

    lines.push(
      `| ${dateShort} | ${escapeMdCell(item.title)} (\`${item.activityId}\`) | ${escapeMdCell(item.activityTypeLabel ?? 'Activity')} | ${placeStr} | ${formatSecHms(item.durationSec)} | ${distStr} | ${elevStr} | ${powerStr} | ${wkgStr} | ${hrStr} | ${veloStr} |`,
    );
  }

  const intervalLabel = opts.intervalSec && opts.intervalSec > 1 ? `${opts.intervalSec}-second averaged` : 'per-second (1s)';
  const cols = [
    '`elapsed_sec`',
    '`timestamp_utc`',
    '`power_w`',
    ...(opts.includeWkg !== false ? ['`wkg`'] : []),
    '`heart_rate_bpm`',
    '`cadence_rpm`',
    '`speed_kmh`',
    '`distance_m`',
    '`altitude_m`',
    '`grade_pct`',
    ...(opts.includeGps ? ['`latitude_deg`', '`longitude_deg`'] : []),
    '`lap` (when lap markers exist in FIT)',
  ];

  lines.push('');
  lines.push(
    `**Attached CSV format (${intervalLabel}):** ${cols.join(', ')}. Multi-activity combined CSVs also prepend \`activity_id\`, \`activity_date\`, \`activity_title\`, and \`activity_type\`.`,
  );

  return lines.join('\n');
}

export function buildActivityBaseFilename(item: ActivityExportItem): string {
  const iso = getItemDateIso(item);
  const datePart = iso ? iso.slice(0, 10) : 'undated';
  const slug =
    item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'zwift-activity';
  return `${datePart}_${slug}_${item.activityId}`;
}

export function allocateUniqueFilename(base: string, ext: string, used: Set<string>): string {
  const cleanExt = ext.replace(/^\./, '');
  let candidate = `${base}.${cleanExt}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}.${cleanExt}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

export function buildExportArchiveZip(files: Record<string, Uint8Array>): Blob {
  const payload: Zippable = {};
  for (const [name, bytes] of Object.entries(files)) {
    payload[name] = bytes;
  }
  const zipped = zipSync(payload, { level: 6 });
  const copy = zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
  return new Blob([copy], { type: 'application/zip' });
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function canShareFiles(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  );
}

export async function shareOrDownloadFile(
  blob: Blob,
  filename: string,
  mimeType: string,
  shareTitle: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareFiles()) {
    try {
      const file = new File([blob], filename, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle });
        return 'shared';
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }
  triggerFileDownload(blob, filename);
  return 'downloaded';
}
