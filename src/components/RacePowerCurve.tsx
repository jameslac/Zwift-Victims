import { useMemo, useState } from 'react';
import { useFavorites } from '../lib/FavoritesContext';
import { POWER_CURVE_INTERVALS } from '../lib/raceStandings';
import type { PowerCurveKey, PowerCurveSplits, UnifiedStandingRow } from '../lib/raceStandings';

type CurveUnit = 'wkg' | 'w';

const UNIT_STORAGE_KEY = 'zv.raceDetail.powerCurveUnit';
const MAX_COMPARED = 5;
const TARGET_COLOR = '#fc6719';
const PEN_AVG_COLOR = '#94a3b8';
const COMPARE_COLORS = ['#38bdf8', '#a855f7', '#22c55e', '#facc15', '#f43f5e'] as const;

interface CurveSeries {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  dashed?: boolean;
  isTarget?: boolean;
  splits: PowerCurveSplits;
}

function loadUnit(): CurveUnit {
  try {
    return localStorage.getItem(UNIT_STORAGE_KEY) === 'w' ? 'w' : 'wkg';
  } catch {
    return 'wkg';
  }
}

function getSplitVal(splits: PowerCurveSplits, key: PowerCurveKey, unit: CurveUnit): number | undefined {
  const val = unit === 'w' ? splits[key]?.w : splits[key]?.wkg;
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : undefined;
}

function hasAnySplit(splits: PowerCurveSplits): boolean {
  return POWER_CURVE_INTERVALS.some(
    ({ key }) => getSplitVal(splits, key, 'wkg') != null || getSplitVal(splits, key, 'w') != null,
  );
}

function formatPrimary(val: number | undefined, unit: CurveUnit): string {
  if (val == null || !Number.isFinite(val)) return '—';
  return unit === 'w' ? `${Math.round(val)} W` : `${val.toFixed(2)} W/kg`;
}

function formatCompact(val: number | undefined, unit: CurveUnit): string {
  if (val == null || !Number.isFinite(val)) return '—';
  return unit === 'w' ? `${Math.round(val)}W` : val.toFixed(2);
}

function computeNiceScale(rawMax: number, unit: CurveUnit): { yMax: number; ticks: number[] } {
  const padded = Math.max(rawMax * 1.1, unit === 'wkg' ? 2 : 100);
  const candidates =
    unit === 'wkg'
      ? [0.5, 1, 2, 2.5, 3, 4, 5]
      : [25, 50, 100, 150, 200, 250, 300, 400, 500];
  const rawStep = padded / 4;
  const step =
    candidates.find((c) => c >= rawStep) ??
    Math.ceil(rawStep / (unit === 'wkg' ? 1 : 100)) * (unit === 'wkg' ? 1 : 100);
  const tickCount = 4;
  const yMax = step * tickCount;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * step);
  return { yMax, ticks };
}

function buildPathSegments(points: Array<{ x: number; y: number } | null>): {
  solidPath: string;
  gapBridgePath: string;
} {
  const solidCmds: string[] = [];
  const bridgeCmds: string[] = [];
  let prevIdx = -1;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    const xStr = pt.x.toFixed(1);
    const yStr = pt.y.toFixed(1);
    if (prevIdx === -1) {
      solidCmds.push(`M ${xStr} ${yStr}`);
    } else if (i === prevIdx + 1) {
      solidCmds.push(`L ${xStr} ${yStr}`);
    } else {
      const prev = points[prevIdx]!;
      bridgeCmds.push(`M ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} L ${xStr} ${yStr}`);
      solidCmds.push(`M ${xStr} ${yStr}`);
    }
    prevIdx = i;
  }

  return {
    solidPath: solidCmds.join(' '),
    gapBridgePath: bridgeCmds.join(' '),
  };
}

