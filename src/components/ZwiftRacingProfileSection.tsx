import { useId, useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import { ordinal } from '../lib/headToHead';
import type { AsyncState } from '../lib/useRiderRaceHistory';
import {
  buildFactorBreakdown,
  buildPhenotypeProfile,
  buildRaceBreakdown,
  buildRankingsSummary,
  buildVeloSummary,
  buildZwiftRacingRiderUrl,
  decodeHtmlEntities,
  extractPowerModelMetrics,
  getTierProgress,
  getVeloTier,
  getVisibleTiers,
  normalizeHexColor,
} from '../lib/zwiftRacingProfile';
import type {
  PhenotypeAxis,
  PhenotypeProfile,
  RaceBreakdown,
  RankingsSummary,
  VeloScaleMode,
  VeloSeriesResult,
  VeloSystem,
  VeloTier,
  VeloTimelinePoint,
} from '../lib/zwiftRacingProfile';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 270;
const CHART_PAD = { top: 18, right: 76, bottom: 34, left: 48 };
const PLOT_W = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right;
const PLOT_H = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;

function formatRating(val: number | undefined, scale: VeloScaleMode): string {
  if (val === undefined || !Number.isFinite(val)) return '—';
  return scale === 'velo2' ? val.toFixed(1) : Math.round(val).toLocaleString();
}

function formatShortDate(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return 'Unknown';
  return new Date(sec * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatAxisDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatDelta(delta: number | undefined, scale: VeloScaleMode): string {
  if (delta === undefined || !Number.isFinite(delta)) return '—';
  const abs = Math.abs(delta);
  const formatted = scale === 'velo2' ? abs.toFixed(1) : Math.round(abs).toString();
  if (abs < 0.05) return '0.0';
  return delta > 0 ? `+${formatted}` : `-${formatted}`;
}

function formatRaceCraft(val: number): string {
  const abs = Math.abs(val);
  const decimals = abs < 0.1 ? 2 : 1;
  return `${val >= 0 ? '+' : '-'}${abs.toFixed(decimals)}`;
}

function formatPhenotypeRaw(raw: number | undefined, scaleMax: number): string {
  if (raw === undefined || !Number.isFinite(raw)) return '—';
  if (scaleMax <= 1) return `${Math.round(raw * 100)}%`;
  return Math.round(raw).toLocaleString();
}

function TierBadge({ tier, prefix }: { tier: VeloTier; prefix?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold leading-tight tracking-wide shrink-0"
      style={{
        backgroundColor: tier.backgroundColor,
        color: tier.textColor,
      }}
    >
      {prefix ? `${prefix}: ${tier.name}` : tier.name}
    </span>
  );
}

function computeChartYBounds(
  points: VeloTimelinePoint[],
  peaks: Array<number | undefined>,
  scale: VeloScaleMode,
): { minY: number; maxY: number; ticks: number[] } {
  const values = points.map((p) => p.after);
  for (const p of peaks) {
    if (p !== undefined && Number.isFinite(p)) values.push(p);
  }

  if (values.length === 0) {
    return scale === 'velo2'
      ? { minY: 400, maxY: 800, ticks: [400, 500, 600, 700, 800] }
      : { minY: 800, maxY: 1600, ticks: [800, 1000, 1200, 1400, 1600] };
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawSpan = rawMax - rawMin;
  const minPad = scale === 'velo2' ? 24 : 60;
  const pad = Math.max(minPad, rawSpan * 0.22);
  const stepBase = scale === 'velo2' ? 20 : 50;

  let minY = Math.max(0, Math.floor((rawMin - pad) / stepBase) * stepBase);
  let maxY = Math.ceil((rawMax + pad) / stepBase) * stepBase;
  if (maxY - minY < stepBase * 2) {
    maxY = minY + stepBase * 2;
  }

  const totalSpan = maxY - minY;
  const rawStep = totalSpan / 4;
  const stepOptions =
    scale === 'velo2' ? [10, 20, 25, 40, 50, 100, 150, 200] : [25, 50, 100, 150, 200, 250, 500];
  const step = stepOptions.find((s) => s >= rawStep) ?? Math.ceil(rawStep / 50) * 50;

  minY = Math.max(0, Math.floor(minY / step) * step);
  maxY = Math.ceil(maxY / step) * step;

  const ticks: number[] = [];
  for (let y = minY; y <= maxY + 0.001; y += step) {
    ticks.push(Math.round(y));
  }

  return { minY, maxY, ticks };
}

function VeloProgressionChart({
  series,
  scale,
  tierSystem,
  selectedPointKey,
  onSelectPointKey,
}: {
  series: VeloSeriesResult;
  scale: VeloScaleMode;
  tierSystem: VeloSystem;
  selectedPointKey: string | null;
  onSelectPointKey: (key: string) => void;
}) {
  const gradId = useId();
  const { points, max30, max90 } = series;

  const activeIndex = useMemo(() => {
    if (points.length === 0) return -1;
    if (selectedPointKey) {
      const idx = points.findIndex((p) => p.key === selectedPointKey);
      if (idx !== -1) return idx;
    }
    return points.length - 1;
  }, [points, selectedPointKey]);

  const activePoint = activeIndex >= 0 ? points[activeIndex] : null;

  const { minY, maxY, ticks: yTicks } = useMemo(
    () => computeChartYBounds(points, [max30, max90], scale),
    [points, max30, max90, scale],
  );

  const visibleTiers = useMemo(
    () => getVisibleTiers(minY, maxY, tierSystem),
    [minY, maxY, tierSystem],
  );

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400">
        No scored race timeline entries in the current window.
      </div>
    );
  }

  const minT = points[0].time;
  const maxT = points[points.length - 1].time;
  const timeSpan = maxT - minT;

  const xFor = (time: number): number => {
    if (points.length === 1 || timeSpan <= 0) return CHART_PAD.left + PLOT_W / 2;
    return CHART_PAD.left + ((time - minT) / timeSpan) * PLOT_W;
  };

  const yFor = (val: number): number => {
    const span = maxY - minY || 1;
    const clamped = Math.min(maxY, Math.max(minY, val));
    return CHART_PAD.top + PLOT_H - ((clamped - minY) / span) * PLOT_H;
  };

  const coords = points.map((pt) => ({
    pt,
    x: xFor(pt.time),
    y: yFor(pt.after),
  }));

  const pathD = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');

  const areaD =
    coords.length >= 2
      ? `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${(CHART_PAD.top + PLOT_H).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(CHART_PAD.top + PLOT_H).toFixed(1)} Z`
      : null;

  const xTickIndices =
    points.length === 1
      ? [0]
      : points.length <= 4
        ? points.map((_, idx) => idx)
        : [0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1];

  const uniqueXTickIndices = [...new Set(xTickIndices)];

  function handlePointer(e: PointerEvent<SVGRectElement>) {
    if (coords.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = (e.clientX - rect.left) / rect.width;
    const svgX = CHART_PAD.left + Math.max(0, Math.min(1, relX)) * PLOT_W;

    let nearest = coords[0];
    let bestDist = Infinity;
    for (const c of coords) {
      const dist = Math.abs(c.x - svgX);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = c;
      }
    }
    if (nearest) onSelectPointKey(nearest.pt.key);
  }

  const combinedPeak =
    max30 !== undefined && max90 !== undefined && Math.abs(max30 - max90) < 0.05;

  const peakLines: Array<{
    label: string;
    value: number;
    color: string;
    align: 'start' | 'end';
  }> = [];
  if (combinedPeak && max30 !== undefined) {
    peakLines.push({ label: '30d/90d Peak', value: max30, color: '#fbbf24', align: 'start' });
  } else {
    if (max90 !== undefined) {
      peakLines.push({ label: '90d Peak', value: max90, color: '#38bdf8', align: 'start' });
    }
    if (max30 !== undefined) {
      peakLines.push({ label: '30d Peak', value: max30, color: '#fbbf24', align: 'end' });
    }
  }

  const activeCoord = activeIndex >= 0 ? coords[activeIndex] : null;

  return (
    <div className="space-y-2.5">
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2 sm:p-3">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full h-auto select-none"
          style={{ touchAction: 'pan-y' }}
          role="img"
          aria-label="vELO rating progression chart over recent races"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fc6719" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#fc6719" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Subtle tier background bands */}
          {visibleTiers.map(({ tier, yBottom, yTop }) => {
            const topPx = yFor(yTop);
            const bottomPx = yFor(yBottom);
            const bandH = Math.max(0, bottomPx - topPx);
            const midPx = topPx + bandH / 2;
            return (
              <g key={tier.name}>
                <rect
                  x={CHART_PAD.left}
                  y={topPx}
                  width={PLOT_W}
                  height={bandH}
                  fill={tier.backgroundColor}
                  fillOpacity={0.07}
                />
                {tier.min > minY && (
                  <line
                    x1={CHART_PAD.left}
                    y1={bottomPx}
                    x2={CHART_PAD.left + PLOT_W}
                    y2={bottomPx}
                    stroke={tier.backgroundColor}
                    strokeOpacity={0.28}
                    strokeDasharray="2 3"
                    strokeWidth="1"
                  />
                )}
                {bandH >= 14 && (
                  <text
                    x={CHART_PAD.left + PLOT_W + 8}
                    y={midPx + 3.5}
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="600"
                  >
                    {tier.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* Horizontal Y gridlines */}
          {yTicks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line
                  x1={CHART_PAD.left}
                  y1={y}
                  x2={CHART_PAD.left + PLOT_W}
                  y2={y}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text
                  x={CHART_PAD.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10.5"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* 30d / 90d peak reference lines */}
          {peakLines.map((peak) => {
            if (peak.value < minY || peak.value > maxY) return null;
            const y = yFor(peak.value);
            return (
              <g key={peak.label}>
                <line
                  x1={CHART_PAD.left}
                  y1={y}
                  x2={CHART_PAD.left + PLOT_W}
                  y2={y}
                  stroke={peak.color}
                  strokeOpacity={0.65}
                  strokeDasharray="5 4"
                  strokeWidth="1.25"
                />
                <text
                  x={peak.align === 'end' ? CHART_PAD.left + PLOT_W - 6 : CHART_PAD.left + 6}
                  y={Math.max(CHART_PAD.top + 10, y - 4)}
                  textAnchor={peak.align}
                  fill={peak.color}
                  fontSize="10"
                  fontWeight="600"
                >
                  {`${peak.label}: ${formatRating(peak.value, scale)}`}
                </text>
              </g>
            );
          })}

          {/* X-axis date labels */}
          {uniqueXTickIndices.map((idx) => {
            const pt = points[idx];
            const x = xFor(pt.time);
            return (
              <text
                key={`${pt.key}-xtick`}
                x={x}
                y={CHART_PAD.top + PLOT_H + 20}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10.5"
              >
                {pt.isLive ? 'Now' : formatAxisDate(pt.time)}
              </text>
            );
          })}

          {/* Active crosshair */}
          {activeCoord && (
            <line
              x1={activeCoord.x}
              y1={CHART_PAD.top}
              x2={activeCoord.x}
              y2={CHART_PAD.top + PLOT_H}
              stroke="#64748b"
              strokeDasharray="4 4"
              strokeWidth="1.25"
            />
          )}

          {/* Area & progression line */}
          {areaD && <path d={areaD} fill={`url(#${gradId})`} />}
          {coords.length >= 2 && (
            <path
              d={pathD}
              fill="none"
              stroke="#fc6719"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Point markers */}
          {coords.map(({ pt, x, y }, idx) => {
            const isActive = idx === activeIndex;
            const deltaVal = pt.delta ?? 0;
            const dotColor = pt.isLive
              ? '#fc6719'
              : deltaVal > 0.05
                ? '#34d399'
                : deltaVal < -0.05
                  ? '#f87171'
                  : '#94a3b8';

            return (
              <g key={pt.key}>
                {isActive && <circle cx={x} cy={y} r="8" fill={dotColor} fillOpacity="0.24" />}
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? 5 : pt.isLive ? 4.2 : 3.2}
                  fill={dotColor}
                  stroke={pt.isLive ? '#f8fafc' : '#020617'}
                  strokeWidth={pt.isLive ? 1.8 : 1.3}
                >
                  <title>{`${pt.title}: ${formatRating(pt.after, scale)}`}</title>
                </circle>
              </g>
            );
          })}

          {/* Pointer scrub overlay */}
          <rect
            x={CHART_PAD.left}
            y={CHART_PAD.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="transparent"
            className="cursor-crosshair"
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onClick={handlePointer}
          />
        </svg>
      </div>

      {/* Pinned race readout card */}
      {activePoint && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                <span>{activePoint.isLive ? 'Current rating' : formatShortDate(activePoint.time)}</span>
                {activePoint.isLive ? (
                  <span className="rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2 py-0.5 text-[10px] font-semibold text-[#fc6719]">
                    Live
                  </span>
                ) : activePoint.didNotFinish ? (
                  <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                    DNF
                  </span>
                ) : activePoint.disqualified ? (
                  <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                    DQ
                  </span>
                ) : activePoint.positionInCategory != null ? (
                  <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                    {ordinal(activePoint.positionInCategory)}
                    {activePoint.penTotal ? ` / ${activePoint.penTotal}` : ''}
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-semibold text-slate-100 truncate" title={activePoint.title}>
                {activePoint.title}
              </p>
            </div>

            {points.length > 1 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  aria-label="Previous race"
                  disabled={activeIndex <= 0}
                  onClick={() => activeIndex > 0 && onSelectPointKey(points[activeIndex - 1].key)}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-35"
                >
                  ‹
                </button>
                <span className="text-[11px] text-slate-400 tabular-nums px-1">
                  {activeIndex + 1}/{points.length}
                </span>
                <button
                  type="button"
                  aria-label="Next race"
                  disabled={activeIndex >= points.length - 1}
                  onClick={() =>
                    activeIndex < points.length - 1 &&
                    onSelectPointKey(points[activeIndex + 1].key)
                  }
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-35"
                >
                  ›
                </button>
              </div>
            )}
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 px-2.5 py-1.5">
              <dt className="text-slate-400">Rating</dt>
              <dd className="font-semibold text-slate-100 tabular-nums">
                {activePoint.before !== undefined
                  ? `${formatRating(activePoint.before, scale)} → ${formatRating(activePoint.after, scale)}`
                  : formatRating(activePoint.after, scale)}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 px-2.5 py-1.5">
              <dt className="text-slate-400">Change</dt>
              <dd
                className={`font-semibold tabular-nums ${
                  (activePoint.delta ?? 0) > 0.05
                    ? 'text-emerald-300'
                    : (activePoint.delta ?? 0) < -0.05
                      ? 'text-red-300'
                      : 'text-slate-300'
                }`}
              >
                {formatDelta(activePoint.delta, scale)}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 px-2.5 py-1.5">
              <dt className="text-slate-400">SOF</dt>
              <dd className="font-semibold text-slate-100 tabular-nums">
                {activePoint.eventRating !== undefined
                  ? formatRating(activePoint.eventRating, scale)
                  : '—'}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 px-2.5 py-1.5">
              <dt className="text-slate-400">Expected Pos</dt>
              <dd className="font-semibold text-slate-100 tabular-nums">
                {activePoint.expectedPosition !== undefined
                  ? activePoint.expectedPosition.toFixed(1)
                  : '—'}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

const RADAR_CX = 170;
const RADAR_CY = 136;
const RADAR_R = 78;

function polarPoint(index: number, total: number, radius: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return {
    x: RADAR_CX + radius * Math.cos(angle),
    y: RADAR_CY + radius * Math.sin(angle),
  };
}

function PhenotypeRadarCard({
  phenotype,
  selectedAxisId,
  onSelectAxisId,
}: {
  phenotype: PhenotypeProfile;
  selectedAxisId: PhenotypeAxis['id'] | null;
  onSelectAxisId: (id: PhenotypeAxis['id']) => void;
}) {
  const activeAxis = useMemo(() => {
    const matched = selectedAxisId
      ? phenotype.axes.find((a) => a.id === selectedAxisId)
      : undefined;
    if (matched) return matched;
    const populated = phenotype.axes.filter((a) => a.rawValue !== undefined);
    if (populated.length > 0) {
      return populated.reduce((best, cur) =>
        (cur.rawValue ?? 0) > (best.rawValue ?? 0) ? cur : best,
      );
    }
    return phenotype.axes[0];
  }, [phenotype.axes, selectedAxisId]);

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const n = phenotype.axes.length;

  const polygonPoints = phenotype.axes
    .map((axis, idx) => {
      const pt = polarPoint(idx, n, axis.normalized * RADAR_R);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(' ');

  const meanPoints =
    phenotype.meanNormalized !== undefined
      ? phenotype.axes
          .map((_, idx) => {
            const pt = polarPoint(idx, n, (phenotype.meanNormalized ?? 0) * RADAR_R);
            return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
          })
          .join(' ')
      : null;

  const confColor =
    phenotype.confidenceBand === 'High'
      ? 'bg-emerald-400'
      : phenotype.confidenceBand === 'Moderate'
        ? 'bg-sky-400'
        : 'bg-amber-400';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col justify-between space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Phenotype
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2.5 py-0.5 text-xs font-bold text-[#fc6719]">
              {phenotype.label}
            </span>
            {phenotype.value !== undefined && (
              <span className="rounded-full bg-slate-900 border border-slate-700 px-2 py-0.5 text-[11px] font-mono text-slate-200">
                Val {phenotype.value.toFixed(1)}
              </span>
            )}
            {phenotype.bias !== undefined && (
              <span className="rounded-full bg-slate-900 border border-slate-700 px-2 py-0.5 text-[11px] font-mono text-slate-200">
                Bias {phenotype.bias >= 0 ? `+${phenotype.bias.toFixed(1)}` : phenotype.bias.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">{phenotype.description}</p>

        {phenotype.confidencePct !== undefined && (
          <div className="flex items-center gap-2.5 text-[11px]">
            <span className="text-slate-400 shrink-0">
              Confidence:{' '}
              <span className="font-semibold text-slate-200">
                {phenotype.confidenceBand} ({phenotype.confidencePct}%)
              </span>
            </span>
            <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${confColor}`}
                style={{ width: `${Math.max(4, phenotype.confidencePct)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {phenotype.hasScores ? (
        <div className="space-y-2.5">
          <svg
            viewBox="0 0 340 268"
            className="w-full max-w-[340px] mx-auto h-auto select-none"
            role="img"
            aria-label="5-axis rider phenotype radar chart"
          >
            {/* Concentric pentagon grid rings */}
            {gridLevels.map((lvl) => {
              const pts = phenotype.axes
                .map((_, idx) => {
                  const pt = polarPoint(idx, n, lvl * RADAR_R);
                  return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                })
                .join(' ');
              return (
                <polygon
                  key={lvl}
                  points={pts}
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth="1"
                />
              );
            })}

            {/* Radial spokes */}
            {phenotype.axes.map((axis, idx) => {
              const outer = polarPoint(idx, n, RADAR_R);
              return (
                <line
                  key={`${axis.id}-spoke`}
                  x1={RADAR_CX}
                  y1={RADAR_CY}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
              );
            })}

            {/* Personal average overlay */}
            {meanPoints && (
              <polygon
                points={meanPoints}
                fill="none"
                stroke="#94a3b8"
                strokeDasharray="4 3"
                strokeWidth="1.25"
              />
            )}

            {/* Rider phenotype shape */}
            <polygon
              points={polygonPoints}
              fill="#fc6719"
              fillOpacity="0.24"
              stroke="#fc6719"
              strokeWidth="2.25"
              strokeLinejoin="round"
            />

            {/* Axis labels & interactive vertices */}
            {phenotype.axes.map((axis, idx) => {
              const vertex = polarPoint(idx, n, axis.normalized * RADAR_R);
              const labelPt = polarPoint(idx, n, RADAR_R + 22);
              const isSelected = activeAxis?.id === axis.id;
              const anchor =
                Math.abs(labelPt.x - RADAR_CX) < 12
                  ? 'middle'
                  : labelPt.x > RADAR_CX
                    ? 'start'
                    : 'end';

              return (
                <g
                  key={axis.id}
                  className="cursor-pointer"
                  onClick={() => onSelectAxisId(axis.id)}
                  onPointerEnter={() => onSelectAxisId(axis.id)}
                >
                  {isSelected && (
                    <circle
                      cx={vertex.x}
                      cy={vertex.y}
                      r="8"
                      fill="#fc6719"
                      fillOpacity="0.28"
                    />
                  )}
                  <circle
                    cx={vertex.x}
                    cy={vertex.y}
                    r={isSelected ? 4.5 : 3.25}
                    fill={isSelected ? '#fb923c' : '#fc6719'}
                    stroke="#020617"
                    strokeWidth="1.5"
                  />
                  <circle cx={vertex.x} cy={vertex.y} r="18" fill="transparent" />
                  <text
                    x={labelPt.x}
                    y={labelPt.y}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    fill={isSelected ? '#f8fafc' : '#94a3b8'}
                    fontSize="11"
                    fontWeight={isSelected ? '700' : '500'}
                  >
                    {axis.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {activeAxis && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-100">{activeAxis.label}</span>
                <span className="text-slate-400">({activeAxis.effortHint})</span>
                {activeAxis.tier && <TierBadge tier={activeAxis.tier} />}
              </div>
              <div className="flex items-center gap-2 font-mono">
                <span className="font-bold text-slate-100">
                  {formatPhenotypeRaw(activeAxis.rawValue, phenotype.scaleMax)}
                </span>
                {activeAxis.deltaFromMean !== undefined && (
                  <span
                    className={`text-[11px] ${
                      activeAxis.deltaFromMean >= 0 ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {phenotype.scaleMax <= 1
                      ? `${activeAxis.deltaFromMean >= 0 ? '+' : ''}${Math.round(activeAxis.deltaFromMean * 100)}% vs avg`
                      : `${activeAxis.deltaFromMean >= 0 ? '+' : ''}${Math.round(activeAxis.deltaFromMean)} vs avg`}
                  </span>
                )}
              </div>
            </div>
          )}

          {phenotype.scoresSource === 'seedFactors' && (
            <p className="text-[11px] text-slate-500 text-center">
              Axes plotted from v4 power seed factors (0–1000); dashed ring shows personal mean.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-5 text-center text-xs text-slate-400">
          No phenotype factor scores available for this rider yet.
        </div>
      )}
    </div>
  );
}

function DisciplineGauge({
  label,
  percentile,
  delta7d,
  place,
  total,
  tier,
}: {
  label: string;
  percentile: number | null;
  delta7d: number | null;
  place?: number;
  total?: number;
  tier?: VeloTier;
}) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = percentile ?? 0;
  const filled = (pct / 100) * c;
  const strokeColor = tier?.backgroundColor ?? (pct >= 80 ? '#fc6719' : '#38bdf8');

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 flex flex-col items-center text-center gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <svg viewBox="0 0 52 52" className="w-12 h-12" aria-hidden="true">
        <circle cx="26" cy="26" r={r} fill="none" stroke="#1e293b" strokeWidth="5" />
        {percentile !== null && pct > 0 && (
          <circle
            cx="26"
            cy="26"
            r={r}
            fill="none"
            stroke={strokeColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
            transform="rotate(-90 26 26)"
          />
        )}
        <text
          x="26"
          y="26"
          textAnchor="middle"
          dominantBaseline="central"
          fill={percentile !== null ? '#f8fafc' : '#64748b'}
          fontSize="12"
          fontWeight="700"
        >
          {percentile !== null ? Math.round(percentile) : '—'}
        </text>
      </svg>
      <div className="text-[10px] leading-tight space-y-0.5">
        {place !== undefined && total !== undefined ? (
          <div className="font-semibold text-slate-200 tabular-nums">
            #{place} / {total}
          </div>
        ) : (
          <div className="text-slate-500">Unranked</div>
        )}
        {delta7d !== null && delta7d !== 0 && (
          <div className={delta7d > 0 ? 'text-emerald-300' : 'text-red-300'}>
            {delta7d > 0 ? `▲ ${delta7d}` : `▼ ${Math.abs(delta7d)}`} (7d)
          </div>
        )}
      </div>
    </div>
  );
}

function RaceOutcomesCard({
  raceBreakdown,
  rankingsSummary,
}: {
  raceBreakdown: RaceBreakdown;
  rankingsSummary: RankingsSummary;
}) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;

  const segments = [
    { key: 'wins', label: 'Wins', count: raceBreakdown.wins, color: '#fbbf24' },
    { key: 'podiums', label: '2nd–3rd', count: raceBreakdown.otherPodiums, color: '#fc6719' },
    { key: 'finishes', label: 'Other Finishes', count: raceBreakdown.otherFinishes, color: '#38bdf8' },
    { key: 'dnfs', label: 'DNFs', count: raceBreakdown.dnfs, color: '#f87171' },
  ];

  const nonZeroSegments = segments.filter((s) => s.count > 0);
  const gapPx = nonZeroSegments.length > 1 ? 2.5 : 0;

  let cumulativeOffset = 0;
  const arcSegments = nonZeroSegments.map((seg) => {
    const rawLen = raceBreakdown.total > 0 ? (seg.count / raceBreakdown.total) * circumference : 0;
    const drawLen = Math.max(0, rawLen - gapPx);
    const offset = -cumulativeOffset;
    cumulativeOffset += rawLen;
    return { ...seg, drawLen, offset };
  });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col justify-between space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            90-Day Race Outcomes
          </h3>
          {raceBreakdown.hasData && (
            <span className="text-[11px] text-slate-400 tabular-nums">
              {raceBreakdown.finishes} finishes · {raceBreakdown.dnfs} DNF
            </span>
          )}
        </div>

        {raceBreakdown.hasData && raceBreakdown.total > 0 ? (
          <>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <svg
                viewBox="0 0 136 136"
                className="w-32 h-32 shrink-0"
                role="img"
                aria-label={`90-day race breakdown: ${raceBreakdown.wins} wins, ${raceBreakdown.otherPodiums} other podiums, ${raceBreakdown.otherFinishes} other finishes, ${raceBreakdown.dnfs} DNFs`}
              >
                <circle
                  cx="68"
                  cy="68"
                  r={radius}
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth="16"
                />
                {arcSegments.map((seg) => (
                  <circle
                    key={seg.key}
                    cx="68"
                    cy="68"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="16"
                    strokeDasharray={`${seg.drawLen} ${circumference}`}
                    strokeDashoffset={seg.offset}
                    transform="rotate(-90 68 68)"
                  />
                ))}
                <text
                  x="68"
                  y="63"
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="22"
                  fontWeight="800"
                >
                  {raceBreakdown.total}
                </text>
                <text
                  x="68"
                  y="81"
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontWeight="600"
                  letterSpacing="1"
                >
                  RACES
                </text>
              </svg>

              <div className="w-full flex-1 space-y-1.5 text-xs">
                {segments.map((seg) => {
                  const pct =
                    raceBreakdown.total > 0
                      ? Math.round((seg.count / raceBreakdown.total) * 100)
                      : 0;
                  return (
                    <div key={seg.key} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-slate-300">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: seg.color }}
                        />
                        <span>{seg.label}</span>
                      </div>
                      <span className="font-mono font-semibold text-slate-100 tabular-nums">
                        {seg.count}{' '}
                        <span className="text-slate-400 font-normal">({pct}%)</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 py-1.5 px-2">
                <div className="text-[10px] uppercase text-slate-400">Win Rate</div>
                <div className="font-bold text-amber-300 tabular-nums">
                  {raceBreakdown.winPct !== null ? `${raceBreakdown.winPct}%` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 py-1.5 px-2">
                <div className="text-[10px] uppercase text-slate-400">Podium Rate</div>
                <div className="font-bold text-[#fc6719] tabular-nums">
                  {raceBreakdown.podiumPct !== null ? `${raceBreakdown.podiumPct}%` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 py-1.5 px-2">
                <div className="text-[10px] uppercase text-slate-400">Finish Rate</div>
                <div className="font-bold text-sky-300 tabular-nums">
                  {raceBreakdown.finishPct !== null ? `${raceBreakdown.finishPct}%` : '—'}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-5 text-center text-xs text-slate-400">
            No races recorded in the last 90 days.
          </div>
        )}
      </div>

      {rankingsSummary.hasData && (
        <div className="border-t border-slate-800 pt-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Discipline Rankings
            </h4>
            {rankingsSummary.gcOverallPlace && (
              <span className="rounded-full bg-slate-900 border border-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200 tabular-nums">
                Overall #{rankingsSummary.gcOverallPlace.rank.toLocaleString()} /{' '}
                {rankingsSummary.gcOverallPlace.total.toLocaleString()}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {rankingsSummary.disciplines.map((d) => (
              <DisciplineGauge
                key={d.id}
                label={d.label}
                percentile={d.percentile}
                delta7d={d.delta7d}
                place={d.place}
                total={d.total}
                tier={d.tier}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ZwiftRacingProfileSection({
  profileId,
  zrState,
}: {
  profileId: number;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
}) {
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [scaleMode, setScaleMode] = useState<VeloScaleMode>('velo2');
  const [selectedPointKey, setSelectedPointKey] = useState<string | null>(null);
  const [selectedAxisId, setSelectedAxisId] = useState<PhenotypeAxis['id'] | null>(null);

  const rider = zrState.status === 'loaded' ? zrState.data.rider : null;
  const overview = zrState.status === 'loaded' ? zrState.data.overview : null;
  const isWoman = rider?.male === false;

  const veloSummary = useMemo(
    () => buildVeloSummary(rider, overview, nowSec),
    [rider, overview, nowSec],
  );

  const effectiveScale: VeloScaleMode =
    scaleMode === 'legacy' && veloSummary.hasLegacyData
      ? 'legacy'
      : veloSummary.hasVelo2Data
        ? 'velo2'
        : veloSummary.hasLegacyData
          ? 'legacy'
          : 'velo2';

  const activeSeries = effectiveScale === 'legacy' ? veloSummary.legacy : veloSummary.velo2;
  const primaryTierSystem: VeloSystem = effectiveScale === 'legacy' ? 'legacy' : 'velo2';
  const womenTierSystem: VeloSystem = effectiveScale === 'legacy' ? 'legacyWomen' : 'velo2Women';

  const phenotype = useMemo(
    () => buildPhenotypeProfile(rider, isWoman ? 'velo2Women' : 'velo2'),
    [rider, isWoman],
  );

  const factorBreakdown = useMemo(
    () => buildFactorBreakdown(rider, isWoman ? 'velo2Women' : 'velo2'),
    [rider, isWoman],
  );

  const raceBreakdown = useMemo(() => buildRaceBreakdown(rider), [rider]);

  const rankingsSummary = useMemo(
    () => buildRankingsSummary(overview, rider?.male),
    [overview, rider?.male],
  );

  const powerModelMetrics = useMemo(() => extractPowerModelMetrics(rider), [rider]);

  if (zrState.status === 'loading') {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-3">
        <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
        <p className="text-sm text-slate-400">Loading ZwiftRacing.app ratings &amp; phenotype…</p>
      </section>
    );
  }

  if (zrState.status === 'error') {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-3">
        <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
        <p role="alert" className="text-sm text-amber-400">
          ZwiftRacing.app unavailable ({zrState.message}).
        </p>
      </section>
    );
  }

  if (!rider && !overview) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-3">
        <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
        <p className="text-sm text-slate-400">
          No ZwiftRacing.app profile found for rider {profileId}.
        </p>
      </section>
    );
  }

  const club = rider?.club;
  const clubBg = normalizeHexColor(club?.backgroundColor) ?? '#1e293b';
  const clubText = normalizeHexColor(club?.textColor) ?? '#e2e8f0';
  const clubBorder = normalizeHexColor(club?.borderColor) ?? '#334155';
  const clubStyle: CSSProperties = {
    backgroundColor: clubBg,
    color: clubText,
    borderColor: clubBorder,
  };
  const clubName = club?.name ? decodeHtmlEntities(club.name).trim() : '';

  const liveProgress =
    activeSeries.live !== undefined
      ? getTierProgress(activeSeries.live, primaryTierSystem)
      : null;
  const womenLiveTier =
    isWoman && activeSeries.live !== undefined
      ? getVeloTier(activeSeries.live, womenTierSystem)
      : null;
  const max30Tier =
    activeSeries.max30 !== undefined
      ? getVeloTier(activeSeries.max30, primaryTierSystem)
      : null;
  const max90Tier =
    activeSeries.max90 !== undefined
      ? getVeloTier(activeSeries.max90, primaryTierSystem)
      : null;
  const v2CrossTier =
    effectiveScale === 'legacy' && veloSummary.velo2.live !== undefined
      ? getVeloTier(veloSummary.velo2.live, 'velo2')
      : null;

  const overallVeloPct =
    factorBreakdown.overallVelo !== undefined
      ? Math.min(100, (factorBreakdown.overallVelo / factorBreakdown.scaleMax) * 100)
      : null;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
      {/* Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
            <a
              href={buildZwiftRacingRiderUrl(profileId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950 px-2.5 py-0.5 text-xs font-medium text-slate-300 hover:border-[#fc6719]/60 hover:text-[#fc6719] transition-colors"
            >
              <span>zwiftracing.app</span>
              <span aria-hidden="true">↗</span>
            </a>
            {clubName && (
              <span
                className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                style={clubStyle}
              >
                {clubName}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            vELO rating progression, phenotype shape, 90-day outcomes, and factor seed vs. RaceCraft breakdown.
          </p>
        </div>

        <div
          role="group"
          aria-label="vELO scale"
          className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950 shrink-0"
        >
          <button
            type="button"
            disabled={!veloSummary.hasVelo2Data}
            onClick={() => setScaleMode('velo2')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              effectiveScale === 'velo2'
                ? 'bg-[#fc6719] text-white'
                : 'text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            vELO v2
          </button>
          <button
            type="button"
            disabled={!veloSummary.hasLegacyData}
            onClick={() => setScaleMode('legacy')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              effectiveScale === 'legacy'
                ? 'bg-[#fc6719] text-white'
                : 'text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            Legacy
          </button>
        </div>
      </div>

      {/* Group 1: vELO Rating, Windows & Progression Chart */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* Card 1: Current vELO */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">
                {effectiveScale === 'legacy' ? 'Legacy vELO' : 'Current vELO'}
              </span>
              {liveProgress && <TierBadge tier={liveProgress.current} />}
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-extrabold text-slate-100 tabular-nums">
                {formatRating(activeSeries.live, effectiveScale)}
              </span>
              {womenLiveTier && <TierBadge tier={womenLiveTier} prefix="Women" />}
            </div>
            {liveProgress && (
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(4, Math.round(liveProgress.progressPct))}%`,
                      backgroundColor: liveProgress.current.backgroundColor,
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  {liveProgress.next && liveProgress.pointsToNext !== null
                    ? `${formatRating(liveProgress.pointsToNext, effectiveScale)} pts to ${liveProgress.next.name}`
                    : 'Top tier'}
                </p>
              </div>
            )}
          </div>

          {/* Card 2: Seed & RaceCraft (or vELO v2 cross-reference in Legacy mode) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-1.5">
            <span className="text-[11px] uppercase tracking-wide text-slate-400 block">
              {effectiveScale === 'legacy' ? 'Current vELO v2' : 'Seed & RaceCraft'}
            </span>
            {effectiveScale === 'legacy' ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-extrabold text-slate-100 tabular-nums">
                    {formatRating(veloSummary.velo2.live, 'velo2')}
                  </span>
                  {v2CrossTier && <TierBadge tier={v2CrossTier} />}
                </div>
                <p className="text-[11px] text-slate-400">Active 0–1000 rating scale</p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-extrabold text-slate-100 tabular-nums">
                    {formatRating(activeSeries.seed, 'velo2')}
                  </span>
                  {activeSeries.netRaceCraft !== undefined && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                        activeSeries.netRaceCraft > 0.005
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      {formatRaceCraft(activeSeries.netRaceCraft)} RC
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Power baseline + RaceCraft bonus</p>
              </>
            )}
          </div>

          {/* Card 3: 30-Day Peak */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">30d Peak</span>
              {max30Tier && <TierBadge tier={max30Tier} />}
            </div>
            <div className="text-xl font-extrabold text-slate-100 tabular-nums">
              {formatRating(activeSeries.max30, effectiveScale)}
            </div>
            <p className="text-[11px] text-slate-400">
              {activeSeries.max30 === undefined
                ? 'No races in 30d window'
                : activeSeries.max30Expires
                  ? `Expires ${formatShortDate(activeSeries.max30Expires)}`
                  : activeSeries.max30Derived
                    ? 'Derived from 90d log'
                    : '30-day window'}
            </p>
          </div>

          {/* Card 4: 90-Day Peak */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">90d Peak</span>
              {max90Tier && <TierBadge tier={max90Tier} />}
            </div>
            <div className="text-xl font-extrabold text-slate-100 tabular-nums">
              {formatRating(activeSeries.max90, effectiveScale)}
            </div>
            <p className="text-[11px] text-slate-400">
              {activeSeries.max90 === undefined
                ? 'No races in 90d window'
                : activeSeries.max90Expires
                  ? `Expires ${formatShortDate(activeSeries.max90Expires)}`
                  : activeSeries.max90Derived
                    ? 'Derived from 90d log'
                    : '90-day window'}
            </p>
          </div>
        </div>

        {(activeSeries.timeTrial !== undefined || activeSeries.handicap !== undefined) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {activeSeries.timeTrial !== undefined && (
              <span className="rounded-full bg-slate-900 border border-slate-700 px-2.5 py-0.5 text-slate-200">
                TT vELO:{' '}
                <strong className="tabular-nums">
                  {formatRating(activeSeries.timeTrial, 'velo2')}
                </strong>
              </span>
            )}
            {activeSeries.handicap !== undefined && (
              <span className="rounded-full bg-slate-900 border border-slate-700 px-2.5 py-0.5 text-slate-200">
                Handicap:{' '}
                <strong className="tabular-nums">{activeSeries.handicap.toFixed(1)}</strong>
              </span>
            )}
          </div>
        )}

        <VeloProgressionChart
          series={activeSeries}
          scale={effectiveScale}
          tierSystem={primaryTierSystem}
          selectedPointKey={selectedPointKey}
          onSelectPointKey={setSelectedPointKey}
        />
      </div>

      {/* Group 2: Phenotype Radar & 90-Day Race Outcomes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PhenotypeRadarCard
          phenotype={phenotype}
          selectedAxisId={selectedAxisId}
          onSelectAxisId={setSelectedAxisId}
        />
        <RaceOutcomesCard raceBreakdown={raceBreakdown} rankingsSummary={rankingsSummary} />
      </div>

      {/* Group 3: vELO Factors, Seed & RaceCraft + Conditional Power Model */}
      {(factorBreakdown.hasData || powerModelMetrics.length > 0) && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
          {factorBreakdown.hasData && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    vELO Factors, Seed &amp; RaceCraft
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Each vELO factor equals your decayed power seed plus any results-based RaceCraft bonus.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />
                    <span>Seed</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />
                    <span>RaceCraft</span>
                  </span>
                  {factorBreakdown.overallVelo !== undefined && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-0.5 bg-slate-100" />
                      <span>Overall vELO ({factorBreakdown.overallVelo.toFixed(1)})</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                {factorBreakdown.rows.map((row) => {
                  const seedVal = row.seed ?? 0;
                  const hasPositiveSkill = (row.skill ?? 0) > 0.005;
                  const seedPct = Math.min(100, (seedVal / factorBreakdown.scaleMax) * 100);
                  const totalPct = Math.min(
                    100,
                    ((row.total ?? seedVal) / factorBreakdown.scaleMax) * 100,
                  );
                  const bonusPct = Math.max(0, totalPct - seedPct);

                  return (
                    <div key={row.id} className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-slate-100">{row.label}</span>
                          <span className="text-[11px] text-slate-400">{row.effortHint}</span>
                          {row.tier && <TierBadge tier={row.tier} />}
                        </div>
                        <div className="flex items-center gap-2 font-mono tabular-nums">
                          <span className="font-bold text-slate-100">
                            {row.total !== undefined ? row.total.toFixed(1) : '—'}
                          </span>
                          {row.seed !== undefined && (
                            <span className="text-[11px] text-slate-400">
                              seed {Math.round(row.seed)}
                            </span>
                          )}
                          {hasPositiveSkill && row.skill !== undefined && (
                            <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                              {formatRaceCraft(row.skill)} RC
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="relative h-2.5 w-full rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                        <div className="flex h-full w-full items-center">
                          {seedPct > 0 && (
                            <div
                              className="h-full shrink min-w-0 transition-all"
                              style={{
                                width: `${seedPct}%`,
                                backgroundColor: row.tier?.backgroundColor ?? '#64748b',
                                opacity: 0.85,
                              }}
                            />
                          )}
                          {hasPositiveSkill && (
                            <div
                              className="h-full bg-emerald-400 shrink-0"
                              style={{
                                width: `${bonusPct}%`,
                                minWidth: '4px',
                              }}
                            />
                          )}
                        </div>

                        {overallVeloPct !== null && (
                          <div
                            aria-hidden="true"
                            className="absolute top-0 bottom-0 w-0.5 bg-slate-100/80"
                            style={{ left: `${overallVeloPct}%` }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {powerModelMetrics.length > 0 && (
            <div
              className={`${
                factorBreakdown.hasData ? 'border-t border-slate-800 pt-3' : ''
              } space-y-2`}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Power Model
              </h3>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {powerModelMetrics.map((metric) => (
                  <div
                    key={metric.key}
                    className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5"
                  >
                    <dt className="text-slate-400">{metric.label}</dt>
                    <dd className="mt-0.5 font-semibold text-sm text-slate-100 tabular-nums">
                      {metric.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
