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
  buildZwiftActivityUrl,
  formatGapSeconds,
  formatUnixSeconds,
  isPodium,
  ordinal,
  summarize,
  zpVal,
} from '../lib/raceHistory';
import type { ActivityType, AsyncState, MergedRace } from '../lib/raceHistory';
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
const ACTIVITY_TYPE_BADGE_TONE: Record<ActivityType, string> = {
  race: 'bg-[#fc6719]/15 border-[#fc6719]/40 text-[#fc6719]',
  ride: 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  workout: 'bg-violet-500/15 border-violet-500/40 text-violet-300',
  free_ride: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
};

type ActivityTypeFilter = 'all' | ActivityType;
type QuickTagFilter = 'podiums' | 'tt' | 'linked' | null;

function isTimeTrialActivity(race: MergedRace): boolean {
  const label = race.activityTypeLabel ?? '';
  if (label === 'TTT' || label === 'Time Trial') return true;
  if (typeof race.zp?.f_t === 'string' && /\bTYPE_TT\b/i.test(race.zp.f_t)) return true;
  if (/\b(itt|ttt|time\s*trial)\b/i.test(`${race.zr?.event?.subType ?? ''} ${race.title}`)) {
    return true;
  }
  return false;
}

function isPodiumActivity(race: MergedRace): boolean {
  if (race.zr?.place?.didNotFinish || race.zr?.place?.disqualified) return false;
  if (race.truePlace != null) return isPodium(race.truePlace);
  return isPodium(race.zpPlace);
}

function matchesSearchQuery(race: MergedRace, query: string): boolean {
  if (!query) return true;
  const haystacks = [
    race.title,
    race.activityTypeLabel,
    race.eventId,
    race.activityId,
    race.zp?.category,
    race.zp?.tname,
    race.zr?.event?.subgroupId,
    race.zr?.event?.routeName,
    race.zr?.event?.subType,
    race.activity?.description,
  ];
  return haystacks.some((val) => typeof val === 'string' && val.toLowerCase().includes(query));
}

