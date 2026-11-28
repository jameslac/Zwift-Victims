import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchUpcomingPublicEvents } from '../api/zwiftCore';
import type { ZwiftPublicEvent } from '../api/zwiftCore';
import { fetchZwiftPowerEventList } from '../api/zwiftPower';
import type { ZwiftPowerEventListItem } from '../api/zwiftPower';
import { fetchZwiftRacingUpcomingEvents } from '../api/zwiftRacing';
import type { ZwiftRacingUpcomingEvent } from '../api/zwiftRacing';
import { useAuth } from '../auth/AuthContext';
import {
  buildLiveRouteMap,
  mergeCalendarEvents,
  normalizeCoreUpcomingEvents,
} from './eventCalendar';
import type { CalendarEvent, EventWindowDays } from './eventCalendar';
import type { AsyncState } from './raceHistory';

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export interface CalendarPayload {
  events: CalendarEvent[];
  liveRouteMap: Map<string, { name: string; world?: string }>;
  zpError: string | null;
  zrError: string | null;
  usedCoreFallback: boolean;
  fetchedAt: number;
}

const zpListCache = new Map<EventWindowDays, CacheEntry<ZwiftPowerEventListItem[]>>();
let zrUpcomingCache: CacheEntry<ZwiftRacingUpcomingEvent[]> | null = null;
let coreUpcomingCache: CacheEntry<ZwiftPublicEvent[]> | null = null;
let sharedLiveRouteMap = new Map<string, { name: string; world?: string }>();

const inFlightByKey = new Map<string, Promise<CalendarPayload>>();

function isFresh<T>(entry: CacheEntry<T> | undefined | null, now = Date.now()): entry is CacheEntry<T> {
  return Boolean(entry && now - entry.fetchedAt < CACHE_TTL_MS);
}

/** Exposes any already-loaded live ZwiftRacing route names for cross-page reuse. */
export function getCachedLiveRouteMap(): Map<string, { name: string; world?: string }> {
  return sharedLiveRouteMap;
}

async function fetchCoreUpcomingFallback(token: string): Promise<ZwiftPublicEvent[]> {
  if (isFresh(coreUpcomingCache)) return coreUpcomingCache.data;
  const pages = await Promise.all([
    fetchUpcomingPublicEvents(token, { start: 0, limit: 200 }),
    fetchUpcomingPublicEvents(token, { start: 200, limit: 200 }).catch(() => [] as ZwiftPublicEvent[]),
    fetchUpcomingPublicEvents(token, { start: 400, limit: 200 }).catch(() => [] as ZwiftPublicEvent[]),
  ]);
  const combined = pages.flat();
  coreUpcomingCache = { data: combined, fetchedAt: Date.now() };
  return combined;
}

function buildPayloadFromCaches(days: EventWindowDays): CalendarPayload | null {
  const zpEntry = zpListCache.get(days);
  if (!isFresh(zpEntry)) return null;
  const zrEvents = isFresh(zrUpcomingCache) ? zrUpcomingCache.data : [];
  const liveRouteMap = buildLiveRouteMap(zrEvents);
  if (liveRouteMap.size > 0) sharedLiveRouteMap = liveRouteMap;
  return {
    events: mergeCalendarEvents(zpEntry.data, zrEvents),
    liveRouteMap,
    zpError: null,
    zrError: null,
    usedCoreFallback: false,
    fetchedAt: zpEntry.fetchedAt,
  };
}

