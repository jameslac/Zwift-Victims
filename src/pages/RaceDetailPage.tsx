import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  AuthError,
  fetchActivityDetail,
  fetchProfileById,
  fetchPublicEvent,
  fetchRaceResults,
  fetchRiderActivities,
  getCachedProfileById,
} from '../api/zwiftCore';
import type {
  ZwiftActivity,
  ZwiftActivityDetail,
  ZwiftProfile,
  ZwiftPublicEvent,
  ZwiftRaceResultEntry,
} from '../api/zwiftCore';
import { fetchZwiftPowerEventResults, fetchZwiftPowerRaces } from '../api/zwiftPower';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import { fetchZwiftRacingEvent, fetchZwiftRacingRider } from '../api/zwiftRacing';
import type {
  ZwiftRacingEventPen,
  ZwiftRacingEventResponse,
  ZwiftRacingEventRider,
  ZwiftRacingRiderResponse,
} from '../api/zwiftRacing';
import { useAuth } from '../auth/AuthContext';
import RaceDetailStandings from '../components/RaceDetailStandings';
import RacePowerCurve from '../components/RacePowerCurve';
import RaceRatingsSection from '../components/RaceRatingsSection';
import { AppHeader, MetricGrid, PlacingBadge, RaceExternalLinks } from '../components/RaceUi';
import {
  decodeHtmlEntities,
  extractActivityPhotos,
  extractCoreZrs,
  formatGapSeconds,
  formatUnixSeconds,
  matchActivityForRace,
  ordinal,
  resolveSubgroupForCategory,
  zpNum,
  zpVal,
} from '../lib/raceHistory';
import type { AsyncState, MergedRace } from '../lib/raceHistory';
import { buildPenOptions, makeSplit, mergePenStandings } from '../lib/raceStandings';
import type { ExpectedPositionMode, PenOption, PowerCurveSplits } from '../lib/raceStandings';
import {
  formatDistance,
  formatDurationMs,
  formatElevation,
  formatWeight,
} from '../lib/units';
import { useUnits } from '../lib/UnitsContext';

type KeyedState<T> = { key: string; state: AsyncState<T> };

const LOADING_STATE: AsyncState<never> = { status: 'loading' };
const EXPECTED_MODE_STORAGE_KEY = 'zv.raceDetail.expectedMode';

function loadExpectedMode(): ExpectedPositionMode {
  try {
    return localStorage.getItem(EXPECTED_MODE_STORAGE_KEY) === 'route' ? 'route' : 'overall';
  } catch {
    return 'overall';
  }
}

function readKeyed<T>(raw: KeyedState<T> | null, expectedKey: string): AsyncState<T> {
  return raw && raw.key === expectedKey ? raw.state : LOADING_STATE;
}

function findZrEventMatch(
  zrEvent: ZwiftRacingEventResponse | null,
  riderId: number | null,
): { pen?: ZwiftRacingEventPen; rider?: ZwiftRacingEventRider } {
  if (!zrEvent || riderId === null) return {};
  for (const pen of zrEvent.pens ?? []) {
    const rider = pen.riders?.find((r) => Number(r.riderId) === riderId);
    if (rider) return { pen, rider };
  }
  return {};
}

function toErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function asNumericIdString(val: unknown): string | undefined {
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) return val.trim();
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return String(val);
  return undefined;
}

