import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { AppHeader, AttributeList, MetricGrid, PlacingBadge, Stat } from '../components/RaceUi';
import {
  flatten,
  formatGapSeconds,
  formatUnixSeconds,
  isPodium,
  mergeRaces,
  ordinal,
  summarize,
  zpVal,
} from '../lib/raceHistory';
import type { AsyncState, MergedRace } from '../lib/raceHistory';

function MergedRaceCard({
  race,
  profileId,
  units,
}: {
  race: MergedRace;
  profileId: number;
  units: UnitSystem;
}) {
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

  const cardContent = (
    <article
      className={`rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3 ${
        race.eventId ? 'group-hover:border-[#fc6719]/70 transition-colors' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-base group-hover:text-[#fc6719] transition-colors">
            {race.title}
          </h3>
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

      {race.eventId && (
        <div className="flex justify-end">
          <span className="text-xs font-semibold text-[#fc6719] group-hover:underline">
            View race details →
          </span>
        </div>
      )}
    </article>
  );

  if (!race.eventId) return cardContent;

  return (
    <Link
      to={`/riders/${profileId}/races/${encodeURIComponent(race.eventId)}`}
      state={{ race }}
      className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#fc6719] rounded-xl"
    >
      {cardContent}
    </Link>
  );
}

function MergedTab({
  zpState,
  zrState,
  profileId,
  units,
}: {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  profileId: number;
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
        merged.map((race) => (
          <MergedRaceCard key={race.key} race={race} profileId={profileId} units={units} />
        ))
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
          ZwiftPower race history enriched with ZwiftRacing.app true standings, course data, and
          vELO ratings. Click any race to inspect full standings and multi-API details.
        </p>
      </div>

      <MergedTab zpState={zpState} zrState={zrState} profileId={profileId} units={units} />
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
  // Default to the rider's Zwift preference until they pick a unit system here.
  const { units, setUnits } = useUnits(profile.useMetric === false ? 'imperial' : 'metric');
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Zwift rider';
  const metrics = profile.competitionMetrics;
  const rows = flatten(profile);
  const publicRows = rows.filter(([key]) => !key.startsWith('privateAttributes'));
  const privateRows = rows.filter(([key]) => key.startsWith('privateAttributes'));

  return (
    <main className="min-h-dvh max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
      <AppHeader
        isOwnProfile={isOwnProfile}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
      />

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
