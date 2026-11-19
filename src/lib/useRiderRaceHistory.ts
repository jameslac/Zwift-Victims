import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchRiderActivities } from '../api/zwiftCore';
import type { ZwiftActivity } from '../api/zwiftCore';
import { fetchZwiftPowerRaces } from '../api/zwiftPower';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { fetchZwiftRacingRider } from '../api/zwiftRacing';
import type { ZwiftRacingRaceEntry, ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import { useAuth } from '../auth/AuthContext';
import { getActivityIdStr, mergeActivities, mergeRaces } from './raceHistory';
import type { MergedRace } from './raceHistory';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: T };

interface ScopedState<T> {
  riderId: number;
  state: AsyncState<T>;
}

interface ActivitiesPaginationState {
  riderId: number;
  nextStart: number;
  hasMore: boolean;
  loadingMore: boolean;
}

const PAGE_SIZE = 50;
const LOADING_ZP: AsyncState<ZwiftPowerRaceEntry[]> = { status: 'loading' };
const LOADING_ZR: AsyncState<ZwiftRacingRiderResponse> = { status: 'loading' };
const LOADING_ACTIVITIES: AsyncState<ZwiftActivity[]> = { status: 'loading' };
const EMPTY_ACTIVITIES: ZwiftActivity[] = [];
const EMPTY_ZP: ZwiftPowerRaceEntry[] = [];
const EMPTY_ZR: ZwiftRacingRaceEntry[] = [];

const zpCache = new Map<number, ZwiftPowerRaceEntry[]>();
const zpInFlight = new Map<number, Promise<ZwiftPowerRaceEntry[]>>();

const zrCache = new Map<number, ZwiftRacingRiderResponse>();
const zrInFlight = new Map<number, Promise<ZwiftRacingRiderResponse>>();

interface CachedActivitiesEntry {
  activities: ZwiftActivity[];
  nextStart: number;
  hasMore: boolean;
}
const activitiesCache = new Map<number, CachedActivitiesEntry>();
const activitiesInFlight = new Map<number, Promise<CachedActivitiesEntry>>();

function loadZpCached(riderId: number): Promise<ZwiftPowerRaceEntry[]> {
  const cached = zpCache.get(riderId);
  if (cached) return Promise.resolve(cached);
  const existing = zpInFlight.get(riderId);
  if (existing) return existing;

  const req = fetchZwiftPowerRaces(riderId)
    .then((data) => {
      zpCache.set(riderId, data);
      return data;
    })
    .finally(() => {
      zpInFlight.delete(riderId);
    });
  zpInFlight.set(riderId, req);
  return req;
}

function loadZrCached(riderId: number): Promise<ZwiftRacingRiderResponse> {
  const cached = zrCache.get(riderId);
  if (cached) return Promise.resolve(cached);
  const existing = zrInFlight.get(riderId);
  if (existing) return existing;

  const req = fetchZwiftRacingRider(riderId)
    .then((data) => {
      zrCache.set(riderId, data);
      return data;
    })
    .finally(() => {
      zrInFlight.delete(riderId);
    });
  zrInFlight.set(riderId, req);
  return req;
}

function mergeActivityPages(existing: ZwiftActivity[], incoming: ZwiftActivity[]): ZwiftActivity[] {
  const seen = new Set<string>();
  const combined: ZwiftActivity[] = [];
  for (const act of [...existing, ...incoming]) {
    const id = getActivityIdStr(act);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    combined.push(act);
  }
  return combined;
}

function loadActivitiesCached(
  riderId: number,
  getAccessToken: () => Promise<string>,
): Promise<CachedActivitiesEntry> {
  const cached = activitiesCache.get(riderId);
  if (cached) return Promise.resolve(cached);
  const existing = activitiesInFlight.get(riderId);
  if (existing) return existing;

  const req = getAccessToken()
    .then((token) =>
      Promise.all([
        fetchRiderActivities(token, riderId, { start: 0, limit: PAGE_SIZE }),
        fetchRiderActivities(token, riderId, { start: PAGE_SIZE, limit: PAGE_SIZE }).catch(
          () => [] as ZwiftActivity[],
        ),
      ]),
    )
    .then(([page1, page2]) => {
      const combined = mergeActivityPages(page1, page2);
      const entry: CachedActivitiesEntry = {
        activities: combined,
        nextStart: PAGE_SIZE * 2,
        hasMore: page1.length >= PAGE_SIZE && page2.length >= PAGE_SIZE,
      };
      activitiesCache.set(riderId, entry);
      return entry;
    })
    .finally(() => {
      activitiesInFlight.delete(riderId);
    });

  activitiesInFlight.set(riderId, req);
  return req;
}

