import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppShell';
import EventCalendarCard from '../components/EventCalendarCard';
import { useFavorites } from '../lib/FavoritesContext';
import { useUnits } from '../lib/UnitsContext';
import {
  DEFAULT_CALENDAR_FILTERS,
  filterAndSortCalendarEvents,
  formatLocalDayHeading,
  getLocalDayKey,
} from '../lib/eventCalendar';
import type {
  CalendarEvent,
  CalendarEventType,
  CalendarFilters,
  CalendarSortKey,
  CalendarTerrain,
  DistanceBucket,
  EventWindowDays,
  TimeOfDayBucket,
} from '../lib/eventCalendar';
import { useEventCalendar } from '../lib/useEventCalendar';
import { useVictimSignups } from '../lib/useVictimSignups';

const PAGE_STEP = 40;

type EventTypeTab = 'all' | CalendarEventType;

export default function EventsCalendarPage() {
  const { loading: authLoading, profile, logout } = useAuth();
  const { units, setUnits } = useUnits(profile?.useMetric === false ? 'imperial' : 'metric');
  const { favorites } = useFavorites();

  const [windowDays, setWindowDays] = useState<EventWindowDays>(3);
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_CALENDAR_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_STEP);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const {
    state: calendarState,
    events,
    liveRouteMap,
    zpError,
    zrError,
    usedCoreFallback,
    lastUpdatedAt,
    refresh: refreshCalendar,
  } = useEventCalendar(windowDays);

  const {
    victimsByEventId,
    mySignedUpEventIds,
    loading: signupsLoading,
    errorCount: signupsErrorCount,
    refresh: refreshSignups,
  } = useVictimSignups(profile?.id ?? 0, favorites, liveRouteMap);

  const typeCounts = useMemo(() => {
    const counts: Record<EventTypeTab, number> = {
      all: events.length,
      race: 0,
      tt: 0,
      ride: 0,
      workout: 0,
      run: 0,
    };
    for (const ev of events) {
      counts[ev.eventType] += 1;
    }
    return counts;
  }, [events]);

  const availableWorlds = useMemo(() => {
    const worlds = new Set<string>();
    for (const ev of events) {
      if (ev.world) worlds.add(ev.world);
    }
    return Array.from(worlds).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const victimsGoingEventsCount = useMemo(
    () => events.filter((ev) => (victimsByEventId.get(ev.eventId)?.length ?? 0) > 0).length,
    [events, victimsByEventId],
  );

  const mySignupsCount = useMemo(
    () => events.filter((ev) => mySignedUpEventIds.has(ev.eventId)).length,
    [events, mySignedUpEventIds],
  );

  const filteredEvents = useMemo(
    () =>
      filterAndSortCalendarEvents(events, filters, {
        victimsByEventId,
        mySignedUpEventIds,
      }),
    [events, filters, victimsByEventId, mySignedUpEventIds],
  );

  const visibleEvents = useMemo(
    () => filteredEvents.slice(0, visibleLimit),
    [filteredEvents, visibleLimit],
  );

  const dayGroups = useMemo(() => {
    if (filters.sortBy !== 'start') {
      return [
        {
          dayKey: 'sorted',
          heading: null as string | null,
          events: visibleEvents,
        },
      ];
    }

    const groups: Array<{ dayKey: string; heading: string; events: CalendarEvent[] }> = [];
    const byDay = new Map<string, CalendarEvent[]>();

    for (const ev of visibleEvents) {
      const dayKey = getLocalDayKey(ev.startSec);
      const list = byDay.get(dayKey);
      if (list) {
        list.push(ev);
      } else {
        const nextList = [ev];
        byDay.set(dayKey, nextList);
        groups.push({
          dayKey,
          heading: formatLocalDayHeading(dayKey, nowMs),
          events: nextList,
        });
      }
    }
    return groups;
  }, [visibleEvents, filters.sortBy, nowMs]);

  const activeAdvancedCount = useMemo(() => {
    let count = 0;
    if (filters.world !== 'all') count += 1;
    if (filters.terrain !== 'all') count += 1;
    if (filters.categoryPen !== 'all') count += 1;
    if (filters.distanceBucket !== 'all') count += 1;
    if (filters.timeOfDay !== 'all') count += 1;
    if (filters.sortBy !== 'start') count += 1;
    return count;
  }, [filters]);

  const hasActiveFilter = useMemo(
    () =>
      filters.query.trim() !== '' ||
      filters.type !== 'all' ||
      filters.victimsOnly ||
      filters.mySignupsOnly ||
      filters.womensOnly ||
      filters.minSignups > 0 ||
      activeAdvancedCount > 0,
    [filters, activeAdvancedCount],
  );

  function updateFilters(patch: Partial<CalendarFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setVisibleLimit(PAGE_STEP);
  }

  function resetFilters() {
    setFilters(DEFAULT_CALENDAR_FILTERS);
    setVisibleLimit(PAGE_STEP);
  }

  function handleWindowChange(days: EventWindowDays) {
    setWindowDays(days);
    setVisibleLimit(PAGE_STEP);
  }

  function handleRefreshAll() {
    refreshCalendar();
    refreshSignups();
  }

  if (authLoading) {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">Loading…</main>
    );
  }

  if (!profile) {
    return <Navigate to="/" replace />;
  }

  const typeTabs: Array<{ id: EventTypeTab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: typeCounts.all },
    { id: 'race', label: 'Races', count: typeCounts.race },
    { id: 'tt', label: 'Time Trials', count: typeCounts.tt },
    { id: 'ride', label: 'Group Rides', count: typeCounts.ride },
    { id: 'workout', label: 'Workouts', count: typeCounts.workout },
    { id: 'run', label: 'Runs', count: typeCounts.run },
  ];

  const remainingCount = Math.max(0, filteredEvents.length - visibleEvents.length);

  return (
    <main className="min-h-dvh max-w-5xl mx-auto p-4 sm:p-8 pb-24 md:pb-12 space-y-6">
      <AppHeader
        isOwnProfile
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        activeTab="events"
      />

      {/* Hero Header */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-7 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 tracking-tight">
                Zwift Event Calendar
              </h1>
              {calendarState.status === 'loaded' && (
                <span className="rounded-full bg-accent/15 border border-accent/40 px-2.5 py-0.5 text-xs font-bold text-accent-text tabular-nums">
                  {events.length.toLocaleString()} upcoming
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              Search and filter upcoming Zwift races, group rides, and workouts. Tap{' '}
              <span className="text-slate-200 font-semibold">Open in Companion</span> on any event
              to jump straight into the Zwift Companion App and join.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Event calendar window"
              className="inline-flex rounded-xl bg-slate-950 border border-slate-800 p-1 text-xs"
            >
              {(
                [
                  { days: 1 as const, label: '24h' },
                  { days: 3 as const, label: '3 Days' },
                  { days: 7 as const, label: '7 Days' },
                ] as const
              ).map((opt) => {
                const active = windowDays === opt.days;
                return (
                  <button
                    key={opt.days}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleWindowChange(opt.days)}
                    className={`rounded-lg px-2.5 py-1 font-bold transition-colors ${
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={calendarState.status === 'loading'}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text disabled:opacity-50 transition-colors"
            >
              {calendarState.status === 'loading' ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {(usedCoreFallback || zrError || signupsErrorCount > 0) && (
          <div className="space-y-1 text-xs text-amber-400">
            {usedCoreFallback && (
              <p role="alert">
                ZwiftPower calendar unavailable ({zpError}); showing Zwift Core upcoming events
                fallback (~24–48h window).
              </p>
            )}
            {zrError && (
              <p role="alert">
                ZwiftRacing.app upcoming metadata unavailable ({zrError}); using ZwiftPower &amp;
                static route details.
              </p>
            )}
            {signupsErrorCount > 0 && (
              <p role="alert">
                Some victim signup feeds failed to load ({signupsErrorCount} failed).
              </p>
            )}
          </div>
        )}
      </section>

      {/* Search & Filters */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <input
              type="search"
              value={filters.query}
              onChange={(e) => updateFilters({ query: e.target.value })}
              placeholder="Search title, route, world, organizer, event ID, or victim…"
              aria-label="Search upcoming Zwift events"
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors ${
                advancedOpen || activeAdvancedCount > 0
                  ? 'border-accent bg-accent/15 text-accent-text'
                  : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-600'
              }`}
            >
              <span>Filters</span>
              {activeAdvancedCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0 text-[10px] font-extrabold text-accent-foreground">
                  {activeAdvancedCount}
                </span>
              )}
            </button>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Event Type Tabs */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by event type"
        >
          {typeTabs.map((tab) => {
            const active = filters.type === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => updateFilters({ type: tab.id })}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-accent border-accent text-accent-foreground'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[11px] tabular-nums ${
                    active ? 'bg-black/20 text-accent-foreground' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Quick Toggle Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={filters.victimsOnly}
            onClick={() => updateFilters({ victimsOnly: !filters.victimsOnly })}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
              filters.victimsOnly
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-amber-400/50 hover:text-amber-300'
            }`}
          >
            <span aria-hidden="true">★</span>
            <span>Victims Going ({victimsGoingEventsCount})</span>
          </button>

          <button
            type="button"
            aria-pressed={filters.mySignupsOnly}
            onClick={() => updateFilters({ mySignupsOnly: !filters.mySignupsOnly })}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
              filters.mySignupsOnly
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-emerald-400/50 hover:text-emerald-300'
            }`}
          >
            <span>✓ My Signups ({mySignupsCount})</span>
          </button>

          <button
            type="button"
            aria-pressed={filters.minSignups === 5}
            onClick={() =>
              updateFilters({ minSignups: filters.minSignups === 5 ? 0 : 5 })
            }
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              filters.minSignups === 5
                ? 'bg-accent/20 border-accent text-accent-text'
                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            5+ Riders
          </button>

          <button
            type="button"
            aria-pressed={filters.minSignups === 20}
            onClick={() =>
              updateFilters({ minSignups: filters.minSignups === 20 ? 0 : 20 })
            }
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              filters.minSignups === 20
                ? 'bg-accent/20 border-accent text-accent-text'
                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            20+ Riders
          </button>

          <button
            type="button"
            aria-pressed={filters.womensOnly}
            onClick={() => updateFilters({ womensOnly: !filters.womensOnly })}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              filters.womensOnly
                ? 'bg-accent/20 border-accent text-accent-text'
                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            Women Only
          </button>
        </div>

        {/* Collapsible Advanced Filters */}
        {advancedOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-slate-800 pt-3.5 text-xs">
            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                World
              </span>
              <select
                value={filters.world}
                onChange={(e) => updateFilters({ world: e.target.value })}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-accent"
              >
                <option value="all">All Worlds</option>
                {availableWorlds.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Terrain
              </span>
              <select
                value={filters.terrain}
                onChange={(e) =>
                  updateFilters({ terrain: e.target.value as 'all' | CalendarTerrain })
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-accent"
              >
                <option value="all">Any Terrain</option>
                <option value="flat">Flat</option>
                <option value="hilly">Hilly</option>
                <option value="mountain">Mountain</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Category Pen
              </span>
              <select
                value={filters.categoryPen}
                onChange={(e) => updateFilters({ categoryPen: e.target.value })}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-accent"
              >
                <option value="all">Any Category</option>
                <option value="A">Cat A</option>
                <option value="B">Cat B</option>
                <option value="C">Cat C</option>
                <option value="D">Cat D</option>
                <option value="E">Cat E</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Distance / Format
              </span>
              <select
                value={filters.distanceBucket}
                onChange={(e) =>
                  updateFilters({ distanceBucket: e.target.value as DistanceBucket })
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-accent"
              >
                <option value="all">Any Distance</option>
                <option value="short">Short (&lt; 20 km / 12 mi)</option>
                <option value="medium">Medium (20–40 km / 12–25 mi)</option>
                <option value="long">Long (&gt; 40 km / 25 mi)</option>
                <option value="timed">Time-Based</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Local Time of Day
              </span>
              <select
                value={filters.timeOfDay}
                onChange={(e) => updateFilters({ timeOfDay: e.target.value as TimeOfDayBucket })}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-accent"
              >
                <option value="all">Any Time</option>
                <option value="morning">Morning (5am–12pm)</option>
                <option value="afternoon">Afternoon (12pm–5pm)</option>
                <option value="evening">Evening (5pm–10pm)</option>
                <option value="late_night">Late Night (10pm–5am)</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Sort By
              </span>
              <select
                value={filters.sortBy}
                onChange={(e) => updateFilters({ sortBy: e.target.value as CalendarSortKey })}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-accent"
              >
                <option value="start">Soonest Start Time</option>
                <option value="signups">Most Signed Up</option>
                <option value="shortest">Shortest Distance</option>
                <option value="longest">Longest Distance</option>
                <option value="climbing">Most Elevation Gain</option>
              </select>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 border-t border-slate-800/80 pt-2.5">
          <span>
            Showing <strong className="text-slate-200">{filteredEvents.length}</strong> of{' '}
            <strong className="text-slate-200">{events.length}</strong> upcoming events
          </span>
          <span className="text-[11px] text-slate-500">
            {signupsLoading
              ? 'Checking victim signups…'
              : lastUpdatedAt
                ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString(undefined, {
                    timeStyle: 'short',
                  })}`
                : null}
          </span>
        </div>
      </section>

      {/* Results List */}
      {calendarState.status === 'loading' ? (
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center">
          <p className="text-sm text-slate-400">Loading upcoming Zwift events…</p>
        </section>
      ) : calendarState.status === 'error' ? (
        <section className="rounded-2xl bg-slate-900 border border-red-500/40 p-6 text-center space-y-3">
          <p role="alert" className="text-sm font-semibold text-red-300">
            {calendarState.message}
          </p>
          <button
            type="button"
            onClick={handleRefreshAll}
            className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-accent-foreground"
          >
            Try Again
          </button>
        </section>
      ) : filteredEvents.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 p-8 text-center space-y-2">
          <p className="text-sm font-bold text-slate-200">
            {events.length === 0
              ? 'No upcoming events found in this window.'
              : 'No events match your active filters.'}
          </p>
          {hasActiveFilter && events.length > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-bold text-accent-text hover:underline"
            >
              Clear filters to show all {events.length} events
            </button>
          )}
        </section>
      ) : (
        <div className="space-y-6">
          {dayGroups.map((group) => (
            <section key={group.dayKey} className="space-y-3">
              {group.heading && (
                <div className="flex items-center justify-between gap-2 px-1">
                  <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-accent-text">
                    {group.heading}
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {group.events.length} shown
                  </span>
                </div>
              )}

              <div className="space-y-3.5">
                {group.events.map((ev) => (
                  <EventCalendarCard
                    key={ev.eventId}
                    event={ev}
                    units={units}
                    victims={victimsByEventId.get(ev.eventId) ?? []}
                    userSignedUp={mySignedUpEventIds.has(ev.eventId)}
                    nowMs={nowMs}
                  />
                ))}
              </div>
            </section>
          ))}

          {remainingCount > 0 && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + PAGE_STEP)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-2.5 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
              >
                Show {Math.min(PAGE_STEP, remainingCount)} more ({remainingCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
