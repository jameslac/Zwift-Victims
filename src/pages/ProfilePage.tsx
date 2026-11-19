import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import PowerBestsSection from '../components/PowerBestsSection';
import { AppHeader, MetricGrid, PlacingBadge, RaceExternalLinks, Stat } from '../components/RaceUi';
import ZwiftRacingProfileSection from '../components/ZwiftRacingProfileSection';
import ZwiftVictimsSection from '../components/ZwiftVictimsSection';
import { useFavorites } from '../lib/FavoritesContext';
import { useUnits } from '../lib/UnitsContext';
import {
  formatDistance,
  formatDrops,
  formatDurationMs,
  formatElevation,
  formatHeight,
  formatWeight,
  formatWkg,
} from '../lib/units';
import type { UnitSystem } from '../lib/units';
import { fetchPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerProfile, ZwiftProfile } from '../api/zwiftCore';
import { getXpProgress } from '../lib/profileXp';
import { extractPowerProfileMetrics } from '../lib/powerBests';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import {
  formatGapSeconds,
  formatUnixSeconds,
  isPodium,
  ordinal,
  summarize,
  zpVal,
} from '../lib/raceHistory';
import type { AsyncState, MergedRace } from '../lib/raceHistory';
import { useRiderRaceHistory } from '../lib/useRiderRaceHistory';

function formatRiderCategory(profile: ZwiftProfile): string | undefined {
  const metrics = profile.competitionMetrics;
  const openCat = metrics?.category?.trim() || undefined;
  const womenCat = metrics?.categoryWomen?.trim() || undefined;
  if (profile.male === false) {
    if (womenCat && openCat) return `${womenCat} (Women) / ${openCat} (Open)`;
    if (womenCat) return `${womenCat} (Women)`;
    if (openCat) return `${openCat} (Open)`;
    return undefined;
  }
  return openCat ?? womenCat;
}

