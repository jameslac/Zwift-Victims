import { useMemo, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ZwiftPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import {
  DEFAULT_MARKED_DURATIONS,
  POWER_SERIES_CONFIGS,
  buildPowerBests,
  computeNiceYScale,
  extractPowerProfileMetrics,
  formatEffortDate,
  formatEffortPrimary,
  formatEffortSecondary,
  getEffortMetricValue,
  pickLogAxisTicks,
} from '../lib/powerBests';
import type { PowerBestRow, PowerMetricUnit, PowerSeriesKey } from '../lib/powerBests';
import { formatWeight } from '../lib/units';
import type { UnitSystem } from '../lib/units';
import type { AsyncState } from '../lib/useRiderRaceHistory';
import SharePowerBestsModal from './SharePowerBestsModal';

const MARKERS_STORAGE_KEY = 'zv.powerCurve.markedDurations';

const SVG_WIDTH = 760;
const SVG_HEIGHT = 320;
const PAD = { top: 20, right: 24, bottom: 40, left: 54 };
const PLOT_W = SVG_WIDTH - PAD.left - PAD.right;
const PLOT_H = SVG_HEIGHT - PAD.top - PAD.bottom;

function loadMarkedDurations(): number[] {
  try {
    const raw = localStorage.getItem(MARKERS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_MARKED_DURATIONS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_MARKED_DURATIONS];
    const valid = parsed.filter(
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 3600,
    );
    return valid.length > 0 ? [...new Set(valid)].sort((a, b) => a - b) : [...DEFAULT_MARKED_DURATIONS];
  } catch {
    return [...DEFAULT_MARKED_DURATIONS];
  }
}

function saveMarkedDurations(durations: number[]): void {
  try {
    localStorage.setItem(MARKERS_STORAGE_KEY, JSON.stringify(durations));
  } catch {
    // Ignore storage quota/private mode errors.
  }
}

export default function PowerBestsSection({
  riderName,
  isOwnProfile,
  weightGrams,
  units,
  ftp,
  zftp: zftpProp,
  zmap: zmapProp,
  powerProfileState,
  zpState,
}: {
  riderName: string;
  isOwnProfile: boolean;
  weightGrams?: number;
  units: UnitSystem;
  ftp?: number;
  zftp?: number;
  zmap?: number;
  powerProfileState: AsyncState<ZwiftPowerProfile> | null;
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
}) {
  const [unit, setUnit] = useState<PowerMetricUnit>('watts');
  const [visibleSeries, setVisibleSeries] = useState<Record<PowerSeriesKey, boolean>>({
    zwiftAllTime: true,
    zwift90Day: true,
    zpRaceBest: true,
  });
  const [markedDurations, setMarkedDurations] = useState<number[]>(loadMarkedDurations);
  const [markersMenuOpen, setMarkersMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedSeconds, setSelectedSeconds] = useState<number | null>(null);

  const powerProfile =
    powerProfileState?.status === 'loaded' ? powerProfileState.data : undefined;
  const zpRaces = useMemo(
    () => (zpState.status === 'loaded' ? zpState.data : []),
    [zpState],
  );

  const rows = useMemo(
    () => buildPowerBests({ powerProfile, zpRaces, weightGrams }),
    [powerProfile, zpRaces, weightGrams],
  );

  const extracted = useMemo(() => extractPowerProfileMetrics(powerProfile), [powerProfile]);
  const zftp = zftpProp ?? extracted.zftp;
  const zmap = zmapProp ?? extracted.zmap;
  const vo2max = extracted.vo2max;

  const availableSeries = useMemo(
    () => POWER_SERIES_CONFIGS.filter((s) => !s.ownOnly || isOwnProfile),
    [isOwnProfile],
  );

  const activeSeries = useMemo(
    () => availableSeries.filter((s) => visibleSeries[s.key]),
    [availableSeries, visibleSeries],
  );

  const rowsWithAnyActiveData = useMemo(
    () =>
      rows.filter((row) =>
        activeSeries.some((s) => getEffortMetricValue(row[s.key], unit) !== undefined),
      ),
    [rows, activeSeries, unit],
  );

  const markedSet = useMemo(() => new Set(markedDurations), [markedDurations]);

  const markedRows = useMemo(
    () => rowsWithAnyActiveData.filter((row) => markedSet.has(row.seconds)),
    [rowsWithAnyActiveData, markedSet],
  );

  const interactiveRows = markedRows.length > 0 ? markedRows : rowsWithAnyActiveData;

  const plotRangeRows = rowsWithAnyActiveData.length > 0 ? rowsWithAnyActiveData : rows;
  const hasAnyPoint = rowsWithAnyActiveData.length > 0;

  const maxVal = useMemo(() => {
    let max = 0;
    for (const row of rowsWithAnyActiveData) {
      for (const s of activeSeries) {
        const val = getEffortMetricValue(row[s.key], unit);
        if (val !== undefined && val > max) max = val;
      }
    }
    return max;
  }, [rowsWithAnyActiveData, activeSeries, unit]);

  const { maxY, ticks: yTicks } = useMemo(() => computeNiceYScale(maxVal, unit), [maxVal, unit]);

  const minLog = plotRangeRows.length > 0 ? Math.log(plotRangeRows[0].seconds) : Math.log(1);
  const maxLog =
    plotRangeRows.length > 1 ? Math.log(plotRangeRows[plotRangeRows.length - 1].seconds) : Math.log(3600);
  const logSpan = maxLog - minLog || 1;

  function xFor(seconds: number): number {
    return PAD.left + ((Math.log(seconds) - minLog) / logSpan) * PLOT_W;
  }

  function yFor(val: number): number {
    return PAD.top + PLOT_H - (Math.min(val, maxY) / maxY) * PLOT_H;
  }

  const xTicks = useMemo(
    () =>
      pickLogAxisTicks(
        plotRangeRows,
        (seconds) => PAD.left + ((Math.log(seconds) - minLog) / logSpan) * PLOT_W,
        32,
      ),
    [plotRangeRows, minLog, logSpan],
  );

  const activeRow: PowerBestRow | undefined = useMemo(() => {
    if (interactiveRows.length === 0) return undefined;
    if (selectedSeconds !== null) {
      const exact = interactiveRows.find((r) => r.seconds === selectedSeconds);
      if (exact) return exact;
    }
    const default20m = interactiveRows.find((r) => r.seconds === 1200);
    if (default20m) return default20m;

    let nearest = interactiveRows[0];
    let bestDiff = Math.abs(nearest.seconds - 1200);
    for (const row of interactiveRows) {
      const diff = Math.abs(row.seconds - 1200);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = row;
      }
    }
    return nearest;
  }, [interactiveRows, selectedSeconds]);

  const activeSeconds = activeRow?.seconds ?? null;

  function handlePlotPointer(e: PointerEvent<SVGRectElement>) {
    if (interactiveRows.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = (e.clientX - rect.left) / rect.width;
    const svgX = PAD.left + Math.max(0, Math.min(1, relX)) * PLOT_W;

    let nearest = interactiveRows[0];
    let bestDist = Infinity;
    for (const row of interactiveRows) {
      const dist = Math.abs(xFor(row.seconds) - svgX);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = row;
      }
    }
    if (nearest) setSelectedSeconds(nearest.seconds);
  }

  function toggleSeries(key: PowerSeriesKey) {
    setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function updateMarked(next: number[]) {
    const clean = [...new Set(next)].sort((a, b) => a - b);
    setMarkedDurations(clean);
    saveMarkedDurations(clean);
  }

  function toggleMarkedDuration(sec: number) {
    if (markedSet.has(sec)) {
      if (markedDurations.length <= 1) return;
      updateMarked(markedDurations.filter((d) => d !== sec));
    } else {
      updateMarked([...markedDurations, sec]);
    }
  }

  function selectDefaultMarkers() {
    updateMarked([...DEFAULT_MARKED_DURATIONS]);
  }

  function selectAllMarkers() {
    const allSecs = rowsWithAnyActiveData.map((r) => r.seconds);
    if (allSecs.length > 0) updateMarked(allSecs);
  }

  const markerGroups = useMemo(
    () => [
      {
        title: 'Sprint (< 1 min)',
        items: rowsWithAnyActiveData.filter((r) => r.seconds < 60),
      },
      {
        title: 'Mid-Range (1 – 10 min)',
        items: rowsWithAnyActiveData.filter((r) => r.seconds >= 60 && r.seconds < 600),
      },
      {
        title: 'Endurance (10 – 60 min)',
        items: rowsWithAnyActiveData.filter((r) => r.seconds >= 600),
      },
    ].filter((g) => g.items.length > 0),
    [rowsWithAnyActiveData],
  );

  const allLoading =
    (!isOwnProfile || powerProfileState?.status === 'loading') && zpState.status === 'loading';

  const primaryAreaSeriesKey: PowerSeriesKey =
    isOwnProfile && visibleSeries.zwiftAllTime ? 'zwiftAllTime' : 'zpRaceBest';

  const seriesGeometries = activeSeries.map((series) => {
    const points = plotRangeRows
      .map((row) => {
        const val = getEffortMetricValue(row[series.key], unit);
        if (val === undefined) return null;
        return {
          row,
          effort: row[series.key]!,
          val,
          x: xFor(row.seconds),
          y: yFor(val),
        };
      })
      .filter((pt): pt is NonNullable<typeof pt> => pt !== null);

    const pathD = points
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');

    const areaD =
      series.key === primaryAreaSeriesKey && points.length >= 2
        ? `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${(PAD.top + PLOT_H).toFixed(1)} L ${points[0].x.toFixed(1)} ${(PAD.top + PLOT_H).toFixed(1)} Z`
        : null;

    return { series, points, pathD, areaD };
  });

  const rangeBadge =
    plotRangeRows.length >= 2
      ? `${plotRangeRows[0].shortLabel} – ${plotRangeRows[plotRangeRows.length - 1].shortLabel}`
      : '5s – 60m';

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">Power Curve ({rangeBadge})</h2>
            {isOwnProfile && vo2max !== undefined && (
              <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs font-semibold text-slate-200">
                VO2max {vo2max.toFixed(1)}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {isOwnProfile
              ? 'Zwift All-Time & 90-Day power curves (all rides) alongside ZwiftPower all-time race bests up to 1 hour.'
              : 'ZwiftPower all-time race splits & sustained full-race averages up to 1 hour.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Power metric unit"
            className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950"
          >
            <button
              type="button"
              onClick={() => setUnit('watts')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                unit === 'watts' ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Watts (W)
            </button>
            <button
              type="button"
              onClick={() => setUnit('wkg')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                unit === 'wkg' ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              W/kg
            </button>
          </div>

          {hasAnyPoint && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-[#fc6719]/60 hover:text-[#fc6719] transition-colors"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5"
                aria-hidden="true"
              >
                <path d="M13 4.5a2.5 2.5 0 1 1 .702 1.737L6.97 9.604a2.518 2.518 0 0 1 0 .792l6.733 3.367a2.5 2.5 0 1 1-.671 1.341l-6.733-3.367a2.5 2.5 0 1 1 0-3.475l6.733-3.366A2.52 2.52 0 0 1 13 4.5Z" />
              </svg>
              <span>Share Interval Bests</span>
            </button>
          )}
        </div>
      </div>

      {!isOwnProfile && (
        <p className="text-xs text-slate-400">
          Zwift Feed personal curves (All-Time &amp; 90-Day) are private to your signed-in account;
          showing ZwiftPower race bests for this rider.
        </p>
      )}

      {isOwnProfile && powerProfileState?.status === 'error' && (
        <p role="alert" className="text-xs text-amber-400">
          Zwift Feed power profile unavailable ({powerProfileState.message}); showing ZwiftPower
          race bests.
        </p>
      )}

      {zpState.status === 'error' && (
        <p role="alert" className="text-xs text-amber-400">
          ZwiftPower race history unavailable ({zpState.message}).
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {availableSeries.map((s) => {
            const enabled = visibleSeries[s.key];
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={enabled}
                onClick={() => toggleSeries(s.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  enabled
                    ? 'bg-slate-950/90 border-slate-700 text-slate-100'
                    : 'bg-slate-950/30 border-slate-800 text-slate-500 opacity-60'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {visibleSeries.zpRaceBest && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#34d399] bg-slate-950" />
              <span>Hollow = race avg</span>
            </span>
          )}

          {hasAnyPoint && (
            <button
              type="button"
              aria-expanded={markersMenuOpen}
              onClick={() => setMarkersMenuOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                markersMenuOpen
                  ? 'border-[#fc6719]/60 bg-[#fc6719]/15 text-[#fc6719]'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span>Markers ({interactiveRows.length})</span>
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`w-3.5 h-3.5 transition-transform ${markersMenuOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Interval Marker Picker */}
      {markersMenuOpen && hasAnyPoint && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-300">
              Choose which intervals appear as selectable hover markers &amp; quick buttons (the
              line still plots all {rowsWithAnyActiveData.length} intervals).
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={selectDefaultMarkers}
                className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              >
                Key defaults
              </button>
              <button
                type="button"
                onClick={selectAllMarkers}
                className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              >
                All ({rowsWithAnyActiveData.length})
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {markerGroups.map((group) => (
              <div key={group.title} className="space-y-1.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.title}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map((row) => {
                    const checked = markedSet.has(row.seconds);
                    return (
                      <button
                        key={row.seconds}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggleMarkedDuration(row.seconds)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          checked
                            ? 'border-[#fc6719]/60 bg-[#fc6719]/20 text-slate-100'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                        }`}
                      >
                        {row.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allLoading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Loading power curves…</p>
      ) : activeSeries.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          Enable at least one curve above to display the chart.
        </p>
      ) : !hasAnyPoint ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          No power curve data available for this unit view.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2 sm:p-4">
            <svg
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              className="w-full h-auto select-none"
              style={{ touchAction: 'pan-y' }}
              role="img"
              aria-label="Power duration curve line chart"
            >
              <defs>
                <linearGradient id="zvPowerArea" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={primaryAreaSeriesKey === 'zwiftAllTime' ? '#fc6719' : '#34d399'}
                    stopOpacity="0.22"
                  />
                  <stop
                    offset="100%"
                    stopColor={primaryAreaSeriesKey === 'zwiftAllTime' ? '#fc6719' : '#34d399'}
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>

              {/* Horizontal gridlines + Y-axis labels */}
              {yTicks.map((tick) => {
                const y = yFor(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={PAD.left}
                      y1={y}
                      x2={PAD.left + PLOT_W}
                      y2={y}
                      stroke="#1e293b"
                      strokeDasharray={tick === 0 ? undefined : '3 4'}
                      strokeWidth="1"
                    />
                    <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11">
                      {unit === 'watts' ? `${Math.round(tick)}W` : tick.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Vertical log-scale gridlines + non-overlapping X-axis labels */}
              {xTicks.map((row) => {
                const x = xFor(row.seconds);
                return (
                  <g key={row.seconds}>
                    <line
                      x1={x}
                      y1={PAD.top}
                      x2={x}
                      y2={PAD.top + PLOT_H}
                      stroke="#1e293b"
                      strokeOpacity="0.65"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={PAD.top + PLOT_H + 18}
                      textAnchor="middle"
                      fill={row.seconds === activeSeconds ? '#f8fafc' : '#94a3b8'}
                      fontWeight={row.seconds === activeSeconds ? '700' : '400'}
                      fontSize="11"
                    >
                      {row.shortLabel}
                    </text>
                  </g>
                );
              })}

              {/* Active duration crosshair */}
              {activeSeconds !== null && (
                <line
                  x1={xFor(activeSeconds)}
                  y1={PAD.top}
                  x2={xFor(activeSeconds)}
                  y2={PAD.top + PLOT_H}
                  stroke="#64748b"
                  strokeDasharray="4 4"
                  strokeWidth="1.25"
                />
              )}

              {/* Area fill under primary curve */}
              {seriesGeometries.map(
                ({ series, areaD }) =>
                  areaD && <path key={`${series.key}-area`} d={areaD} fill="url(#zvPowerArea)" />,
              )}

              {/* Full-resolution series lines + selective marked dots */}
              {seriesGeometries.map(({ series, points, pathD }) => (
                <g key={series.key}>
                  {points.length >= 2 && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke={series.color}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {points
                    .filter(
                      (pt) =>
                        markedSet.has(pt.row.seconds) || pt.row.seconds === activeSeconds,
                    )
                    .map((pt) => {
                      const isActive = pt.row.seconds === activeSeconds;
                      const isHollow = Boolean(pt.effort.isSustainedRaceAvg);
                      return (
                        <g key={`${series.key}-${pt.row.seconds}`}>
                          {isActive && (
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r="8"
                              fill={series.color}
                              fillOpacity="0.22"
                            />
                          )}
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isActive ? 5 : 3.5}
                            fill={isHollow ? '#020617' : series.color}
                            stroke={isHollow ? series.color : '#020617'}
                            strokeWidth={isHollow ? 2.2 : 1.5}
                          >
                            <title>
                              {`${series.label} (${pt.row.label}): ${formatEffortPrimary(pt.effort, unit)}`}
                            </title>
                          </circle>
                        </g>
                      );
                    })}
                </g>
              ))}

              {/* Interactive pointer scrub/tap overlay snapped to marked intervals */}
              <rect
                x={PAD.left}
                y={PAD.top}
                width={PLOT_W}
                height={PLOT_H}
                fill="transparent"
                className="cursor-crosshair"
                onPointerMove={handlePlotPointer}
                onPointerDown={handlePlotPointer}
                onClick={handlePlotPointer}
              />
            </svg>

            {/* Quick duration selector pills (marked intervals only) */}
            <div className="flex flex-wrap items-center gap-1.5 px-2 pt-2 pb-1">
              {interactiveRows.map((row) => {
                const isActive = row.seconds === activeSeconds;
                return (
                  <button
                    key={row.seconds}
                    type="button"
                    onClick={() => setSelectedSeconds(row.seconds)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      isActive
                        ? 'bg-[#fc6719] text-white'
                        : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {row.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pinned active duration readout panel */}
          {activeRow && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 sm:p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-100">{activeRow.label} Best</h3>
                <span className="text-[11px] text-slate-400">
                  Hover or tap any marked interval to inspect
                </span>
              </div>

              <div
                className={`grid grid-cols-1 ${
                  activeSeries.length >= 3
                    ? 'sm:grid-cols-3'
                    : activeSeries.length === 2
                      ? 'sm:grid-cols-2'
                      : ''
                } gap-2.5`}
              >
                {activeSeries.map((s) => {
                  const effort = activeRow[s.key];
                  const secondary = formatEffortSecondary(effort, unit);
                  const dateLabel = formatEffortDate(effort?.date);
                  return (
                    <div
                      key={s.key}
                      className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: s.color }}
                          />
                          <span className="font-medium">{s.label}</span>
                        </div>
                        {effort?.isSustainedRaceAvg && (
                          <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
                            race avg
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-extrabold text-slate-100">
                          {formatEffortPrimary(effort, unit)}
                        </span>
                        {secondary && <span className="text-xs text-slate-400">{secondary}</span>}
                      </div>
                      {(dateLabel || effort?.eventTitle) && (
                        <p
                          className="text-[11px] text-slate-500 truncate"
                          title={effort?.eventTitle || dateLabel}
                        >
                          {dateLabel}
                          {dateLabel && effort?.eventTitle ? ' · ' : ''}
                          {effort?.eventTitle}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {shareOpen && (
        <SharePowerBestsModal
          onClose={() => setShareOpen(false)}
          riderName={riderName}
          weightLabel={formatWeight(weightGrams, units)}
          ftp={ftp}
          zftp={zftp}
          zmap={zmap}
          vo2max={vo2max}
          unit={unit}
          series={activeSeries.length > 0 ? activeSeries : availableSeries}
          markedRows={interactiveRows}
          allDataRows={rowsWithAnyActiveData}
        />
      )}
    </section>
  );
}
