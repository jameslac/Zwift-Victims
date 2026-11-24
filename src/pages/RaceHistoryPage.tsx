import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { ZwiftProfile } from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import { useAuth } from '../auth/AuthContext';
import LazyActivityExportModal from '../components/LazyActivityExportModal';
import { AppHeader, RiderContextBanner } from '../components/AppShell';
import {
  ActivityTypeBadge,
  MetricGrid,
  PlacingBadge,
  RaceExternalLinks,
} from '../components/RaceUi';
import { mergedRaceToExportItem } from '../lib/activityExport';
import type { ActivityExportItem, ActivityExportRiderContext } from '../lib/activityExport';
import { useUnits } from '../lib/UnitsContext';
import {
  formatGapSeconds,
  formatUnixSeconds,
  formatZwiftWorld,
  isPodium,
  ordinal,
  summarize,
  zpVal,
} from '../lib/raceHistory';
import type { ActivityType, AsyncState, MergedRace } from '../lib/raceHistory';
import { formatDistance, formatDurationMs, formatElevation } from '../lib/units';
import type { UnitSystem } from '../lib/units';
import {
  formatRiderCategory,
  formatRiderName,
  useRiderProfile,
} from '../lib/useRiderProfile';
import { useRiderRaceHistory } from '../lib/useRiderRaceHistory';

