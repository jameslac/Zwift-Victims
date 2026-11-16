import { useEffect, useMemo, useState } from 'react';
import { fetchZwiftPowerRaces } from '../api/zwiftPower';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { fetchZwiftRacingRider } from '../api/zwiftRacing';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
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

/**
 * Fetches ZwiftPower and ZwiftRacing race histories for a rider and merges them.
 */
export function useRiderRaceHistory(riderId: number): {
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
  mergedRaces: MergedRace[];
} {
  const [zpEntry, setZpEntry] = useState<ScopedState<ZwiftPowerRaceEntry[]>>({
    riderId,
    state: LOADING_ZP,
  });
  const [zrEntry, setZrEntry] = useState<ScopedState<ZwiftRacingRiderResponse>>({
    riderId,
    state: LOADING_ZR,
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

    return () => {
      cancelled = true;
    };
  }, [riderId]);

  const zpState = zpEntry.riderId === riderId ? zpEntry.state : LOADING_ZP;
  const zrState = zrEntry.riderId === riderId ? zrEntry.state : LOADING_ZR;

  const mergedRaces = useMemo(() => {
    if (zpState.status !== 'loaded') return [];
    const zr = zrState.status === 'loaded' ? (zrState.data.overview?.history ?? []) : [];
    return mergeRaces(zpState.data, zr);
  }, [zpState, zrState]);

  return { zpState, zrState, mergedRaces };
}