export interface UseRiderRaceHistoryOptions {
  includeActivities?: boolean;
}

/**
 * Fetches ZwiftPower, ZwiftRacing, and optionally Zwift Core activities for a rider
 * and exposes both race-only (`mergedRaces`) and full-feed (`mergedActivities`) lists.
 */
export function useRiderRaceHistory(
  riderId: number,
  options: UseRiderRaceHistoryOptions = {},
): {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  activitiesState: AsyncState<ZwiftActivity[]>;
  mergedRaces: MergedRace[];
  mergedActivities: MergedRace[];
  hasMoreActivities: boolean;
  loadingMoreActivities: boolean;
  loadMoreActivities: () => void;
} {
  const { includeActivities = false } = options;
  const { getAccessToken } = useAuth();
  const [zpEntry, setZpEntry] = useState<ScopedState<ZwiftPowerRaceEntry[]>>(() => {
    const cached = zpCache.get(riderId);
    return {
      riderId,
      state: cached ? { status: 'loaded', data: cached } : LOADING_ZP,
    };
  });
  const [zrEntry, setZrEntry] = useState<ScopedState<ZwiftRacingRiderResponse>>(() => {
    const cached = zrCache.get(riderId);
    return {
      riderId,
      state: cached ? { status: 'loaded', data: cached } : LOADING_ZR,
    };
  });
  const [activitiesEntry, setActivitiesEntry] = useState<ScopedState<ZwiftActivity[]>>(() => {
    const cached = activitiesCache.get(riderId);
    return {
      riderId,
      state: cached ? { status: 'loaded', data: cached.activities } : LOADING_ACTIVITIES,
    };
  });
  const [pagination, setPagination] = useState<ActivitiesPaginationState>(() => {
    const cached = activitiesCache.get(riderId);
    return {
      riderId,
      nextStart: cached?.nextStart ?? 0,
      hasMore: cached?.hasMore ?? false,
      loadingMore: false,
    };
  });

  useEffect(() => {
    let cancelled = false;

    loadZpCached(riderId)
      .then((data) => {
        if (!cancelled) setZpEntry({ riderId, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZpEntry({
            riderId,
            state: {
              status: 'error',
              message: err instanceof Error ? err.message : 'Failed to load ZwiftPower races.',
            },
          });
        }
      });

    loadZrCached(riderId)
      .then((data) => {
        if (!cancelled) setZrEntry({ riderId, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZrEntry({
            riderId,
            state: {
              status: 'error',
              message: err instanceof Error ? err.message : 'Failed to load ZwiftRacing.app data.',
            },
          });
        }
      });

    if (includeActivities) {
      loadActivitiesCached(riderId, getAccessToken)
        .then((entry) => {
          if (cancelled) return;
          setActivitiesEntry({ riderId, state: { status: 'loaded', data: entry.activities } });
          setPagination({
            riderId,
            nextStart: entry.nextStart,
            hasMore: entry.hasMore,
            loadingMore: false,
          });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setActivitiesEntry({
              riderId,
              state: {
                status: 'error',
                message: err instanceof Error ? err.message : 'Failed to load Zwift activities.',
              },
            });
            setPagination({
              riderId,
              nextStart: 0,
              hasMore: false,
              loadingMore: false,
            });
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [riderId, includeActivities, getAccessToken]);

  const zpState = useMemo<AsyncState<ZwiftPowerRaceEntry[]>>(() => {
    if (zpEntry.riderId === riderId) return zpEntry.state;
    const cached = zpCache.get(riderId);
    return cached ? { status: 'loaded', data: cached } : LOADING_ZP;
  }, [zpEntry, riderId]);

  const zrState = useMemo<AsyncState<ZwiftRacingRiderResponse>>(() => {
    if (zrEntry.riderId === riderId) return zrEntry.state;
    const cached = zrCache.get(riderId);
    return cached ? { status: 'loaded', data: cached } : LOADING_ZR;
  }, [zrEntry, riderId]);

  const activitiesState = useMemo<AsyncState<ZwiftActivity[]>>(() => {
    if (activitiesEntry.riderId === riderId) return activitiesEntry.state;
    const cached = activitiesCache.get(riderId);
    return cached ? { status: 'loaded', data: cached.activities } : LOADING_ACTIVITIES;
  }, [activitiesEntry, riderId]);

  const cachedActs = activitiesCache.get(riderId);
  const scopedPagination =
    pagination.riderId === riderId
      ? pagination
      : {
          riderId,
          nextStart: cachedActs?.nextStart ?? 0,
          hasMore: cachedActs?.hasMore ?? false,
          loadingMore: false,
        };

  const loadMoreActivities = useCallback(() => {
    if (!includeActivities || scopedPagination.loadingMore || !scopedPagination.hasMore) return;
    const startOffset = scopedPagination.nextStart;
    setPagination((prev) =>
      prev.riderId === riderId ? { ...prev, loadingMore: true } : prev,
    );
    getAccessToken()
      .then((token) => fetchRiderActivities(token, riderId, { start: startOffset, limit: PAGE_SIZE }))
      .then((page) => {
        setActivitiesEntry((prev) => {
          if (prev.riderId !== riderId || prev.state.status !== 'loaded') return prev;
          const merged = mergeActivityPages(prev.state.data, page);
          const nextEntry: CachedActivitiesEntry = {
            activities: merged,
            nextStart: startOffset + PAGE_SIZE,
            hasMore: page.length >= PAGE_SIZE,
          };
          activitiesCache.set(riderId, nextEntry);
          return {
            riderId,
            state: { status: 'loaded', data: merged },
          };
        });
        setPagination((prev) =>
          prev.riderId === riderId
            ? {
                riderId,
                nextStart: startOffset + PAGE_SIZE,
                hasMore: page.length >= PAGE_SIZE,
                loadingMore: false,
              }
            : prev,
        );
      })
      .catch(() => {
        setPagination((prev) =>
          prev.riderId === riderId ? { ...prev, loadingMore: false } : prev,
        );
      });
  }, [
    includeActivities,
    scopedPagination.loadingMore,
    scopedPagination.hasMore,
    scopedPagination.nextStart,
    riderId,
    getAccessToken,
  ]);

  const activities =
    (includeActivities || activitiesState.status === 'loaded') &&
    activitiesState.status === 'loaded'
      ? activitiesState.data
      : EMPTY_ACTIVITIES;

  const mergedRaces = useMemo(() => {
    if (zpState.status !== 'loaded') return [];
    const zr = zrState.status === 'loaded' ? (zrState.data.overview?.history ?? EMPTY_ZR) : EMPTY_ZR;
    return mergeRaces(zpState.data, zr, activities);
  }, [zpState, zrState, activities]);

  const mergedActivities = useMemo(() => {
    if (
      zpState.status !== 'loaded' &&
      zrState.status !== 'loaded' &&
      activitiesState.status !== 'loaded'
    ) {
      return [];
    }
    const zp = zpState.status === 'loaded' ? zpState.data : EMPTY_ZP;
    const zr = zrState.status === 'loaded' ? (zrState.data.overview?.history ?? EMPTY_ZR) : EMPTY_ZR;
    return mergeActivities(zp, zr, activities);
  }, [zpState, zrState, activitiesState.status, activities]);

  return {
    zpState,
    zrState,
    activitiesState,
    mergedRaces,
    mergedActivities,
    hasMoreActivities: includeActivities && scopedPagination.hasMore,
    loadingMoreActivities: includeActivities && scopedPagination.loadingMore,
    loadMoreActivities,
  };
}
