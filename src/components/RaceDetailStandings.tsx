import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ZwiftProfile,
  ZwiftPublicEvent,
  ZwiftRaceResultEntry,
} from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingEventResponse } from '../api/zwiftRacing';
import { useFavorites } from '../lib/FavoritesContext';
import { ordinal } from '../lib/raceHistory';
import type { AsyncState } from '../lib/raceHistory';
import { buildPenOptions, mergePenStandings } from '../lib/raceStandings';
import type { PenOption, PenSystem, SplitPair } from '../lib/raceStandings';
import { formatDurationMs, formatWeight } from '../lib/units';
import type { UnitSystem } from '../lib/units';

type RowFilter = 'all' | 'zp' | 'hidden' | 'tracked';
type SplitsUnit = 'w' | 'wkg';

const COLUMN_DEFS = [
  { id: 'zpPlace', label: 'ZP #' },
  { id: 'riderCategory', label: 'Rider Cat' },
  { id: 'zrs', label: 'ZRS' },
  { id: 'velo', label: 'vELO' },
  { id: 'phenotype', label: 'Phenotype' },
  { id: 'team', label: 'Team' },
  { id: 'time', label: 'Time' },
  { id: 'gap', label: 'Gap' },
  { id: 'avgW', label: 'Avg W' },
  { id: 'np', label: 'NP' },
  { id: 'avgWkg', label: 'Avg W/kg' },
  { id: 'splits', label: '5s / 1m / 5m / 20m' },
  { id: 'hr', label: 'HR' },
  { id: 'weight', label: 'Weight' },
  { id: 'powerSource', label: 'Power Src' },
  { id: 'status', label: 'Status' },
] as const;

type ColumnId = (typeof COLUMN_DEFS)[number]['id'];
type ColumnVisibility = Record<ColumnId, boolean>;

const COLS_STORAGE_KEY = 'zv.raceDetail.standingsCols';
const SPLITS_UNIT_STORAGE_KEY = 'zv.raceDetail.splitsUnit';

const DEFAULT_COLUMNS: ColumnVisibility = {
  zpPlace: true,
  riderCategory: true,
  zrs: true,
  velo: true,
  phenotype: true,
  team: true,
  time: true,
  gap: true,
  avgW: true,
  np: true,
  avgWkg: true,
  splits: true,
  hr: true,
  weight: true,
  powerSource: true,
  status: true,
};