function XpProgressBar({ profile }: { profile: ZwiftProfile }) {
  const xp = getXpProgress(profile);
  if (!xp) return null;

  const xpLabel =
    xp.totalXp !== null && xp.nextLevelXp !== null
      ? `${xp.totalXp.toLocaleString()} / ${xp.nextLevelXp.toLocaleString()} XP`
      : xp.totalXp !== null
        ? `${xp.totalXp.toLocaleString()} XP`
        : null;

  return (
    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2.5 py-0.5 text-xs font-bold text-[#fc6719]">
            {xp.level !== null ? `Level ${xp.level}` : 'XP Progress'}
          </span>
          {xpLabel && <span className="font-semibold text-slate-200">{xpLabel}</span>}
        </div>
        <div className="text-xs text-slate-400">
          {xp.xpRemaining !== null && xp.level !== null && xp.xpRemaining > 0 ? (
            <>
              <span className="font-semibold text-slate-200">{xp.progressPct}%</span>
              <span> · {xp.xpRemaining.toLocaleString()} XP to Level {xp.level + 1}</span>
            </>
          ) : (
            <span className="font-semibold text-slate-200">{xp.progressPct}%</span>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={xp.level !== null ? `Level ${xp.level} XP progress` : 'XP progress'}
        aria-valuenow={xp.progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#fc6719] to-amber-400 transition-all"
          style={{ width: `${xp.progressPct}%` }}
        />
      </div>
    </div>
  );
}
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
  const detailPath = race.eventId
    ? `/riders/${profileId}/races/${encodeURIComponent(race.eventId)}`
    : null;

  const mainBody = (
    <>
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
    </>
  );

  return (
    <article
      className={`rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3 ${
        detailPath ? 'hover:border-[#fc6719]/70 transition-colors' : ''
      }`}
    >
      {detailPath ? (
        <Link
          to={detailPath}
          state={{ race }}
          className="block space-y-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#fc6719] rounded-lg"
        >
          {mainBody}
        </Link>
      ) : (
        <div className="space-y-3">{mainBody}</div>
      )}

      <footer className="border-t border-slate-800/80 pt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          {detailPath && (
            <Link
              to={detailPath}
              state={{ race }}
              className="text-xs font-semibold text-[#fc6719] hover:underline"
            >
              View race details →
            </Link>
          )}
        </div>
        <RaceExternalLinks
          zpZid={race.zp?.zid != null ? String(race.zp.zid) : undefined}
          zrEventId={
            race.zr && race.zr.event?.eventId != null ? String(race.zr.event.eventId) : undefined
          }
          zrSubgroup={race.zr ? (race.zr.event?.subgroupId ?? race.zp?.category) : undefined}
          routeName={race.zr?.event?.routeName}
          activityId={race.activityId}
        />
      </footer>
    </article>
  );
}

function MergedTab({
  zpState,
  zrState,
  merged,
  profileId,
  units,
}: {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  merged: MergedRace[];
  profileId: number;
  units: UnitSystem;
}) {
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
  zpState,
  zrState,
  merged,
  profileId,
  units,
}: {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  merged: MergedRace[];
  profileId: number;
  units: UnitSystem;
}) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold">Race History</h2>
        <p className="text-xs text-slate-400">
          ZwiftPower race history enriched with ZwiftRacing.app true standings, course data, and
          vELO ratings. Click any race to inspect full standings and multi-API details.
        </p>
      </div>

      <MergedTab
        zpState={zpState}
        zrState={zrState}
        merged={merged}
        profileId={profileId}
        units={units}
      />
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
  // Default to the rider's Zwift preference until they pick a unit system here.
  const { units, setUnits } = useUnits(profile.useMetric === false ? 'imperial' : 'metric');
  const { favorites, isFavorite, toggleFavorite, upsertFavorite, removeFavorite } = useFavorites();
  const { zpState, zrState, mergedRaces } = useRiderRaceHistory(profile.id, {
    includeActivities: true,
  });
  const [powerProfileState, setPowerProfileState] = useState<AsyncState<ZwiftPowerProfile> | null>(
    () => (isOwnProfile ? { status: 'loading' } : null),
  );

  useEffect(() => {
    if (!isOwnProfile) return;
    let cancelled = false;

    getAccessToken()
      .then(fetchPowerProfile)
      .then((data) => {
        if (!cancelled) setPowerProfileState({ status: 'loaded', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPowerProfileState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load Zwift power profile.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profile.id, isOwnProfile, getAccessToken]);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Zwift rider';
  const metrics = profile.competitionMetrics;
  const { zftp, zmap } = extractPowerProfileMetrics(
    powerProfileState?.status === 'loaded' ? powerProfileState.data : null,
  );
  const racingScore =
    metrics?.racingScore != null && Number.isFinite(metrics.racingScore)
      ? Math.round(metrics.racingScore)
      : undefined;
  const riderCategory = formatRiderCategory(profile);
  const favoriteCategory =
    (profile.male === false
      ? (metrics?.categoryWomen ?? metrics?.category)
      : (metrics?.category ?? metrics?.categoryWomen)) ?? undefined;
  const favorited = isFavorite(profile.id);
  const existingFavorite = favorites.find((f) => f.id === profile.id);

  useEffect(() => {
    if (
      !isOwnProfile &&
      existingFavorite &&
      (existingFavorite.name !== name ||
        existingFavorite.imageSrc !== profile.imageSrc ||
        existingFavorite.category !== favoriteCategory)
    ) {
      upsertFavorite({
        id: profile.id,
        name,
        imageSrc: profile.imageSrc,
        category: favoriteCategory,
      });
    }
  }, [
    isOwnProfile,
    existingFavorite,
    name,
    profile.id,
    profile.imageSrc,
    favoriteCategory,
    upsertFavorite,
  ]);

  return (
    <main className="min-h-dvh max-w-4xl mx-auto p-4 sm:p-8 space-y-6">
      <AppHeader
        isOwnProfile={isOwnProfile}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
      />

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
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

          {!isOwnProfile && (
            <button
              type="button"
              onClick={() =>
                toggleFavorite({
                  id: profile.id,
                  name,
                  imageSrc: profile.imageSrc,
                  category: favoriteCategory,
                })
              }
              aria-pressed={favorited}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors shrink-0 ${
                favorited
                  ? 'bg-amber-500/15 border-amber-400/50 text-amber-300 hover:bg-amber-500/25'
                  : 'bg-slate-950/70 border-slate-700 text-slate-200 hover:border-amber-400/50 hover:text-amber-300'
              }`}
            >
              <span aria-hidden="true">{favorited ? '★' : '☆'}</span>
              <span>{favorited ? 'Favorited' : 'Favorite'}</span>
            </button>
          )}
        </div>

        <XpProgressBar profile={profile} />

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="FTP" value={profile.ftp ? `${profile.ftp} W` : undefined} />
          <Stat label="W/kg" value={formatWkg(profile.ftp, profile.weight)} />
          {isOwnProfile && (
            <>
              <Stat
                label="zFTP"
                value={
                  powerProfileState?.status === 'loading'
                    ? '…'
                    : zftp !== undefined
                      ? `${Math.round(zftp)} W`
                      : undefined
                }
                subValue={
                  zftp !== undefined && profile.weight
                    ? formatWkg(zftp, profile.weight)
                    : undefined
                }
              />
              <Stat
                label="zMAP"
                value={
                  powerProfileState?.status === 'loading'
                    ? '…'
                    : zmap !== undefined
                      ? `${Math.round(zmap)} W`
                      : undefined
                }
                subValue={
                  zmap !== undefined && profile.weight
                    ? formatWkg(zmap, profile.weight)
                    : undefined
                }
              />
            </>
          )}
          <Stat label="Weight" value={formatWeight(profile.weight, units)} />
          <Stat label="Height" value={formatHeight(profile.height, units)} />
          <Stat label="Racing Score" value={racingScore} />
          <Stat label="Category" value={riderCategory} />
          <Stat label="Total Distance" value={formatDistance(profile.totalDistance, units)} />
          <Stat label="Total Climbed" value={formatElevation(profile.totalDistanceClimbed, units)} />
          <Stat label="Drops" value={formatDrops(profile.totalGold)} />
        </dl>
      </section>

      {isOwnProfile && (
        <ZwiftVictimsSection
          profileId={profile.id}
          favorites={favorites}
          onRemoveFavorite={removeFavorite}
          profileRaces={mergedRaces}
          profileZpState={zpState}
          profileZrState={zrState}
        />
      )}

      <PowerBestsSection
        riderName={name}
        isOwnProfile={isOwnProfile}
        weightGrams={profile.weight}
        units={units}
        ftp={profile.ftp}
        zftp={zftp}
        zmap={zmap}
        powerProfileState={powerProfileState}
        zpState={zpState}
      />

      <ZwiftRacingProfileSection profileId={profile.id} zrState={zrState} />

      <RaceHistorySection
        zpState={zpState}
        zrState={zrState}
        merged={mergedRaces}
        profileId={profile.id}
        units={units}
      />
    </main>
  );
}