function shortRiderLabel(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export default function RacePowerCurve({
  penKey,
  targetRiderId,
  targetRiderName,
  targetFallbackSplits,
  rows,
  hrEfficiency,
}: {
  penKey: string;
  targetRiderId: number;
  targetRiderName: string;
  targetFallbackSplits: PowerCurveSplits;
  rows: UnifiedStandingRow[];
  hrEfficiency?: string | number;
}) {
  const { isFavorite } = useFavorites();
  const [unit, setUnit] = useState<CurveUnit>(loadUnit);
  const [comparedState, setComparedState] = useState<{ penKey: string; ids: number[] }>({
    penKey,
    ids: [],
  });
  const [showPenAvg, setShowPenAvg] = useState(true);
  const [riderSearch, setRiderSearch] = useState('');
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const comparedIds = useMemo(
    () => (comparedState.penKey === penKey ? comparedState.ids : []),
    [comparedState, penKey],
  );

  function updateComparedIds(updater: (prev: number[]) => number[]) {
    setComparedState((prev) => {
      const base = prev.penKey === penKey ? prev.ids : [];
      const next = Array.from(new Set(updater(base))).slice(0, MAX_COMPARED);
      return { penKey, ids: next };
    });
  }

  function handleUnitChange(next: CurveUnit) {
    setUnit(next);
    try {
      localStorage.setItem(UNIT_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
  }

  const targetRow = useMemo(
    () => rows.find((r) => r.riderId === targetRiderId),
    [rows, targetRiderId],
  );

  const targetSplits = useMemo<PowerCurveSplits>(() => {
    const pick = (k: PowerCurveKey) => {
      const rSplit = targetRow?.splits[k];
      const fSplit = targetFallbackSplits[k];
      return {
        w: rSplit?.w ?? fSplit?.w,
        wkg: rSplit?.wkg ?? fSplit?.wkg,
      };
    };
    return {
      s5: pick('s5'),
      s15: pick('s15'),
      s30: pick('s30'),
      m1: pick('m1'),
      m2: pick('m2'),
      m5: pick('m5'),
      m20: pick('m20'),
    };
  }, [targetRow, targetFallbackSplits]);

  const penAvgSplits = useMemo<PowerCurveSplits>(() => {
    const empty = () => ({ w: undefined as number | undefined, wkg: undefined as number | undefined });
    const out: PowerCurveSplits = {
      s5: empty(),
      s15: empty(),
      s30: empty(),
      m1: empty(),
      m2: empty(),
      m5: empty(),
      m20: empty(),
    };
    for (const { key } of POWER_CURVE_INTERVALS) {
      let sumW = 0;
      let countW = 0;
      let sumWkg = 0;
      let countWkg = 0;
      for (const r of rows) {
        const w = getSplitVal(r.splits, key, 'w');
        const wkg = getSplitVal(r.splits, key, 'wkg');
        if (w != null) {
          sumW += w;
          countW += 1;
        }
        if (wkg != null) {
          sumWkg += wkg;
          countWkg += 1;
        }
      }
      out[key] = {
        w: countW > 0 ? sumW / countW : undefined,
        wkg: countWkg > 0 ? sumWkg / countWkg : undefined,
      };
    }
    return out;
  }, [rows]);

  const candidateRiders = useMemo(() => {
    return rows
      .filter((r) => r.riderId > 0 && r.riderId !== targetRiderId && hasAnySplit(r.splits))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  }, [rows, targetRiderId]);

  const filteredCandidates = useMemo(() => {
    const q = riderSearch.trim().toLowerCase();
    return candidateRiders.filter(
      (r) => !comparedIds.includes(r.riderId) && (!q || r.name.toLowerCase().includes(q)),
    );
  }, [candidateRiders, comparedIds, riderSearch]);

  const winnerCandidate = useMemo(() => {
    return (
      candidateRiders.find((r) => !r.didNotFinish && !r.disqualified) ?? candidateRiders[0]
    );
  }, [candidateRiders]);

  const favoriteCandidates = useMemo(
    () => candidateRiders.filter((r) => isFavorite(r.riderId)),
    [candidateRiders, isFavorite],
  );

  const activeComparedRows = useMemo(() => {
    const byId = new Map(candidateRiders.map((r) => [r.riderId, r]));
    return comparedIds
      .map((id) => byId.get(id))
      .filter((r): r is UnifiedStandingRow => r !== undefined);
  }, [candidateRiders, comparedIds]);

  const hasPenAvgData = hasAnySplit(penAvgSplits);
  const targetHasData = hasAnySplit(targetSplits);

  const visibleSeries = useMemo<CurveSeries[]>(() => {
    const list: CurveSeries[] = [];
    if (showPenAvg && hasPenAvgData) {
      list.push({
        id: 'pen-avg',
        label: 'Pen Avg',
        shortLabel: 'Pen Avg',
        color: PEN_AVG_COLOR,
        dashed: true,
        splits: penAvgSplits,
      });
    }
    activeComparedRows.forEach((row, idx) => {
      const rankPrefix = row.rank != null ? `#${row.rank} ` : '';
      list.push({
        id: `rider-${row.riderId}`,
        label: `${rankPrefix}${row.name}`,
        shortLabel: shortRiderLabel(row.name),
        color: COMPARE_COLORS[idx % COMPARE_COLORS.length],
        splits: row.splits,
      });
    });
    list.push({
      id: `target-${targetRiderId}`,
      label: targetRiderName,
      shortLabel: shortRiderLabel(targetRiderName),
      color: TARGET_COLOR,
      isTarget: true,
      splits: targetSplits,
    });
    return list;
  }, [
    showPenAvg,
    hasPenAvgData,
    penAvgSplits,
    activeComparedRows,
    targetRiderId,
    targetRiderName,
    targetSplits,
  ]);

  const chartGeometry = useMemo(() => {
    const width = 720;
    const height = 260;
    const pad = { top: 20, right: 24, bottom: 32, left: 48 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    let rawMax = 0;
    for (const series of visibleSeries) {
      for (const { key } of POWER_CURVE_INTERVALS) {
        const val = getSplitVal(series.splits, key, unit);
        if (val != null && val > rawMax) rawMax = val;
      }
    }

    const { yMax, ticks } = computeNiceScale(rawMax, unit);
    const xForIndex = (i: number) =>
      pad.left + (i / (POWER_CURVE_INTERVALS.length - 1)) * plotW;
    const yForValue = (val: number) => pad.top + plotH - (val / yMax) * plotH;

    const mappedSeries = visibleSeries.map((series) => {
      const points = POWER_CURVE_INTERVALS.map(({ key }, i) => {
        const val = getSplitVal(series.splits, key, unit);
        if (val == null) return null;
        return { x: xForIndex(i), y: yForValue(val), val, key };
      });
      const { solidPath, gapBridgePath } = buildPathSegments(points);
      return { series, points, solidPath, gapBridgePath };
    });

    const targetEntry = mappedSeries.find((m) => m.series.isTarget);
    let targetAreaPath = '';
    if (targetEntry) {
      const validPts = targetEntry.points.filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );
      if (validPts.length >= 2) {
        const baselineY = (pad.top + plotH).toFixed(1);
        const lineCmds = validPts
          .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' ');
        targetAreaPath = `${lineCmds} L ${validPts[validPts.length - 1].x.toFixed(1)} ${baselineY} L ${validPts[0].x.toFixed(1)} ${baselineY} Z`;
      }
    }

    return { width, height, pad, plotW, plotH, yMax, ticks, xForIndex, yForValue, mappedSeries, targetAreaPath };
  }, [visibleSeries, unit]);

  const winnerSelected = winnerCandidate != null && comparedIds.includes(winnerCandidate.riderId);
  const allFavsSelected =
    favoriteCandidates.length > 0 &&
    favoriteCandidates.slice(0, MAX_COMPARED).every((f) => comparedIds.includes(f.riderId));

  function toggleWinner() {
    if (!winnerCandidate) return;
    updateComparedIds((prev) =>
      prev.includes(winnerCandidate.riderId)
        ? prev.filter((id) => id !== winnerCandidate.riderId)
        : [...prev, winnerCandidate.riderId],
    );
  }

  function toggleFavorites() {
    if (favoriteCandidates.length === 0) return;
    const favIds = favoriteCandidates.map((f) => f.riderId);
    updateComparedIds((prev) => {
      if (allFavsSelected) return prev.filter((id) => !favIds.includes(id));
      const merged = [...prev];
      for (const id of favIds) {
        if (!merged.includes(id) && merged.length < MAX_COMPARED) merged.push(id);
      }
      return merged;
    });
  }

  const activeInterval = activeIdx != null ? POWER_CURVE_INTERVALS[activeIdx] : null;
  const targetShort = shortRiderLabel(targetRiderName);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">Power Curve</h2>
            {hrEfficiency !== undefined && (
              <span
                title="Heart Rate Efficiency (Watts per heartbeat from ZwiftPower)"
                className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-300"
              >
                HR Efficiency: {hrEfficiency}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Peak power splits (5s–20m) across ZwiftPower, ZwiftRacing, and Zwift Core — overlay pen
            riders to see where races were won.
          </p>
        </div>

        <div
          role="group"
          aria-label="Power curve unit"
          className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950 self-start"
        >
          {(['wkg', 'w'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => handleUnitChange(u)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                unit === u ? 'bg-accent text-accent-foreground' : 'text-slate-300 hover:text-white'
              }`}
            >
              {u === 'wkg' ? 'W/kg' : 'Watts (W)'}
            </button>
          ))}
        </div>
      </div>

      {/* Comparison Controls */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {candidateRiders.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                value={riderSearch}
                onChange={(e) => setRiderSearch(e.target.value)}
                placeholder="Filter riders…"
                aria-label="Filter pen riders to compare"
                className="w-36 rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-accent"
              />
              <select
                aria-label="Select rider to compare power curve"
                value=""
                disabled={comparedIds.length >= MAX_COMPARED || filteredCandidates.length === 0}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (Number.isFinite(id) && id > 0) {
                    updateComparedIds((prev) => [...prev, id]);
                    setRiderSearch('');
                  }
                }}
                className="max-w-xs rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">
                  {comparedIds.length >= MAX_COMPARED
                    ? `Max ${MAX_COMPARED} compared`
                    : filteredCandidates.length === 0
                      ? 'No matching riders'
                      : `+ Compare rider (${filteredCandidates.length})…`}
                </option>
                {filteredCandidates.map((r) => (
                  <option key={r.riderId} value={r.riderId}>
                    {r.rank != null ? `#${r.rank} ` : ''}
                    {r.name}
                    {isFavorite(r.riderId) ? ' ★' : ''}
                    {r.avgWkg != null ? ` · ${r.avgWkg.toFixed(2)} W/kg` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {winnerCandidate && (
            <button
              type="button"
              onClick={toggleWinner}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                winnerSelected
                  ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                  : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {winnerCandidate.rank != null ? `Compare #${winnerCandidate.rank}` : 'Compare Leader'}
            </button>
          )}

          {favoriteCandidates.length > 0 && (
            <button
              type="button"
              onClick={toggleFavorites}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                allFavsSelected
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                  : 'bg-slate-950 border-slate-700 text-amber-300/90 hover:bg-slate-800'
              }`}
            >
              ★ Favorites ({favoriteCandidates.length})
            </button>
          )}

          {hasPenAvgData && (
            <button
              type="button"
              onClick={() => setShowPenAvg((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                showPenAvg
                  ? 'bg-slate-800 border-slate-500 text-slate-100'
                  : 'bg-slate-950 border-slate-700 text-slate-400 hover:bg-slate-800'
              }`}
            >
              Pen Avg
            </button>
          )}

          {comparedIds.length > 0 && (
            <button
              type="button"
              onClick={() => updateComparedIds(() => [])}
              className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-700"
            >
              Clear
            </button>
          )}
        </div>

        {/* Active Curve Legend Pills */}
        {(targetHasData || activeComparedRows.length > 0 || (showPenAvg && hasPenAvgData)) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 border border-[#fc6719]/50 px-2.5 py-1 text-xs font-semibold text-slate-100">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: TARGET_COLOR }}
              />
              {targetRiderName}
            </span>

            {activeComparedRows.map((row, idx) => {
              const color = COMPARE_COLORS[idx % COMPARE_COLORS.length];
              return (
                <button
                  key={row.riderId}
                  type="button"
                  onClick={() =>
                    updateComparedIds((prev) => prev.filter((id) => id !== row.riderId))
                  }
                  title={`Remove ${row.name} from comparison`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 border border-slate-700 hover:border-slate-500 px-2.5 py-1 text-xs text-slate-200 transition"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span>
                    {row.rank != null ? `#${row.rank} ` : ''}
                    {row.name}
                    {isFavorite(row.riderId) ? ' ★' : ''}
                  </span>
                  <span className="text-slate-400 hover:text-white ml-0.5">×</span>
                </button>
              );
            })}

            {showPenAvg && hasPenAvgData && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950/70 border border-slate-800 px-2.5 py-1 text-xs text-slate-300">
                <span className="w-3.5 border-t-2 border-dashed border-slate-400" />
                Pen Avg
              </span>
            )}
          </div>
        )}
      </div>

      {!targetHasData && !hasPenAvgData && activeComparedRows.length === 0 ? (
        <p className="text-sm text-slate-400">
          No peak power splits available for this race or pen across ZwiftPower, ZwiftRacing, and
          Zwift Core.
        </p>
      ) : (
        <>
          {/* Hover / Tap Readout Strip */}
          <div className="min-h-8 rounded-xl bg-slate-950/70 border border-slate-800 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {activeInterval ? (
              <>
                <span className="font-bold text-slate-200 uppercase tracking-wide">
                  {activeInterval.label} Peak:
                </span>
                {visibleSeries
                  .slice()
                  .reverse()
                  .map((series) => {
                    const primaryVal = getSplitVal(series.splits, activeInterval.key, unit);
                    const secondaryUnit: CurveUnit = unit === 'wkg' ? 'w' : 'wkg';
                    const secondaryVal = getSplitVal(series.splits, activeInterval.key, secondaryUnit);
                    const targetVal = getSplitVal(targetSplits, activeInterval.key, unit);
                    const targetAdvantage =
                      !series.isTarget && primaryVal != null && targetVal != null
                        ? targetVal - primaryVal
                        : undefined;
                    return (
                      <span key={series.id} className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: series.color }}
                        />
                        <span className="text-slate-300">{series.shortLabel}:</span>
                        <span className="font-mono font-semibold text-slate-100">
                          {formatPrimary(primaryVal, unit)}
                        </span>
                        {secondaryVal != null && (
                          <span className="text-slate-500 font-mono">
                            ({formatPrimary(secondaryVal, secondaryUnit)})
                          </span>
                        )}
                        {targetAdvantage != null && Math.abs(targetAdvantage) >= 0.005 && (
                          <span
                            title={`${targetShort} vs ${series.shortLabel}`}
                            className={`font-mono text-[11px] ${
                              targetAdvantage > 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            ({targetShort} {targetAdvantage > 0 ? '+' : ''}
                            {unit === 'w'
                              ? `${Math.round(targetAdvantage)}W`
                              : targetAdvantage.toFixed(2)}
                            )
                          </span>
                        )}
                      </span>
                    );
                  })}
              </>
            ) : (
              <span className="text-slate-400">
                Hover or select an interval column on the chart to compare exact splits.
              </span>
            )}
          </div>

          {/* Interactive SVG Chart */}
          <div className="rounded-xl bg-slate-950/60 border border-slate-800/90 p-2 sm:p-4">
            <svg
              viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
              className="w-full h-auto overflow-visible select-none"
              role="img"
              aria-label={`Power curve chart comparing ${targetRiderName} across 5s to 20m intervals`}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <defs>
                <linearGradient id="zvTargetCurveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TARGET_COLOR} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={TARGET_COLOR} stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Horizontal Gridlines & Y-Axis Labels */}
              {chartGeometry.ticks.map((tick) => {
                const y = chartGeometry.yForValue(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={chartGeometry.pad.left}
                      y1={y}
                      x2={chartGeometry.pad.left + chartGeometry.plotW}
                      y2={y}
                      stroke="#1e293b"
                      strokeDasharray={tick === 0 ? undefined : '3 3'}
                    />
                    <text
                      x={chartGeometry.pad.left - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill="#94a3b8"
                      fontSize="11"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {unit === 'wkg' ? tick.toFixed(tick % 1 === 0 ? 0 : 1) : Math.round(tick)}
                    </text>
                  </g>
                );
              })}

              {/* Y-Axis Unit Label */}
              <text
                x={chartGeometry.pad.left - 8}
                y={12}
                textAnchor="end"
                fill="#64748b"
                fontSize="10"
              >
                {unit === 'wkg' ? 'W/kg' : 'W'}
              </text>

              {/* Vertical Hover Crosshair */}
              {activeIdx != null && (
                <line
                  x1={chartGeometry.xForIndex(activeIdx)}
                  y1={chartGeometry.pad.top}
                  x2={chartGeometry.xForIndex(activeIdx)}
                  y2={chartGeometry.pad.top + chartGeometry.plotH}
                  stroke="#475569"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              )}

              {/* Area Fill under Target Curve */}
              {chartGeometry.targetAreaPath && (
                <path d={chartGeometry.targetAreaPath} fill="url(#zvTargetCurveFill)" />
              )}

              {/* Series Lines & Dots */}
              {chartGeometry.mappedSeries.map(({ series, points, solidPath, gapBridgePath }) => (
                <g key={series.id}>
                  {gapBridgePath && (
                    <path
                      d={gapBridgePath}
                      fill="none"
                      stroke={series.color}
                      strokeWidth={series.isTarget ? 2 : 1.5}
                      strokeDasharray="4 4"
                      opacity={0.55}
                    />
                  )}
                  {solidPath && (
                    <path
                      d={solidPath}
                      fill="none"
                      stroke={series.color}
                      strokeWidth={series.isTarget ? 2.75 : series.dashed ? 1.75 : 2.25}
                      strokeDasharray={series.dashed ? '6 4' : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {points.map((pt, i) => {
                    if (!pt) return null;
                    const isHovered = activeIdx === i;
                    return (
                      <circle
                        key={`${series.id}-${i}`}
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? (series.isTarget ? 6 : 5) : series.isTarget ? 4 : 3}
                        fill={series.color}
                        stroke="#0f172a"
                        strokeWidth={isHovered ? 2 : 1.5}
                      />
                    );
                  })}
                </g>
              ))}

              {/* X-Axis Labels & Full-Height Interactive Columns */}
              {POWER_CURVE_INTERVALS.map(({ label }, i) => {
                const x = chartGeometry.xForIndex(i);
                const colWidth = chartGeometry.plotW / (POWER_CURVE_INTERVALS.length - 1);
                const rectX = Math.max(chartGeometry.pad.left - 12, x - colWidth / 2);
                const isHovered = activeIdx === i;
                return (
                  <g key={label}>
                    <text
                      x={x}
                      y={chartGeometry.height - 8}
                      textAnchor="middle"
                      fill={isHovered ? '#f8fafc' : '#94a3b8'}
                      fontWeight={isHovered ? 700 : 500}
                      fontSize="11"
                    >
                      {label}
                    </text>
                    <rect
                      x={rectX}
                      y={chartGeometry.pad.top}
                      width={colWidth}
                      height={chartGeometry.plotH + 24}
                      fill="transparent"
                      className="cursor-pointer outline-none"
                      tabIndex={0}
                      role="button"
                      aria-label={`Inspect ${label} power interval`}
                      onMouseEnter={() => setActiveIdx(i)}
                      onFocus={() => setActiveIdx(i)}
                      onClick={() => setActiveIdx((prev) => (prev === i ? null : i))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActiveIdx((prev) => (prev === i ? null : i));
                        }
                      }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Comparison Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide">
                  <th className="py-2 pr-4 whitespace-nowrap">Interval</th>
                  {activeComparedRows.length === 0 ? (
                    <>
                      <th className="py-2 pr-4 whitespace-nowrap">Watts</th>
                      <th className="py-2 pr-4 whitespace-nowrap">W/kg</th>
                      {hasPenAvgData && <th className="py-2 pr-4 whitespace-nowrap">Pen Avg</th>}
                      {hasPenAvgData && <th className="py-2 whitespace-nowrap">vs Pen Avg</th>}
                    </>
                  ) : (
                    <>
                      <th className="py-2 pr-4 whitespace-nowrap text-[#fc6719]">
                        {targetShort} ({unit === 'wkg' ? 'W/kg' : 'W'})
                      </th>
                      {activeComparedRows.map((row, idx) => (
                        <th
                          key={row.riderId}
                          className="py-2 pr-4 whitespace-nowrap"
                          style={{ color: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                          title={`Delta shown relative to ${targetRiderName}`}
                        >
                          {row.rank != null ? `#${row.rank} ` : ''}
                          {shortRiderLabel(row.name)}
                        </th>
                      ))}
                      {showPenAvg && hasPenAvgData && (
                        <th className="py-2 whitespace-nowrap">Pen Avg</th>
                      )}
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {POWER_CURVE_INTERVALS.map(({ key, label }, i) => {
                  const targetW = getSplitVal(targetSplits, key, 'w');
                  const targetWkg = getSplitVal(targetSplits, key, 'wkg');
                  const targetVal = unit === 'w' ? targetW : targetWkg;
                  const penVal = getSplitVal(penAvgSplits, key, unit);
                  const diffPct =
                    targetVal != null && penVal != null && penVal > 0
                      ? ((targetVal - penVal) / penVal) * 100
                      : undefined;
                  const diffAbs =
                    targetVal != null && penVal != null ? targetVal - penVal : undefined;
                  const isRowHighlighted = activeIdx === i;

                  return (
                    <tr
                      key={key}
                      onMouseEnter={() => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(null)}
                      className={isRowHighlighted ? 'bg-slate-800/40' : 'hover:bg-slate-900/50'}
                    >
                      <td className="py-2 pr-4 font-semibold whitespace-nowrap">{label}</td>

                      {activeComparedRows.length === 0 ? (
                        <>
                          <td className="py-2 pr-4 font-mono whitespace-nowrap">
                            {targetW != null ? `${Math.round(targetW)} W` : '—'}
                          </td>
                          <td className="py-2 pr-4 font-mono whitespace-nowrap">
                            {targetWkg != null ? `${targetWkg.toFixed(2)} W/kg` : '—'}
                          </td>
                          {hasPenAvgData && (
                            <td className="py-2 pr-4 font-mono text-slate-400 whitespace-nowrap">
                              {formatPrimary(penVal, unit)}
                            </td>
                          )}
                          {hasPenAvgData && (
                            <td className="py-2 font-mono whitespace-nowrap">
                              {diffPct != null && diffAbs != null ? (
                                <span
                                  className={
                                    diffAbs > 0
                                      ? 'text-emerald-400'
                                      : diffAbs < 0
                                        ? 'text-red-400'
                                        : 'text-slate-300'
                                  }
                                >
                                  {diffPct > 0 ? '+' : ''}
                                  {diffPct.toFixed(1)}% ({diffAbs > 0 ? '+' : ''}
                                  {formatCompact(diffAbs, unit)})
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                          )}
                        </>
                      ) : (
                        <>
                          <td className="py-2 pr-4 font-mono whitespace-nowrap">
                            <span className="font-semibold text-slate-100">
                              {formatCompact(targetVal, unit)}
                            </span>
                            <span className="ml-1.5 text-[11px] text-slate-500">
                              {formatCompact(
                                unit === 'w' ? targetWkg : targetW,
                                unit === 'w' ? 'wkg' : 'w',
                              )}
                            </span>
                          </td>
                          {activeComparedRows.map((row) => {
                            const compVal = getSplitVal(row.splits, key, unit);
                            const deltaVsComp =
                              targetVal != null && compVal != null
                                ? targetVal - compVal
                                : undefined;
                            return (
                              <td key={row.riderId} className="py-2 pr-4 font-mono whitespace-nowrap">
                                <span className="text-slate-200">
                                  {formatCompact(compVal, unit)}
                                </span>
                                {deltaVsComp != null && Math.abs(deltaVsComp) >= 0.005 && (
                                  <span
                                    title={`${targetRiderName} vs ${row.name} (${deltaVsComp > 0 ? 'ahead' : 'behind'})`}
                                    className={`ml-1.5 text-[11px] ${
                                      deltaVsComp > 0 ? 'text-emerald-400' : 'text-red-400'
                                    }`}
                                  >
                                    ({deltaVsComp > 0 ? '+' : ''}
                                    {unit === 'w'
                                      ? Math.round(deltaVsComp)
                                      : deltaVsComp.toFixed(2)}
                                    )
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          {showPenAvg && hasPenAvgData && (
                            <td className="py-2 font-mono text-slate-400 whitespace-nowrap">
                              {formatCompact(penVal, unit)}
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}