function loadColumns(): ColumnVisibility {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as Partial<Record<ColumnId, unknown>>;
    const next = { ...DEFAULT_COLUMNS };
    for (const def of COLUMN_DEFS) {
      if (typeof parsed[def.id] === 'boolean') next[def.id] = parsed[def.id] as boolean;
    }
    return next;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function loadSplitsUnit(): SplitsUnit {
  try {
    return localStorage.getItem(SPLITS_UNIT_STORAGE_KEY) === 'wkg' ? 'wkg' : 'w';
  } catch {
    return 'w';
  }
}

function formatSplit(split: SplitPair, unit: SplitsUnit): string {
  if (unit === 'w') return split.w != null ? `${Math.round(split.w)}` : '—';
  return split.wkg != null ? split.wkg.toFixed(1) : '—';
}

function formatRowGap(gapSec: number | undefined): string {
  if (gapSec == null || !Number.isFinite(gapSec)) return '—';
  if (gapSec <= 0.05) return '0.0s';
  if (gapSec < 60) return `+${gapSec.toFixed(1)}s`;
  return `+${formatDurationMs(gapSec * 1000)}`;
}

function penSystemBadge(system: PenSystem): { label: string; title: string } {
  switch (system) {
    case 'zrs':
      return {
        label: 'Racing Score (ZRS)',
        title: 'Pens assigned using Zwift Racing Score thresholds',
      };
    case 'category_enforcement':
      return {
        label: 'Category Enforcement',
        title: 'Pens assigned using Zwift Category Enforcement boundaries',
      };
    default:
      return {
        label: 'Category',
        title: 'Standard category pens',
      };
  }
}

export default function RaceDetailStandings({
  raceKey,
  targetRiderId,
  loggedInProfile,
  targetProfile,
  publicEvent,
  zrEvent,
  selectedSubgroupId,
  selectedCategory,
  onSelectPen,
  coreResults,
  zpViewResults,
  zpZwiftResults,
  units,
}: {
  raceKey: string;
  targetRiderId: number;
  loggedInProfile?: ZwiftProfile | null;
  targetProfile?: ZwiftProfile;
  publicEvent: AsyncState<ZwiftPublicEvent>;
  zrEvent: AsyncState<ZwiftRacingEventResponse | null>;
  selectedSubgroupId: number | null;
  selectedCategory?: string;
  onSelectPen: (pen: PenOption) => void;
  coreResults: AsyncState<ZwiftRaceResultEntry[]> | null;
  zpViewResults: AsyncState<ZwiftPowerRaceEntry[]>;
  zpZwiftResults: AsyncState<ZwiftPowerRaceEntry[]>;
  units: UnitSystem;
}) {
  const { isFavorite } = useFavorites();
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [splitsUnit, setSplitsUnit] = useState<SplitsUnit>(loadSplitsUnit);
  const [columns, setColumns] = useState<ColumnVisibility>(loadColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const publicEventData = publicEvent.status === 'loaded' ? publicEvent.data : undefined;
  const zrEventData = zrEvent.status === 'loaded' ? zrEvent.data : undefined;
  const zpViewList = useMemo(
    () => (zpViewResults.status === 'loaded' ? zpViewResults.data : []),
    [zpViewResults],
  );
  const zpZwiftList = useMemo(
    () => (zpZwiftResults.status === 'loaded' ? zpZwiftResults.data : []),
    [zpZwiftResults],
  );
  const coreList = useMemo(
    () => (coreResults?.status === 'loaded' ? coreResults.data : []),
    [coreResults],
  );

  const { penSystem, pens } = useMemo(
    () => buildPenOptions(publicEventData, zrEventData, zpViewList, zpZwiftList),
    [publicEventData, zrEventData, zpViewList, zpZwiftList],
  );

  const activePen = useMemo(() => {
    if (pens.length === 0) return null;
    if (selectedSubgroupId != null) {
      const bySg = pens.find((p) => p.subgroupId === selectedSubgroupId);
      if (bySg) return bySg;
    }
    if (selectedCategory) {
      const base = selectedCategory.trim().toUpperCase().replace(/\+$/, '');
      const byCat = pens.find((p) => p.category?.toUpperCase() === base);
      if (byCat) return byCat;
    }
    return pens[0];
  }, [pens, selectedSubgroupId, selectedCategory]);

  const combinedRows = useMemo(
    () =>
      mergePenStandings({
        selectedPen: activePen,
        totalPensCount: pens.length,
        coreResults: coreList,
        zrEvent: zrEventData,
        zpViewResults: zpViewList,
        zpZwiftResults: zpZwiftList,
        zpViewLoaded: zpViewResults.status === 'loaded',
        targetRiderId,
        targetProfile,
        loggedInProfile,
      }),
    [
      activePen,
      pens.length,
      coreList,
      zrEventData,
      zpViewList,
      zpZwiftList,
      zpViewResults.status,
      targetRiderId,
      targetProfile,
      loggedInProfile,
    ],
  );

  const loggedInId = loggedInProfile?.id;
  const favoritedInPen = useMemo(
    () => combinedRows.filter((r) => r.riderId > 0 && isFavorite(r.riderId)),
    [combinedRows, isFavorite],
  );

  const zpCount = useMemo(
    () => combinedRows.filter((r) => r.sources.zpView).length,
    [combinedRows],
  );
  const hiddenCount = useMemo(
    () => combinedRows.filter((r) => r.hiddenOnZp).length,
    [combinedRows],
  );
  const trackedCount = useMemo(
    () =>
      combinedRows.filter(
        (r) => r.riderId === targetRiderId || r.riderId === loggedInId || isFavorite(r.riderId),
      ).length,
    [combinedRows, targetRiderId, loggedInId, isFavorite],
  );

  const visibleRows = useMemo(() => {
    switch (rowFilter) {
      case 'zp':
        return combinedRows.filter((r) => r.sources.zpView);
      case 'hidden':
        return combinedRows.filter((r) => r.hiddenOnZp);
      case 'tracked':
        return combinedRows.filter(
          (r) => r.riderId === targetRiderId || r.riderId === loggedInId || isFavorite(r.riderId),
        );
      default:
        return combinedRows;
    }
  }, [combinedRows, rowFilter, targetRiderId, loggedInId, isFavorite]);

  function toggleColumn(id: ColumnId) {
    setColumns((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }

  function resetColumns() {
    setColumns(DEFAULT_COLUMNS);
    try {
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(DEFAULT_COLUMNS));
    } catch {
      // Ignore storage errors
    }
  }

  function handleSplitsUnit(next: SplitsUnit) {
    setSplitsUnit(next);
    try {
      localStorage.setItem(SPLITS_UNIT_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
  }

  const enabledColCount = COLUMN_DEFS.filter((d) => columns[d.id]).length;
  const systemBadge = penSystemBadge(penSystem);
  const anyLoading =
    coreResults?.status === 'loading' ||
    zpViewResults.status === 'loading' ||
    zpZwiftResults.status === 'loading' ||
    zrEvent.status === 'loading';

  return (
    <section
      key={raceKey}
      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">Combined Event Standings</h2>
            <span
              title={systemBadge.title}
              className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-300"
            >
              {systemBadge.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Unified standings merging Zwift Core unfiltered finishers, ZwiftRacing.app vELO &amp;
            phenotypes, and ZwiftPower filtered/raw metrics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <div
            role="group"
            aria-label="Power splits unit"
            className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950"
          >
            {(['w', 'wkg'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => handleSplitsUnit(u)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  splitsUnit === u ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {u === 'w' ? 'W' : 'W/kg'}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-expanded={showColumnPicker}
            onClick={() => setShowColumnPicker((v) => !v)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Fields ({enabledColCount}/{COLUMN_DEFS.length})
          </button>
        </div>
      </div>

      {showColumnPicker && (
        <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-300">Visible standings columns</p>
            <button
              type="button"
              onClick={resetColumns}
              className="text-xs text-[#fc6719] hover:underline"
            >
              Reset all on
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs">
            {COLUMN_DEFS.map((col) => (
              <label
                key={col.id}
                className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300 select-none"
              >
                <input
                  type="checkbox"
                  checked={columns[col.id]}
                  onChange={() => toggleColumn(col.id)}
                  className="accent-[#fc6719] rounded"
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {pens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400 mr-1">
            {penSystem === 'zrs' ? 'Pen:' : 'Category:'}
          </span>
          {pens.map((pen) => {
            const isActive = activePen?.key === pen.key;
            return (
              <button
                key={pen.key}
                type="button"
                onClick={() => onSelectPen(pen)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  isActive
                    ? 'bg-[#fc6719] border-[#fc6719] text-white'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {pen.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `All (${combinedRows.length})`, show: true },
              { id: 'zp', label: `ZwiftPower (${zpCount})`, show: zpViewResults.status === 'loaded' },
              { id: 'hidden', label: `Hidden on ZP (${hiddenCount})`, show: hiddenCount > 0 },
              { id: 'tracked', label: `Rider & Favorites (${trackedCount})`, show: trackedCount > 0 },
            ] as const
          )
            .filter((f) => f.show)
            .map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setRowFilter(f.id)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  rowFilter === f.id
                    ? 'bg-slate-200 border-slate-200 text-slate-950 font-semibold'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
        </div>

        {anyLoading && <span className="text-xs text-slate-400">Syncing race sources…</span>}
      </div>

      {favoritedInPen.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-amber-300">★ Favorited in this pen:</span>
          {favoritedInPen.map((fav) => (
            <Link
              key={fav.key}
              to={`/riders/${fav.riderId}`}
              className="text-amber-200 hover:text-amber-100 hover:underline font-medium"
            >
              {fav.name}
              {fav.rank != null ? ` (${ordinal(fav.rank)})` : ''}
            </Link>
          ))}
        </div>
      )}

      {visibleRows.length === 0 ? (
        <p className="text-sm text-slate-400">
          {anyLoading
            ? 'Loading combined event standings…'
            : 'No finishers matched this pen across the available APIs.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide">
                <th className="py-2 pr-3 whitespace-nowrap">#</th>
                {columns.zpPlace && <th className="py-2 pr-3 whitespace-nowrap">ZP #</th>}
                <th className="py-2 pr-3 whitespace-nowrap">Rider</th>
                {columns.riderCategory && (
                  <th
                    className="py-2 pr-3 whitespace-nowrap"
                    title="Rider's actual Zwift category (not event pen)"
                  >
                    Rider Cat
                  </th>
                )}
                {columns.zrs && (
                  <th className="py-2 pr-3 whitespace-nowrap" title="Zwift Racing Score">
                    ZRS
                  </th>
                )}
                {columns.velo && (
                  <th className="py-2 pr-3 whitespace-nowrap" title="ZwiftRacing.app vELO">
                    vELO
                  </th>
                )}
                {columns.phenotype && <th className="py-2 pr-3 whitespace-nowrap">Phenotype</th>}
                {columns.team && <th className="py-2 pr-3 whitespace-nowrap">Team</th>}
                {columns.time && <th className="py-2 pr-3 whitespace-nowrap">Time</th>}
                {columns.gap && <th className="py-2 pr-3 whitespace-nowrap">Gap</th>}
                {columns.avgW && <th className="py-2 pr-3 whitespace-nowrap">Avg W</th>}
                {columns.np && <th className="py-2 pr-3 whitespace-nowrap">NP</th>}
                {columns.avgWkg && <th className="py-2 pr-3 whitespace-nowrap">W/kg</th>}
                {columns.splits && (
                  <th className="py-2 pr-3 whitespace-nowrap">
                    5s / 1m / 5m / 20m ({splitsUnit === 'w' ? 'W' : 'W/kg'})
                  </th>
                )}
                {columns.hr && <th className="py-2 pr-3 whitespace-nowrap">HR</th>}
                {columns.weight && <th className="py-2 pr-3 whitespace-nowrap">Weight</th>}
                {columns.powerSource && <th className="py-2 pr-3 whitespace-nowrap">Power</th>}
                {columns.status && <th className="py-2 whitespace-nowrap">Status</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {visibleRows.map((row) => {
                const isTarget = row.riderId === targetRiderId;
                const isYou = loggedInId != null && row.riderId === loggedInId;
                const isFav = row.riderId > 0 && isFavorite(row.riderId);

                const rowBg =
                  isTarget || isYou
                    ? 'bg-[#fc6719]/15'
                    : isFav
                      ? 'bg-amber-400/15'
                      : 'hover:bg-slate-900/50';
                const nameTone =
                  isTarget || isYou
                    ? 'text-[#fc6719] font-bold'
                    : isFav
                      ? 'text-amber-300 font-bold'
                      : 'font-medium';

                const rankDisplay = row.didNotFinish
                  ? 'DNF'
                  : row.disqualified
                    ? 'DQ'
                    : row.rank != null
                      ? String(row.rank)
                      : '—';

                const splitsStr = [
                  formatSplit(row.splits.s5, splitsUnit),
                  formatSplit(row.splits.m1, splitsUnit),
                  formatSplit(row.splits.m5, splitsUnit),
                  formatSplit(row.splits.m20, splitsUnit),
                ].join(' / ');

                return (
                  <tr key={row.key} className={rowBg}>
                    <td className="py-2 pr-3 font-semibold whitespace-nowrap">{rankDisplay}</td>

                    {columns.zpPlace && (
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                        {row.zpPlace != null ? row.zpPlace : '—'}
                      </td>
                    )}

                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {row.riderId > 0 ? (
                          <Link
                            to={`/riders/${row.riderId}`}
                            className={`hover:underline ${
                              isFav && !isTarget && !isYou
                                ? 'hover:text-amber-200'
                                : 'hover:text-[#fc6719]'
                            } ${nameTone}`}
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className={nameTone}>{row.name}</span>
                        )}
                        {isYou && (
                          <span className="rounded bg-[#fc6719]/25 px-1.5 py-0.5 text-[10px] font-semibold text-[#fc6719]">
                            You
                          </span>
                        )}
                        {isTarget && !isYou && (
                          <span className="rounded bg-[#fc6719]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#fc6719]">
                            Rider
                          </span>
                        )}
                        {isFav && (
                          <span className="rounded bg-amber-400/20 border border-amber-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            ★ Favorite
                          </span>
                        )}
                      </div>
                    </td>

                    {columns.riderCategory && (
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.riderCategory ? (
                          <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px] font-semibold text-slate-200">
                            {row.riderCategory}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    )}

                    {columns.zrs && (
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">
                        {row.zrsScore != null ? (
                          <span>
                            {Math.round(row.zrsScore)}
                            {row.zrsDelta != null && row.zrsDelta !== 0 && (
                              <span
                                className={`ml-1 text-[10px] ${
                                  row.zrsDelta > 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {row.zrsDelta > 0 ? '+' : ''}
                                {row.zrsDelta.toFixed(0)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    )}

                    {columns.velo && (
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">
                        {row.velo != null ? (
                          <span>
                            {row.velo.toFixed(0)}
                            {row.veloDelta != null && Math.abs(row.veloDelta) >= 0.05 && (
                              <span
                                className={`ml-1 text-[10px] ${
                                  row.veloDelta >= 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {row.veloDelta >= 0 ? '+' : ''}
                                {row.veloDelta.toFixed(1)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    )}

                    {columns.phenotype && (
                      <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">
                        {row.phenotype ?? '—'}
                      </td>
                    )}

                    {columns.team && (
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                        {row.team ?? '—'}
                      </td>
                    )}

                    {columns.time && (
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">
                        {row.timeSec != null ? formatDurationMs(row.timeSec * 1000) : '—'}
                      </td>
                    )}

                    {columns.gap && (
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">
                        {formatRowGap(row.gapSec)}
                      </td>
                    )}

                    {columns.avgW && (
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.avgWatts != null ? `${Math.round(row.avgWatts)} W` : '—'}
                      </td>
                    )}

                    {columns.np && (
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.np != null ? `${Math.round(row.np)} W` : '—'}
                      </td>
                    )}

                    {columns.avgWkg && (
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.avgWkg != null ? row.avgWkg.toFixed(2) : '—'}
                      </td>
                    )}

                    {columns.splits && (
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">{splitsStr}</td>
                    )}

                    {columns.hr && (
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.avgHr != null || row.maxHr != null
                          ? `${row.avgHr != null ? Math.round(row.avgHr) : '—'} / ${
                              row.maxHr != null ? Math.round(row.maxHr) : '—'
                            }`
                          : '—'}
                      </td>
                    )}

                    {columns.weight && (
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatWeight(row.weightGrams, units)}
                      </td>
                    )}

                    {columns.powerSource && (
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                        {row.powerSource ?? '—'}
                      </td>
                    )}

                    {columns.status && (
                      <td className="py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {row.hiddenOnZp && (
                            <span
                              className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-300"
                              title="Not present in ZwiftPower filtered results (_view.json)"
                            >
                              Hidden on ZP
                            </span>
                          )}
                          {row.penalty && (
                            <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                              {row.penalty}
                            </span>
                          )}
                          {row.upg && (
                            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                              UPG
                            </span>
                          )}
                          {row.flaggedCheating && (
                            <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] text-red-300">
                              Flagged
                            </span>
                          )}
                          {row.flaggedSandbagging && (
                            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-300">
                              Sandbag
                            </span>
                          )}
                          {!row.hiddenOnZp &&
                            !row.penalty &&
                            !row.upg &&
                            !row.flaggedCheating &&
                            !row.flaggedSandbagging && <span className="text-slate-500">—</span>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