async function loadCalendarData(
  days: EventWindowDays,
  reloadNonce: number,
  getAccessToken: () => Promise<string>,
): Promise<CalendarPayload> {
  const cachedImmediate = buildPayloadFromCaches(days);
  if (cachedImmediate && isFresh(zrUpcomingCache)) {
    return cachedImmediate;
  }

  const inflightKey = `${days}:${reloadNonce}`;
  const existing = inFlightByKey.get(inflightKey);
  if (existing) return existing;

  const req = (async (): Promise<CalendarPayload> => {
    const token = await getAccessToken();
    const cachedZp = zpListCache.get(days);
    const zpPromise = isFresh(cachedZp)
      ? Promise.resolve(cachedZp.data)
      : fetchZwiftPowerEventList(token, days).then((data) => {
          zpListCache.set(days, { data, fetchedAt: Date.now() });
          return data;
        });

    const zrPromise = isFresh(zrUpcomingCache)
      ? Promise.resolve(zrUpcomingCache.data)
      : fetchZwiftRacingUpcomingEvents(token).then((data) => {
          zrUpcomingCache = { data, fetchedAt: Date.now() };
          return data;
        });

    const [zpRes, zrRes] = await Promise.allSettled([zpPromise, zrPromise]);

    const zrEvents = zrRes.status === 'fulfilled' ? zrRes.value : [];
    const zrError =
      zrRes.status === 'rejected'
        ? zrRes.reason instanceof Error
          ? zrRes.reason.message
          : 'ZwiftRacing.app upcoming feed unavailable.'
        : null;

    const liveRouteMap = buildLiveRouteMap(zrEvents);
    if (liveRouteMap.size > 0) sharedLiveRouteMap = liveRouteMap;

    if (zpRes.status === 'fulfilled') {
      return {
        events: mergeCalendarEvents(zpRes.value, zrEvents),
        liveRouteMap,
        zpError: null,
        zrError,
        usedCoreFallback: false,
        fetchedAt: Date.now(),
      };
    }

    const zpError =
      zpRes.reason instanceof Error
        ? zpRes.reason.message
        : 'ZwiftPower event list unavailable.';

    const coreEvents = await fetchCoreUpcomingFallback(token);
    return {
      events: normalizeCoreUpcomingEvents(coreEvents, zrEvents),
      liveRouteMap,
      zpError,
      zrError,
      usedCoreFallback: true,
      fetchedAt: Date.now(),
    };
  })().finally(() => {
    inFlightByKey.delete(inflightKey);
  });

  inFlightByKey.set(inflightKey, req);
  return req;
}

const LOADING_STATE: AsyncState<CalendarPayload> = { status: 'loading' };

export function useEventCalendar(days: EventWindowDays) {
  const { getAccessToken } = useAuth();
  const [reloadNonce, setReloadNonce] = useState(0);
  const requestKey = `${days}:${reloadNonce}`;

  const [entry, setEntry] = useState<{ key: string; state: AsyncState<CalendarPayload> }>(() => {
    const cached = buildPayloadFromCaches(days);
    return {
      key: requestKey,
      state: cached ? { status: 'loaded', data: cached } : LOADING_STATE,
    };
  });

  useEffect(() => {
    let cancelled = false;
    loadCalendarData(days, reloadNonce, getAccessToken)
      .then((data) => {
        if (!cancelled) {
          setEntry({ key: requestKey, state: { status: 'loaded', data } });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntry({
            key: requestKey,
            state: {
              status: 'error',
              message: err instanceof Error ? err.message : 'Failed to load upcoming events.',
            },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [days, reloadNonce, requestKey, getAccessToken]);

  const state = useMemo<AsyncState<CalendarPayload>>(() => {
    if (entry.key === requestKey) return entry.state;
    return LOADING_STATE;
  }, [entry, requestKey]);

  const refresh = useCallback(() => {
    zpListCache.delete(days);
    zrUpcomingCache = null;
    coreUpcomingCache = null;
    setReloadNonce((n) => n + 1);
  }, [days]);

  const loaded = state.status === 'loaded' ? state.data : null;

  return {
    state,
    events: loaded?.events ?? [],
    liveRouteMap: loaded?.liveRouteMap ?? sharedLiveRouteMap,
    zpError: loaded?.zpError ?? null,
    zrError: loaded?.zrError ?? null,
    usedCoreFallback: loaded?.usedCoreFallback ?? false,
    lastUpdatedAt: loaded?.fetchedAt ?? null,
    refresh,
  };
}
