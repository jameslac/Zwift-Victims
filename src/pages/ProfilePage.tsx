import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useUnits } from '../lib/UnitsContext';
import {
  formatDistance,
  formatDurationMs,
  formatElevation,
  formatHeight,
  formatWeight,
  formatWkg,
} from '../lib/units';
import type { UnitSystem } from '../lib/units';
import {
  fetchActivityDetail,
  fetchRaceResults,
  fetchRiderActivities,
} from '../api/zwiftCore';
import type {
  ZwiftActivity,
  ZwiftActivityDetail,
  ZwiftProfile,
  ZwiftRaceResultEntry,
} from '../api/zwiftCore';
import { fetchZwiftPowerRaces } from '../api/zwiftPower';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { fetchZwiftRacingRider } from '../api/zwiftRacing';
import type { ZwiftRacingRaceEntry, ZwiftRacingRiderResponse } from '../api/zwiftRacing';

import { isPodium, mergeRaces, summarize } from '../lib/raceHistory';
import type { MergedRace } from '../lib/raceHistory';

type ProviderTab = 'merged' | 'zwiftpower' | 'zwiftracing' | 'core';

type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: T };

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{value ?? '—'}</dd>
    </div>
  );
}

/** Flatten nested JSON into dotted-key/value string pairs for display. */
function flatten(obj: unknown, prefix = ''): [string, string][] {
  if (obj === null || typeof obj !== 'object') return [[prefix, String(obj)]];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return [[prefix, Array.isArray(obj) ? '[]' : '{}']];
  return entries.flatMap(([k, v]) => {
    const key = prefix ? (Array.isArray(obj) ? `${prefix}[${k}]` : `${prefix}.${k}`) : k;
    return v !== null && typeof v === 'object' ? flatten(v, key) : [[key, String(v)] as [string, string]];
  });
}

function collectKeys(items: unknown[], excludePrefix?: string): string[] {
  return Array.from(
    new Set(
      items.flatMap((item) =>
        flatten(item)
          .map(([key]) => key)
          .filter((key) =>
            excludePrefix ? !key.startsWith(`${excludePrefix}.`) && key !== excludePrefix : true,
          ),
      ),
    ),
  ).sort();
}

