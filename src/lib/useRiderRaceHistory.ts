import { useEffect, useMemo, useState } from 'react';
import { fetchRiderActivities } from '../api/zwiftCore';
import type { ZwiftActivity } from '../api/zwiftCore';
import { fetchZwiftPowerRaces } from '../api/zwiftPower';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { fetchZwiftRacingRider } from '../api/zwiftRacing';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import { useAuth } from '../auth/AuthContext';
import { mergeRaces } from './raceHistory';
import type { MergedRace } from './raceHistory';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: T };

interface ScopedState<T> {
  riderId: number;
  state: AsyncState<T>;
}

const LOADING_ZP: AsyncState<ZwiftPowerRaceEntry[]> = { status: 'loading' };
const LOADING_ZR: AsyncState<ZwiftRacingRiderResponse> = { status: 'loading' };
const LOADING_ACTIVITIES: AsyncState<ZwiftActivity[]> = { status: 'loading' };
const EMPTY_ACTIVITIES: ZwiftActivity[] = [];

export interface UseRiderRaceHistoryOptions {
  includeActivities?: boolean;
}

/**
 * Fetches ZwiftPower and ZwiftRacing race histories for a rider (and optionally
 * Zwift Core activities to resolve 64-bit `activityId` values) and merges them.
 */
export function useRiderRaceHistory(
  riderId: number,
  options: UseRiderRaceHistoryOptions = {},
): {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  activitiesState: AsyncState<ZwiftActivity[]>;
  mergedRaces: MergedRace[];
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
        .then((token) => fetchRiderActivities(token, riderId, { start: 0, limit: 50 }))
        .then((data) => {
          if (!cancelled) setActivitiesEntry({ riderId, state: { status: 'loaded', data } });
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

  const activities =
    includeActivities && activitiesState.status === 'loaded'
      ? activitiesState.data
      : EMPTY_ACTIVITIES;

  const mergedRaces = useMemo(() => {
    if (zpState.status !== 'loaded') return [];
    const zr = zrState.status === 'loaded' ? (zrState.data.overview?.history ?? []) : [];
    return mergeRaces(zpState.data, zr, activities);
  }, [zpState, zrState, activities]);

  return { zpState, zrState, activitiesState, mergedRaces };
}
