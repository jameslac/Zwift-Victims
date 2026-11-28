import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { roundTo } from './activityExport';
import type {
  ActivityExportItem,
  ActivityExportRiderContext,
  CsvFormatOptions,
  ParsedActivityTelemetry,
  SamplingIntervalSec,
  TelemetrySample,
} from './activityExport';
import { csvCell } from './telemetryCore';

export { mergedRaceToExportItem } from './activityExport';
export {
  decodeFitTelemetry,
  parseFitnessDataTelemetry,
  resampleTelemetrySamples,
} from './telemetryCore';
export type {
  ActivityExportItem,
  ActivityExportRiderContext,
  CsvFormatOptions,
  CsvPackaging,
  ExportFormat,
  ParsedActivityTelemetry,
  SamplingIntervalSec,
  TelemetryLap,
  TelemetrySample,
  TelemetrySource,
} from './activityExport';

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
