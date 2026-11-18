import { useMemo, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ZwiftPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { buildPowerBests, extractPowerProfileMetrics } from '../lib/powerBests';
import type { PowerBestRow, PowerEffort } from '../lib/powerBests';
import type { AsyncState } from '../lib/useRiderRaceHistory';

type MetricUnit = 'watts' | 'wkg';
type SeriesKey = 'zwiftAllTime' | 'zwift90Day' | 'zpRaceBest';

interface SeriesConfig {
  key: SeriesKey;
  label: string;
  color: string;
  ownOnly: boolean;
}

const SERIES_CONFIGS: readonly SeriesConfig[] = [
  { key: 'zwiftAllTime', label: 'Zwift All-Time', color: '#fc6719', ownOnly: true },
  { key: 'zwift90Day', label: 'Zwift 90-Day', color: '#38bdf8', ownOnly: true },
  { key: 'zpRaceBest', label: 'ZwiftPower Race Best', color: '#34d399', ownOnly: false },
];

const X_AXIS_TICK_SECONDS = new Set([5, 15, 30, 60, 120, 300, 600, 1200, 2400, 3600]);

const SVG_WIDTH = 760;
const SVG_HEIGHT = 320;
const PAD = { top: 20, right: 24, bottom: 40, left: 54 };
const PLOT_W = SVG_WIDTH - PAD.left - PAD.right;
const PLOT_H = SVG_HEIGHT - PAD.top - PAD.bottom;

function formatEffortDate(date: string | number | undefined): string | undefined {
  if (date === undefined || date === null || date === '') return undefined;
  const parsed = typeof date === 'number' ? new Date(date * 1000) : new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function getMetricValue(effort: PowerEffort | undefined, unit: MetricUnit): number | undefined {
  if (!effort) return undefined;
  return unit === 'watts' ? effort.watts : effort.wkg;
}

function computeYScale(maxVal: number, unit: MetricUnit): { maxY: number; ticks: number[] } {
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

function formatPrimaryMetric(effort: PowerEffort | undefined, unit: MetricUnit): string {
  if (!effort) return '—';
  if (unit === 'watts') {
    return effort.watts !== undefined ? `${Math.round(effort.watts)} W` : '—';
  }
  return effort.wkg !== undefined ? `${effort.wkg.toFixed(2)} W/kg` : '—';
}

function formatSecondaryMetric(effort: PowerEffort | undefined, unit: MetricUnit): string | undefined {
  if (!effort) return undefined;
  if (unit === 'watts') {
    return effort.wkg !== undefined ? `${effort.wkg.toFixed(2)} W/kg` : undefined;
  }
  return effort.watts !== undefined ? `${Math.round(effort.watts)} W` : undefined;
}

function TableEffortCell({ effort, tag }: { effort?: PowerEffort; tag?: string }) {
  if (!effort || (effort.watts === undefined && effort.wkg === undefined)) {
    return <span className="text-slate-500">—</span>;
  }
  const dateLabel = formatEffortDate(effort.date);
  return (
    <div className="space-y-0.5" title={effort.eventTitle || undefined}>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-semibold text-slate-100">
          {effort.watts !== undefined ? `${Math.round(effort.watts)} W` : '—'}
        </span>
        {effort.wkg !== undefined && (
          <span className="text-xs text-slate-400">{effort.wkg.toFixed(2)} W/kg</span>
        )}
        {tag && (
          <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
            {tag}
          </span>
        )}
      </div>
      {(dateLabel || effort.eventTitle) && (
        <p className="text-[11px] text-slate-500 truncate max-w-[14rem]">
          {dateLabel}
          {dateLabel && effort.eventTitle ? ' · ' : ''}
          {effort.eventTitle}
        </p>
      )}
    </div>
  );
}

export default function PowerBestsSection({
  isOwnProfile,
  weightGrams,
  powerProfileState,
  zpState,
}: {
  isOwnProfile: boolean;
  weightGrams?: number;
  powerProfileState: AsyncState<ZwiftPowerProfile> | null;
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
}) {
  const [unit, setUnit] = useState<MetricUnit>('watts');
  const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
    zwiftAllTime: true,
    zwift90Day: true,
    zpRaceBest: true,
  });
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

  const { vo2max } = useMemo(() => extractPowerProfileMetrics(powerProfile), [powerProfile]);

  const availableSeries = useMemo(
    () => SERIES_CONFIGS.filter((s) => !s.ownOnly || isOwnProfile),
    [isOwnProfile],
  );

  const activeSeries = useMemo(
    () => availableSeries.filter((s) => visibleSeries[s.key]),
    [availableSeries, visibleSeries],
  );

  const hasAnyPoint = useMemo(
    () =>
      rows.some((row) =>
        activeSeries.some((s) => getMetricValue(row[s.key], unit) !== undefined),
      ),
    [rows, activeSeries, unit],
  );

  const maxVal = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      for (const s of activeSeries) {
        const val = getMetricValue(row[s.key], unit);
        if (val !== undefined && val > max) max = val;
      }
    }
    return max;
  }, [rows, activeSeries, unit]);

  const { maxY, ticks: yTicks } = useMemo(() => computeYScale(maxVal, unit), [maxVal, unit]);

  const minLog = rows.length > 0 ? Math.log(rows[0].seconds) : Math.log(5);
  const maxLog = rows.length > 1 ? Math.log(rows[rows.length - 1].seconds) : Math.log(3600);
  const logSpan = maxLog - minLog || 1;

  function xFor(seconds: number): number {
    return PAD.left + ((Math.log(seconds) - minLog) / logSpan) * PLOT_W;
  }

  function yFor(val: number): number {
    return PAD.top + PLOT_H - (Math.min(val, maxY) / maxY) * PLOT_H;
  }

  const activeRow: PowerBestRow | undefined = useMemo(() => {
    if (rows.length === 0) return undefined;
    if (selectedSeconds !== null) {
      const exact = rows.find((r) => r.seconds === selectedSeconds);
      if (exact) return exact;
    }
    const defaultRow = rows.find((r) => r.seconds === 1200);
    if (
      defaultRow &&
      activeSeries.some((s) => getMetricValue(defaultRow[s.key], unit) !== undefined)
    ) {
      return defaultRow;
    }
    const firstWithData = rows.find((r) =>
      activeSeries.some((s) => getMetricValue(r[s.key], unit) !== undefined),
    );
    return firstWithData ?? defaultRow ?? rows[0];
  }, [rows, selectedSeconds, activeSeries, unit]);

  const activeSeconds = activeRow?.seconds ?? null;

  function handlePlotPointer(e: PointerEvent<SVGRectElement>) {
    if (rows.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = (e.clientX - rect.left) / rect.width;
    const svgX = PAD.left + Math.max(0, Math.min(1, relX)) * PLOT_W;

    const candidates = rows.filter((r) =>
      activeSeries.some((s) => getMetricValue(r[s.key], unit) !== undefined),
    );
    const pool = candidates.length > 0 ? candidates : rows;

    let nearest = pool[0];
    let bestDist = Infinity;
    for (const row of pool) {
      const dist = Math.abs(xFor(row.seconds) - svgX);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = row;
      }
    }
    if (nearest) setSelectedSeconds(nearest.seconds);
  }

  function toggleSeries(key: SeriesKey) {
    setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const allLoading =
    (!isOwnProfile || powerProfileState?.status === 'loading') && zpState.status === 'loading';

  const primaryAreaSeriesKey: SeriesKey = isOwnProfile && visibleSeries.zwiftAllTime
    ? 'zwiftAllTime'
    : 'zpRaceBest';

  const seriesGeometries = activeSeries.map((series) => {
    const points = rows
      .map((row) => {
        const val = getMetricValue(row[series.key], unit);
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

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">Power Curve (5 sec – 60 min)</h2>
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

        <div
          role="group"
          aria-label="Power metric unit"
          className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950 shrink-0"
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
        {visibleSeries.zpRaceBest && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#34d399] bg-slate-950" />
            <span>Hollow marker = sustained race avg</span>
          </span>
        )}
      </div>

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
              aria-label="Power duration curve line chart from 5 seconds to 60 minutes"
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
                    <text
                      x={PAD.left - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill="#94a3b8"
                      fontSize="11"
                    >
                      {unit === 'watts' ? `${Math.round(tick)}W` : tick.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Vertical log-scale gridlines + X-axis labels */}
              {rows
                .filter((row) => X_AXIS_TICK_SECONDS.has(row.seconds))
                .map((row) => {
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

              {/* Series lines + markers */}
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
                  {points.map((pt) => {
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
                            {`${series.label} (${pt.row.label}): ${formatPrimaryMetric(pt.effort, unit)}`}
                          </title>
                        </circle>
                      </g>
                    );
                  })}
                </g>
              ))}

              {/* Interactive pointer scrub/tap overlay */}
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

            {/* Quick duration selector pills synced with chart */}
            <div className="flex flex-wrap items-center gap-1 px-2 pt-2 pb-1">
              {rows.map((row) => {
                const isActive = row.seconds === activeSeconds;
                const hasData = activeSeries.some(
                  (s) => getMetricValue(row[s.key], unit) !== undefined,
                );
                return (
                  <button
                    key={row.seconds}
                    type="button"
                    disabled={!hasData}
                    onClick={() => setSelectedSeconds(row.seconds)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      isActive
                        ? 'bg-[#fc6719] text-white'
                        : hasData
                          ? 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-600'
                          : 'bg-slate-900/40 text-slate-600 cursor-not-allowed'
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
                  Hover or tap any interval above to inspect
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
                  const secondary = formatSecondaryMetric(effort, unit);
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
                          {formatPrimaryMetric(effort, unit)}
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

          <details className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
            <summary className="cursor-pointer text-xs text-slate-300 font-medium">
              View all intervals table ({rows.length} intervals)
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide text-[11px]">
                    <th className="py-2 px-3 font-medium">Duration</th>
                    {isOwnProfile && <th className="py-2 px-3 font-medium">Zwift All-Time</th>}
                    {isOwnProfile && <th className="py-2 px-3 font-medium">Zwift 90-Day</th>}
                    <th className="py-2 px-3 font-medium">ZwiftPower Race Best</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {rows.map((row) => (
                    <tr key={row.seconds} className="hover:bg-slate-900/50 align-top">
                      <td className="py-2 px-3 whitespace-nowrap font-semibold text-slate-200">
                        {row.label}
                      </td>
                      {isOwnProfile && (
                        <td className="py-2 px-3">
                          <TableEffortCell effort={row.zwiftAllTime} />
                        </td>
                      )}
                      {isOwnProfile && (
                        <td className="py-2 px-3">
                          <TableEffortCell effort={row.zwift90Day} />
                        </td>
                      )}
                      <td className="py-2 px-3">
                        <TableEffortCell
                          effort={row.zpRaceBest}
                          tag={row.zpRaceBest?.isSustainedRaceAvg ? 'race avg' : undefined}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