function MergedRaceCard({
  race,
  profileId,
  units,
  riderWeightGrams,
}: {
  race: MergedRace;
  profileId: number;
  units: UnitSystem;
  riderWeightGrams?: number;
}) {
  const { zp, zr, activity } = race;
  const activityType: ActivityType = race.activityType ?? 'race';
  const activityTypeLabel = race.activityTypeLabel ?? 'Race';
  const isStandaloneCore = !zp && !zr && Boolean(activity);

  const coreMovingSec =
    typeof activity?.movingTimeInMs === 'number' && activity.movingTimeInMs > 0
      ? Math.round(activity.movingTimeInMs / 1000)
      : undefined;
  const timeSec = zpVal(zp?.time) ?? zr?.race?.time ?? coreMovingSec;
  const avgPower =
    zpVal(zp?.avg_power) ??
    (typeof activity?.avgWatts === 'number' && activity.avgWatts > 0
      ? Math.round(activity.avgWatts)
      : undefined);
  const np = zpVal(zp?.np);
  const avgWkg =
    zpVal(zp?.avg_wkg) ??
    zr?.race?.wkgAvg?.toFixed(2) ??
    (typeof activity?.avgWatts === 'number' &&
    activity.avgWatts > 0 &&
    riderWeightGrams &&
    riderWeightGrams > 0
      ? (activity.avgWatts / (riderWeightGrams / 1000)).toFixed(2)
      : undefined);
  const avgHr =
    zpVal(zp?.avg_hr) ??
    (typeof activity?.avgHeartRate === 'number' && activity.avgHeartRate > 0
      ? Math.round(activity.avgHeartRate)
      : undefined);
  const maxHr =
    zpVal(zp?.max_hr) ??
    (typeof activity?.maxHeartRate === 'number' && activity.maxHeartRate > 0
      ? Math.round(activity.maxHeartRate)
      : undefined);
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
  const distanceMeters =
    typeof distKm === 'number'
      ? distKm * 1000
      : typeof activity?.distanceInMeters === 'number' && activity.distanceInMeters > 0
        ? activity.distanceInMeters
        : undefined;
  const elevationMeters = zr?.event?.elevation ?? activity?.totalElevation;
  const inflated = (race.placeInflation ?? 0) > 0;
  const podiumMismatch = isPodium(race.zpPlace) && !isPodium(race.truePlace) && race.truePlace != null;
  const category = zp?.category ?? zr?.event?.subgroupId;
  const eloBefore = zr?.velo?.elo?.before;
  const eloAfter = zr?.velo?.elo?.after;
  const sof = zr?.velo?.elo?.eventRating;
  const detailPath = race.eventId
    ? `/riders/${profileId}/races/${encodeURIComponent(race.eventId)}`
    : null;
  const zwiftActivityUrl = !detailPath && race.activityId ? buildZwiftActivityUrl(race.activityId) : null;

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
            {!race.eventId && race.activityId ? ` · activity ${race.activityId}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${ACTIVITY_TYPE_BADGE_TONE[activityType]}`}
          >
            {activityTypeLabel}
          </span>
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
          {!zp && Boolean(zr) && (
            <span className="rounded-full bg-slate-700/40 border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
              ZwiftRacing only
            </span>
          )}
          {Boolean(zp) && !zr && activityType === 'race' && (
            <span className="rounded-full bg-slate-700/40 border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
              No ZwiftRacing data
            </span>
          )}
          {isStandaloneCore && (
            <span className="rounded-full bg-slate-700/40 border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
              Zwift Feed
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
        zp &&
        (activityType === 'race' || (zp.position_in_cat != null && zp.position_in_cat > 0)) && (
          <p className="text-xs text-slate-400">
            ZwiftPower category place: {zp.position_in_cat ?? '—'} (field may exclude hidden riders; no
            ZwiftRacing result to verify — older than 90 days or unscored).
          </p>
        )
      )}

      {isStandaloneCore ? (
        <MetricGrid
          items={[
            {
              label: 'Time',
              value: typeof timeSec === 'number' ? formatDurationMs(timeSec * 1000) : undefined,
            },
            { label: 'Distance', value: formatDistance(distanceMeters, units) },
            { label: 'Elevation', value: formatElevation(elevationMeters, units) },
            { label: 'Avg Power', value: avgPower !== undefined ? `${avgPower} W` : undefined },
            { label: 'Avg W/kg', value: avgWkg !== undefined ? `${avgWkg} W/kg` : undefined },
            avgHr !== undefined || maxHr !== undefined
              ? {
                  label: 'Avg / Max HR',
                  value: `${avgHr ?? '—'} / ${maxHr ?? '—'} bpm`,
                }
              : {
                  label: 'Calories',
                  value:
                    typeof activity?.calories === 'number' && activity.calories > 0
                      ? `${Math.round(activity.calories)} kcal`
                      : undefined,
                },
          ]}
        />
      ) : (
        <MetricGrid
          items={[
            {
              label: 'Time',
              value: typeof timeSec === 'number' ? formatDurationMs(timeSec * 1000) : undefined,
            },
            { label: 'Gap', value: formatGapSeconds(gap) },
            { label: 'Distance', value: formatDistance(distanceMeters, units) },
            { label: 'Elevation', value: formatElevation(elevationMeters, units) },
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
      )}
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
          {detailPath ? (
            <Link
              to={detailPath}
              state={{ race }}
              className="text-xs font-semibold text-[#fc6719] hover:underline"
            >
              {activityType === 'race' ? 'View race details →' : 'View event details →'}
            </Link>
          ) : (
            zwiftActivityUrl && (
              <a
                href={zwiftActivityUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-[#fc6719] hover:underline"
              >
                Open on Zwift.com ↗
              </a>
            )
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
  activitiesState,
  mergedRaces,
  mergedActivities,
  hasMoreActivities,
  loadingMoreActivities,
  onLoadMoreActivities,
  profileId,
  units,
  riderWeightGrams,
}: {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  activitiesState: AsyncState<unknown>;
  mergedRaces: MergedRace[];
  mergedActivities: MergedRace[];
  hasMoreActivities: boolean;
  loadingMoreActivities: boolean;
  onLoadMoreActivities: () => void;
  profileId: number;
  units: UnitSystem;
  riderWeightGrams?: number;
}) {
  const [typeFilter, setTypeFilter] = useState<ActivityTypeFilter>('all');
  const [quickTag, setQuickTag] = useState<QuickTagFilter>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const summary = useMemo(() => summarize(mergedRaces), [mergedRaces]);

  const counts = useMemo(() => {
    const byType: Record<ActivityType, number> = {
      race: 0,
      ride: 0,
      workout: 0,
      free_ride: 0,
    };
    let podiums = 0;
    let tt = 0;
    let linked = 0;

    for (const item of mergedActivities) {
      const t: ActivityType = item.activityType ?? 'race';
      byType[t] += 1;
      if (isPodiumActivity(item)) podiums += 1;
      if (isTimeTrialActivity(item)) tt += 1;
      if (item.activityId) linked += 1;
    }

    return {
      all: mergedActivities.length,
      ...byType,
      podiums,
      tt,
      linked,
    };
  }, [mergedActivities]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredActivities = useMemo(
    () =>
      mergedActivities.filter((item) => {
        if (typeFilter !== 'all' && (item.activityType ?? 'race') !== typeFilter) return false;
        if (quickTag === 'podiums' && !isPodiumActivity(item)) return false;
        if (quickTag === 'tt' && !isTimeTrialActivity(item)) return false;
        if (quickTag === 'linked' && !item.activityId) return false;
        if (trimmedQuery && !matchesSearchQuery(item, trimmedQuery)) return false;
        return true;
      }),
    [mergedActivities, typeFilter, quickTag, trimmedQuery],
  );

  const hasActiveFilter = typeFilter !== 'all' || quickTag !== null || trimmedQuery !== '';

  function resetFilters() {
    setTypeFilter('all');
    setQuickTag(null);
    setSearchQuery('');
  }

  const allSourcesLoading =
    zpState.status === 'loading' &&
    zrState.status === 'loading' &&
    activitiesState.status === 'loading';

  if (allSourcesLoading) {
    return <p className="text-sm text-slate-400">Loading activity history…</p>;
  }

  if (
    zpState.status === 'error' &&
    zrState.status === 'error' &&
    activitiesState.status === 'error'
  ) {
    return (
      <p role="alert" className="text-sm text-red-400">
        {zpState.message}
      </p>
    );
  }

  const typeTabs: Array<{ id: ActivityTypeFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'race', label: 'Races', count: counts.race },
    { id: 'ride', label: 'Group Rides', count: counts.ride },
    { id: 'workout', label: 'Workouts', count: counts.workout },
    { id: 'free_ride', label: 'Free Rides', count: counts.free_ride },
  ];

  const quickChips: Array<{ id: Exclude<QuickTagFilter, null>; label: string; count: number }> = [
    { id: 'podiums', label: 'Podiums', count: counts.podiums },
    { id: 'tt', label: 'TT / TTT', count: counts.tt },
    { id: 'linked', label: 'Zwift Activity Linked', count: counts.linked },
  ];

  return (
    <div className="space-y-4">
      {(zpState.status === 'error' ||
        zrState.status === 'error' ||
        activitiesState.status === 'error') && (
        <div className="space-y-1">
          {zpState.status === 'error' && (
            <p role="alert" className="text-xs text-amber-400">
              ZwiftPower unavailable ({zpState.message}); showing ZwiftRacing &amp; Zwift Feed only.
            </p>
          )}
          {zrState.status === 'error' && (
            <p role="alert" className="text-xs text-amber-400">
              ZwiftRacing.app unavailable ({zrState.message}); showing ZwiftPower &amp; Zwift Feed only.
            </p>
          )}
          {activitiesState.status === 'error' && (
            <p role="alert" className="text-xs text-amber-400">
              Zwift Core activity feed unavailable ({activitiesState.message}); solo free rides and
              workouts may be omitted.
            </p>
          )}
        </div>
      )}

      <MetricGrid
        items={[
          { label: 'All Activities', value: mergedActivities.length },
          { label: 'Races', value: summary.total },
          { label: 'Enriched (ZR)', value: `${summary.enriched} / ${summary.total}` },
          { label: 'Podiums (ZP)', value: summary.zpPodiums },
          { label: 'Podiums (true)', value: summary.truePodiums },
          { label: 'ZP overstates', value: `${summary.inflatedRaces} races` },
        ]}
      />
      <p className="text-xs text-slate-500">
        Race podium counts cover races present in both ZwiftPower and ZwiftRacing.app (~90-day
        window).
      </p>

      <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Activity type filter">
          {typeTabs.map((tab) => {
            const active = typeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTypeFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[#fc6719] border-[#fc6719] text-white'
                    : 'bg-slate-900/80 border-slate-700/80 text-slate-300 hover:border-slate-500 hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[11px] ${
                    active ? 'bg-black/20 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
            {quickChips.map((chip) => {
              const active = quickTag === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setQuickTag(active ? null : chip.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#fc6719]/20 border-[#fc6719]/60 text-[#fc6719]'
                      : 'bg-slate-900/60 border-slate-700/70 text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <span>{chip.label}</span>
                  <span className="text-[11px] opacity-75">({chip.count})</span>
                </button>
              );
            })}
          </div>

          <div className="relative sm:w-64">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by title, route, cat, team…"
              aria-label="Filter activities"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#fc6719]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-0.5">
          <span>
            Showing <strong className="text-slate-200">{filteredActivities.length}</strong> of{' '}
            <strong className="text-slate-200">{mergedActivities.length}</strong> activities
            {activitiesState.status === 'loading' ? ' (loading Zwift Feed…)' : ''}
          </span>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-[#fc6719] hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {filteredActivities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center space-y-2">
          <p className="text-sm text-slate-300">
            {mergedActivities.length === 0
              ? 'No activities found.'
              : 'No activities match the current filter.'}
          </p>
          {hasActiveFilter && mergedActivities.length > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-[#fc6719] hover:underline"
            >
              Clear filters to show all {mergedActivities.length} activities
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredActivities.map((race) => (
            <MergedRaceCard
              key={race.key}
              race={race}
              profileId={profileId}
              units={units}
              riderWeightGrams={riderWeightGrams}
            />
          ))}
        </div>
      )}

      {hasMoreActivities && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={onLoadMoreActivities}
            disabled={loadingMoreActivities}
            className="rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-[#fc6719]/60 hover:text-[#fc6719] disabled:opacity-50 transition-colors"
          >
            {loadingMoreActivities ? 'Loading older activities…' : 'Load older Zwift activities'}
          </button>
        </div>
      )}
    </div>
  );
}

function RaceHistorySection({
  zpState,
  zrState,
  activitiesState,
  mergedRaces,
  mergedActivities,
  hasMoreActivities,
  loadingMoreActivities,
  onLoadMoreActivities,
  profileId,
  units,
  riderWeightGrams,
}: {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  activitiesState: AsyncState<unknown>;
  mergedRaces: MergedRace[];
  mergedActivities: MergedRace[];
  hasMoreActivities: boolean;
  loadingMoreActivities: boolean;
  onLoadMoreActivities: () => void;
  profileId: number;
  units: UnitSystem;
  riderWeightGrams?: number;
}) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold">Activity &amp; Race History</h2>
        <p className="text-xs text-slate-400">
          All Zwift activities merged across ZwiftPower, ZwiftRacing.app, and Zwift Core. Filter by
          activity type or search, and click any event to inspect full standings and details.
        </p>
      </div>

      <MergedTab
        zpState={zpState}
        zrState={zrState}
        activitiesState={activitiesState}
        mergedRaces={mergedRaces}
        mergedActivities={mergedActivities}
        hasMoreActivities={hasMoreActivities}
        loadingMoreActivities={loadingMoreActivities}
        onLoadMoreActivities={onLoadMoreActivities}
        profileId={profileId}
        units={units}
        riderWeightGrams={riderWeightGrams}
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
  const {
    zpState,
    zrState,
    activitiesState,
    mergedRaces,
    mergedActivities,
    hasMoreActivities,
    loadingMoreActivities,
    loadMoreActivities,
  } = useRiderRaceHistory(profile.id, {
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
        activitiesState={activitiesState}
        mergedRaces={mergedRaces}
        mergedActivities={mergedActivities}
        hasMoreActivities={hasMoreActivities}
        loadingMoreActivities={loadingMoreActivities}
        onLoadMoreActivities={loadMoreActivities}
        profileId={profile.id}
        units={units}
        riderWeightGrams={profile.weight}
      />
    </main>
  );
}
