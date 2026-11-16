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
import type { ZwiftProfile } from '../api/zwiftCore';
import { fetchZwiftPowerRaces } from '../api/zwiftPower';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { fetchZwiftRacingRider } from '../api/zwiftRacing';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';

import { isPodium, mergeRaces, summarize } from '../lib/raceHistory';
import type { MergedRace } from '../lib/raceHistory';

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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function PlacingBadge({
  truePlace,
  fieldSize,
  zpPlace,
  didNotFinish,
  disqualified,
  penalty,
}: {
  truePlace?: number;
  fieldSize?: number;
  zpPlace?: number;
  didNotFinish?: boolean;
  disqualified?: boolean;
  penalty?: string;
}) {
  if (didNotFinish) {
    return (
      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 text-xs font-semibold text-red-300">
        DNF
      </span>
    );
  }
  if (disqualified) {
    return (
      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 text-xs font-semibold text-red-300">
        DQ
      </span>
    );
  }
  if (truePlace != null) {
    const label = fieldSize ? `${ordinal(truePlace)} / ${fieldSize}` : ordinal(truePlace);
    let tone = 'bg-slate-800/80 border-slate-600 text-slate-100';
    if (truePlace === 1) {
      tone = 'bg-amber-400/20 border-amber-400/50 text-amber-300';
    } else if (truePlace === 2) {
      tone = 'bg-slate-300/20 border-slate-300/50 text-slate-200';
    } else if (truePlace === 3) {
      tone = 'bg-orange-500/20 border-orange-500/50 text-orange-300';
    }
    return (
      <span
        className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}
        title="True category placing from ZwiftRacing (includes private riders)"
      >
        {label}
      </span>
    );
  }
  if (penalty) {
    return (
      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 text-xs font-semibold text-red-300">
        {penalty}
      </span>
    );
  }
  if (zpPlace != null) {
    return (
      <span
        className="rounded-full bg-slate-700/40 border border-slate-600 px-2.5 py-0.5 text-xs font-semibold text-slate-300"
        title="ZwiftPower category placing (private/hidden riders excluded)"
      >
        {ordinal(zpPlace)} (ZP*)
      </span>
    );
  }
  return null;
}

function MergedRaceCard({ race, units }: { race: MergedRace; units: UnitSystem }) {
  const { zp, zr } = race;
  const timeSec = zpVal(zp?.time) ?? zr?.race?.time;
  const avgPower = zpVal(zp?.avg_power);
  const np = zpVal(zp?.np);
  const avgWkg = zpVal(zp?.avg_wkg) ?? zr?.race?.wkgAvg?.toFixed(2);
  const avgHr = zpVal(zp?.avg_hr);
  const maxHr = zpVal(zp?.max_hr);
  const w5 = zpVal(zp?.w5);
  const wkg5Raw = zpVal(zp?.wkg5);
  const wkg5 = wkg5Raw ?? (zr?.race?.wkg5 != null ? zr.race.wkg5.toFixed(1) : undefined);
  const sprint5s =
    w5 !== undefined && wkg5 !== undefined
      ? `${w5} W (${wkg5} W/kg)`
      : w5 !== undefined
        ? `${w5} W`
        : wkg5 !== undefined
          ? `${wkg5} W/kg`
          : undefined;
  const gap = zp?.gap ?? zr?.race?.gap;
  const distKm = zp?.distance ?? zr?.race?.distance ?? zr?.event?.distance;
  const inflated = (race.placeInflation ?? 0) > 0;
  const podiumMismatch = isPodium(race.zpPlace) && !isPodium(race.truePlace) && race.truePlace != null;
  const category = zp?.category ?? zr?.event?.subgroupId;
  const eloBefore = zr?.velo?.elo?.before;
  const eloAfter = zr?.velo?.elo?.after;
  const sof = zr?.velo?.elo?.eventRating;

  return (
    <article className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-base">{race.title}</h3>
          <p className="text-xs text-slate-400">
            {formatUnixSeconds(race.date)}
            {category ? ` · Cat ${category}` : ''}
            {zr?.event?.subType ? ` · ${zr.event.subType}` : ''}
            {zr?.event?.routeName ? ` · ${zr.event.routeName}` : ''}
            {zp?.tname ? ` · Team ${zp.tname}` : ''}
            {race.eventId ? ` · event ${race.eventId}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PlacingBadge
            truePlace={race.truePlace}
            fieldSize={race.fieldSize}
            zpPlace={race.zpPlace}
            didNotFinish={zr?.place?.didNotFinish}
            disqualified={zr?.place?.disqualified}
            penalty={zp?.penalty}
          />
          {race.truePlace != null &&
            !zr?.place?.didNotFinish &&
            !zr?.place?.disqualified &&
            zp?.penalty && (
              <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-xs font-semibold text-red-300">
                {zp.penalty}
              </span>
            )}
          {zp?.upg === 1 && (
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-xs font-semibold text-amber-300">
              UPG
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
          { label: 'Elevation', value: formatElevation(zr?.event?.elevation, units) },
          { label: 'Avg Power', value: avgPower !== undefined ? `${avgPower} W` : undefined },
          { label: 'NP', value: np !== undefined ? `${np} W` : undefined },
          { label: 'Avg W/kg', value: avgWkg !== undefined ? `${avgWkg} W/kg` : undefined },
          {
            label: 'Avg / Max HR',
            value:
              avgHr !== undefined || maxHr !== undefined
                ? `${avgHr ?? '—'} / ${maxHr ?? '—'} bpm`
                : undefined,
          },
          { label: '5s Sprint', value: sprint5s },
          {
            label: 'vELO',
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
          { label: 'SOF', value: sof != null ? sof.toFixed(0) : undefined },
        ]}
      />
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
    return <p className="text-sm text-slate-400">Loading race history…</p>;
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
}: {
  profileId: number;
  units: UnitSystem;
}) {
  const [zpState, setZpState] = useState<AsyncState<ZwiftPowerRaceEntry[]>>({ status: 'loading' });
  const [zrState, setZrState] = useState<AsyncState<ZwiftRacingRiderResponse>>({
    status: 'loading',
  });

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

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold">Race History</h2>
        <p className="text-xs text-slate-400">
          ZwiftPower race history enriched with ZwiftRacing.app true standings, course data, and vELO ratings.
        </p>
      </div>

      <MergedTab zpState={zpState} zrState={zrState} units={units} />
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
  const { logout } = useAuth();
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

      <RaceHistorySection profileId={profile.id} units={units} />

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
