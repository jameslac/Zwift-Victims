import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchZwiftPowerEventSignups,
  fetchZwiftPowerRiderSignups,
} from '../api/zwiftPower';
import type { ZwiftPowerEventListItem, ZwiftPowerEventSignupEntry } from '../api/zwiftPower';
import { useAuth } from '../auth/AuthContext';
import type { FavoriteRider } from './FavoritesContext';
import {
  normalizeZpEventToCalendarEvent,
  penLabelFromNumber,
} from './eventCalendar';
import type { CalendarEvent, VictimInEvent } from './eventCalendar';
import { getCachedLiveRouteMap } from './useEventCalendar';

const SIGNUPS_TTL_MS = 3 * 60_000;
const LIVE_GRACE_SEC = 15 * 60;
const SIGNUP_CONCURRENCY = 4;
const MAX_ENRICHED_VICTIM_EVENTS = 10;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const riderSignupsCache = new Map<number, CacheEntry<ZwiftPowerEventListItem[]>>();
const eventSignupsCache = new Map<string, CacheEntry<ZwiftPowerEventSignupEntry[]>>();

function isFresh<T>(entry: CacheEntry<T> | undefined, now = Date.now()): entry is CacheEntry<T> {
  return Boolean(entry && now - entry.fetchedAt < SIGNUPS_TTL_MS);
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function next() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await worker(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export interface VictimSignupItem {
  event: CalendarEvent;
  pen?: string;
  userAlsoSignedUp: boolean;
}

export interface GroupedVictimEvent {
  event: CalendarEvent;
  victims: VictimInEvent[];
  userSignedUp: boolean;
}

interface RawVictimSignupsResult {
  rawByRider: Map<number, ZwiftPowerEventListItem[]>;
  penLookupByEvent: Map<string, Map<number, { pen?: string; count: number }>>;
  errorCount: number;
  fetchedAt: number;
}

function buildPenLookup(entries: ZwiftPowerEventSignupEntry[]): Map<number, { pen?: string; count: number }> {
  const byRider = new Map<number, { pen?: string; count: number }>();
  const totalCount = entries.length;
  for (const row of entries) {
    if (typeof row.zwid !== 'number' || !Number.isFinite(row.zwid)) continue;
    byRider.set(row.zwid, {
      pen: penLabelFromNumber(row.label),
      count: totalCount,
    });
  }
  return byRider;
}

export function useVictimSignups(
  ownProfileId: number,
  favorites: FavoriteRider[],
  liveRouteMap?: Map<string, { name: string; world?: string }>,
) {
  const { getAccessToken } = useAuth();
  const [reloadNonce, setReloadNonce] = useState(0);

  const rivals = useMemo(
    () => favorites.filter((f) => f.id !== ownProfileId),
    [favorites, ownProfileId],
  );
  const rivalsKey = useMemo(
    () =>
      rivals
        .map((r) => r.id)
        .sort((a, b) => a - b)
        .join(','),
    [rivals],
  );

  const requestKey = `${ownProfileId}:${rivalsKey}:${reloadNonce}`;

  const [entry, setEntry] = useState<{
    key: string;
    loading: boolean;
    data: RawVictimSignupsResult | null;
  }>(() => ({
    key: requestKey,
    loading: ownProfileId > 0,
    data: null,
  }));

  useEffect(() => {
    if (ownProfileId <= 0) return;
    let cancelled = false;

    const rivalIds = rivalsKey
      ? rivalsKey
          .split(',')
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const targetRiderIds = [ownProfileId, ...rivalIds];

    (async () => {
      const token = await getAccessToken();
      let errorCount = 0;
      const rawByRider = new Map<number, ZwiftPowerEventListItem[]>();
      const penLookupByEvent = new Map<string, Map<number, { pen?: string; count: number }>>();

      await runWithConcurrency(targetRiderIds, SIGNUP_CONCURRENCY, async (riderId) => {
        const cached = riderSignupsCache.get(riderId);
        if (isFresh(cached)) {
          rawByRider.set(riderId, cached.data);
          return;
        }
        try {
          const items = await fetchZwiftPowerRiderSignups(token, riderId);
          riderSignupsCache.set(riderId, { data: items, fetchedAt: Date.now() });
          rawByRider.set(riderId, items);
        } catch {
          errorCount += 1;
          rawByRider.set(riderId, []);
        }
      });

      if (cancelled) return;

      const cutoffSec = Math.floor(Date.now() / 1000) - LIVE_GRACE_SEC;
      const victimEvents = new Map<string, number>();
      for (const rivalId of rivalIds) {
        for (const item of rawByRider.get(rivalId) ?? []) {
          const eid = String(item.zid ?? item.DT_RowId ?? '').trim();
          const tm = typeof item.tm === 'number' ? item.tm : Number(item.tm);
          if (!eid || !Number.isFinite(tm) || tm < cutoffSec) continue;
          const prev = victimEvents.get(eid);
          if (prev === undefined || tm < prev) victimEvents.set(eid, tm);
        }
      }

      const eventsToEnrich = Array.from(victimEvents.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, MAX_ENRICHED_VICTIM_EVENTS)
        .map(([eid]) => eid);

      // Emit phase 1 immediately so upcoming signups display right away before pen enrichment completes.
      for (const eid of eventsToEnrich) {
        const cached = eventSignupsCache.get(eid);
        if (isFresh(cached)) {
          penLookupByEvent.set(eid, buildPenLookup(cached.data));
        }
      }

      setEntry({
        key: requestKey,
        loading: eventsToEnrich.some((eid) => !penLookupByEvent.has(eid)),
        data: {
          rawByRider: new Map(rawByRider),
          penLookupByEvent: new Map(penLookupByEvent),
          errorCount,
          fetchedAt: Date.now(),
        },
      });

      const uncachedEvents = eventsToEnrich.filter((eid) => !penLookupByEvent.has(eid));
      if (uncachedEvents.length === 0) return;

      await runWithConcurrency(uncachedEvents, SIGNUP_CONCURRENCY, async (eid) => {
        try {
          const rows = await fetchZwiftPowerEventSignups(token, eid);
          eventSignupsCache.set(eid, { data: rows, fetchedAt: Date.now() });
          penLookupByEvent.set(eid, buildPenLookup(rows));
        } catch {
          // Pen lookup is optional enrichment; ignore transient failures.
        }
      });

      if (cancelled) return;
      setEntry({
        key: requestKey,
        loading: false,
        data: {
          rawByRider,
          penLookupByEvent,
          errorCount,
          fetchedAt: Date.now(),
        },
      });
    })().catch(() => {
      if (!cancelled) {
        setEntry({
          key: requestKey,
          loading: false,
          data: {
            rawByRider: new Map(),
            penLookupByEvent: new Map(),
            errorCount: 1,
            fetchedAt: Date.now(),
          },
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ownProfileId, rivalsKey, reloadNonce, requestKey, getAccessToken]);

  const effectiveRouteMap = liveRouteMap ?? getCachedLiveRouteMap();

  const derived = useMemo(() => {
    const empty = {
      signupsByRiderId: new Map<number, VictimSignupItem[]>(),
      victimsByEventId: new Map<string, VictimInEvent[]>(),
      groupedUpcomingEvents: [] as GroupedVictimEvent[],
      mySignedUpEventIds: new Set<string>(),
    };

    const raw = entry.key === requestKey ? entry.data : null;
    if (!raw) return empty;

    const cutoffSec = Math.floor(raw.fetchedAt / 1000) - LIVE_GRACE_SEC;
    const mySignedUpEventIds = new Set<string>();
    for (const item of raw.rawByRider.get(ownProfileId) ?? []) {
      const eid = String(item.zid ?? item.DT_RowId ?? '').trim();
      const tm = typeof item.tm === 'number' ? item.tm : Number(item.tm);
      if (eid && Number.isFinite(tm) && tm >= cutoffSec) {
        mySignedUpEventIds.add(eid);
      }
    }

    const signupsByRiderId = new Map<number, VictimSignupItem[]>();
    const victimsByEventId = new Map<string, VictimInEvent[]>();
    const eventById = new Map<string, CalendarEvent>();

    for (const rival of rivals) {
      const items = raw.rawByRider.get(rival.id) ?? [];
      const seenForRider = new Set<string>();
      const riderUpcoming: VictimSignupItem[] = [];

      for (const rawItem of items) {
        const normalized = normalizeZpEventToCalendarEvent(rawItem, undefined, effectiveRouteMap);
        if (!normalized || normalized.startSec < cutoffSec) continue;
        if (seenForRider.has(normalized.eventId)) continue;
        seenForRider.add(normalized.eventId);

        const penLookup = raw.penLookupByEvent.get(normalized.eventId);
        const riderPenInfo = penLookup?.get(rival.id);
        const enrichedTotal =
          penLookup && penLookup.size > 0
            ? Math.max(normalized.totalSignups, penLookup.size)
            : normalized.totalSignups;

        const finalEvent =
          enrichedTotal !== normalized.totalSignups
            ? { ...normalized, totalSignups: enrichedTotal }
            : normalized;

        if (!eventById.has(finalEvent.eventId)) {
          eventById.set(finalEvent.eventId, finalEvent);
        } else {
          const prev = eventById.get(finalEvent.eventId)!;
          if (finalEvent.totalSignups > prev.totalSignups) {
            eventById.set(finalEvent.eventId, { ...prev, totalSignups: finalEvent.totalSignups });
          }
        }

        const pen = riderPenInfo?.pen;
        riderUpcoming.push({
          event: finalEvent,
          pen,
          userAlsoSignedUp: mySignedUpEventIds.has(finalEvent.eventId),
        });

        const existingVictims = victimsByEventId.get(finalEvent.eventId) ?? [];
        if (!existingVictims.some((v) => v.rider.id === rival.id)) {
          existingVictims.push({ rider: rival, pen });
          victimsByEventId.set(finalEvent.eventId, existingVictims);
        }
      }

      riderUpcoming.sort((a, b) => a.event.startSec - b.event.startSec);
      signupsByRiderId.set(rival.id, riderUpcoming);
    }

    const groupedUpcomingEvents: GroupedVictimEvent[] = Array.from(victimsByEventId.entries())
      .map(([eventId, victims]) => ({
        event: eventById.get(eventId)!,
        victims,
        userSignedUp: mySignedUpEventIds.has(eventId),
      }))
      .filter((g) => Boolean(g.event))
      .sort((a, b) => a.event.startSec - b.event.startSec);

    return {
      signupsByRiderId,
      victimsByEventId,
      groupedUpcomingEvents,
      mySignedUpEventIds,
    };
  }, [entry, requestKey, ownProfileId, rivals, effectiveRouteMap]);

  const refresh = useCallback(() => {
    riderSignupsCache.delete(ownProfileId);
    for (const r of rivals) {
      riderSignupsCache.delete(r.id);
    }
    eventSignupsCache.clear();
    setReloadNonce((n) => n + 1);
  }, [ownProfileId, rivals]);

  return {
    ...derived,
    loading: ownProfileId > 0 && (entry.key !== requestKey || entry.loading),
    errorCount: entry.key === requestKey ? (entry.data?.errorCount ?? 0) : 0,
    lastUpdatedAt: entry.key === requestKey ? (entry.data?.fetchedAt ?? null) : null,
    refresh,
  };
}
