import { useEffect, useMemo, useState } from 'react';
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
import { fetchRaceResults, fetchRiderActivities } from '../api/zwiftCore';
import type { ZwiftActivity, ZwiftProfile, ZwiftRaceResultEntry } from '../api/zwiftCore';

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

function isRaceOrEventActivity(activity: ZwiftActivity): boolean {
  return (
    Boolean(activity.eventSubgroupId) ||
    /\b(race|zrl|wtrl|ttt|crit|fondo|stage|tour|chase)\b/i.test(activity.name ?? '')
  );
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return 'Unknown date';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatActivityDuration(activity: ZwiftActivity): string {
  if (typeof activity.movingTimeInMs === 'number') {
    return formatDurationMs(activity.movingTimeInMs);
  }
  return activity.duration || '—';
}

type RaceResultState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; entries: ZwiftRaceResultEntry[] };

function RaceResultPanel({
  subgroupId,
  profileId,
  state,
  onLoad,
}: {
  subgroupId: number;
  profileId: number;
  state: RaceResultState | undefined;
  onLoad: (subgroupId: number) => void;
}) {
  const myEntry =
    state?.status === 'loaded'
      ? state.entries.find((entry) => Number(entry.profileId) === profileId)
      : undefined;
  const myEntryRows = myEntry ? flatten(myEntry) : [];

  return (
    <div className="rounded-lg bg-slate-900/70 border border-slate-800 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400 font-mono">
          eventSubgroupId: {subgroupId}
        </span>
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

      {state?.status === 'error' && (
        <p className="text-xs text-red-400">{state.message}</p>
      )}

      {state?.status === 'loaded' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-300">
            Returned {state.entries.length} subgroup finisher
            {state.entries.length === 1 ? '' : 's'}.
            {myEntry
              ? ` Your rank: ${myEntry.rank ?? '—'} · Elapsed: ${formatDurationMs(
                  myEntry.activityData?.durationInMilliseconds,
                )} · Avg Power: ${
                  myEntry.sensorData?.avgWatts != null
                    ? `${Math.round(myEntry.sensorData.avgWatts)} W`
                    : '—'
                }`
              : ' Your rider ID was not found in the returned subgroup entries.'}
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

function RaceHistorySection({
  profileId,
  units,
  getAccessToken,
}: {
  profileId: number;
  units: UnitSystem;
  getAccessToken: () => Promise<string>;
}) {
  const [activities, setActivities] = useState<ZwiftActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'races'>('all');
  const [raceResultsBySubgroup, setRaceResultsBySubgroup] = useState<
    Record<number, RaceResultState>
  >({});

  useEffect(() => {
    let cancelled = false;
    getAccessToken()
      .then((token) => fetchRiderActivities(token, profileId, { start: 0, limit: 20 }))
      .then((data) => {
        if (!cancelled) {
          setActivities(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load activities.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getAccessToken, profileId]);

  const raceActivities = useMemo(() => activities.filter(isRaceOrEventActivity), [activities]);
  const displayedActivities = filter === 'races' ? raceActivities : activities;
  const allActivityKeys = useMemo(
    () =>
      Array.from(
        new Set(activities.flatMap((activity) => flatten(activity).map(([key]) => key))),
      ).sort(),
    [activities],
  );

  async function handleLoadRaceResult(subgroupId: number) {
    setRaceResultsBySubgroup((prev) => ({ ...prev, [subgroupId]: { status: 'loading' } }));
    try {
      const token = await getAccessToken();
      const entries = await fetchRaceResults(token, subgroupId);
      setRaceResultsBySubgroup((prev) => ({
        ...prev,
        [subgroupId]: { status: 'loaded', entries },
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

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Race &amp; Activity History</h2>
          <p className="text-xs text-slate-400">
            Raw feed from Zwift&apos;s <code>/api/profiles/{profileId}/activities</code> (latest 20)
            and optional <code>/api/race-results/entries</code> per event subgroup.
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-950 self-start">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              filter === 'all'
                ? 'bg-[#fc6719] text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            All activities ({activities.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('races')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              filter === 'races'
                ? 'bg-[#fc6719] text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Races &amp; Events ({raceActivities.length})
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading activities…</p>}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {!loading && !error && activities.length > 0 && (
        <details className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">
            All attribute keys returned across activities ({allActivityKeys.length} keys)
          </summary>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs font-mono text-slate-400">
            {allActivityKeys.map((key) => (
              <li key={key} className="break-all">
                {key}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!loading && !error && displayedActivities.length === 0 && (
        <p className="text-sm text-slate-400">
          {filter === 'races'
            ? 'No race or event activities detected in the latest 20 activities.'
            : 'No activities returned by Zwift.'}
        </p>
      )}

      <div className="space-y-4">
        {displayedActivities.map((activity, index) => {
          const activityRows = flatten(activity);
          const raceOrEvent = isRaceOrEventActivity(activity);
          const subgroupId =
            typeof activity.eventSubgroupId === 'number' && activity.eventSubgroupId > 0
              ? activity.eventSubgroupId
              : null;

          return (
            <article
              key={String(activity.id ?? activity.id_str ?? index)}
              className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-base">
                    {activity.name || 'Untitled activity'}
                  </h3>
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

              <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
                  <dt className="text-slate-400">Distance</dt>
                  <dd className="mt-0.5 font-semibold">
                    {formatDistance(activity.distanceInMeters, units)}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
                  <dt className="text-slate-400">Elevation</dt>
                  <dd className="mt-0.5 font-semibold">
                    {formatElevation(activity.totalElevation, units)}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
                  <dt className="text-slate-400">Moving Time</dt>
                  <dd className="mt-0.5 font-semibold">{formatActivityDuration(activity)}</dd>
                </div>
                <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
                  <dt className="text-slate-400">Avg Power</dt>
                  <dd className="mt-0.5 font-semibold">
                    {activity.avgWatts != null ? `${Math.round(activity.avgWatts)} W` : '—'}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
                  <dt className="text-slate-400">Avg HR</dt>
                  <dd className="mt-0.5 font-semibold">
                    {activity.avgHeartRate != null
                      ? `${Math.round(activity.avgHeartRate)} bpm`
                      : '—'}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
                  <dt className="text-slate-400">Calories</dt>
                  <dd className="mt-0.5 font-semibold">
                    {activity.calories != null ? `${Math.round(activity.calories)} kcal` : '—'}
                  </dd>
                </div>
              </dl>

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
                  All activity attributes ({activityRows.length} fields)
                </summary>
                <AttributeList rows={activityRows} />
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function ProfilePage({ profile }: { profile: ZwiftProfile }) {
  const { logout, getAccessToken } = useAuth();
  // Default to the rider's Zwift preference until they pick a unit system here.
  const { units, setUnits } = useUnits(profile.useMetric === false ? 'imperial' : 'metric');
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Zwift rider';
  const metrics = profile.competitionMetrics;
  const rows = flatten(profile);
  const publicRows = rows.filter(([key]) => !key.startsWith('privateAttributes'));
  const privateRows = rows.filter(([key]) => key.startsWith('privateAttributes'));

  return (
    <main className="min-h-dvh max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <span className="font-extrabold text-lg">Zwift Victims</span>
        <div className="flex items-center gap-2">
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
            <h1 className="text-2xl sm:text-3xl font-extrabold">{name}</h1>
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
          Everything returned by Zwift&apos;s <code>/api/profiles/me</code>, as-is (weight in grams,
          height in mm).
        </p>
        <AttributeList rows={publicRows} />
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-400">
            privateAttributes ({privateRows.length} internal Zwift values)
          </summary>
          <AttributeList rows={privateRows} />
        </details>
      </section>
    </main>
  );
}