type ActivityTypeFilter = 'all' | ActivityType;

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
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  race: MergedRace;
  profileId: number;
  units: UnitSystem;
  riderWeightGrams?: number;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (key: string) => void;
}) {
  const { zp, zr, activity } = race;
  const activityType: ActivityType = race.activityType ?? 'race';
  const activityTypeLabel = race.activityTypeLabel ?? 'Race';
  const isStandaloneCore = !zp && !zr && Boolean(activity);
  const selectable = Boolean(race.activityId);

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
  const podiumMismatch =
    isPodium(race.zpPlace) && !isPodium(race.truePlace) && race.truePlace != null;
  const category = zp?.category ?? zr?.event?.subgroupId;
  const eloBefore = zr?.velo?.elo?.before;
  const eloAfter = zr?.velo?.elo?.after;
  const sof = zr?.velo?.elo?.eventRating;
  const detailPath = race.eventId
    ? `/riders/${profileId}/races/${encodeURIComponent(race.eventId)}`
    : race.activityId
      ? `/riders/${profileId}/activities/${encodeURIComponent(race.activityId)}`
      : null;
  const worldName = formatZwiftWorld(activity?.worldId);

  const mainBody = (
    <>
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1 flex items-start gap-2.5">
          {selectMode && (
            <span
              aria-hidden="true"
              className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-md border text-xs font-extrabold shrink-0 transition-colors ${
                !selectable
                  ? 'border-slate-700 bg-slate-900/50 text-slate-600'
                  : selected
                    ? 'border-accent bg-accent text-white'
                    : 'border-slate-500 bg-slate-900 text-transparent'
              }`}
            >
              {selectable && selected ? '✓' : ''}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-base group-hover:text-accent-text transition-colors leading-snug break-words">
              {race.title}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {formatUnixSeconds(race.date)}
              {zr?.event?.subType ? ` · ${zr.event.subType}` : ''}
              {zr?.event?.routeName ? ` · ${zr.event.routeName}` : ''}
              {!zr?.event?.routeName && worldName ? ` · ${worldName}` : ''}
              {zp?.tname ? ` · Team ${zp.tname}` : ''}
              {race.eventId ? ` · event ${race.eventId}` : ''}
              {!race.eventId && race.activityId ? ` · activity ${race.activityId}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 ml-auto">
          {selectMode && !selectable && (
            <span className="rounded-full bg-slate-800/90 border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-400">
              No FIT link
            </span>
          )}
          {category && (
            <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs font-bold text-slate-200">
              Cat {category}
            </span>
          )}
          <ActivityTypeBadge type={activityType} label={activityTypeLabel} />
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
        </div>
      </div>

      {race.truePlace != null && inflated && race.zpPlace != null && (
        <div className="rounded-lg border bg-amber-500/10 border-amber-500/30 p-2.5 text-xs text-amber-200">
          ZwiftPower shows <span className="font-bold">{ordinal(race.zpPlace)}</span> —{' '}
          <span className="font-bold">
            {race.placeInflation} place{race.placeInflation === 1 ? '' : 's'} better
          </span>{' '}
          than reality ({ordinal(race.truePlace)}
          {race.fieldSize ? ` / ${race.fieldSize}` : ''}) because hidden riders are dropped
          {podiumMismatch ? ' (ZwiftPower shows a podium that wasn’t)' : ''}.
        </div>
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

  const cardBorderClass = selectMode
    ? selectable
      ? selected
        ? 'border-accent ring-1 ring-accent/50'
        : 'border-slate-600/80 hover:border-accent/70'
      : 'border-slate-700/60 opacity-65'
    : detailPath
      ? 'border-slate-600/80 hover:border-accent/80'
      : 'border-slate-600/80';

  return (
    <article
      className={`rounded-2xl bg-slate-950/95 border-2 border-l-4 border-l-accent shadow-lg shadow-black/50 p-4 sm:p-5 space-y-3.5 transition-colors ${cardBorderClass}`}
    >
      {selectMode ? (
        selectable ? (
          <button
            type="button"
            onClick={() => onToggleSelect?.(race.key)}
            aria-pressed={selected}
            aria-label={`${selected ? 'Deselect' : 'Select'} ${race.title} for export`}
            className="block w-full text-left space-y-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
          >
            {mainBody}
          </button>
        ) : (
          <div className="space-y-3">{mainBody}</div>
        )
      ) : detailPath ? (
        <Link
          to={detailPath}
          state={{ race }}
          className="block space-y-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
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
              className="text-xs font-semibold text-accent-text hover:underline"
            >
              {race.eventId
                ? activityType === 'race'
                  ? 'View race details →'
                  : 'View event details →'
                : 'View activity details →'}
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
  activitiesState,
  mergedRaces,
  mergedActivities,
  hasMoreActivities,
  loadingMoreActivities,
  onLoadMoreActivities,
  profileId,
  units,
  riderWeightGrams,
  riderContext,
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
  riderContext: ActivityExportRiderContext;
}) {
  const [typeFilter, setTypeFilter] = useState<ActivityTypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const summary = useMemo(() => summarize(mergedRaces), [mergedRaces]);

  const counts = useMemo(() => {
    const byType: Record<ActivityType, number> = {
      race: 0,
      ride: 0,
      workout: 0,
      free_ride: 0,
    };

    for (const item of mergedActivities) {
      const t: ActivityType = item.activityType ?? 'race';
      byType[t] += 1;
    }

    return {
      all: mergedActivities.length,
      ...byType,
    };
  }, [mergedActivities]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredActivities = useMemo(
    () =>
      mergedActivities.filter((item) => {
        if (typeFilter !== 'all' && (item.activityType ?? 'race') !== typeFilter) return false;
        if (trimmedQuery && !matchesSearchQuery(item, trimmedQuery)) return false;
        return true;
      }),
    [mergedActivities, typeFilter, trimmedQuery],
  );

  const visibleExportableKeys = useMemo(
    () => filteredActivities.filter((r) => Boolean(r.activityId)).map((r) => r.key),
    [filteredActivities],
  );
  const visibleUnmatchedCount = filteredActivities.length - visibleExportableKeys.length;

  const selectedExportItems = useMemo(() => {
    const items: ActivityExportItem[] = [];
    for (const race of mergedActivities) {
      if (!selectedKeys.has(race.key)) continue;
      const item = mergedRaceToExportItem(race, profileId, riderContext);
      if (item) items.push(item);
    }
    return items;
  }, [mergedActivities, selectedKeys, profileId, riderContext]);

  const hasActiveFilter = typeFilter !== 'all' || trimmedQuery !== '';

  function resetFilters() {
    setTypeFilter('all');
    setSearchQuery('');
  }

  function handleToggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSelectVisible() {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of visibleExportableKeys) next.add(k);
      return next;
    });
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

  return (
    <div className={`space-y-4 ${selectMode ? 'pb-16' : ''}`}>
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
              ZwiftRacing.app unavailable ({zrState.message}); showing ZwiftPower &amp; Zwift Feed
              only.
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Activity type filter"
          >
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
                      ? 'bg-accent border-accent text-white'
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

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by title, route, cat, team…"
                aria-label="Filter activities"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent"
              />
            </div>
            <button
              type="button"
              onClick={() => setSelectMode((prev) => !prev)}
              aria-pressed={selectMode}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                selectMode
                  ? 'bg-accent border-accent text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-accent/60 hover:text-accent-text'
              }`}
            >
              {selectMode ? 'Done Selecting' : 'Select & Export'}
            </button>
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
              className="text-xs font-semibold text-accent-text hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>

        {selectMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={visibleExportableKeys.length === 0}
                onClick={handleSelectVisible}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-accent/60 hover:text-accent-text disabled:opacity-45 transition-colors"
              >
                Select visible ({visibleExportableKeys.length})
              </button>
              {selectedExportItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedKeys(new Set())}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  Clear ({selectedExportItems.length})
                </button>
              )}
            </div>
            {visibleUnmatchedCount > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>
                  {visibleUnmatchedCount} older{' '}
                  {visibleUnmatchedCount === 1 ? 'entry needs' : 'entries need'} Zwift Feed loaded
                </span>
                {hasMoreActivities && (
                  <button
                    type="button"
                    disabled={loadingMoreActivities}
                    onClick={onLoadMoreActivities}
                    className="font-semibold text-accent-text hover:underline disabled:opacity-50"
                  >
                    {loadingMoreActivities ? 'Loading…' : 'Load older'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
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
              className="text-xs font-semibold text-accent-text hover:underline"
            >
              Clear filters to show all {mergedActivities.length} activities
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {filteredActivities.map((race) => (
            <MergedRaceCard
              key={race.key}
              race={race}
              profileId={profileId}
              units={units}
              riderWeightGrams={riderWeightGrams}
              selectMode={selectMode}
              selected={selectedKeys.has(race.key)}
              onToggleSelect={handleToggleSelect}
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
            className="rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-accent/60 hover:text-accent-text disabled:opacity-50 transition-colors"
          >
            {loadingMoreActivities ? 'Loading older activities…' : 'Load older Zwift activities'}
          </button>
        </div>
      )}

      {selectMode && (
        <div className="fixed bottom-16 md:bottom-5 inset-x-0 z-40 px-3 sm:px-6 pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto rounded-2xl border border-accent/60 bg-slate-950/95 backdrop-blur-xl shadow-2xl shadow-black/70 px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-100">
              <span className="inline-flex items-center justify-center rounded-full bg-accent/20 border border-accent/50 px-2.5 py-0.5 text-xs font-extrabold text-accent-text tabular-nums">
                {selectedExportItems.length}
              </span>
              <span>
                {selectedExportItems.length === 1 ? 'activity selected' : 'activities selected'}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {selectedExportItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedKeys(new Set())}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectMode(false);
                  setSelectedKeys(new Set());
                }}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedExportItems.length === 0}
                onClick={() => setExportModalOpen(true)}
                className="rounded-xl bg-accent hover:bg-accent-hover px-4 py-1.5 text-xs sm:text-sm font-bold text-white shadow disabled:opacity-45 transition-colors"
              >
                Export CSV / FIT ({selectedExportItems.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {exportModalOpen && selectedExportItems.length > 0 && (
        <LazyActivityExportModal
          onClose={() => setExportModalOpen(false)}
          rider={riderContext}
          items={selectedExportItems}
          onRemoveItem={(key) =>
            setSelectedKeys((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            })
          }
        />
      )}
    </div>
  );
}

function RiderRaceHistoryView({
  profile,
  isOwnProfile,
}: {
  profile: ZwiftProfile;
  isOwnProfile: boolean;
}) {
  const { logout } = useAuth();
  const { units, setUnits } = useUnits(profile.useMetric === false ? 'imperial' : 'metric');
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

  const riderName = formatRiderName(profile);
  const riderContext = useMemo<ActivityExportRiderContext>(
    () => ({
      riderId: profile.id,
      riderName,
      weightKg:
        typeof profile.weight === 'number' && profile.weight > 0
          ? profile.weight / 1000
          : undefined,
      ftpW: typeof profile.ftp === 'number' && profile.ftp > 0 ? profile.ftp : undefined,
      category: formatRiderCategory(profile),
      zrs: profile.competitionMetrics?.racingScore ?? undefined,
    }),
    [profile, riderName],
  );

  return (
    <main className="min-h-dvh max-w-5xl mx-auto p-4 sm:p-8 pb-24 md:pb-12 space-y-6">
      <AppHeader
        isOwnProfile={isOwnProfile}
        targetRiderId={profile.id}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        activeTab="history"
      />

      <RiderContextBanner profile={profile} isOwnProfile={isOwnProfile} />

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-100">
              {isOwnProfile ? 'Activity & Race History' : `${riderName} · Activity & Race History`}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              All Zwift activities merged across ZwiftPower, ZwiftRacing.app, and Zwift Core. Filter
              by activity type or search, and click any event to inspect full standings and details.
            </p>
          </div>
          <Link
            to={isOwnProfile ? '/' : `/riders/${profile.id}`}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
          >
            <span>← {isOwnProfile ? 'Profile Overview' : `${riderName}'s Profile`}</span>
          </Link>
        </div>

        <MergedTab
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
          riderContext={riderContext}
        />
      </section>
    </main>
  );
}

export default function RaceHistoryPage() {
  const resolution = useRiderProfile();

  if (resolution.status === 'loading') {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">
        {resolution.riderIdParam ? `Loading rider ${resolution.riderIdParam}…` : 'Loading…'}
      </main>
    );
  }

  if (resolution.status === 'unauthenticated') {
    return <Navigate to="/" replace />;
  }

  if (resolution.status === 'invalid_id') {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <p className="text-red-400 text-sm">
            Invalid Zwift rider ID: &ldquo;{resolution.riderIdParam}&rdquo;.
          </p>
          <Link
            to="/"
            className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            Back to my profile
          </Link>
        </div>
      </main>
    );
  }

  if (resolution.status === 'error') {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <p className="text-red-400 text-sm">{resolution.message}</p>
          <Link
            to="/"
            className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            Back to my profile
          </Link>
        </div>
      </main>
    );
  }

  return (
    <RiderRaceHistoryView
      key={resolution.profile.id}
      profile={resolution.profile}
      isOwnProfile={resolution.isOwnProfile}
    />
  );
}
