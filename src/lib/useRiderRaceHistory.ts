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
  const [zpEntry, setZpEntry] = useState<ScopedState<ZwiftPowerRaceEntry[]>>({
    riderId,
    state: LOADING_ZP,
  });
  const [zrEntry, setZrEntry] = useState<ScopedState<ZwiftRacingRiderResponse>>({
    riderId,
    state: LOADING_ZR,
  });
  const [activitiesEntry, setActivitiesEntry] = useState<ScopedState<ZwiftActivity[]>>({
    riderId,
    state: LOADING_ACTIVITIES,
  });
  const [pagination, setPagination] = useState<ActivitiesPaginationState>({
    riderId,
    nextStart: 0,
    hasMore: false,
    loadingMore: false,
  });

  useEffect(() => {
    let cancelled = false;

    fetchZwiftPowerRaces(riderId)
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

    fetchZwiftRacingRider(riderId)
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
      getAccessToken()
        .then((token) =>
          Promise.all([
            fetchRiderActivities(token, riderId, { start: 0, limit: PAGE_SIZE }),
            fetchRiderActivities(token, riderId, { start: PAGE_SIZE, limit: PAGE_SIZE }).catch(
              () => [] as ZwiftActivity[],
            ),
          ]),
        )
        .then(([page1, page2]) => {
          if (cancelled) return;
          const combined = mergeActivityPages(page1, page2);
          setActivitiesEntry({ riderId, state: { status: 'loaded', data: combined } });
          setPagination({
            riderId,
            nextStart: PAGE_SIZE * 2,
            hasMore: page1.length >= PAGE_SIZE && page2.length >= PAGE_SIZE,
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

  const zpState = zpEntry.riderId === riderId ? zpEntry.state : LOADING_ZP;
  const zrState = zrEntry.riderId === riderId ? zrEntry.state : LOADING_ZR;
  const activitiesState =
    activitiesEntry.riderId === riderId ? activitiesEntry.state : LOADING_ACTIVITIES;
  const scopedPagination =
    pagination.riderId === riderId
      ? pagination
      : { riderId, nextStart: 0, hasMore: false, loadingMore: false };

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
          return {
            riderId,
            state: { status: 'loaded', data: mergeActivityPages(prev.state.data, page) },
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
    includeActivities && activitiesState.status === 'loaded'
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
