import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  fetchActivityDetail,
  fetchProfileById,
  fetchPublicEvent,
  fetchRaceResults,
  fetchRiderActivities,
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
import { AppHeader, MetricGrid, PlacingBadge } from '../components/RaceUi';
import {
  decodeHtmlEntities,
  extractActivityPhotos,
  extractCoreZrs,
  formatGapSeconds,
  formatUnixSeconds,
  matchActivityForRace,
  ordinal,
  resolveSubgroupForCategory,
  subgroupCategoryLabel,
  zpNum,
  zpVal,
} from '../lib/raceHistory';
import type { AsyncState, MergedRace } from '../lib/raceHistory';
import type { PenOption } from '../lib/raceStandings';
import {
  formatDistance,
  formatDurationMs,
  formatElevation,
  formatSpeed,
  formatWeight,
} from '../lib/units';
import { useUnits } from '../lib/UnitsContext';

type KeyedState<T> = { key: string; state: AsyncState<T> };

const LOADING_STATE: AsyncState<never> = { status: 'loading' };

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

function formatBoolean(val: unknown): string | undefined {
  if (val === true || val === 1) return 'Yes';
  if (val === false || val === 0) return 'No';
  return undefined;
}

function deltaTone(val: number | undefined): 'positive' | 'negative' | undefined {
  if (val == null || !Number.isFinite(val) || val === 0) return undefined;
  return val > 0 ? 'positive' : 'negative';
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
  const targetProfile =
    targetProfileState.status === 'loaded' ? targetProfileState.data : undefined;
  const rawRiderName = targetProfile
    ? [targetProfile.firstName, targetProfile.lastName].filter(Boolean).join(' ') ||
      `Rider ${targetRiderId}`
    : bestZpEntry?.name || zrEventMatch.rider?.name || `Rider ${targetRiderId}`;
  const riderName = decodeHtmlEntities(rawRiderName);

  const publicEvent = publicEventState.status === 'loaded' ? publicEventState.data : undefined;
  const zrEvent = zrEventState.status === 'loaded' ? zrEventState.data : null;
  const zrEventRider = zrEventMatch.rider;
  const zrEventPen = zrEventMatch.pen;
  const activityDetail =
    activityDetailState?.status === 'loaded' ? activityDetailState.data : undefined;
  const selectedSubgroup = publicEvent?.eventSubgroups?.find((sg) => sg.id === selectedSubgroupId);

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
  const zpCatFieldCount =
    zpViewState.status === 'loaded' && riderCategory
      ? zpViewState.data.filter(
          (e) =>
            (e.category ?? '').trim().toUpperCase().replace(/\+$/, '') ===
            riderCategory.trim().toUpperCase().replace(/\+$/, ''),
        ).length
      : undefined;

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
  const distMeters =
    bestZpEntry?.distance != null
      ? bestZpEntry.distance * 1000
      : zrEntry?.race?.distance != null
        ? zrEntry.race.distance * 1000
        : zrEventRider?.distance != null
          ? zrEventRider.distance * 1000
          : zrEntry?.event?.distance != null
            ? zrEntry.event.distance * 1000
            : zrEvent?.distance != null
              ? zrEvent.distance * 1000
              : myCoreEntry?.activityData?.segmentDistanceInCentimeters != null
                ? myCoreEntry.activityData.segmentDistanceInCentimeters / 100
                : (selectedSubgroup?.distanceInMeters ?? publicEvent?.distanceInMeters);
  const elevationMeters =
    zrEntry?.event?.elevation ??
    zrEvent?.elevation ??
    (myCoreEntry?.activityData?.elevationInCentimeters != null
      ? myCoreEntry.activityData.elevationInCentimeters / 100
      : matchedActivity?.totalElevation);

  const raceWeightGrams =
    zpNum(bestZpEntry?.weight) != null
      ? zpNum(bestZpEntry?.weight)! * 1000
      : zrEntry?.race?.weight != null
        ? zrEntry.race.weight * 1000
        : zrEventRider?.weight != null
          ? zrEventRider.weight * 1000
          : myCoreEntry?.profileData?.weightInGrams;
  const raceWeightKg = raceWeightGrams != null ? raceWeightGrams / 1000 : undefined;

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

  const avgHr =
    zpVal(bestZpEntry?.avg_hr) ??
    myCoreEntry?.sensorData?.heartRateData?.avgHeartRate ??
    activityDetail?.avgHeartRate;
  const maxHr =
    zpVal(bestZpEntry?.max_hr) ??
    myCoreEntry?.sensorData?.heartRateData?.maxHeartRate ??
    activityDetail?.maxHeartRate;

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

  const powerCurveRows = [
    {
      interval: '5s',
      zpW: zpVal(bestZpEntry?.w5),
      zpWkg: zpVal(bestZpEntry?.wkg5),
      zrWkg: (zrEntry?.race?.wkg5 ?? zrEventRider?.wkg5)?.toFixed(2),
      coreW: undefined as number | undefined,
    },
    {
      interval: '15s',
      zpW: zpVal(bestZpEntry?.w15),
      zpWkg: zpVal(bestZpEntry?.wkg15),
      zrWkg: (zrEntry?.race?.wkg15 ?? zrEventRider?.wkg15)?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP15Seconds,
    },
    {
      interval: '30s',
      zpW: zpVal(bestZpEntry?.w30),
      zpWkg: zpVal(bestZpEntry?.wkg30),
      zrWkg: (zrEntry?.race?.wkg30 ?? zrEventRider?.wkg30)?.toFixed(2),
      coreW: undefined,
    },
    {
      interval: '1m',
      zpW: zpVal(bestZpEntry?.w60),
      zpWkg: zpVal(bestZpEntry?.wkg60),
      zrWkg: (zrEntry?.race?.wkg60 ?? zrEventRider?.wkg60)?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP1Minute,
    },
    {
      interval: '2m',
      zpW: zpVal(bestZpEntry?.w120),
      zpWkg: zpVal(bestZpEntry?.wkg120),
      zrWkg: (zrEntry?.race?.wkg120 ?? zrEventRider?.wkg120)?.toFixed(2),
      coreW: undefined,
    },
    {
      interval: '5m',
      zpW: zpVal(bestZpEntry?.w300),
      zpWkg: zpVal(bestZpEntry?.wkg300),
      zrWkg: (zrEntry?.race?.wkg300 ?? zrEventRider?.wkg300)?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP5Minutes,
    },
    {
      interval: '20m',
      zpW: zpVal(bestZpEntry?.w1200),
      zpWkg: zpVal(bestZpEntry?.wkg1200),
      zrWkg: (zrEntry?.race?.wkg1200 ?? zrEventRider?.wkg1200)?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP20Minutes,
    },
  ];

  const eloBefore = zrEntry?.velo?.elo?.before ?? zrEventRider?.velo?.elo?.before;
  const eloAfter = zrEntry?.velo?.elo?.after ?? zrEventRider?.velo?.elo?.after;
  const eloAdjDelta = zrEntry?.velo?.elo?.adjustedChange ?? zrEventRider?.velo?.elo?.adjustedChange;
  const eloRawDelta = zrEntry?.velo?.elo?.rawChange ?? zrEventRider?.velo?.elo?.rawChange;
  const sof = zrEntry?.velo?.elo?.eventRating ?? zrEventRider?.velo?.elo?.eventRating;
  const expectedPos =
    zrEntry?.velo?.elo?.expectedPosition ??
    zrEventRider?.velo?.elo?.expectedPosition ??
    zrEventRider?.expectedPosition;
  const intensity = zrEntry?.velo?.intensity ?? zrEventRider?.velo?.intensity;
  const eloFactorsMap = zrEntry?.velo?.elo?.factors ?? zrEventRider?.velo?.elo?.factors;
  const eloFactors = eloFactorsMap ? Object.entries(eloFactorsMap) : [];

  const switchedPenDifferent =
    selectedCategory &&
    riderCategory &&
    selectedCategory.trim().toUpperCase().replace(/\+$/, '') !==
      riderCategory.trim().toUpperCase().replace(/\+$/, '');

  const eloDeltaVal =
    eloAfter != null && eloBefore != null ? eloAfter - eloBefore : eloAdjDelta;
  const expectedBeat =
    bestVerifiedPlace != null && expectedPos != null
      ? Math.round(expectedPos) - bestVerifiedPlace
      : undefined;
  const legacyBefore = zrEntry?.legacy?.ratingBefore ?? zrEventRider?.ratingBefore;
  const legacyAfter = zrEntry?.legacy?.rating ?? zrEventRider?.rating;
  const legacyDelta =
    zrEntry?.legacy?.ratingDelta ??
    zrEventRider?.ratingDelta ??
    (legacyAfter != null && legacyBefore != null ? legacyAfter - legacyBefore : undefined);
  const zpSkillGainNum =
    bestZpEntry?.skill_gain != null && bestZpEntry.skill_gain !== ''
      ? Number(bestZpEntry.skill_gain)
      : undefined;

  return (
    <main className="min-h-dvh max-w-6xl mx-auto p-4 sm:p-8 space-y-6">
      <AppHeader
        isOwnProfile={isOwnProfile}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        backTo={backPath}
        backLabel={`← ${riderName}`}
      />

      {/* Hero Header */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs text-slate-400">
              Race Details ·{' '}
              <Link to={backPath} className="text-[#fc6719] hover:underline font-medium">
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              ZwiftRacing (True Place)
            </p>
            <p className="text-xl font-bold">
              {zrDidNotFinish
                ? 'DNF'
                : zrDisqualified
                  ? 'DQ'
                  : truePlace != null
                    ? `${ordinal(truePlace)}${zrFieldSize ? ` / ${zrFieldSize}` : ''}`
                    : '—'}
            </p>
            <p className="text-[11px] text-slate-400">
              {truePlace != null
                ? zrEntry
                  ? 'Includes private riders'
                  : 'Resolved from ZwiftRacing event page'
                : zrRiderState.status === 'loading' || zrEventState.status === 'loading'
                  ? 'Loading…'
                  : 'Not scored on ZwiftRacing.app'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Zwift Core (Unfiltered)
            </p>
            <p className="text-xl font-bold">
              {coreRank != null
                ? `${ordinal(coreRank)}${coreFieldSize ? ` / ${coreFieldSize}` : ''}`
                : '—'}
            </p>
            <p className="text-[11px] text-slate-400">
              {coreRank != null
                ? `${
                    selectedSubgroup
                      ? `Cat ${subgroupCategoryLabel(selectedSubgroup) ?? selectedSubgroup.id}`
                      : 'Subgroup'
                  } official finishers (works >90d)`
                : coreResultsState?.status === 'loading'
                  ? 'Loading subgroup entries…'
                  : switchedPenDifferent
                    ? `Viewing Pen ${selectedCategory} (rider raced Cat ${riderCategory})`
                    : 'Rider not found in selected pen'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              ZwiftPower (Filtered)
            </p>
            <p className="text-xl font-bold">
              {zpPlace != null
                ? `${ordinal(zpPlace)}${zpCatFieldCount ? ` / ${zpCatFieldCount}` : ''}`
                : '—'}
            </p>
            <p className="text-[11px] text-slate-400">
              {bestZpEntry?.pos != null
                ? `Overall ZP pos: ${ordinal(bestZpEntry.pos)} (excludes private riders)`
                : zpRacesState.status === 'loading'
                  ? 'Loading…'
                  : 'No ZwiftPower placing'}
            </p>
          </div>
        </div>

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
            { label: 'Distance', value: formatDistance(distMeters, units) },
            { label: 'Elevation', value: formatElevation(elevationMeters, units) },
            { label: 'Avg Power', value: avgPower !== undefined ? `${avgPower} W` : undefined },
            { label: 'NP', value: np !== undefined ? `${np} W` : undefined },
            { label: 'Max Power', value: maxWatts !== undefined ? `${maxWatts} W` : undefined },
            { label: 'Avg W/kg', value: avgWkg !== undefined ? `${avgWkg} W/kg` : undefined },
            { label: 'Race FTP', value: raceFtp !== undefined ? `${raceFtp} W` : undefined },
            { label: 'Race Weight', value: formatWeight(raceWeightGrams, units) },
            {
              label: 'Calories',
              value: calories != null ? `${Math.round(calories)} kcal` : undefined,
            },
            { label: 'Moving Time', value: formatDurationMs(movingTimeMs) },
          ]}
        />
      </section>

      {/* Tier 2: Full Power Curve & Physiology */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
        <div>
          <h2 className="text-lg font-bold">Power Curve, Physiology &amp; Sensors</h2>
          <p className="text-xs text-slate-400">
            Critical power splits and heart rate / cadence / sensor telemetry across ZwiftPower,
            ZwiftRacing.app, and Zwift Core.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide">
                <th className="py-2 pr-4">Interval</th>
                <th className="py-2 pr-4">ZP Watts</th>
                <th className="py-2 pr-4">ZP W/kg</th>
                <th className="py-2 pr-4">ZwiftRacing W/kg</th>
                <th className="py-2">Zwift Core criticalP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {powerCurveRows.map((row) => (
                <tr key={row.interval}>
                  <td className="py-2 pr-4 font-semibold">{row.interval}</td>
                  <td className="py-2 pr-4 font-mono">
                    {row.zpW !== undefined ? `${row.zpW} W` : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {row.zpWkg !== undefined ? `${row.zpWkg} W/kg` : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {row.zrWkg !== undefined ? `${row.zrWkg} W/kg` : '—'}
                  </td>
                  <td className="py-2 font-mono">
                    {row.coreW !== undefined ? `${Math.round(row.coreW)} W` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <MetricGrid
          items={[
            {
              label: 'Avg / Max HR',
              value:
                avgHr !== undefined || maxHr !== undefined
                  ? `${avgHr ?? '—'} / ${maxHr ?? '—'} bpm`
                  : undefined,
            },
            { label: 'HR Recovery (hrr)', value: zpVal(bestZpEntry?.hrr) },
            { label: 'HR Efficiency', value: zpVal(bestZpEntry?.hreff) },
            {
              label: 'Avg / Max Cadence',
              value:
                activityDetail?.avgCadenceInRotationsPerMinute != null ||
                activityDetail?.maxCadenceInRotationsPerMinute != null
                  ? `${
                      activityDetail.avgCadenceInRotationsPerMinute != null
                        ? Math.round(activityDetail.avgCadenceInRotationsPerMinute)
                        : '—'
                    } / ${
                      activityDetail.maxCadenceInRotationsPerMinute != null
                        ? Math.round(activityDetail.maxCadenceInRotationsPerMinute)
                        : '—'
                    } rpm`
                  : undefined,
            },
            {
              label: 'Avg Speed',
              value:
                activityDetail?.avgSpeedInMetersPerSecond != null
                  ? formatSpeed(activityDetail.avgSpeedInMetersPerSecond, units)
                  : zrEventRider?.avgSpeed != null
                    ? formatSpeed(zrEventRider.avgSpeed / 3.6, units)
                    : undefined,
            },
            {
              label: 'Max Speed',
              value: formatSpeed(activityDetail?.maxSpeedInMetersPerSecond, units),
            },
            {
              label: 'Power Type',
              value:
                zrEntry?.sensor?.powerType ??
                zrEventRider?.sensor?.powerType ??
                myCoreEntry?.sensorData?.powerType ??
                (bestZpEntry?.power_type != null ? `ZP type ${bestZpEntry.power_type}` : undefined),
            },
            {
              label: 'Steering',
              value:
                formatBoolean(zrEntry?.sensor?.steering ?? zrEventRider?.sensor?.steering) ??
                formatBoolean(myCoreEntry?.sensorData?.pairedSteeringDevice),
            },
            {
              label: 'Trainer Diff.',
              value:
                (zrEntry?.sensor?.trainerDifficulty ??
                  zrEventRider?.sensor?.trainerDifficulty) != null
                  ? `${Math.round((zrEntry?.sensor?.trainerDifficulty ?? zrEventRider?.sensor?.trainerDifficulty)! * 100)}%`
                  : undefined,
            },
            {
              label: 'HRM',
              value:
                formatBoolean(
                  zrEntry?.sensor?.heartRateMonitor ?? zrEventRider?.sensor?.heartRateMonitor,
                ) ?? (bestZpEntry?.hrm != null ? formatBoolean(bestZpEntry.hrm) : undefined),
            },
            { label: 'Power Src (ZP)', value: bestZpEntry?.src },
            {
              label: 'Estimated Power',
              value:
                bestZpEntry?.is_guess != null
                  ? bestZpEntry.is_guess === 1
                    ? 'Estimated'
                    : 'Measured'
                  : undefined,
            },
          ]}
        />
      </section>

      {/* Tier 2: Ratings, Points & Event Internals */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
        <div>
          <h2 className="text-lg font-bold">Ratings, Points &amp; Event Internals</h2>
          <p className="text-xs text-slate-400">
            ZwiftRacing vELO deltas, Strength of Field, ZRS, and ZwiftPower ranking metrics.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
            ZwiftRacing.app vELO &amp; Points
          </h3>
          <MetricGrid
            items={[
              {
                label: 'vELO',
                value:
                  eloBefore != null && eloAfter != null
                    ? `${eloBefore.toFixed(1)} → ${eloAfter.toFixed(1)}`
                    : zrEventRider?.riderVelo?.race != null
                      ? zrEventRider.riderVelo.race.toFixed(1)
                      : undefined,
                tone: deltaTone(eloDeltaVal),
              },
              {
                label: 'Adjusted Δ',
                value:
                  eloAdjDelta != null
                    ? `${eloAdjDelta >= 0 ? '+' : ''}${eloAdjDelta.toFixed(2)}`
                    : undefined,
                tone: deltaTone(eloAdjDelta),
              },
              {
                label: 'Raw Δ',
                value:
                  eloRawDelta != null
                    ? `${eloRawDelta >= 0 ? '+' : ''}${eloRawDelta.toFixed(2)}`
                    : undefined,
                tone: deltaTone(eloRawDelta),
              },
              {
                label: 'SOF (eventRating)',
                value: sof != null ? sof.toFixed(0) : undefined,
              },
              {
                label: 'Expected Pos',
                value:
                  expectedPos != null
                    ? `${expectedPos.toFixed(1)}${
                        expectedBeat != null && expectedBeat !== 0
                          ? ` (${expectedBeat > 0 ? `+${expectedBeat}` : expectedBeat})`
                          : ''
                      }`
                    : undefined,
                tone: deltaTone(expectedBeat),
              },
              {
                label: 'Intensity',
                value: intensity != null ? intensity.toFixed(2) : undefined,
              },
              {
                label: 'zPoints',
                value:
                  zrEntry?.velo?.points?.value != null
                    ? zrEntry.velo.points.value.toFixed(1)
                    : undefined,
              },
              {
                label: 'GC / Sprint / Climb',
                value:
                  zrEntry?.velo?.points &&
                  (zrEntry.velo.points.gc != null ||
                    zrEntry.velo.points.sprint != null ||
                    zrEntry.velo.points.climb != null)
                    ? `${zrEntry.velo.points.gc ?? '—'} / ${zrEntry.velo.points.sprint ?? '—'} / ${zrEntry.velo.points.climb ?? '—'}`
                    : undefined,
              },
              {
                label: 'ZRS (Core)',
                value:
                  coreZrs.score != null
                    ? `${Math.round(coreZrs.score)}${coreZrs.delta != null && coreZrs.delta !== 0 ? ` (${coreZrs.delta > 0 ? '+' : ''}${Math.round(coreZrs.delta)})` : ''}`
                    : targetProfile?.competitionMetrics?.racingScore != null
                      ? Math.round(targetProfile.competitionMetrics.racingScore)
                      : undefined,
                tone: deltaTone(coreZrs.delta),
              },
              {
                label: 'Legacy Rating',
                value:
                  legacyBefore != null && legacyAfter != null
                    ? `${legacyBefore.toFixed(0)} → ${legacyAfter.toFixed(0)}`
                    : undefined,
                tone: deltaTone(legacyDelta),
              },
              {
                label: 'Legacy Δ',
                value:
                  legacyDelta != null
                    ? `${legacyDelta >= 0 ? '+' : ''}${legacyDelta.toFixed(1)}`
                    : undefined,
                tone: deltaTone(legacyDelta),
              },
              { label: 'Points Status', value: zrEntry?.pointsStatus ?? zrEventRider?.pointsStatus },
            ]}
          />

          {eloFactors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {eloFactors.map(([k, v]) => {
                let displayVal: string;
                let factorDelta: number | undefined;
                if (typeof v === 'number') {
                  displayVal = v.toFixed(2);
                } else if (v && typeof v === 'object' && !Array.isArray(v)) {
                  const rec = v as Record<string, unknown>;
                  if (typeof rec.skillDelta === 'number' && Number.isFinite(rec.skillDelta)) {
                    factorDelta = rec.skillDelta;
                  } else if (typeof rec.before === 'number' && typeof rec.after === 'number') {
                    factorDelta = rec.after - rec.before;
                  }
                  if (typeof rec.before === 'number' && typeof rec.after === 'number') {
                    displayVal = `${rec.before.toFixed(1)} → ${rec.after.toFixed(1)}`;
                  } else {
                    displayVal = JSON.stringify(v);
                  }
                } else {
                  displayVal = String(v);
                }
                const factorTone = deltaTone(factorDelta);
                const chipClasses =
                  factorTone === 'positive'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : factorTone === 'negative'
                      ? 'bg-red-500/10 border-red-500/30 text-red-300'
                      : 'bg-slate-950/70 border-slate-800 text-slate-300';
                return (
                  <span
                    key={k}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono ${chipClasses}`}
                  >
                    {k}: {displayVal}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
            ZwiftPower Ranking Internals
          </h3>
          <MetricGrid
            items={[
              { label: 'Skill', value: bestZpEntry?.skill },
              { label: 'Skill Before', value: bestZpEntry?.skill_b },
              {
                label: 'Skill Gain',
                value: bestZpEntry?.skill_gain,
                tone: deltaTone(
                  zpSkillGainNum != null && Number.isFinite(zpSkillGainNum)
                    ? zpSkillGainNum
                    : undefined,
                ),
              },
              { label: 'Division', value: bestZpEntry?.div },
              { label: 'Women Div', value: bestZpEntry?.divw },
              { label: 'ZP Points', value: bestZpEntry?.pts },
              { label: 'Points Pos', value: bestZpEntry?.pts_pos },
              { label: 'zEff', value: bestZpEntry?.zeff },
              { label: 'CP', value: bestZpEntry?.cp },
              { label: 'VTTA', value: bestZpEntry?.vtta },
              { label: 'ZADA', value: bestZpEntry?.zada },
              { label: 'Info / Strike', value: bestZpEntry?.strike ?? bestZpEntry?.info },
            ]}
          />
        </div>
      </section>

      {/* Tier 2: Combined Event Standings */}
      <RaceDetailStandings
        raceKey={raceKey}
        targetRiderId={targetRiderId}
        loggedInProfile={profile}
        targetProfile={targetProfile}
        publicEvent={publicEventState}
        zrEvent={zrEventState}
        selectedSubgroupId={selectedSubgroupId}
        selectedCategory={selectedCategory}
        onSelectPen={handleSelectPen}
        coreResults={coreResultsState}
        zpViewResults={zpViewState}
        zpZwiftResults={zpZwiftState}
        units={units}
      />
    </main>
  );
}