export default function RaceDetailPage() {
  const { loading: authLoading, profile, logout, getAccessToken } = useAuth();
  const { riderId: riderIdParam, eventId } = useParams<{ riderId?: string; eventId?: string }>();
  const location = useLocation();
  const passedRace = (location.state as { race?: MergedRace } | null)?.race;

  const validEventId = Boolean(eventId && /^\d+$/.test(eventId));
  const validRiderParam = !riderIdParam || /^\d+$/.test(riderIdParam);
  const targetRiderId =
    riderIdParam && /^\d+$/.test(riderIdParam) ? Number(riderIdParam) : (profile?.id ?? null);
  const isOwnProfile = Boolean(profile && targetRiderId === profile.id);
  const raceKey =
    profile && targetRiderId !== null && validEventId ? `${targetRiderId}:${eventId}` : '';

  const { units, setUnits } = useUnits(profile?.useMetric === false ? 'imperial' : 'metric');

  const [remoteProfileRaw, setRemoteProfileRaw] = useState<KeyedState<ZwiftProfile> | null>(null);
  const [zpRacesRaw, setZpRacesRaw] = useState<KeyedState<ZwiftPowerRaceEntry[]> | null>(null);
  const [zrRiderRaw, setZrRiderRaw] = useState<KeyedState<ZwiftRacingRiderResponse> | null>(null);
  const [zrEventRaw, setZrEventRaw] =
    useState<KeyedState<ZwiftRacingEventResponse | null> | null>(null);
  const [zpViewRaw, setZpViewRaw] = useState<KeyedState<ZwiftPowerRaceEntry[]> | null>(null);
  const [zpZwiftRaw, setZpZwiftRaw] = useState<KeyedState<ZwiftPowerRaceEntry[]> | null>(null);
  const [publicEventRaw, setPublicEventRaw] = useState<KeyedState<ZwiftPublicEvent> | null>(null);
  const [activitiesRaw, setActivitiesRaw] = useState<KeyedState<ZwiftActivity[]> | null>(null);

  const [penChoice, setPenChoice] = useState<{
    raceKey: string;
    subgroupId: number | null;
    category?: string;
  } | null>(null);
  const [coreResultsRaw, setCoreResultsRaw] = useState<KeyedState<ZwiftRaceResultEntry[]> | null>(
    null,
  );
  const [activityDetailRaw, setActivityDetailRaw] =
    useState<KeyedState<ZwiftActivityDetail> | null>(null);
  const [expectedMode, setExpectedMode] = useState<ExpectedPositionMode>(loadExpectedMode);
  const [penProfilesMap, setPenProfilesMap] = useState<Map<number, ZwiftProfile>>(() => new Map());
  const [visibleCandidateKey, setVisibleCandidateKey] = useState<string>('');
  const failedProfileIdsRef = useRef<Set<number>>(new Set());

  const toggleExpectedMode = useCallback(() => {
    setExpectedMode((prev) => {
      const next: ExpectedPositionMode = prev === 'route' ? 'overall' : 'route';
      try {
        localStorage.setItem(EXPECTED_MODE_STORAGE_KEY, next);
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!raceKey || targetRiderId === null || !eventId) return;
    let cancelled = false;

    if (!isOwnProfile) {
      getAccessToken()
        .then((token) => fetchProfileById(token, targetRiderId))
        .then((data) => {
          if (!cancelled) setRemoteProfileRaw({ key: raceKey, state: { status: 'loaded', data } });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setRemoteProfileRaw({
              key: raceKey,
              state: { status: 'error', message: toErrMsg(err, 'Failed to load rider profile.') },
            });
          }
        });
    }

    fetchZwiftPowerRaces(targetRiderId)
      .then((data) => {
        if (!cancelled) setZpRacesRaw({ key: raceKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZpRacesRaw({
            key: raceKey,
            state: { status: 'error', message: toErrMsg(err, 'Failed to load ZwiftPower history.') },
          });
        }
      });

    fetchZwiftRacingRider(targetRiderId)
      .then((data) => {
        if (!cancelled) setZrRiderRaw({ key: raceKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZrRiderRaw({
            key: raceKey,
            state: { status: 'error', message: toErrMsg(err, 'Failed to load ZwiftRacing data.') },
          });
        }
      });

    fetchZwiftRacingEvent(eventId)
      .then((data) => {
        if (!cancelled) setZrEventRaw({ key: raceKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZrEventRaw({
            key: raceKey,
            state: {
              status: 'error',
              message: toErrMsg(err, 'Failed to load ZwiftRacing event.'),
            },
          });
        }
      });

    fetchZwiftPowerEventResults(eventId, 'view')
      .then((data) => {
        if (!cancelled) setZpViewRaw({ key: raceKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZpViewRaw({
            key: raceKey,
            state: { status: 'error', message: toErrMsg(err, 'Failed to load ZwiftPower results.') },
          });
        }
      });

    fetchZwiftPowerEventResults(eventId, 'zwift')
      .then((data) => {
        if (!cancelled) setZpZwiftRaw({ key: raceKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZpZwiftRaw({
            key: raceKey,
            state: {
              status: 'error',
              message: toErrMsg(err, 'Failed to load unfiltered ZwiftPower results.'),
            },
          });
        }
      });

    getAccessToken()
      .then((token) => fetchPublicEvent(token, eventId))
      .then((data) => {
        if (!cancelled) setPublicEventRaw({ key: raceKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPublicEventRaw({
            key: raceKey,
            state: { status: 'error', message: toErrMsg(err, 'Failed to load Zwift event.') },
          });
        }
      });

    getAccessToken()
      .then((token) => fetchRiderActivities(token, targetRiderId, { start: 0, limit: 50 }))
      .then((data) => {
        if (!cancelled) setActivitiesRaw({ key: raceKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setActivitiesRaw({
            key: raceKey,
            state: { status: 'error', message: toErrMsg(err, 'Failed to load rider activities.') },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [raceKey, targetRiderId, eventId, isOwnProfile, getAccessToken]);

  const targetProfileState: AsyncState<ZwiftProfile> = useMemo(() => {
    if (isOwnProfile && profile) return { status: 'loaded', data: profile };
    return readKeyed(remoteProfileRaw, raceKey);
  }, [isOwnProfile, profile, remoteProfileRaw, raceKey]);

  const zpRacesState = readKeyed(zpRacesRaw, raceKey);
  const zrRiderState = readKeyed(zrRiderRaw, raceKey);
  const zrEventState = readKeyed(zrEventRaw, raceKey);
  const zpViewState = readKeyed(zpViewRaw, raceKey);
  const zpZwiftState = readKeyed(zpZwiftRaw, raceKey);
  const publicEventState = readKeyed(publicEventRaw, raceKey);
  const activitiesState = readKeyed(activitiesRaw, raceKey);

  const zpProfileEntry = useMemo(() => {
    if (zpRacesState.status === 'loaded' && eventId) {
      return zpRacesState.data.find((r) => String(r.zid ?? '') === eventId);
    }
    return passedRace?.eventId === eventId ? passedRace?.zp : undefined;
  }, [zpRacesState, eventId, passedRace]);

  const zrEntry = useMemo(() => {
    if (zrRiderState.status === 'loaded' && eventId) {
      const history = zrRiderState.data.overview?.history ?? [];
      return history.find((r) => String(r.event?.eventId ?? '') === eventId);
    }
    return passedRace?.eventId === eventId ? passedRace?.zr : undefined;
  }, [zrRiderState, eventId, passedRace]);

  const zrEventData = zrEventState.status === 'loaded' ? zrEventState.data : null;
  const zrEventMatch = useMemo(
    () => findZrEventMatch(zrEventData, targetRiderId),
    [zrEventData, targetRiderId],
  );

  const zpViewEntry = useMemo(() => {
    if (zpViewState.status !== 'loaded' || targetRiderId === null) return undefined;
    return zpViewState.data.find((e) => Number(e.zwid) === targetRiderId);
  }, [zpViewState, targetRiderId]);

  const zpZwiftEntry = useMemo(() => {
    if (zpZwiftState.status !== 'loaded' || targetRiderId === null) return undefined;
    return zpZwiftState.data.find((e) => Number(e.zwid) === targetRiderId);
  }, [zpZwiftState, targetRiderId]);

  const bestZpEntry = zpProfileEntry ?? zpViewEntry ?? zpZwiftEntry;
  const riderCategory =
    bestZpEntry?.category ?? zrEntry?.event?.subgroupId ?? zrEventMatch.pen?.name;

  const matchedActivity = useMemo(() => {
    if (activitiesState.status !== 'loaded') return undefined;
    const subgroupIds =
      publicEventState.status === 'loaded'
        ? (publicEventState.data.eventSubgroups ?? []).map((sg) => sg.id)
        : [];
    const publicEventDateSec =
      publicEventState.status === 'loaded' && publicEventState.data.eventStart
        ? Math.floor(Date.parse(publicEventState.data.eventStart) / 1000)
        : undefined;
    const zrEventData = zrEventState.status === 'loaded' ? zrEventState.data : null;
    const raceDateSec =
      bestZpEntry?.event_date ?? zrEntry?.event?.time ?? zrEventData?.time ?? publicEventDateSec;
    const eventTitle =
      bestZpEntry?.event_title ??
      zrEntry?.event?.title ??
      zrEventData?.title ??
      (publicEventState.status === 'loaded' ? publicEventState.data.name : undefined);
    return matchActivityForRace(activitiesState.data, {
      subgroupIds,
      raceDateSec,
      eventTitle,
    });
  }, [activitiesState, publicEventState, zrEventState, bestZpEntry, zrEntry]);

  const defaultSubgroupId = useMemo(() => {
    const subgroups =
      publicEventState.status === 'loaded' ? (publicEventState.data.eventSubgroups ?? []) : [];
    const byCategory = resolveSubgroupForCategory(subgroups, riderCategory);
    if (byCategory?.id) return byCategory.id;
    if (zrEventMatch.pen?.id && /^\d+$/.test(String(zrEventMatch.pen.id))) {
      return Number(zrEventMatch.pen.id);
    }
    if (typeof matchedActivity?.eventSubgroupId === 'number' && matchedActivity.eventSubgroupId > 0) {
      return matchedActivity.eventSubgroupId;
    }
    if (subgroups[0]?.id) return subgroups[0].id;
    const zrFirstId = zrEventState.status === 'loaded' ? zrEventState.data?.pens?.[0]?.id : undefined;
    return zrFirstId && /^\d+$/.test(String(zrFirstId)) ? Number(zrFirstId) : null;
  }, [publicEventState, zrEventState, zrEventMatch.pen, riderCategory, matchedActivity]);

  const selectedSubgroupId =
    penChoice && penChoice.raceKey === raceKey ? penChoice.subgroupId : defaultSubgroupId;
  const selectedCategory =
    penChoice && penChoice.raceKey === raceKey ? penChoice.category : riderCategory;

  const subgroupKey =
    raceKey && selectedSubgroupId !== null ? `${raceKey}:${selectedSubgroupId}` : '';

  useEffect(() => {
    if (!subgroupKey || selectedSubgroupId === null) return;
    let cancelled = false;
    getAccessToken()
      .then((token) => fetchRaceResults(token, selectedSubgroupId))
      .then((data) => {
        if (!cancelled) setCoreResultsRaw({ key: subgroupKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCoreResultsRaw({
            key: subgroupKey,
            state: { status: 'error', message: toErrMsg(err, 'Failed to load subgroup results.') },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [subgroupKey, selectedSubgroupId, getAccessToken]);

  const coreResultsState: AsyncState<ZwiftRaceResultEntry[]> | null = useMemo(() => {
    if (selectedSubgroupId !== null) return readKeyed(coreResultsRaw, subgroupKey);
    if (
      publicEventState.status === 'loading' ||
      zrEventState.status === 'loading' ||
      activitiesState.status === 'loading'
    ) {
      return { status: 'loading' };
    }
    return null;
  }, [
    selectedSubgroupId,
    coreResultsRaw,
    subgroupKey,
    publicEventState.status,
    zrEventState.status,
    activitiesState.status,
  ]);

  const myCoreEntry = useMemo(() => {
    if (coreResultsState?.status !== 'loaded' || targetRiderId === null) return undefined;
    return coreResultsState.data.find((e) => Number(e.profileId) === targetRiderId);
  }, [coreResultsState, targetRiderId]);

  const activityIdStr = useMemo(() => {
    return (
      asNumericIdString(matchedActivity?.id_str) ??
      asNumericIdString(myCoreEntry?.activityData?.activityIdStr) ??
      asNumericIdString(matchedActivity?.id) ??
      asNumericIdString(myCoreEntry?.activityData?.activityId) ??
      asNumericIdString(passedRace?.eventId === eventId ? passedRace?.activityId : undefined) ??
      null
    );
  }, [matchedActivity, myCoreEntry, passedRace, eventId]);

  useEffect(() => {
    if (!activityIdStr) return;
    let cancelled = false;
    getAccessToken()
      .then((token) => fetchActivityDetail(token, activityIdStr))
      .then((data) => {
        if (!cancelled) {
          setActivityDetailRaw({ key: activityIdStr, state: { status: 'loaded', data } });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setActivityDetailRaw({
            key: activityIdStr,
            state: { status: 'error', message: toErrMsg(err, 'Failed to load activity detail.') },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activityIdStr, getAccessToken]);

  const activityDetailState: AsyncState<ZwiftActivityDetail> | null = useMemo(() => {
    if (activityIdStr) return readKeyed(activityDetailRaw, activityIdStr);
    if (activitiesState.status === 'loading' || coreResultsState?.status === 'loading') {
      return { status: 'loading' };
    }
    return null;
  }, [activityIdStr, activityDetailRaw, activitiesState.status, coreResultsState?.status]);

  const targetProfile =
    targetProfileState.status === 'loaded' ? targetProfileState.data : undefined;
  const publicEvent = publicEventState.status === 'loaded' ? publicEventState.data : undefined;
  const zrEvent = zrEventState.status === 'loaded' ? zrEventState.data : null;
  const zrEventRider = zrEventMatch.rider;
  const zrEventPen = zrEventMatch.pen;
  const activityDetail =
    activityDetailState?.status === 'loaded' ? activityDetailState.data : undefined;
  const selectedSubgroup = publicEvent?.eventSubgroups?.find((sg) => sg.id === selectedSubgroupId);

  const raceWeightGrams =
    zpNum(bestZpEntry?.weight) != null
      ? zpNum(bestZpEntry?.weight)! * 1000
      : zrEntry?.race?.weight != null
        ? zrEntry.race.weight * 1000
        : zrEventRider?.weight != null
          ? zrEventRider.weight * 1000
          : myCoreEntry?.profileData?.weightInGrams;
  const raceWeightKg = raceWeightGrams != null ? raceWeightGrams / 1000 : undefined;

  const eventDistanceMeters = useMemo(() => {
    if (bestZpEntry?.distance != null) return bestZpEntry.distance * 1000;
    if (zrEntry?.race?.distance != null) return zrEntry.race.distance * 1000;
    if (zrEventRider?.distance != null) return zrEventRider.distance * 1000;
    if (zrEntry?.event?.distance != null) return zrEntry.event.distance * 1000;
    if (zrEvent?.distance != null) return zrEvent.distance * 1000;
    if (myCoreEntry?.activityData?.segmentDistanceInCentimeters != null) {
      return myCoreEntry.activityData.segmentDistanceInCentimeters / 100;
    }
    return selectedSubgroup?.distanceInMeters ?? publicEvent?.distanceInMeters;
  }, [
    bestZpEntry?.distance,
    zrEntry?.race?.distance,
    zrEntry?.event?.distance,
    zrEventRider?.distance,
    zrEvent?.distance,
    myCoreEntry?.activityData?.segmentDistanceInCentimeters,
    selectedSubgroup?.distanceInMeters,
    publicEvent?.distanceInMeters,
  ]);

  const zpViewList = useMemo(
    () => (zpViewState.status === 'loaded' ? zpViewState.data : []),
    [zpViewState],
  );
  const zpZwiftList = useMemo(
    () => (zpZwiftState.status === 'loaded' ? zpZwiftState.data : []),
    [zpZwiftState],
  );
  const coreList = useMemo(
    () => (coreResultsState?.status === 'loaded' ? coreResultsState.data : []),
    [coreResultsState],
  );

  const { penSystem, pens } = useMemo(
    () => buildPenOptions(publicEvent, zrEvent, zpViewList, zpZwiftList),
    [publicEvent, zrEvent, zpViewList, zpZwiftList],
  );

  const activePen = useMemo(() => {
    if (pens.length === 0) return null;
    if (selectedSubgroupId != null) {
      const bySg = pens.find((p) => p.subgroupId === selectedSubgroupId);
      if (bySg) return bySg;
    }
    if (selectedCategory) {
      const base = selectedCategory.trim().toUpperCase().replace(/\+$/, '');
      const byCat = pens.find((p) => p.category?.toUpperCase() === base);
      if (byCat) return byCat;
    }
    return pens[0];
  }, [pens, selectedSubgroupId, selectedCategory]);

  const activeZrPen = useMemo(() => {
    const pensList = zrEvent?.pens;
    if (!pensList || pensList.length === 0) return undefined;
    if (selectedSubgroupId != null) {
      const byId = pensList.find((p) => Number(p.id) === selectedSubgroupId);
      if (byId) return byId;
    }
    const cat = (selectedCategory ?? riderCategory)?.trim().toUpperCase().replace(/\+$/, '');
    if (cat) {
      const byName = pensList.find(
        (p) => p.name?.trim().toUpperCase().replace(/\+$/, '') === cat,
      );
      if (byName) return byName;
    }
    return pensList[0];
  }, [zrEvent, selectedSubgroupId, selectedCategory, riderCategory]);

  const effectiveRiderProfiles = useMemo(() => {
    const merged = new Map<number, ZwiftProfile>(penProfilesMap);
    const addIfCached = (idVal: unknown) => {
      const id = Number(idVal);
      if (!Number.isFinite(id) || id <= 0 || merged.has(id)) return;
      const cached = getCachedProfileById(id);
      if (cached) merged.set(id, cached);
    };
    for (const c of coreList) addIfCached(c.profileId);
    for (const pen of zrEvent?.pens ?? []) {
      for (const r of pen.riders ?? []) addIfCached(r.riderId);
    }
    for (const z of zpViewList) addIfCached(z.zwid);
    for (const z of zpZwiftList) addIfCached(z.zwid);
    return merged;
  }, [penProfilesMap, coreList, zrEvent, zpViewList, zpZwiftList]);

  const combinedRows = useMemo(
    () =>
      mergePenStandings({
        selectedPen: activePen,
        totalPensCount: pens.length,
        coreResults: coreList,
        zrEvent,
        zpViewResults: zpViewList,
        zpZwiftResults: zpZwiftList,
        zpViewLoaded: zpViewState.status === 'loaded',
        targetRiderId: targetRiderId ?? 0,
        targetProfile,
        loggedInProfile: profile,
        riderProfiles: effectiveRiderProfiles,
        eventDistanceMeters,
        targetActivityDetail: activityDetail,
      }),
    [
      activePen,
      pens.length,
      coreList,
      zrEvent,
      zpViewList,
      zpZwiftList,
      zpViewState.status,
      targetRiderId,
      targetProfile,
      profile,
      effectiveRiderProfiles,
      eventDistanceMeters,
      activityDetail,
    ],
  );

  // Wait for ZwiftPower results to settle, then look up Zwift Core profiles only for visible-page riders still missing a category.
  useEffect(() => {
    if (
      !raceKey ||
      zpViewState.status === 'loading' ||
      zpZwiftState.status === 'loading' ||
      !visibleCandidateKey
    ) {
      return;
    }
    const toFetch = visibleCandidateKey
      .split(',')
      .map(Number)
      .filter(
        (id) =>
          Number.isFinite(id) &&
          id > 0 &&
          !getCachedProfileById(id) &&
          !failedProfileIdsRef.current.has(id),
      );
    if (toFetch.length === 0) return;

    let cancelled = false;

    (async () => {
      let token: string;
      try {
        token = await getAccessToken();
      } catch {
        return;
      }
      if (cancelled) return;

      let nextIdx = 0;
      const concurrency = Math.min(6, toFetch.length);

      async function worker() {
        while (!cancelled) {
          const idx = nextIdx++;
          if (idx >= toFetch.length) return;
          const id = toFetch[idx];
          if (getCachedProfileById(id) || failedProfileIdsRef.current.has(id)) continue;
          try {
            const loaded = await fetchProfileById(token, id);
            if (!cancelled) {
              setPenProfilesMap((prev) => {
                if (prev.get(id) === loaded) return prev;
                const next = new Map(prev);
                next.set(id, loaded);
                return next;
              });
            }
          } catch (err) {
            if (err instanceof AuthError) {
              cancelled = true;
              return;
            }
            failedProfileIdsRef.current.add(id);
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    })();

    return () => {
      cancelled = true;
    };
  }, [raceKey, zpViewState.status, zpZwiftState.status, visibleCandidateKey, getAccessToken]);

  const targetFallbackSplits = useMemo<PowerCurveSplits>(() => {
    const zp = bestZpEntry;
    const zrR = zrEntry?.race ?? zrEventRider;
    const cp = myCoreEntry?.criticalP;
    return {
      s5: makeSplit(zp?.w5, zp?.wkg5, zrR?.wkg5, undefined, raceWeightKg),
      s15: makeSplit(zp?.w15, zp?.wkg15, zrR?.wkg15, cp?.criticalP15Seconds, raceWeightKg),
      s30: makeSplit(zp?.w30, zp?.wkg30, zrR?.wkg30, undefined, raceWeightKg),
      m1: makeSplit(zp?.w60, zp?.wkg60, zrR?.wkg60, cp?.criticalP1Minute, raceWeightKg),
      m2: makeSplit(zp?.w120, zp?.wkg120, zrR?.wkg120, undefined, raceWeightKg),
      m5: makeSplit(zp?.w300, zp?.wkg300, zrR?.wkg300, cp?.criticalP5Minutes, raceWeightKg),
      m20: makeSplit(zp?.w1200, zp?.wkg1200, zrR?.wkg1200, cp?.criticalP20Minutes, raceWeightKg),
    };
  }, [bestZpEntry, zrEntry, zrEventRider, myCoreEntry, raceWeightKg]);

  const standingsAnyLoading =
    coreResultsState?.status === 'loading' ||
    zpViewState.status === 'loading' ||
    zpZwiftState.status === 'loading' ||
    zrEventState.status === 'loading';

  function handleSelectPen(pen: PenOption) {
    setPenChoice({ raceKey, subgroupId: pen.subgroupId, category: pen.category });
  }

  if (authLoading) {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">Loading…</main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
          <h1 className="text-xl font-extrabold">Log in to view race details</h1>
          <p className="text-sm text-slate-400">
            Zwift Core race results and activity telemetry require your Zwift session.
          </p>
          <Link
            to="/login"
            className="inline-block rounded-lg bg-[#fc6719] px-5 py-2.5 text-sm font-bold text-white"
          >
            Log in with Zwift
          </Link>
        </div>
      </main>
    );
  }

  if (!validEventId || !validRiderParam || targetRiderId === null) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <p className="text-red-400 text-sm">Invalid rider or event ID in URL.</p>
          <Link
            to="/"
            className="inline-block rounded-lg bg-[#fc6719] px-4 py-2 text-sm font-bold text-white"
          >
            Back to profile
          </Link>
        </div>
      </main>
    );
  }

  const backPath = isOwnProfile ? '/' : `/riders/${targetRiderId}`;
  const historyPath = isOwnProfile ? '/history' : `/riders/${targetRiderId}/history`;
  const rawRiderName = targetProfile
    ? [targetProfile.firstName, targetProfile.lastName].filter(Boolean).join(' ') ||
      `Rider ${targetRiderId}`
    : bestZpEntry?.name || zrEventMatch.rider?.name || `Rider ${targetRiderId}`;
  const riderName = decodeHtmlEntities(rawRiderName);

  const raceTitle = decodeHtmlEntities(
    bestZpEntry?.event_title ||
      zrEntry?.event?.title ||
      zrEvent?.title ||
      publicEvent?.name ||
      activityDetail?.eventInfo?.name ||
      `Event ${eventId}`,
  );
  const raceDateSec =
    bestZpEntry?.event_date ??
    zrEntry?.event?.time ??
    zrEvent?.time ??
    (publicEvent?.eventStart ? Math.floor(Date.parse(publicEvent.eventStart) / 1000) : undefined);

  const zrDidNotFinish = zrEntry?.place?.didNotFinish ?? zrEventRider?.didNotFinish;
  const zrDisqualified = zrEntry?.place?.disqualified ?? zrEventRider?.disqualified;
  const truePlace =
    zrEntry?.place?.positionInCategory ??
    (!zrDidNotFinish && !zrDisqualified && zrEventRider?.position && zrEventRider.position > 0
      ? zrEventRider.position
      : undefined);
  const zrFieldSize =
    zrEntry?.place?.penTotal ?? zrEventPen?.results?.count ?? zrEventPen?.riders?.length;

  const coreRank = myCoreEntry?.rank;
  const coreFieldSize =
    coreResultsState?.status === 'loaded' ? coreResultsState.data.length : undefined;
  const zpPlace =
    typeof bestZpEntry?.position_in_cat === 'number' ? bestZpEntry.position_in_cat : undefined;

  const bestVerifiedPlace = truePlace ?? coreRank;
  const bestVerifiedSource =
    truePlace != null ? 'ZwiftRacing' : coreRank != null ? 'Zwift Core unfiltered' : undefined;
  const inflation =
    bestVerifiedPlace != null && zpPlace != null ? bestVerifiedPlace - zpPlace : undefined;

  const timeSec =
    zpNum(bestZpEntry?.time) ??
    zrEntry?.race?.time ??
    zrEventRider?.time ??
    (myCoreEntry?.activityData?.durationInMilliseconds != null
      ? myCoreEntry.activityData.durationInMilliseconds / 1000
      : undefined);
  const gapSec = bestZpEntry?.gap ?? zrEntry?.race?.gap ?? zrEventRider?.gap;
  const elevationMeters =
    zrEntry?.event?.elevation ??
    zrEvent?.elevation ??
    (myCoreEntry?.activityData?.elevationInCentimeters != null
      ? myCoreEntry.activityData.elevationInCentimeters / 100
      : matchedActivity?.totalElevation);

  const avgPower =
    zpVal(bestZpEntry?.avg_power) ??
    (myCoreEntry?.sensorData?.avgWatts != null
      ? Math.round(myCoreEntry.sensorData.avgWatts)
      : zrEventRider?.wkgAvg != null && raceWeightKg
        ? Math.round(zrEventRider.wkgAvg * raceWeightKg)
        : undefined);
  const np =
    zpVal(bestZpEntry?.np) ??
    (zrEventRider?.np != null && zrEventRider.np > 0 ? Math.round(zrEventRider.np) : undefined);
  const maxWatts =
    activityDetail?.maxWatts != null
      ? Math.round(activityDetail.maxWatts)
      : matchedActivity?.maxWatts != null
        ? Math.round(matchedActivity.maxWatts)
        : undefined;
  const avgWkg =
    zpVal(bestZpEntry?.avg_wkg) ??
    (zrEntry?.race?.wkgAvg != null
      ? zrEntry.race.wkgAvg.toFixed(2)
      : zrEventRider?.wkgAvg != null
        ? zrEventRider.wkgAvg.toFixed(2)
        : undefined) ??
    (myCoreEntry?.sensorData?.avgWatts != null && myCoreEntry?.profileData?.weightInGrams
      ? (myCoreEntry.sensorData.avgWatts / (myCoreEntry.profileData.weightInGrams / 1000)).toFixed(2)
      : undefined);
  const raceFtp = zpVal(bestZpEntry?.wftp) ?? bestZpEntry?.ftp ?? activityDetail?.profileFtp;
  const calories = myCoreEntry?.activityData?.calories ?? matchedActivity?.calories;
  const movingTimeMs = matchedActivity?.movingTimeInMs;

  const avgPowerNum = avgPower !== undefined && avgPower !== '' ? Number(avgPower) : undefined;
  const npNum = np !== undefined && np !== '' ? Number(np) : undefined;
  const avgNpText =
    avgPowerNum != null && Number.isFinite(avgPowerNum) && npNum != null && Number.isFinite(npNum)
      ? `${Math.round(avgPowerNum)} / ${Math.round(npNum)} W`
      : avgPowerNum != null && Number.isFinite(avgPowerNum)
        ? `${Math.round(avgPowerNum)} W`
        : npNum != null && Number.isFinite(npNum)
          ? `— / ${Math.round(npNum)} W`
          : undefined;

  const rawAvgCad = activityDetail?.avgCadenceInRotationsPerMinute ?? matchedActivity?.avgCadence;
  const rawMaxCad = activityDetail?.maxCadenceInRotationsPerMinute ?? matchedActivity?.maxCadence;
  const avgCadence =
    typeof rawAvgCad === 'number' && Number.isFinite(rawAvgCad) && rawAvgCad > 0
      ? Math.round(rawAvgCad)
      : undefined;
  const maxCadence =
    typeof rawMaxCad === 'number' && Number.isFinite(rawMaxCad) && rawMaxCad > 0
      ? Math.round(rawMaxCad)
      : undefined;
  const cadenceText =
    avgCadence != null && maxCadence != null
      ? `${avgCadence} / ${maxCadence} rpm`
      : avgCadence != null
        ? `${avgCadence} rpm`
        : maxCadence != null
          ? `— / ${maxCadence} rpm`
          : undefined;

  const coreZrs = extractCoreZrs(myCoreEntry);

  const activityPhotos = extractActivityPhotos(matchedActivity, activityDetail);
  const eventImageUrl = zrEntry?.event?.imageUrl || zrEvent?.imageUrl || publicEvent?.imageUrl;
  const galleryPhotos = [
    ...activityPhotos,
    ...(eventImageUrl && !activityPhotos.some((p) => p.url === eventImageUrl)
      ? [{ url: eventImageUrl, label: 'Official event banner' }]
      : []),
  ];

  const routeName = zrEntry?.event?.routeName ?? zrEvent?.route?.name;
  const worldName = zrEvent?.route?.world;
  const eventSubType = zrEntry?.event?.subType ?? zrEvent?.subType;
  const laps =
    zrEntry?.event?.numLaps ??
    zrEvent?.numLaps ??
    (bestZpEntry?.laps ? Number(bestZpEntry.laps) : undefined) ??
    selectedSubgroup?.laps ??
    publicEvent?.laps ??
    activityDetail?.eventInfo?.laps;

  const hasZrEvent = Boolean(zrEntry || zrEvent);
  const linkZpZid =
    bestZpEntry?.zid != null
      ? String(bestZpEntry.zid)
      : zpViewList.length > 0 || zpZwiftList.length > 0
        ? eventId
        : undefined;
  const linkZrEventId = hasZrEvent
    ? String(zrEntry?.event?.eventId ?? zrEvent?.eventId ?? eventId)
    : undefined;
  const linkZrSubgroup = hasZrEvent
    ? (zrEntry?.event?.subgroupId ?? zrEventPen?.name ?? riderCategory ?? activePen?.category)
    : undefined;

  return (
    <main className="min-h-dvh max-w-6xl mx-auto p-4 sm:p-8 pb-24 md:pb-12 space-y-6">
      <AppHeader
        isOwnProfile={isOwnProfile}
        targetRiderId={targetRiderId ?? undefined}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        backTo={historyPath}
        backLabel="← History"
      />

      {/* Hero Header */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs text-slate-400">
              Race Details ·{' '}
              <Link to={backPath} className="text-accent-text hover:underline font-medium">
                {riderName}
              </Link>{' '}
              (ID {targetRiderId})
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold">{raceTitle}</h1>
            <p className="text-xs text-slate-400">
              {formatUnixSeconds(raceDateSec)}
              {riderCategory ? ` · Cat ${riderCategory}` : ''}
              {eventSubType ? ` · ${eventSubType}` : ''}
              {routeName ? ` · ${routeName}` : ''}
              {worldName ? ` (${worldName})` : ''}
              {laps ? ` · ${laps} lap${laps === 1 ? '' : 's'}` : ''}
              {bestZpEntry?.tname ? ` · Team ${decodeHtmlEntities(bestZpEntry.tname)}` : ''}
              {` · event ${eventId}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <PlacingBadge
              truePlace={bestVerifiedPlace}
              fieldSize={truePlace != null ? zrFieldSize : coreFieldSize}
              zpPlace={zpPlace}
              didNotFinish={zrDidNotFinish}
              disqualified={zrDisqualified}
              penalty={bestZpEntry?.penalty}
            />
            {bestVerifiedPlace != null &&
              !zrDidNotFinish &&
              !zrDisqualified &&
              bestZpEntry?.penalty && (
                <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-xs font-semibold text-red-300">
                  {bestZpEntry.penalty}
                </span>
              )}
            {bestZpEntry?.upg === 1 && (
              <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-xs font-semibold text-amber-300">
                UPG
              </span>
            )}
          </div>
        </div>

        {zrEvent?.rules &&
          (zrEvent.rules.powerMeterRequired ||
            zrEvent.rules.powerupsAllowed === false ||
            zrEvent.rules.draftingDisabled) && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {zrEvent.rules.powerMeterRequired && (
                <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-slate-300">
                  Power Meter Required
                </span>
              )}
              {zrEvent.rules.powerupsAllowed === false && (
                <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-slate-300">
                  No PowerUps
                </span>
              )}
              {zrEvent.rules.draftingDisabled && (
                <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-slate-300">
                  No Drafting
                </span>
              )}
            </div>
          )}

        <RaceExternalLinks
          zpZid={linkZpZid}
          zrEventId={linkZrEventId}
          zrSubgroup={linkZrSubgroup}
          routeName={routeName}
          activityId={activityIdStr ?? undefined}
          align="start"
          showLabels
        />

        {galleryPhotos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {galleryPhotos.map((photo) => (
              <a
                key={photo.url}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-xl overflow-hidden border border-slate-800 bg-slate-950 block hover:border-[#fc6719]/70 transition-colors"
              >
                <img
                  src={photo.url}
                  alt={`${photo.label} for ${raceTitle}`}
                  loading="lazy"
                  className="w-full h-44 object-cover group-hover:opacity-95 transition-opacity"
                />
                <div className="px-3 py-1.5 text-[11px] text-slate-400 flex items-center justify-between gap-2">
                  <span className="truncate">{photo.label}</span>
                  <span className="text-[#fc6719] shrink-0 group-hover:underline">Full size ↗</span>
                </div>
              </a>
            ))}
          </div>
        )}

        {inflation != null && inflation > 0 && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200">
            ZwiftPower reports <span className="font-bold">{ordinal(zpPlace!)}</span>, which is{' '}
            <span className="font-bold">
              {inflation} place{inflation === 1 ? '' : 's'} better
            </span>{' '}
            than the {bestVerifiedSource} placing ({ordinal(bestVerifiedPlace!)}) because ZwiftPower
            drops private or non-opted-in riders.
          </div>
        )}

        <MetricGrid
          items={[
            {
              label: 'Time',
              value: timeSec != null ? formatDurationMs(timeSec * 1000) : undefined,
            },
            { label: 'Gap', value: formatGapSeconds(gapSec) },
            { label: 'Distance', value: formatDistance(eventDistanceMeters, units) },
            { label: 'Elevation', value: formatElevation(elevationMeters, units) },
            { label: 'Avg / NP', value: avgNpText },
            { label: 'Max Power', value: maxWatts !== undefined ? `${maxWatts} W` : undefined },
            { label: 'Avg W/kg', value: avgWkg !== undefined ? `${avgWkg} W/kg` : undefined },
            { label: 'Race FTP', value: raceFtp !== undefined ? `${raceFtp} W` : undefined },
            { label: 'Avg / Max Cadence', value: cadenceText },
            { label: 'Race Weight', value: formatWeight(raceWeightGrams, units) },
            {
              label: 'Calories',
              value: calories != null ? `${Math.round(calories)} kcal` : undefined,
            },
            { label: 'Moving Time', value: formatDurationMs(movingTimeMs) },
          ]}
        />
      </section>

      {/* Tier 2: Interactive Multi-Rider Power Curve */}
      <RacePowerCurve
        penKey={`${raceKey}:${activePen?.key ?? 'default'}`}
        targetRiderId={targetRiderId}
        targetRiderName={riderName}
        targetFallbackSplits={targetFallbackSplits}
        rows={combinedRows}
        hrEfficiency={zpVal(bestZpEntry?.hreff)}
      />

      {/* Tier 2: Ratings & Performance Impact */}
      <RaceRatingsSection
        zrEntry={zrEntry}
        zrEventRider={zrEventRider}
        zrEventPen={zrEventPen ?? activeZrPen}
        bestZpEntry={bestZpEntry}
        coreZrs={coreZrs}
        fallbackZrsScore={targetProfile?.competitionMetrics?.racingScore}
        bestVerifiedPlace={bestVerifiedPlace}
        expectedMode={expectedMode}
        onToggleExpectedMode={toggleExpectedMode}
      />

      {/* Tier 2: Combined Event Standings */}
      <RaceDetailStandings
        raceKey={raceKey}
        targetRiderId={targetRiderId}
        loggedInProfile={profile}
        penSystem={penSystem}
        pens={pens}
        activePen={activePen}
        combinedRows={combinedRows}
        anyLoading={standingsAnyLoading}
        zpViewLoaded={zpViewState.status === 'loaded'}
        onSelectPen={handleSelectPen}
        expectedMode={expectedMode}
        onToggleExpectedMode={toggleExpectedMode}
        onVisibleCandidateKeyChange={setVisibleCandidateKey}
        units={units}
      />
    </main>
  );
}
