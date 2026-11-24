import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AuthError,
  fetchActivityFitFile,
  fetchActivityFitnessData,
} from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';
import {
  allocateUniqueFilename,
  buildActivityBaseFilename,
  buildAiContextMarkdown,
  buildExportArchiveZip,
  canShareFiles,
  decodeFitTelemetry,
  formatActivitiesSummaryCsv,
  formatActivityCsv,
  formatCombinedActivitiesCsv,
  parseFitnessDataTelemetry,
  resampleTelemetrySamples,
  shareOrDownloadFile,
  triggerFileDownload,
} from '../lib/fitTelemetry';
import type {
  ActivityExportItem,
  ActivityExportRiderContext,
  CsvPackaging,
  ExportFormat,
  ParsedActivityTelemetry,
  SamplingIntervalSec,
  TelemetrySource,
} from '../lib/fitTelemetry';
import { formatDateTime, formatUnixSeconds } from '../lib/raceHistory';

type ItemProgressStatus =
  | { state: 'ready' }
  | { state: 'fetching' }
  | { state: 'done'; detail: string; warning?: string }
  | { state: 'error'; message: string };

interface CachedTelemetryFetch {
  fitBuffer?: ArrayBuffer;
  fitError?: string;
  fitnessRaw?: unknown;
}

interface ProcessedItem {
  item: ActivityExportItem;
  telemetry?: ParsedActivityTelemetry;
  fitBytes?: Uint8Array;
  sourceNote?: TelemetrySource;
  warning?: string;
}

function getPrimaryButtonLabel(
  format: ExportFormat,
  count: number,
  packaging: CsvPackaging,
  isBusy: boolean,
): string {
  if (isBusy) return 'Preparing Export…';
  if (format === 'fit') {
    return count === 1 ? 'Export & Download FIT' : `Export & Download FIT ZIP (${count})`;
  }
  if (format === 'both') {
    return `Export & Download ZIP (${count})`;
  }
  if (count === 1) {
    return 'Export & Download CSV';
  }
  return packaging === 'combined'
    ? `Export & Download Combined CSV (${count})`
    : `Export & Download CSV ZIP (${count})`;
}

