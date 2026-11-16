import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  ZwiftPublicEvent,
  ZwiftRaceResultEntry,
} from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import {
  formatGapSeconds,
  ordinal,
  subgroupCategoryLabel,
  zpNum,
  zpVal,
} from '../lib/raceHistory';
import type { AsyncState } from '../lib/raceHistory';
import { formatDurationMs, formatWeight } from '../lib/units';
import type { UnitSystem } from '../lib/units';

type StandingsSource = 'core' | 'zp_view' | 'zp_zwift';

function coreEntryWkg(entry: ZwiftRaceResultEntry): string | undefined {
  const watts = entry.sensorData?.avgWatts;
  const grams = entry.profileData?.weightInGrams;
  if (typeof watts !== 'number' || typeof grams !== 'number' || grams <= 0) return undefined;
  return (watts / (grams / 1000)).toFixed(2);
}

function CoreStandingsTable({
  entries,
  targetRiderId,
  zpVisibleIds,
  zpLoaded,
  units,
}: {
  entries: ZwiftRaceResultEntry[];
  targetRiderId: number;
  zpVisibleIds: Set<number>;
  zpLoaded: boolean;
  units: UnitSystem;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No unfiltered subgroup finishers returned by Zwift Core for this subgroup.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">Rider</th>
            <th className="py-2 pr-3">Time</th>
            <th className="py-2 pr-3">Avg W</th>
            <th className="py-2 pr-3">W/kg</th>
            <th className="py-2 pr-3">Weight</th>
            <th className="py-2 pr-3">Avg / Max HR</th>
            <th className="py-2 pr-3">15s / 1m / 5m / 20m</th>
            <th className="py-2 pr-3">Power</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {entries.map((entry, idx) => {
            const riderId = Number(entry.profileId);
            const isTarget = riderId === targetRiderId;
            const fullName =
              [entry.profileData?.firstName, entry.profileData?.lastName]
                .filter(Boolean)
                .join(' ') || `Rider ${entry.profileId ?? '—'}`;
            const wkg = coreEntryWkg(entry);
            const avgHr = entry.sensorData?.heartRateData?.avgHeartRate;
            const maxHr = entry.sensorData?.heartRateData?.maxHeartRate;
            const cp = entry.criticalP;
            const hasCp =
              cp?.criticalP15Seconds != null ||
              cp?.criticalP1Minute != null ||
              cp?.criticalP5Minutes != null ||
              cp?.criticalP20Minutes != null;
            const cpStr = hasCp
              ? [
                  cp?.criticalP15Seconds != null ? Math.round(cp.criticalP15Seconds) : '—',
                  cp?.criticalP1Minute != null ? Math.round(cp.criticalP1Minute) : '—',
                  cp?.criticalP5Minutes != null ? Math.round(cp.criticalP5Minutes) : '—',
                  cp?.criticalP20Minutes != null ? Math.round(cp.criticalP20Minutes) : '—',
                ].join(' / ')
              : '—';
            const hiddenOnZp = zpLoaded && Number.isFinite(riderId) && !zpVisibleIds.has(riderId);

            return (
              <tr
                key={`${entry.id ?? entry.profileId ?? idx}`}
                className={isTarget ? 'bg-[#fc6719]/15' : 'hover:bg-slate-900/50'}
              >
                <td className="py-2 pr-3 font-semibold whitespace-nowrap">
                  {entry.rank ?? idx + 1}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {Number.isFinite(riderId) && riderId > 0 ? (
                      <Link
                        to={`/riders/${riderId}`}
                        className={`font-medium hover:text-[#fc6719] hover:underline ${
                          isTarget ? 'text-[#fc6719] font-bold' : ''
                        }`}
                      >
                        {fullName}
                      </Link>
                    ) : (
                      <span>{fullName}</span>
                    )}
                    {isTarget && (
                      <span className="rounded bg-[#fc6719]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#fc6719]">
                        Rider
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">
                  {formatDurationMs(entry.activityData?.durationInMilliseconds)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {entry.sensorData?.avgWatts != null
                    ? `${Math.round(entry.sensorData.avgWatts)} W`
                    : '—'}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{wkg ? `${wkg}` : '—'}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {formatWeight(entry.profileData?.weightInGrams, units)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {avgHr != null || maxHr != null
                    ? `${avgHr ?? '—'} / ${maxHr ?? '—'}`
                    : '—'}
                </td>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">{cpStr}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-slate-400">
                  {entry.sensorData?.powerType ?? '—'}
                </td>
                <td className="py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {hiddenOnZp && (
                      <span
                        className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-300"
                        title="Not present in ZwiftPower filtered results (_view.json)"
                      >
                        Hidden on ZP
                      </span>
                    )}
                    {entry.flaggedCheating && (
                      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] text-red-300">
                        Flagged
                      </span>
                    )}
                    {entry.flaggedSandbagging && (
                      <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-300">
                        Sandbag
                      </span>
                    )}
                    {!hiddenOnZp && !entry.flaggedCheating && !entry.flaggedSandbagging && (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ZwiftPowerStandingsTable({
  entries,
  targetRiderId,
  categoryFilter,
}: {
  entries: ZwiftPowerRaceEntry[];
  targetRiderId: number;
  categoryFilter: string;
}) {
  const filtered = useMemo(
    () =>
      categoryFilter === 'ALL'
        ? entries
        : entries.filter(
            (e) => (e.category ?? '').trim().toUpperCase() === categoryFilter,
          ),
    [entries, categoryFilter],
  );

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No ZwiftPower riders found{categoryFilter !== 'ALL' ? ` in Cat ${categoryFilter}` : ''}.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide">
            <th className="py-2 pr-3">Cat #</th>
            <th className="py-2 pr-3">Pos #</th>
            <th className="py-2 pr-3">Cat</th>
            <th className="py-2 pr-3">Rider</th>
            <th className="py-2 pr-3">Team</th>
            <th className="py-2 pr-3">Time</th>
            <th className="py-2 pr-3">Gap</th>
            <th className="py-2 pr-3">Avg W</th>
            <th className="py-2 pr-3">NP</th>
            <th className="py-2 pr-3">W/kg</th>
            <th className="py-2 pr-3">5s / 1m / 5m / 20m</th>
            <th className="py-2 pr-3">HR</th>
            <th className="py-2">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {filtered.map((entry, idx) => {
            const riderId = Number(entry.zwid);
            const isTarget = riderId === targetRiderId;
            const timeSec = zpNum(entry.time);
            const avgPower = zpVal(entry.avg_power);
            const np = zpVal(entry.np);
            const avgWkg = zpVal(entry.avg_wkg);
            const avgHr = zpVal(entry.avg_hr);
            const maxHr = zpVal(entry.max_hr);
            const splits = [
              zpVal(entry.w5) ?? '—',
              zpVal(entry.w60) ?? '—',
              zpVal(entry.w300) ?? '—',
              zpVal(entry.w1200) ?? '—',
            ].join(' / ');

            return (
              <tr
                key={`${entry.res_id ?? entry.uid ?? entry.zwid ?? idx}`}
                className={isTarget ? 'bg-[#fc6719]/15' : 'hover:bg-slate-900/50'}
              >
                <td className="py-2 pr-3 font-semibold whitespace-nowrap">
                  {entry.position_in_cat != null ? ordinal(entry.position_in_cat) : '—'}
                </td>
                <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                  {entry.pos ?? '—'}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{entry.category ?? '—'}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {Number.isFinite(riderId) && riderId > 0 ? (
                    <Link
                      to={`/riders/${riderId}`}
                      className={`font-medium hover:text-[#fc6719] hover:underline ${
                        isTarget ? 'text-[#fc6719] font-bold' : ''
                      }`}
                    >
                      {entry.name || `Rider ${riderId}`}
                    </Link>
                  ) : (
                    <span>{entry.name || '—'}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                  {entry.tname || '—'}
                </td>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">
                  {timeSec != null ? formatDurationMs(timeSec * 1000) : '—'}
                </td>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">
                  {formatGapSeconds(entry.gap)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {avgPower !== undefined ? `${avgPower} W` : '—'}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {np !== undefined ? `${np} W` : '—'}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{avgWkg ?? '—'}</td>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">{splits}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {avgHr !== undefined || maxHr !== undefined
                    ? `${avgHr ?? '—'} / ${maxHr ?? '—'}`
                    : '—'}
                </td>
                <td className="py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {entry.penalty && (
                      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                        {entry.penalty}
                      </span>
                    )}
                    {entry.upg === 1 && (
                      <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        UPG
                      </span>
                    )}
                    {!entry.penalty && entry.upg !== 1 && (
                      <span className="text-slate-500">—</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RaceDetailStandings({
  raceKey,
  targetRiderId,
  publicEvent,
  selectedSubgroupId,
  onSelectSubgroupId,
  coreResults,
  zpViewResults,
  zpZwiftResults,
  defaultCategory,
  units,
}: {
  raceKey: string;
  targetRiderId: number;
  publicEvent: AsyncState<ZwiftPublicEvent>;
  selectedSubgroupId: number | null;
  onSelectSubgroupId: (id: number) => void;
  coreResults: AsyncState<ZwiftRaceResultEntry[]> | null;
  zpViewResults: AsyncState<ZwiftPowerRaceEntry[]>;
  zpZwiftResults: AsyncState<ZwiftPowerRaceEntry[]>;
  defaultCategory?: string;
  units: UnitSystem;
}) {
  const [source, setSource] = useState<StandingsSource>('core');
  const [catChoice, setCatChoice] = useState<{ raceKey: string; cat: string } | null>(null);
  const [manualSubgroup, setManualSubgroup] = useState('');

  const subgroups = useMemo(
    () => (publicEvent.status === 'loaded' ? (publicEvent.data.eventSubgroups ?? []) : []),
    [publicEvent],
  );

  const zpVisibleIds = useMemo(() => {
    const ids = new Set<number>();
    if (zpViewResults.status === 'loaded') {
      for (const entry of zpViewResults.data) {
        const id = Number(entry.zwid);
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }
    }
    return ids;
  }, [zpViewResults]);

  const availableCategories = useMemo(() => {
    const entries =
      source === 'zp_view'
        ? zpViewResults.status === 'loaded'
          ? zpViewResults.data
          : []
        : zpZwiftResults.status === 'loaded'
          ? zpZwiftResults.data
          : [];
    const cats = new Set<string>();
    for (const entry of entries) {
      const cat = (entry.category ?? '').trim().toUpperCase();
      if (cat) cats.add(cat);
    }
    return Array.from(cats).sort();
  }, [source, zpViewResults, zpZwiftResults]);

  const normalizedDefault = defaultCategory?.trim().toUpperCase();
  const activeCatFilter =
    catChoice && catChoice.raceKey === raceKey
      ? catChoice.cat
      : normalizedDefault && availableCategories.includes(normalizedDefault)
        ? normalizedDefault
        : 'ALL';

  function handleManualSubgroupSubmit(e: FormEvent) {
    e.preventDefault();
    const cleaned = manualSubgroup.trim();
    if (!/^\d+$/.test(cleaned)) return;
    onSelectSubgroupId(Number(cleaned));
    setManualSubgroup('');
  }

  const coreCount = coreResults?.status === 'loaded' ? ` (${coreResults.data.length})` : '';
  const zpViewCount = zpViewResults.status === 'loaded' ? ` (${zpViewResults.data.length})` : '';
  const zpZwiftCount =
    zpZwiftResults.status === 'loaded' ? ` (${zpZwiftResults.data.length})` : '';

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Full Event Standings</h2>
          <p className="text-xs text-slate-400">
            Compare official unfiltered Zwift Core subgroup finishers against ZwiftPower filtered
            (<code>_view.json</code>) and raw (<code>_zwift.json</code>) event standings.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Standings data source"
          className="inline-flex flex-wrap rounded-lg border border-slate-700 p-0.5 bg-slate-950 self-start"
        >
          {(
            [
              { id: 'core', label: `Zwift Core Unfiltered${coreCount}` },
              { id: 'zp_view', label: `ZwiftPower Filtered${zpViewCount}` },
              { id: 'zp_zwift', label: `ZwiftPower Unfiltered${zpZwiftCount}` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={source === tab.id}
              onClick={() => setSource(tab.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                source === tab.id ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {source === 'core' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {subgroups.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400 mr-1">Subgroup pen:</span>
                {subgroups.map((sg) => {
                  const label = subgroupCategoryLabel(sg);
                  const active = sg.id === selectedSubgroupId;
                  return (
                    <button
                      key={sg.id}
                      type="button"
                      onClick={() => onSelectSubgroupId(sg.id)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                        active
                          ? 'bg-[#fc6719] border-[#fc6719] text-white'
                          : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {label ? `Cat ${label}` : sg.name || `Pen ${sg.id}`}
                      {sg.totalEntrantCount != null ? ` (${sg.totalEntrantCount})` : ''}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                {selectedSubgroupId
                  ? `Showing subgroup ${selectedSubgroupId}`
                  : 'No subgroup list returned from /api/public/events.'}
              </p>
            )}

            <form onSubmit={handleManualSubgroupSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Subgroup ID…"
                aria-label="Query Zwift Core subgroup ID"
                value={manualSubgroup}
                onChange={(e) => setManualSubgroup(e.target.value)}
                className="w-32 rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1 text-xs focus:outline-none focus:border-[#fc6719]"
              />
              <button
                type="submit"
                disabled={!/^\d+$/.test(manualSubgroup.trim())}
                className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800 disabled:opacity-40"
              >
                Load pen
              </button>
            </form>
          </div>

          {coreResults === null && (
            <p className="text-sm text-slate-400">
              No subgroup ID available automatically. Enter an <code>event_subgroup_id</code> above
              to load Zwift Core finishers.
            </p>
          )}
          {coreResults?.status === 'loading' && (
            <p className="text-sm text-slate-400">Loading Zwift Core subgroup results…</p>
          )}
          {coreResults?.status === 'error' && (
            <p role="alert" className="text-sm text-red-400">
              {coreResults.message}
            </p>
          )}
          {coreResults?.status === 'loaded' && (
            <CoreStandingsTable
              entries={coreResults.data}
              targetRiderId={targetRiderId}
              zpVisibleIds={zpVisibleIds}
              zpLoaded={zpViewResults.status === 'loaded'}
              units={units}
            />
          )}
        </div>
      )}

      {source !== 'core' && (
        <div className="space-y-4">
          {availableCategories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400 mr-1">Category:</span>
              {['ALL', ...availableCategories].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCatChoice({ raceKey, cat })}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    activeCatFilter === cat
                      ? 'bg-[#fc6719] border-[#fc6719] text-white'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {cat === 'ALL' ? 'All' : `Cat ${cat}`}
                </button>
              ))}
            </div>
          )}

          {source === 'zp_view' && zpViewResults.status === 'loading' && (
            <p className="text-sm text-slate-400">Loading ZwiftPower filtered results…</p>
          )}
          {source === 'zp_view' && zpViewResults.status === 'error' && (
            <p role="alert" className="text-sm text-red-400">
              {zpViewResults.message}
            </p>
          )}
          {source === 'zp_view' && zpViewResults.status === 'loaded' && (
            <ZwiftPowerStandingsTable
              entries={zpViewResults.data}
              targetRiderId={targetRiderId}
              categoryFilter={activeCatFilter}
            />
          )}

          {source === 'zp_zwift' && zpZwiftResults.status === 'loading' && (
            <p className="text-sm text-slate-400">Loading ZwiftPower unfiltered results…</p>
          )}
          {source === 'zp_zwift' && zpZwiftResults.status === 'error' && (
            <p role="alert" className="text-sm text-red-400">
              {zpZwiftResults.message}
            </p>
          )}
          {source === 'zp_zwift' && zpZwiftResults.status === 'loaded' && (
            <ZwiftPowerStandingsTable
              entries={zpZwiftResults.data}
              targetRiderId={targetRiderId}
              categoryFilter={activeCatFilter}
            />
          )}
        </div>
      )}
    </section>
  );
}
