import { useEffect, useMemo, useState } from 'react';
import {
  computeNiceYScale,
  formatEffortPrimary,
  formatEffortSecondary,
  getEffortMetricValue,
  pickLogAxisTicks,
} from '../lib/powerBests';
import type {
  PowerBestRow,
  PowerMetricUnit,
  PowerSeriesConfig,
} from '../lib/powerBests';
import { formatPowerBestsText, renderPowerCardPngBlob } from '../lib/powerCardExport';

function triggerPngDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MiniCurveSvg({
  allRows,
  markedRows,
  series,
  unit,
}: {
  allRows: PowerBestRow[];
  markedRows: PowerBestRow[];
  series: readonly PowerSeriesConfig[];
  unit: PowerMetricUnit;
}) {
  const W = 680;
  const H = 165;
  const pad = { top: 14, right: 16, bottom: 26, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const plotRows = useMemo(
    () =>
      allRows.filter((row) =>
        series.some((s) => getEffortMetricValue(row[s.key], unit) !== undefined),
      ),
    [allRows, series, unit],
  );

  if (plotRows.length === 0) return null;

  let maxVal = 0;
  for (const row of plotRows) {
    for (const s of series) {
      const val = getEffortMetricValue(row[s.key], unit);
      if (val !== undefined && val > maxVal) maxVal = val;
    }
  }
  const { maxY, ticks: yTicks } = computeNiceYScale(maxVal, unit);
  const minLog = Math.log(plotRows[0].seconds);
  const maxLog = Math.log(plotRows[plotRows.length - 1].seconds);
  const logSpan = maxLog - minLog || 1;
  const xFor = (sec: number) => pad.left + ((Math.log(sec) - minLog) / logSpan) * plotW;
  const yFor = (val: number) => pad.top + plotH - (Math.min(val, maxY) / maxY) * plotH;
  const xTicks = pickLogAxisTicks(plotRows, xFor, 44);
  const markedSet = new Set(markedRows.map((r) => r.seconds));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span>{s.label}</span>
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Shareable power curve preview"
      >
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                y1={y}
                x2={pad.left + plotW}
                y2={y}
                stroke="#1e293b"
                strokeDasharray={tick === 0 ? undefined : '3 4'}
                strokeWidth="1"
              />
              <text x={pad.left - 6} y={y + 3.5} textAnchor="end" fill="#64748b" fontSize="10">
                {unit === 'watts' ? `${Math.round(tick)}W` : tick.toFixed(0)}
              </text>
            </g>
          );
        })}

        {xTicks.map((row) => {
          const x = xFor(row.seconds);
          return (
            <g key={row.seconds}>
              <line
                x1={x}
                y1={pad.top}
                x2={x}
                y2={pad.top + plotH}
                stroke="#1e293b"
                strokeOpacity="0.65"
                strokeWidth="1"
              />
              <text
                x={x}
                y={pad.top + plotH + 16}
                textAnchor="middle"
                fill="#64748b"
                fontSize="10"
              >
                {row.shortLabel}
              </text>
            </g>
          );
        })}

        {series.map((s) => {
          const pts = plotRows
            .map((row) => {
              const val = getEffortMetricValue(row[s.key], unit);
              if (val === undefined) return null;
              return { row, effort: row[s.key]!, x: xFor(row.seconds), y: yFor(val) };
            })
            .filter((pt): pt is NonNullable<typeof pt> => pt !== null);

          const pathD = pts
            .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
            .join(' ');

          return (
            <g key={s.key}>
              {pts.length >= 2 && (
                <path
                  d={pathD}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {pts
                .filter((pt) => markedSet.has(pt.row.seconds))
                .map((pt) => {
                  const isHollow = Boolean(pt.effort.isSustainedRaceAvg);
                  return (
                    <circle
                      key={`${s.key}-${pt.row.seconds}`}
                      cx={pt.x}
                      cy={pt.y}
                      r="3"
                      fill={isHollow ? '#020617' : s.color}
                      stroke={isHollow ? s.color : '#020617'}
                      strokeWidth={isHollow ? 1.8 : 1.2}
                    />
                  );
                })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function SharePowerBestsModal({
  onClose,
  riderName,
  weightLabel,
  ftp,
  zftp,
  zmap,
  vo2max,
  unit,
  series,
  markedRows,
  allDataRows,
}: {
  onClose: () => void;
  riderName: string;
  weightLabel?: string;
  ftp?: number;
  zftp?: number;
  zmap?: number;
  vo2max?: number;
  unit: PowerMetricUnit;
  series: readonly PowerSeriesConfig[];
  markedRows: PowerBestRow[];
  allDataRows: PowerBestRow[];
}) {
  const [scope, setScope] = useState<'marked' | 'all'>('marked');
  const [busy, setBusy] = useState<'share' | 'download' | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const rows = scope === 'marked' && markedRows.length > 0 ? markedRows : allDataRows;
  const generatedDate = useMemo(() => new Date(), []);
  const generatedDateLabel = generatedDate.toLocaleDateString(undefined, { dateStyle: 'medium' });

  const hasSustainedAvg = useMemo(
    () =>
      rows.some((r) => series.some((s) => s.key === 'zpRaceBest') && r.zpRaceBest?.isSustainedRaceAvg),
    [rows, series],
  );

  const statPills = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (ftp) items.push({ label: 'FTP', value: `${Math.round(ftp)} W` });
    if (zftp !== undefined) items.push({ label: 'zFTP', value: `${Math.round(zftp)} W` });
    if (zmap !== undefined) items.push({ label: 'zMAP', value: `${Math.round(zmap)} W` });
    if (vo2max !== undefined) items.push({ label: 'VO2max', value: vo2max.toFixed(1) });
    if (weightLabel && weightLabel !== '—') items.push({ label: 'Weight', value: weightLabel });
    return items;
  }, [ftp, zftp, zmap, vo2max, weightLabel]);

  const exportInput = {
    riderName,
    weightLabel,
    ftp,
    zftp,
    zmap,
    vo2max,
    unit,
    series,
    rows,
    allRows: allDataRows,
    generatedAt: generatedDate,
  };

  const fileSlug =
    riderName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'zwift-rider';
  const filename = `${fileSlug}-power-bests.png`;

  async function handleExportPng(mode: 'share' | 'download') {
    setBusy(mode);
    setErrorMsg(null);
    try {
      const blob = await renderPowerCardPngBlob(exportInput);
      const file = new File([blob], filename, { type: 'image/png' });

      if (
        mode === 'share' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        navigator.canShare?.({ files: [file] })
      ) {
        try {
          await navigator.share({
            files: [file],
            title: `${riderName} — Zwift Power Bests`,
          });
          return;
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        }
      }

      triggerPngDownload(blob, filename);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to export PNG image.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyText() {
    setErrorMsg(null);
    try {
      await navigator.clipboard.writeText(formatPowerBestsText(exportInput));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMsg('Clipboard access unavailable in this browser.');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-bests-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/85 backdrop-blur-sm p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6 space-y-4 shadow-2xl my-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="share-bests-title" className="text-base sm:text-lg font-bold">
              Share Interval Bests
            </h2>
            <p className="text-xs text-slate-400">
              Screenshot the card below or export a crisp PNG / text summary.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        {/* Action toolbar (outside screenshot card) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950">
            <button
              type="button"
              onClick={() => setScope('marked')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                scope === 'marked' ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Marked ({markedRows.length})
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                scope === 'all' ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              All ({allDataRows.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy !== null || rows.length === 0}
              onClick={() => handleExportPng('share')}
              className="rounded-lg bg-[#fc6719] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#e55a12] disabled:opacity-50"
            >
              {busy === 'share' ? 'Rendering…' : 'Share Image'}
            </button>
            <button
              type="button"
              disabled={busy !== null || rows.length === 0}
              onClick={() => handleExportPng('download')}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {busy === 'download' ? 'Saving…' : 'Download PNG'}
            </button>
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={handleCopyText}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {copied ? 'Copied!' : 'Copy Text'}
            </button>
          </div>
        </div>

        {errorMsg && (
          <p role="alert" className="text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {/* Screenshot-ready card */}
        <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4 sm:p-5 space-y-4">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center rounded-full bg-[#fc6719] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
                Zwift Victims
              </span>
              <span className="text-[11px] text-slate-400">Power Bests · {generatedDateLabel}</span>
            </div>

            <h3 className="text-xl sm:text-2xl font-extrabold text-slate-100">{riderName}</h3>

            {statPills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {statPills.map((pill) => (
                  <span
                    key={pill.label}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs"
                  >
                    <span className="text-slate-400">{pill.label}</span>
                    <span className="font-bold text-slate-100">{pill.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <MiniCurveSvg
            allRows={allDataRows}
            markedRows={rows}
            series={series}
            unit={unit}
          />

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="py-2 px-3 font-semibold">Duration</th>
                  {series.map((s) => (
                    <th key={s.key} className="py-2 px-3 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        <span>{s.label}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {rows.map((row) => (
                  <tr key={row.seconds}>
                    <td className="py-1.5 px-3 font-semibold text-slate-200 whitespace-nowrap">
                      {row.label}
                    </td>
                    {series.map((s) => {
                      const effort = row[s.key];
                      const primary = formatEffortPrimary(effort, unit);
                      const secondary = formatEffortSecondary(effort, unit);
                      const star = s.key === 'zpRaceBest' && effort?.isSustainedRaceAvg ? '*' : '';
                      return (
                        <td key={s.key} className="py-1.5 px-3 whitespace-nowrap">
                          {primary === '—' ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="font-bold text-slate-100">
                                {primary}
                                {star}
                              </span>
                              {secondary && (
                                <span className="text-[11px] text-slate-400">{secondary}</span>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasSustainedAvg && (
            <p className="text-[11px] text-slate-500">
              * ZwiftPower sustained full-race average over races &ge; duration.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