export default function ActivityExportModal({
  onClose,
  rider,
  items,
  onRemoveItem,
}: {
  onClose: () => void;
  rider: ActivityExportRiderContext;
  items: ActivityExportItem[];
  onRemoveItem?: (key: string) => void;
}) {
  const { getAccessToken } = useAuth();

  const [format, setFormat] = useState<ExportFormat>('csv');
  const [packaging, setPackaging] = useState<CsvPackaging>('combined');
  const [intervalSec, setIntervalSec] = useState<SamplingIntervalSec>(1);
  const [includeGps, setIncludeGps] = useState(false);
  const [includeSummary, setIncludeSummary] = useState(true);

  const [busyMode, setBusyMode] = useState<'download' | 'share' | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, ItemProgressStatus>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  const [copiedContext, setCopiedContext] = useState(false);

  const cancelledRef = useRef(false);
  const fetchCacheRef = useRef<Map<string, CachedTelemetryFetch>>(new Map());

  const showShareButton = useMemo(() => canShareFiles(), []);
  const outputsZip =
    format === 'both' ||
    (format === 'fit' && items.length > 1) ||
    (format === 'csv' && items.length > 1 && packaging === 'separate_zip');

  useEffect(() => {
    cancelledRef.current = false;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cancelledRef.current = true;
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelledRef.current = true;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  function handleClose() {
    cancelledRef.current = true;
    onClose();
  }

  function setItemProgress(key: string, status: ItemProgressStatus) {
    if (cancelledRef.current) return;
    setProgressMap((prev) => ({ ...prev, [key]: status }));
  }

  async function resolveFitBuffer(
    item: ActivityExportItem,
    cached: CachedTelemetryFetch,
  ): Promise<ArrayBuffer> {
    if (cached.fitBuffer) return cached.fitBuffer;
    const token = await getAccessToken();
    const buf = await fetchActivityFitFile(token, item.activityId, item.riderId);
    cached.fitBuffer = buf;
    cached.fitError = undefined;
    return buf;
  }

  async function resolveFitnessData(
    item: ActivityExportItem,
    cached: CachedTelemetryFetch,
  ): Promise<unknown> {
    if (cached.fitnessRaw !== undefined) return cached.fitnessRaw;
    const token = await getAccessToken();
    const raw = await fetchActivityFitnessData(token, item.activityId, item.riderId);
    cached.fitnessRaw = raw;
    return raw;
  }

  async function processSingleItem(item: ActivityExportItem): Promise<ProcessedItem> {
    let cached = fetchCacheRef.current.get(item.activityId);
    if (!cached) {
      cached = {};
      fetchCacheRef.current.set(item.activityId, cached);
    }

    const weightKg = item.weightKg ?? rider.weightKg;

    if (format === 'fit') {
      const buf = await resolveFitBuffer(item, cached);
      return {
        item,
        fitBytes: new Uint8Array(buf),
        sourceNote: 'fit',
      };
    }

    let fitFailureMsg: string | undefined;
    try {
      const buf = await resolveFitBuffer(item, cached);
      const decoded = decodeFitTelemetry(buf, { weightKg });
      return {
        item,
        telemetry: decoded,
        fitBytes: format === 'both' ? (decoded.fitBytes ?? new Uint8Array(buf)) : undefined,
        sourceNote: 'fit',
      };
    } catch (err: unknown) {
      if (err instanceof AuthError) throw err;
      fitFailureMsg = err instanceof Error ? err.message : 'Unable to load FIT file.';
      cached.fitError = fitFailureMsg;
    }

    // Automatic fallback to Zwift Core fitnessData stream when S3 .fit is unavailable/forbidden.
    try {
      const rawStream = await resolveFitnessData(item, cached);
      const parsed = parseFitnessDataTelemetry(rawStream, {
        startDateIso: item.startDateIso,
        weightKg,
      });
      return {
        item,
        telemetry: parsed,
        sourceNote: 'fitness_data',
        warning:
          format === 'both'
            ? `Raw .fit unavailable (${fitFailureMsg}); exported CSV from fitness stream fallback.`
            : undefined,
      };
    } catch (fallbackErr: unknown) {
      if (fallbackErr instanceof AuthError) throw fallbackErr;
      const fallbackMsg =
        fallbackErr instanceof Error ? fallbackErr.message : 'Fitness stream fallback failed.';
      throw new Error(`${fitFailureMsg} Fallback: ${fallbackMsg}`, { cause: fallbackErr });
    }
  }

  async function runExport(mode: 'download' | 'share') {
    if (items.length === 0 || busyMode !== null) return;

    cancelledRef.current = false;
    setBusyMode(mode);
    setErrorMsg(null);
    setWarningMsg(null);
    setResultNotice(null);

    const initialMap: Record<string, ItemProgressStatus> = {};
    for (const item of items) {
      initialMap[item.key] = { state: 'ready' };
    }
    setProgressMap(initialMap);

    const results: Array<ProcessedItem | null> = new Array(items.length).fill(null);
    const failures: Array<{ title: string; message: string }> = [];
    let authFailure: AuthError | null = null;
    let nextIdx = 0;
    const concurrency = Math.min(3, items.length);

    async function worker() {
      while (!cancelledRef.current && !authFailure) {
        const idx = nextIdx++;
        if (idx >= items.length) return;
        const item = items[idx];
        setItemProgress(item.key, { state: 'fetching' });
        try {
          const processed = await processSingleItem(item);
          if (cancelledRef.current) return;
          results[idx] = processed;
          if (format === 'fit') {
            const kb = Math.max(1, Math.round((processed.fitBytes?.byteLength ?? 0) / 1024));
            setItemProgress(item.key, { state: 'done', detail: `${kb} KB (.fit)` });
          } else {
            const resampledCount = resampleTelemetrySamples(
              processed.telemetry?.samples ?? [],
              intervalSec,
            ).length;
            const sourceTag = processed.sourceNote === 'fitness_data' ? 'stream fallback' : 'FIT';
            setItemProgress(item.key, {
              state: 'done',
              detail: `${resampledCount.toLocaleString()} rows (${sourceTag})`,
              warning: processed.warning,
            });
          }
        } catch (err: unknown) {
          if (err instanceof AuthError) {
            authFailure = err;
            setItemProgress(item.key, { state: 'error', message: err.message });
            return;
          }
          const msg = err instanceof Error ? err.message : 'Export failed.';
          failures.push({ title: item.title, message: msg });
          setItemProgress(item.key, { state: 'error', message: msg });
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (cancelledRef.current) return;

    if (authFailure) {
      setErrorMsg((authFailure as AuthError).message || 'Session expired. Please log in again.');
      setBusyMode(null);
      return;
    }

    const succeeded = results.filter((r): r is ProcessedItem => r !== null);
    if (succeeded.length === 0) {
      const sampleErr = failures[0]?.message ?? 'Unable to export selected activities.';
      const has403 = failures.some((f) => /403|forbidden/i.test(f.message));
      setErrorMsg(
        has403
          ? `${sampleErr} Zwift S3 denied direct FIT access; you can still download the .fit manually from zwift.com/activity/<id>.`
          : sampleErr,
      );
      setBusyMode(null);
      return;
    }

    try {
      const encoder = new TextEncoder();
      const todayStamp = new Date().toISOString().slice(0, 10);
      let outputBlob: Blob;
      let outputFilename: string;
      let outputMime: string;

      if (format === 'fit' && items.length === 1 && succeeded[0].fitBytes) {
        const bytes = succeeded[0].fitBytes;
        const copy = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        outputBlob = new Blob([copy], { type: 'application/octet-stream' });
        outputFilename = `${buildActivityBaseFilename(succeeded[0].item)}.fit`;
        outputMime = 'application/octet-stream';
      } else if (format === 'csv' && items.length === 1 && succeeded[0].telemetry) {
        const resampled = resampleTelemetrySamples(succeeded[0].telemetry.samples, intervalSec);
        const csvText = formatActivityCsv(resampled, {
          includeGps,
          includeWkg: resampled.some((s) => s.wkg !== undefined),
          includeLap: resampled.some((s) => s.lap !== undefined),
        });
        outputBlob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
        outputFilename = `${buildActivityBaseFilename(succeeded[0].item)}.csv`;
        outputMime = 'text/csv';
      } else if (format === 'csv' && packaging === 'combined') {
        const entries = succeeded
          .filter((r) => Boolean(r.telemetry))
          .map((r) => ({
            item: r.item,
            samples: resampleTelemetrySamples(r.telemetry!.samples, intervalSec),
          }));
        const csvText = formatCombinedActivitiesCsv(entries, {
          includeGps,
          includeWkg: entries.some((e) => e.samples.some((s) => s.wkg !== undefined)),
          includeLap: entries.some((e) => e.samples.some((s) => s.lap !== undefined)),
        });
        outputBlob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
        outputFilename = `zwift-activities-combined_${todayStamp}.csv`;
        outputMime = 'text/csv';
      } else {
        const files: Record<string, Uint8Array> = {};
        const usedNames = new Set<string>(includeSummary ? ['activities_summary.csv'] : []);
        const summaryEntries: Array<{
          item: ActivityExportItem;
          telemetry?: ParsedActivityTelemetry;
          fileName?: string;
        }> = [];

        for (const r of succeeded) {
          const base = buildActivityBaseFilename(r.item);
          const createdNames: string[] = [];

          if (r.telemetry && (format === 'csv' || format === 'both')) {
            const resampled = resampleTelemetrySamples(r.telemetry.samples, intervalSec);
            const csvText = formatActivityCsv(resampled, {
              includeGps,
              includeWkg: resampled.some((s) => s.wkg !== undefined),
              includeLap: resampled.some((s) => s.lap !== undefined),
            });
            const csvName = allocateUniqueFilename(base, 'csv', usedNames);
            files[csvName] = encoder.encode(csvText);
            createdNames.push(csvName);
          }

          if (r.fitBytes && (format === 'fit' || format === 'both')) {
            const fitName = allocateUniqueFilename(base, 'fit', usedNames);
            files[fitName] = r.fitBytes;
            createdNames.push(fitName);
          }

          summaryEntries.push({
            item: r.item,
            telemetry: r.telemetry,
            fileName: createdNames.join(' + '),
          });
        }

        if (includeSummary) {
          files['activities_summary.csv'] = encoder.encode(
            formatActivitiesSummaryCsv(summaryEntries),
          );
        }

        outputBlob = buildExportArchiveZip(files);
        outputFilename =
          items.length === 1
            ? `${buildActivityBaseFilename(succeeded[0].item)}.zip`
            : `zwift-activities-export_${todayStamp}.zip`;
        outputMime = 'application/zip';
      }

      const fallbackCount = succeeded.filter((s) => Boolean(s.warning)).length;
      const warnings: string[] = [];
      if (failures.length > 0) {
        warnings.push(
          `${failures.length} of ${items.length} activities failed and were omitted from the export.`,
        );
      }
      if (fallbackCount > 0) {
        warnings.push(
          `${fallbackCount} ${fallbackCount === 1 ? 'activity' : 'activities'} fell back to JSON stream CSV because the raw .fit binary was unavailable.`,
        );
      }
      if (warnings.length > 0) {
        setWarningMsg(warnings.join(' '));
      }

      const shareTitle =
        items.length === 1
          ? `${items[0].title} — Zwift Telemetry`
          : `${succeeded.length} Zwift Activities — Telemetry Export`;

      if (mode === 'share') {
        const outcome = await shareOrDownloadFile(outputBlob, outputFilename, outputMime, shareTitle);
        if (!cancelledRef.current && outcome !== 'cancelled') {
          setResultNotice(
            outcome === 'shared'
              ? `Shared ${outputFilename}`
              : `Downloaded ${outputFilename}`,
          );
        }
      } else {
        triggerFileDownload(outputBlob, outputFilename);
        if (!cancelledRef.current) {
          setResultNotice(`Downloaded ${outputFilename}`);
        }
      }
    } catch (err: unknown) {
      if (!cancelledRef.current) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to package export file.');
      }
    } finally {
      if (!cancelledRef.current) {
        setBusyMode(null);
      }
    }
  }

  async function handleCopyAiContext() {
    setErrorMsg(null);
    try {
      const markdown = buildAiContextMarkdown(rider, items, {
        intervalSec,
        includeGps,
        includeWkg: true,
      });
      await navigator.clipboard.writeText(markdown);
      setCopiedContext(true);
      setTimeout(() => setCopiedContext(false), 2000);
    } catch {
      setErrorMsg('Clipboard access is unavailable in this browser.');
    }
  }

  const isBusy = busyMode !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-export-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-2.5 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-700/90 bg-slate-900 p-4 sm:p-6 space-y-5 shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="activity-export-title" className="text-base sm:text-lg font-extrabold text-slate-100">
                Export Activity Telemetry
              </h2>
              <span className="rounded-full bg-accent/15 border border-accent/40 px-2.5 py-0.5 text-xs font-bold text-accent-text">
                {items.length} {items.length === 1 ? 'activity' : 'activities'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Export per-second CSV and/or raw FIT files ready to attach to Gemini or Claude.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close export modal"
            className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white shrink-0"
          >
            Close
          </button>
        </div>

        {/* Format Picker */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Export Format
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                {
                  id: 'csv',
                  title: 'Per-Second CSV',
                  subtitle: 'Recommended for Gemini & Claude',
                },
                {
                  id: 'fit',
                  title: 'Raw FIT (.fit)',
                  subtitle: items.length > 1 ? 'Bundled in a .zip archive' : 'Original Zwift binary',
                },
                {
                  id: 'both',
                  title: 'CSV + FIT (.zip)',
                  subtitle: 'Both formats + summary CSV',
                },
              ] as const
            ).map((option) => {
              const active = format === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={isBusy}
                  aria-pressed={active}
                  onClick={() => setFormat(option.id)}
                  className={`rounded-xl border p-3 text-left transition-all disabled:opacity-60 ${
                    active
                      ? 'border-accent bg-accent/12 ring-1 ring-accent'
                      : 'border-slate-800 bg-slate-950/65 hover:border-slate-700'
                  }`}
                >
                  <span className="block text-xs sm:text-sm font-bold text-slate-100">
                    {option.title}
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">{option.subtitle}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CSV & Archive Options */}
        {(format !== 'fit' || outputsZip) && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3.5">
            {format === 'csv' && items.length > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">Multi-Activity CSV Layout</span>
                <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setPackaging('combined')}
                    aria-pressed={packaging === 'combined'}
                    className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                      packaging === 'combined'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Single combined CSV
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setPackaging('separate_zip')}
                    aria-pressed={packaging === 'separate_zip'}
                    className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                      packaging === 'separate_zip'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Separate CSVs (.zip)
                  </button>
                </div>
              </div>
            )}

            {format !== 'fit' && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">Sampling Resolution</span>
                <div
                  role="group"
                  aria-label="Sampling resolution"
                  className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs"
                >
                  {(
                    [
                      { id: 1, label: '1s (Per-second)' },
                      { id: 5, label: '5s avg' },
                      { id: 10, label: '10s avg' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isBusy}
                      aria-pressed={intervalSec === opt.id}
                      onClick={() => setIntervalSec(opt.id)}
                      className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                        intervalSec === opt.id
                          ? 'bg-accent text-accent-foreground'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
              {format !== 'fit' && (
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeGps}
                    disabled={isBusy}
                    onChange={(e) => setIncludeGps(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-900 accent-current text-accent"
                  />
                  <span>Include GPS coordinates (lat/lon)</span>
                </label>
              )}
              {outputsZip && (
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeSummary}
                    disabled={isBusy}
                    onChange={(e) => setIncludeSummary(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-900 accent-current text-accent"
                  />
                  <span>Include activities_summary.csv</span>
                </label>
              )}
            </div>
          </div>
        )}

        {/* Selected Activity Queue */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Selected Activities
          </p>
          <ul className="max-h-56 overflow-y-auto divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/60">
            {items.map((item) => {
              const status = progressMap[item.key] ?? { state: 'ready' };
              const dateLabel =
                item.dateSec !== undefined
                  ? formatUnixSeconds(item.dateSec)
                  : formatDateTime(item.startDateIso);

              return (
                <li
                  key={item.key}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-100 truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {dateLabel}
                      {item.activityTypeLabel ? ` · ${item.activityTypeLabel}` : ''}
                      {` · #${item.activityId}`}
                    </p>
                    {status.state === 'error' && (
                      <p className="text-[11px] text-red-400 mt-0.5 break-words">{status.message}</p>
                    )}
                    {status.state === 'done' && status.warning && (
                      <p className="text-[11px] text-amber-300 mt-0.5">{status.warning}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {status.state === 'ready' && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                        Ready
                      </span>
                    )}
                    {status.state === 'fetching' && (
                      <span className="rounded-full bg-accent/15 border border-accent/40 px-2 py-0.5 text-[11px] font-semibold text-accent-text">
                        Fetching…
                      </span>
                    )}
                    {status.state === 'done' && (
                      <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                        {status.detail}
                      </span>
                    )}
                    {status.state === 'error' && (
                      <span className="rounded-full bg-red-500/15 border border-red-500/40 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                        Failed
                      </span>
                    )}

                    {onRemoveItem && items.length > 1 && !isBusy && (
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.key)}
                        aria-label={`Remove ${item.title} from export`}
                        className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:border-red-500/50 hover:text-red-300"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {warningMsg && (
          <div
            role="status"
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200"
          >
            {warningMsg}
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300"
          >
            {errorMsg}
          </div>
        )}

        {resultNotice && !errorMsg && (
          <div
            role="status"
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-medium text-emerald-300"
          >
            {resultNotice} — Ready to attach directly in Gemini or Claude.
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-800 pt-4">
          <button
            type="button"
            disabled={items.length === 0 || isBusy}
            onClick={handleCopyAiContext}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-accent/60 hover:text-accent-text disabled:opacity-50 transition-colors"
          >
            {copiedContext ? 'Copied AI Context!' : 'Copy AI Context'}
          </button>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {showShareButton && (
              <button
                type="button"
                disabled={items.length === 0 || isBusy}
                onClick={() => runExport('share')}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text disabled:opacity-50 transition-colors"
              >
                {busyMode === 'share' ? 'Sharing…' : 'Share to App…'}
              </button>
            )}
            <button
              type="button"
              disabled={items.length === 0 || isBusy}
              onClick={() => runExport('download')}
              className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-2 text-xs sm:text-sm font-bold text-accent-foreground shadow disabled:opacity-50 transition-colors"
            >
              {getPrimaryButtonLabel(format, items.length, packaging, busyMode === 'download')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