function AttributeList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-slate-800 text-sm mt-2">
      {rows.map(([key, value]) => (
        <div key={key} className="flex flex-col sm:flex-row sm:justify-between gap-1 py-2">
          <dt className="font-mono text-slate-400 break-all">{key}</dt>
          <dd className="font-mono sm:text-right break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AttributeKeysSummary({ label, keys }: { label: string; keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <details className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-300">
        {label} ({keys.length} keys)
      </summary>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs font-mono text-slate-400">
        {keys.map((key) => (
          <li key={key} className="break-all">
            {key}
          </li>
        ))}
      </ul>
    </details>
  );
}

function MetricGrid({
  items,
}: {
  items: Array<{ label: string; value: string | number | undefined }>;
}) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
          <dt className="text-slate-400">{item.label}</dt>
          <dd className="mt-0.5 font-semibold">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function zpVal(v: unknown): string | number | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  return String(raw);
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return 'Unknown date';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatUnixSeconds(sec: number | undefined): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return 'Unknown date';
  return new Date(sec * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatGapSeconds(gap: number | undefined): string {
  if (gap === undefined || gap === null || !Number.isFinite(gap)) return '—';
  if (gap === 0) return '0.0s';
  if (gap < 60) return `+${gap.toFixed(1)}s`;
  return `+${formatDurationMs(gap * 1000)}`;
}

function isRaceOrEventActivity(activity: ZwiftActivity): boolean {
  return (
    Boolean(activity.eventSubgroupId) ||
    /\b(race|zrl|wtrl|ttt|crit|fondo|stage|tour|chase)\b/i.test(activity.name ?? '')
  );
}

function formatActivityDuration(activity: ZwiftActivity): string {
  if (typeof activity.movingTimeInMs === 'number') {
    return formatDurationMs(activity.movingTimeInMs);
  }
  return activity.duration || '—';
}

function RaceResultPanel({
  subgroupId,
  profileId,
  state,
  onLoad,
}: {
  subgroupId: number;
  profileId: number;
  state: AsyncState<ZwiftRaceResultEntry[]> | undefined;
  onLoad: (subgroupId: number) => void;
}) {
  const myEntry =
    state?.status === 'loaded'
      ? state.data.find((entry) => Number(entry.profileId) === profileId)
      : undefined;
  const myEntryRows = myEntry ? flatten(myEntry) : [];

  return (
    <div className="rounded-lg bg-slate-900/70 border border-slate-800 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400 font-mono">eventSubgroupId: {subgroupId}</span>
        <button
          type="button"
          disabled={state?.status === 'loading'}
          onClick={() => onLoad(subgroupId)}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {state?.status === 'loading'
            ? 'Loading race result…'
            : state?.status === 'loaded'
              ? 'Refresh race result'
              : 'Load race result'}
        </button>
      </div>

      {state?.status === 'error' && <p className="text-xs text-red-400">{state.message}</p>}

      {state?.status === 'loaded' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-300">
            Returned {state.data.length} subgroup finisher
            {state.data.length === 1 ? '' : 's'}.
            {myEntry
              ? ` Your rank: ${myEntry.rank ?? '—'} · Elapsed: ${formatDurationMs(
                  myEntry.activityData?.durationInMilliseconds,
                )} · Avg Power: ${
                  myEntry.sensorData?.avgWatts != null
                    ? `${Math.round(myEntry.sensorData.avgWatts)} W`
                    : '—'
                }`
              : ' Rider ID was not found in the returned subgroup entries.'}
          </p>
          {myEntry && (
            <details open>
              <summary className="cursor-pointer text-xs text-slate-400">
                All race result attributes ({myEntryRows.length} fields)
              </summary>
              <AttributeList rows={myEntryRows} />
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ZwiftPowerTab({
  profileId,
  units,
  state,
}: {
  profileId: number;
  units: UnitSystem;
  state: AsyncState<ZwiftPowerRaceEntry[]>;
}) {
  const races = useMemo(() => (state.status === 'loaded' ? state.data : []), [state]);
  const allKeys = useMemo(() => collectKeys(races), [races]);

  if (state.status === 'loading') {
    return <p className="text-sm text-slate-400">Loading ZwiftPower race history…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-red-400">
        {state.message}
      </p>
    );
  }
  if (races.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No ZwiftPower race history found for rider {profileId}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Returned {races.length} races from <code>/cache3/profile/{profileId}_all.json</code> (sorted
        newest first).
      </p>

      <AttributeKeysSummary
        label="All ZwiftPower attribute keys returned across races"
        keys={allKeys}
      />

      {races.map((race, index) => {
        const rows = flatten(race);
        const timeSec = zpVal(race.time);
        const avgPower = zpVal(race.avg_power);
        const np = zpVal(race.np);
        const avgWkg = zpVal(race.avg_wkg);
        const avgHr = zpVal(race.avg_hr);
        const maxHr = zpVal(race.max_hr);
        const w5 = zpVal(race.w5);
        const w15 = zpVal(race.w15);
        const w60 = zpVal(race.w60);
        const w300 = zpVal(race.w300);
        const w1200 = zpVal(race.w1200);
        const wkg1200 = zpVal(race.wkg1200);

        return (
          <article
            key={String(race.res_id ?? race.uid ?? `${race.zid}-${index}`)}
            className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-base">{race.event_title || 'Untitled race'}</h3>
                <p className="text-xs text-slate-400">
                  {formatUnixSeconds(race.event_date)}
                  {race.zid ? ` · zid: ${race.zid}` : ''}
                  {race.tname ? ` · Team ${race.tname}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {race.category && (
                  <span className="rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2.5 py-0.5 text-xs font-semibold text-[#fc6719]">
                    Cat {race.category}
                  </span>
                )}
                {race.upg === 1 && (
                  <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-xs font-semibold text-amber-300">
                    UPG
                  </span>
                )}
                {race.penalty && (
                  <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-xs font-semibold text-red-300">
                    {race.penalty}
                  </span>
                )}
              </div>
            </div>

            <MetricGrid
              items={[
                { label: 'Cat Pos', value: race.position_in_cat },
                { label: 'Overall Pos', value: race.pos },
                {
                  label: 'Time',
                  value:
                    typeof timeSec === 'number' ? formatDurationMs(timeSec * 1000) : undefined,
                },
                { label: 'Gap', value: formatGapSeconds(race.gap) },
                {
                  label: 'Distance',
                  value:
                    typeof race.distance === 'number'
                      ? formatDistance(race.distance * 1000, units)
                      : undefined,
                },
                {
                  label: 'Avg Power',
                  value: avgPower !== undefined ? `${avgPower} W` : undefined,
                },
                { label: 'NP', value: np !== undefined ? `${np} W` : undefined },
                { label: 'Avg W/kg', value: avgWkg !== undefined ? `${avgWkg} W/kg` : undefined },
                {
                  label: 'Avg / Max HR',
                  value:
                    avgHr !== undefined || maxHr !== undefined
                      ? `${avgHr ?? '—'} / ${maxHr ?? '—'} bpm`
                      : undefined,
                },
                {
                  label: '5s / 15s',
                  value:
                    w5 !== undefined || w15 !== undefined
                      ? `${w5 ?? '—'} / ${w15 ?? '—'} W`
                      : undefined,
                },
                {
                  label: '1m / 5m',
                  value:
                    w60 !== undefined || w300 !== undefined
                      ? `${w60 ?? '—'} / ${w300 ?? '—'} W`
                      : undefined,
                },
                {
                  label: '20m',
                  value:
                    w1200 !== undefined
                      ? `${w1200} W${wkg1200 !== undefined ? ` (${wkg1200})` : ''}`
                      : undefined,
                },
              ]}
            />

            <details open={index === 0}>
              <summary className="cursor-pointer text-xs text-slate-300 font-medium">
                All ZwiftPower attributes ({rows.length} fields)
              </summary>
              <AttributeList rows={rows} />
            </details>
          </article>
        );
      })}
    </div>
  );
}

function ZwiftRacingTab({
  profileId,
  units,
  state,
}: {
  profileId: number;
  units: UnitSystem;
  state: AsyncState<ZwiftRacingRiderResponse>;
}) {
  const history: ZwiftRacingRaceEntry[] = useMemo(
    () => (state.status === 'loaded' ? (state.data.overview?.history ?? []) : []),
    [state],
  );
  const allKeys = useMemo(() => collectKeys(history), [history]);
  const riderSummaryRows = useMemo(() => {
    if (state.status !== 'loaded') return [];
    const { rider, overview } = state.data;
    const overviewSummary = overview
      ? Object.fromEntries(Object.entries(overview).filter(([k]) => k !== 'history' && k !== 'latest'))
      : null;
    return flatten({ rider, overview: overviewSummary });
  }, [state]);

  if (state.status === 'loading') {
    return <p className="text-sm text-slate-400">Loading ZwiftRacing.app data…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-red-400">
        {state.message}
      </p>
    );
  }

  const { rider, overview } = state.data;
  if (!rider && !overview) {
    return (
      <p className="text-sm text-slate-400">
        No ZwiftRacing.app profile found for rider {profileId}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Rider ratings and {history.length} races from <code>zwiftracing.app/riders/{profileId}</code>.
      </p>

      {rider && (
        <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
          <MetricGrid
            items={[
              {
                label: 'vELO (v2)',
                value: rider.velo?.race != null ? rider.velo.race.toFixed(1) : undefined,
              },
              {
                label: 'Legacy vELO',
                value:
                  overview?.legacyRatings?.live != null
                    ? overview.legacyRatings.live.toFixed(0)
                    : undefined,
              },
              { label: 'Phenotype', value: rider.phenotype?.label },
              {
                label: 'Finishes / Wins',
                value:
                  rider.race?.finishes != null
                    ? `${rider.race.finishes} / ${rider.race.wins ?? 0}`
                    : undefined,
              },
              { label: 'Podiums / DNFs', value: rider.race ? `${rider.race.podiums ?? 0} / ${rider.race.dnfs ?? 0}` : undefined },
              { label: 'Club', value: rider.club?.name },
            ]}
          />
          <details>
            <summary className="cursor-pointer text-xs text-slate-300 font-medium">
              All ZwiftRacing rider profile attributes ({riderSummaryRows.length} fields)
            </summary>
            <AttributeList rows={riderSummaryRows} />
          </details>
        </div>
      )}

      <AttributeKeysSummary
        label="All ZwiftRacing race attribute keys returned across history"
        keys={allKeys}
      />

      {history.length === 0 ? (
        <p className="text-sm text-slate-400">No race history entries returned by ZwiftRacing.app.</p>
      ) : (
        history.map((entry, index) => {
          const rows = flatten(entry);
          const distKm = entry.race?.distance ?? entry.event?.distance;
          const eloBefore = entry.velo?.elo?.before;
          const eloAfter = entry.velo?.elo?.after;

          return (
            <article
              key={`${entry.event?.eventId ?? 'zr'}-${entry.event?.time ?? index}`}
              className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-base">{entry.event?.title || 'Untitled race'}</h3>
                  <p className="text-xs text-slate-400">
                    {formatUnixSeconds(entry.event?.time)}
                    {entry.event?.routeName ? ` · ${entry.event.routeName}` : ''}
                    {entry.event?.eventId ? ` · eventId: ${entry.event.eventId}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.event?.subgroupId && (
                    <span className="rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2.5 py-0.5 text-xs font-semibold text-[#fc6719]">
                      Cat {entry.event.subgroupId}
                    </span>
                  )}
                  {entry.place?.didNotFinish && (
                    <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-xs font-semibold text-red-300">
                      DNF
                    </span>
                  )}
                  {entry.place?.disqualified && (
                    <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-xs font-semibold text-red-300">
                      DQ
                    </span>
                  )}
                </div>
              </div>

              <MetricGrid
                items={[
                  {
                    label: 'Place',
                    value:
                      entry.place?.positionInCategory != null
                        ? `${entry.place.positionInCategory}${
                            entry.place.penTotal ? ` / ${entry.place.penTotal}` : ''
                          }`
                        : undefined,
                  },
                  {
                    label: 'Time',
                    value:
                      entry.race?.time != null ? formatDurationMs(entry.race.time * 1000) : undefined,
                  },
                  { label: 'Gap', value: formatGapSeconds(entry.race?.gap) },
                  {
                    label: 'Distance',
                    value: distKm != null ? formatDistance(distKm * 1000, units) : undefined,
                  },
                  { label: 'Elevation', value: formatElevation(entry.event?.elevation, units) },
                  {
                    label: 'Avg W/kg',
                    value:
                      entry.race?.wkgAvg != null
                        ? `${entry.race.wkgAvg.toFixed(2)} W/kg`
                        : undefined,
                  },
                  {
                    label: 'vELO Before → After',
                    value:
                      eloBefore != null && eloAfter != null
                        ? `${eloBefore.toFixed(1)} → ${eloAfter.toFixed(1)}`
                        : undefined,
                  },
                  {
                    label: 'Expected Pos',
                    value:
                      entry.velo?.elo?.expectedPosition != null
                        ? entry.velo.elo.expectedPosition.toFixed(1)
                        : undefined,
                  },
                  {
                    label: 'zPoints',
                    value:
                      entry.velo?.points?.value != null
                        ? entry.velo.points.value.toFixed(1)
                        : undefined,
                  },
                  {
                    label: '5s / 15s W/kg',
                    value:
                      entry.race?.wkg5 != null || entry.race?.wkg15 != null
                        ? `${entry.race.wkg5?.toFixed(1) ?? '—'} / ${entry.race.wkg15?.toFixed(1) ?? '—'}`
                        : undefined,
                  },
                  {
                    label: '1m / 5m W/kg',
                    value:
                      entry.race?.wkg60 != null || entry.race?.wkg300 != null
                        ? `${entry.race.wkg60?.toFixed(1) ?? '—'} / ${entry.race.wkg300?.toFixed(1) ?? '—'}`
                        : undefined,
                  },
                  {
                    label: '20m W/kg',
                    value:
                      entry.race?.wkg1200 != null ? `${entry.race.wkg1200.toFixed(2)} W/kg` : undefined,
                  },
                ]}
              />

              <details open={index === 0}>
                <summary className="cursor-pointer text-xs text-slate-300 font-medium">
                  All ZwiftRacing attributes ({rows.length} fields)
                </summary>
                <AttributeList rows={rows} />
              </details>
            </article>
          );
        })
      )}
    </div>
  );
}

function ZwiftCoreTab({
  profileId,
  units,
  getAccessToken,
  state,
}: {
  profileId: number;
  units: UnitSystem;
  getAccessToken: () => Promise<string>;
  state: AsyncState<ZwiftActivity[]>;
}) {
  const [filter, setFilter] = useState<'all' | 'races'>('all');
  const [detailByActivityId, setDetailByActivityId] = useState<
    Record<string, AsyncState<ZwiftActivityDetail>>
  >({});
  const [raceResultsBySubgroup, setRaceResultsBySubgroup] = useState<
    Record<number, AsyncState<ZwiftRaceResultEntry[]>>
  >({});

  const activities = useMemo(() => (state.status === 'loaded' ? state.data : []), [state]);
  const raceActivities = useMemo(() => activities.filter(isRaceOrEventActivity), [activities]);
  const displayedActivities = filter === 'races' ? raceActivities : activities;
  const allActivityKeys = useMemo(() => collectKeys(activities, 'profile'), [activities]);

  async function handleLoadActivityDetail(activityKey: string) {
    setDetailByActivityId((prev) => ({ ...prev, [activityKey]: { status: 'loading' } }));
    try {
      const token = await getAccessToken();
      const detail = await fetchActivityDetail(token, activityKey);
      setDetailByActivityId((prev) => ({ ...prev, [activityKey]: { status: 'loaded', data: detail } }));
    } catch (err: unknown) {
      setDetailByActivityId((prev) => ({
        ...prev,
        [activityKey]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load activity detail.',
        },
      }));
    }
  }

  async function handleLoadRaceResult(subgroupId: number) {
    setRaceResultsBySubgroup((prev) => ({ ...prev, [subgroupId]: { status: 'loading' } }));
    try {
      const token = await getAccessToken();
      const entries = await fetchRaceResults(token, subgroupId);
      setRaceResultsBySubgroup((prev) => ({
        ...prev,
        [subgroupId]: { status: 'loaded', data: entries },
      }));
    } catch (err: unknown) {
      setRaceResultsBySubgroup((prev) => ({
        ...prev,
        [subgroupId]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load race results.',
        },
      }));
    }
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-slate-400">Loading Zwift Core activities…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-red-400">
        {state.message}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-slate-400">
          Raw feed from Zwift Core <code>/api/profiles/{profileId}/activities</code> (latest 20;{' '}
          <code>profile.*</code> collapsed).
        </p>

        <div className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950 self-start">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              filter === 'all' ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            All activities ({activities.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('races')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              filter === 'races' ? 'bg-[#fc6719] text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            Races &amp; Events ({raceActivities.length})
          </button>
        </div>
      </div>

      <AttributeKeysSummary
        label="All Zwift Core activity attribute keys (excluding profile.*)"
        keys={allActivityKeys}
      />

      {displayedActivities.length === 0 ? (
        <p className="text-sm text-slate-400">
          {filter === 'races'
            ? 'No race or event activities detected in the latest 20 activities.'
            : 'No activities returned by Zwift.'}
        </p>
      ) : (
        displayedActivities.map((activity, index) => {
          const allRows = flatten(activity);
          const activityOnlyRows = allRows.filter(
            ([key]) => !key.startsWith('profile.') && key !== 'profile',
          );
          const profileRows = allRows.filter(
            ([key]) => key.startsWith('profile.') || key === 'profile',
          );
          const raceOrEvent = isRaceOrEventActivity(activity);
          const activityIdStr = activity.id_str ?? String(activity.id);
          const detailState = detailByActivityId[activityIdStr];
          const detailSubgroupId =
            detailState?.status === 'loaded' ? detailState.data.eventInfo?.eventSubGroupId : undefined;
          const subgroupId =
            typeof activity.eventSubgroupId === 'number' && activity.eventSubgroupId > 0
              ? activity.eventSubgroupId
              : typeof detailSubgroupId === 'number' && detailSubgroupId > 0
                ? detailSubgroupId
                : null;

          return (
            <article
              key={`${activityIdStr}-${index}`}
              className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-base">{activity.name || 'Untitled activity'}</h3>
                  <p className="text-xs text-slate-400">
                    {formatDateTime(activity.startDate)}
                    {activity.sport ? ` · ${activity.sport}` : ''}
                  </p>
                </div>
                {raceOrEvent && (
                  <span className="rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2.5 py-0.5 text-xs font-semibold text-[#fc6719]">
                    Race / Event
                  </span>
                )}
              </div>

              <MetricGrid
                items={[
                  { label: 'Distance', value: formatDistance(activity.distanceInMeters, units) },
                  { label: 'Elevation', value: formatElevation(activity.totalElevation, units) },
                  { label: 'Moving Time', value: formatActivityDuration(activity) },
                  {
                    label: 'Avg Power',
                    value: activity.avgWatts != null ? `${Math.round(activity.avgWatts)} W` : undefined,
                  },
                  {
                    label: 'Avg HR',
                    value:
                      activity.avgHeartRate != null
                        ? `${Math.round(activity.avgHeartRate)} bpm`
                        : undefined,
                  },
                  {
                    label: 'Calories',
                    value:
                      activity.calories != null ? `${Math.round(activity.calories)} kcal` : undefined,
                  },
                ]}
              />

              <div className="rounded-lg bg-slate-900/70 border border-slate-800 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-400 font-mono">
                    id_str: {activityIdStr}
                  </span>
                  <button
                    type="button"
                    disabled={detailState?.status === 'loading'}
                    onClick={() => handleLoadActivityDetail(activityIdStr)}
                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                  >
                    {detailState?.status === 'loading'
                      ? 'Loading activity detail…'
                      : detailState?.status === 'loaded'
                        ? 'Refresh activity detail'
                        : 'Load detailed activity'}
                  </button>
                </div>

                {detailState?.status === 'error' && (
                  <p className="text-xs text-red-400">{detailState.message}</p>
                )}

                {detailState?.status === 'loaded' && (
                  <div className="space-y-2">
                    <MetricGrid
                      items={[
                        {
                          label: 'Max Power',
                          value:
                            detailState.data.maxWatts != null
                              ? `${Math.round(detailState.data.maxWatts)} W`
                              : undefined,
                        },
                        {
                          label: 'Avg / Max HR',
                          value:
                            detailState.data.avgHeartRate != null ||
                            detailState.data.maxHeartRate != null
                              ? `${detailState.data.avgHeartRate ?? '—'} / ${detailState.data.maxHeartRate ?? '—'} bpm`
                              : undefined,
                        },
                        {
                          label: 'Avg Cadence',
                          value:
                            detailState.data.avgCadenceInRotationsPerMinute != null
                              ? `${Math.round(detailState.data.avgCadenceInRotationsPerMinute)} rpm`
                              : undefined,
                        },
                        {
                          label: 'Event ID',
                          value: detailState.data.eventInfo?.id,
                        },
                        {
                          label: 'Subgroup ID',
                          value: detailState.data.eventInfo?.eventSubGroupId,
                        },
                        {
                          label: 'Subgroup Entrants',
                          value: detailState.data.eventInfo?.subgroupTotalEntrantCount,
                        },
                      ]}
                    />
                    <details open>
                      <summary className="cursor-pointer text-xs text-slate-400">
                        All detailed activity attributes ({flatten(detailState.data).length} fields)
                      </summary>
                      <AttributeList rows={flatten(detailState.data)} />
                    </details>
                  </div>
                )}
              </div>

              {subgroupId !== null && (
                <RaceResultPanel
                  subgroupId={subgroupId}
                  profileId={profileId}
                  state={raceResultsBySubgroup[subgroupId]}
                  onLoad={handleLoadRaceResult}
                />
              )}

              <details open={index === 0}>
                <summary className="cursor-pointer text-xs text-slate-300 font-medium">
                  All activity attributes ({activityOnlyRows.length} fields)
                </summary>
                <AttributeList rows={activityOnlyRows} />
              </details>

              {profileRows.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-slate-400">
                    profile.* ({profileRows.length} repeated rider profile values)
                  </summary>
                  <AttributeList rows={profileRows} />
                </details>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function MergedRaceCard({ race, units }: { race: MergedRace; units: UnitSystem }) {
  const { zp, zr } = race;
  const timeSec = zpVal(zp?.time) ?? zr?.race?.time;
  const avgPower = zpVal(zp?.avg_power);
  const np = zpVal(zp?.np);
  const avgWkg = zpVal(zp?.avg_wkg) ?? zr?.race?.wkgAvg?.toFixed(2);
  const gap = zp?.gap ?? zr?.race?.gap;
  const distKm = zp?.distance ?? zr?.race?.distance ?? zr?.event?.distance;
  const inflated = (race.placeInflation ?? 0) > 0;
  const podiumMismatch = isPodium(race.zpPlace) && !isPodium(race.truePlace) && race.truePlace != null;
  const category = zp?.category ?? zr?.event?.subgroupId;
  const eloBefore = zr?.velo?.elo?.before;
  const eloAfter = zr?.velo?.elo?.after;
  const rows = flatten({ zwiftPower: zp ?? null, zwiftRacing: zr ?? null });

  return (
    <article className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-base">{race.title}</h3>
          <p className="text-xs text-slate-400">
            {formatUnixSeconds(race.date)}
            {zr?.event?.routeName ? ` · ${zr.event.routeName}` : ''}
            {race.eventId ? ` · event ${race.eventId}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {category && (
            <span className="rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2.5 py-0.5 text-xs font-semibold text-[#fc6719]">
              Cat {category}
            </span>
          )}
          {!zp && (
            <span className="rounded-full bg-slate-700/40 border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
              ZwiftRacing only
            </span>
          )}
          {zp && !zr && (
            <span className="rounded-full bg-slate-700/40 border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
              No ZwiftRacing data
            </span>
          )}
          {zr?.place?.didNotFinish && (
            <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-xs font-semibold text-red-300">
              DNF
            </span>
          )}
        </div>
      </div>

      {race.truePlace != null ? (
        <div
          className={`rounded-lg border p-3 text-sm ${
            inflated
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-slate-900/70 border-slate-800'
          }`}
        >
          <p>
            <span className="font-bold">Finished {ordinal(race.truePlace)}</span>
            {race.fieldSize ? ` of ${race.fieldSize}` : ''} in category{' '}
            <span className="text-xs text-slate-400">(ZwiftRacing — includes private riders)</span>
          </p>
          {race.zpPlace != null && (
            <p className="text-xs text-slate-300 mt-1">
              ZwiftPower shows {ordinal(race.zpPlace)}
              {inflated
                ? ` — ${race.placeInflation} place${race.placeInflation === 1 ? '' : 's'} better than reality because hidden riders are dropped${
                    podiumMismatch ? ' (ZwiftPower shows a podium that wasn’t)' : ''
                  }.`
                : '.'}
            </p>
          )}
        </div>
      ) : (
        zp && (
          <p className="text-xs text-slate-400">
            ZwiftPower category place: {zp.position_in_cat ?? '—'} (field may exclude hidden riders; no
            ZwiftRacing result to verify — older than 90 days or unscored).
          </p>
        )
      )}

      <MetricGrid
        items={[
          {
            label: 'Time',
            value: typeof timeSec === 'number' ? formatDurationMs(timeSec * 1000) : undefined,
          },
          { label: 'Gap', value: formatGapSeconds(gap) },
          {
            label: 'Distance',
            value: typeof distKm === 'number' ? formatDistance(distKm * 1000, units) : undefined,
          },
          { label: 'Avg Power', value: avgPower !== undefined ? `${avgPower} W` : undefined },
          { label: 'NP', value: np !== undefined ? `${np} W` : undefined },
          { label: 'Avg W/kg', value: avgWkg !== undefined ? `${avgWkg}` : undefined },
          {
            label: 'Overall Pos (ZP)',
            value: zp?.pos,
          },
          {
            label: 'vELO Before → After',
            value:
              eloBefore != null && eloAfter != null
                ? `${eloBefore.toFixed(1)} → ${eloAfter.toFixed(1)}`
                : undefined,
          },
          {
            label: 'Expected Pos',
            value:
              zr?.velo?.elo?.expectedPosition != null
                ? zr.velo.elo.expectedPosition.toFixed(1)
                : undefined,
          },
          {
            label: 'Team',
            value: zp?.tname || undefined,
          },
        ]}
      />

      <details>
        <summary className="cursor-pointer text-xs text-slate-300 font-medium">
          All merged attributes ({rows.length} fields)
        </summary>
        <AttributeList rows={rows} />
      </details>
    </article>
  );
}

function MergedTab({
  zpState,
  zrState,
  units,
}: {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  units: UnitSystem;
}) {
  const merged = useMemo(() => {
    if (zpState.status !== 'loaded') return [];
    const zr = zrState.status === 'loaded' ? (zrState.data.overview?.history ?? []) : [];
    return mergeRaces(zpState.data, zr);
  }, [zpState, zrState]);
  const summary = useMemo(() => summarize(merged), [merged]);

  if (zpState.status === 'loading' || zrState.status === 'loading') {
    return <p className="text-sm text-slate-400">Loading ZwiftPower + ZwiftRacing.app…</p>;
  }
  if (zpState.status === 'error') {
    return (
      <p role="alert" className="text-sm text-red-400">
        {zpState.message}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        ZwiftPower is the primary race list; each race is enriched from ZwiftRacing.app by event ID.
        Placings come from ZwiftRacing.app when available because ZwiftPower drops private riders from
        the standings.
      </p>
      {zrState.status === 'error' && (
        <p role="alert" className="text-xs text-amber-400">
          ZwiftRacing.app unavailable ({zrState.message}); showing ZwiftPower only.
        </p>
      )}

      <MetricGrid
        items={[
          { label: 'Races', value: summary.total },
          { label: 'Enriched', value: `${summary.enriched} / ${summary.total}` },
          { label: 'Podiums (ZP)', value: summary.zpPodiums },
          { label: 'Podiums (true)', value: summary.truePodiums },
          { label: 'ZP overstates', value: `${summary.inflatedRaces} races` },
        ]}
      />
      <p className="text-xs text-slate-500">
        Podium counts cover only races present in both sources (ZwiftRacing.app history is ~90 days).
      </p>

      {merged.length === 0 ? (
        <p className="text-sm text-slate-400">No races found.</p>
      ) : (
        merged.map((race) => <MergedRaceCard key={race.key} race={race} units={units} />)
      )}
    </div>
  );
}

function RaceHistorySection({
  profileId,
  units,
  getAccessToken,
}: {
  profileId: number;
  units: UnitSystem;
  getAccessToken: () => Promise<string>;
}) {
  const [activeTab, setActiveTab] = useState<ProviderTab>('merged');
  const [zpState, setZpState] = useState<AsyncState<ZwiftPowerRaceEntry[]>>({ status: 'loading' });
  const [zrState, setZrState] = useState<AsyncState<ZwiftRacingRiderResponse>>({
    status: 'loading',
  });
  const [coreState, setCoreState] = useState<AsyncState<ZwiftActivity[]>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetchZwiftPowerRaces(profileId)
      .then((data) => {
        if (!cancelled) setZpState({ status: 'loaded', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZpState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load ZwiftPower races.',
          });
        }
      });

    fetchZwiftRacingRider(profileId)
      .then((data) => {
        if (!cancelled) setZrState({ status: 'loaded', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZrState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load ZwiftRacing.app data.',
          });
        }
      });

    getAccessToken()
      .then((token) => fetchRiderActivities(token, profileId, { start: 0, limit: 20 }))
      .then((data) => {
        if (!cancelled) setCoreState({ status: 'loaded', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCoreState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load Zwift Core activities.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getAccessToken, profileId]);

  const zpCount = zpState.status === 'loaded' ? ` (${zpState.data.length})` : '';
  const zrCount =
    zrState.status === 'loaded'
      ? ` (${zrState.data.overview?.history?.length ?? 0})`
      : '';
  const coreCount = coreState.status === 'loaded' ? ` (${coreState.data.length})` : '';

  const tabs: Array<{ id: ProviderTab; label: string }> = [
    { id: 'merged', label: 'Race History' },
    { id: 'zwiftpower', label: `ZwiftPower${zpCount}` },
    { id: 'zwiftracing', label: `ZwiftRacing.app${zrCount}` },
    { id: 'core', label: `Zwift Core${coreCount}` },
  ];

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Race &amp; Activity History</h2>
          <p className="text-xs text-slate-400">
            Compare every attribute returned across ZwiftPower, ZwiftRacing.app, and Zwift Core for
            Zwift ID {profileId}.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Race data source"
          className="inline-flex flex-wrap rounded-lg border border-slate-700 p-0.5 bg-slate-950 self-start"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === tab.id
                  ? 'bg-[#fc6719] text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'merged' && <MergedTab zpState={zpState} zrState={zrState} units={units} />}
      {activeTab === 'zwiftpower' && (
        <ZwiftPowerTab profileId={profileId} units={units} state={zpState} />
      )}
      {activeTab === 'zwiftracing' && (
        <ZwiftRacingTab profileId={profileId} units={units} state={zrState} />
      )}
      {activeTab === 'core' && (
        <ZwiftCoreTab
          profileId={profileId}
          units={units}
          getAccessToken={getAccessToken}
          state={coreState}
        />
      )}
    </section>
  );
}

export default function ProfilePage({
  profile,
  isOwnProfile = true,
}: {
  profile: ZwiftProfile;
  isOwnProfile?: boolean;
}) {
  const { logout, getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [lookupId, setLookupId] = useState('');
  // Default to the rider's Zwift preference until they pick a unit system here.
  const { units, setUnits } = useUnits(profile.useMetric === false ? 'imperial' : 'metric');
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Zwift rider';
  const metrics = profile.competitionMetrics;
  const rows = flatten(profile);
  const publicRows = rows.filter(([key]) => !key.startsWith('privateAttributes'));
  const privateRows = rows.filter(([key]) => key.startsWith('privateAttributes'));

  function handleLookupSubmit(e: FormEvent) {
    e.preventDefault();
    const cleaned = lookupId.trim();
    if (!/^\d+$/.test(cleaned)) return;
    setLookupId('');
    navigate(`/riders/${cleaned}`);
  }

  return (
    <main className="min-h-dvh max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="font-extrabold text-lg">
            Zwift Victims
          </Link>
          {!isOwnProfile && (
            <Link
              to="/"
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              My profile
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleLookupSubmit} className="flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="View rider ID…"
              aria-label="View rider by Zwift ID"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              className="w-32 rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#fc6719]"
            />
            <button
              type="submit"
              disabled={!/^\d+$/.test(lookupId.trim())}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
            >
              Go
            </button>
          </form>
          <select
            aria-label="Units"
            value={units}
            onChange={(e) => setUnits(e.target.value as UnitSystem)}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm"
          >
            <option value="metric">Metric (kg, cm)</option>
            <option value="imperial">Imperial (lb, ft)</option>
          </select>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Log out
          </button>
        </div>
      </header>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
          {profile.imageSrc ? (
            <img
              src={profile.imageSrc}
              alt={name}
              className="w-24 h-24 rounded-full object-cover border-2 border-[#fc6719]"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center text-3xl font-bold">
              {name[0]}
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold">{name}</h1>
              {!isOwnProfile && (
                <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
                  Rider profile
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400">Zwift ID {profile.id}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="FTP" value={profile.ftp ? `${profile.ftp} W` : undefined} />
          <Stat label="W/kg" value={formatWkg(profile.ftp, profile.weight)} />
          <Stat label="Weight" value={formatWeight(profile.weight, units)} />
          <Stat label="Height" value={formatHeight(profile.height, units)} />
          <Stat label="Racing Score" value={metrics?.racingScore} />
          <Stat label="Category" value={metrics?.category ?? metrics?.categoryWomen} />
        </dl>
      </section>

      <RaceHistorySection profileId={profile.id} units={units} getAccessToken={getAccessToken} />

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8">
        <h2 className="text-lg font-bold mb-3">All profile data</h2>
        <p className="text-xs text-slate-400 mb-4">
          Everything returned by Zwift&apos;s{' '}
          <code>{isOwnProfile ? '/api/profiles/me' : `/api/profiles/${profile.id}`}</code>, as-is
          (weight in grams, height in mm).
        </p>
        <AttributeList rows={publicRows} />
        {privateRows.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-slate-400">
              privateAttributes ({privateRows.length} internal Zwift values)
            </summary>
            <AttributeList rows={privateRows} />
          </details>
        )}
      </section>
    </main>
  );
}
