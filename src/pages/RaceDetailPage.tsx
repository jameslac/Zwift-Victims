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
import { fetchZwiftRacingRider } from '../api/zwiftRacing';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import { useAuth } from '../auth/AuthContext';
import RaceApiExplorer from '../components/RaceApiExplorer';
import type { ApiSourceStatus } from '../components/RaceApiExplorer';
import RaceDetailStandings from '../components/RaceDetailStandings';
import { AppHeader, MetricGrid, PlacingBadge } from '../components/RaceUi';
import {
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
import {
  formatDistance,
  formatDurationMs,
  formatElevation,
  formatSpeed,
  formatWeight,
} from '../lib/units';
import { useUnits } from '../lib/UnitsContext';

type KeyedState<T> = { key: string; state: AsyncState<T> };

function readKeyed<T>(raw: KeyedState<T> | null, expectedKey: string): AsyncState<T> {
  return raw && raw.key === expectedKey ? raw.state : { status: 'loading' };
}

function toErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function asNumericIdString(val: unknown): string | undefined {
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) return val.trim();
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return String(val);
  return undefined;
}

function pickNumberField(
  records: Array<Record<string, unknown> | undefined>,
  keys: string[],
): number | undefined {
  for (const rec of records) {
    if (!rec) continue;
    for (const key of keys) {
      const val = rec[key];
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
    }
  }
  return undefined;
}

function extractEquipmentIds(
  coreEntry: ZwiftRaceResultEntry | undefined,
  activity: ZwiftActivity | undefined,
  activityDetail: ZwiftActivityDetail | undefined,
  riderId: number,
): { frameId?: number; wheelId?: number } {
  const subgroupMatches = [
    ...(activityDetail?.subgroupResults?.topResults ?? []),
    ...(activityDetail?.subgroupResults?.nearPlayerResults ?? []),
  ].filter((r) => Number(r.profileId) === riderId);

  const records: Array<Record<string, unknown> | undefined> = [
    coreEntry,
    coreEntry?.activityData,
    coreEntry?.sensorData,
    activity,
    activityDetail,
    ...subgroupMatches,
  ];
  return {
    frameId: pickNumberField(records, ['frameId', 'bikeFrameId']),
    wheelId: pickNumberField(records, ['wheelId', 'bikeWheelId']),
  };
}

function formatBoolean(val: unknown): string | undefined {
  if (val === true || val === 1) return 'Yes';
  if (val === false || val === 0) return 'No';
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
  const [zpViewRaw, setZpViewRaw] = useState<KeyedState<ZwiftPowerRaceEntry[]> | null>(null);
  const [zpZwiftRaw, setZpZwiftRaw] = useState<KeyedState<ZwiftPowerRaceEntry[]> | null>(null);
  const [publicEventRaw, setPublicEventRaw] = useState<KeyedState<ZwiftPublicEvent> | null>(null);
  const [activitiesRaw, setActivitiesRaw] = useState<KeyedState<ZwiftActivity[]> | null>(null);

  const [subgroupChoice, setSubgroupChoice] = useState<{
    raceKey: string;
    subgroupId: number;
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
      .then((token) => fetchRiderActivities(token, targetRiderId, { start: 0, limit: 30 }))
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

  const zpViewEntry = useMemo(() => {
    if (zpViewState.status !== 'loaded' || targetRiderId === null) return undefined;
    return zpViewState.data.find((e) => Number(e.zwid) === targetRiderId);
  }, [zpViewState, targetRiderId]);

  const zpZwiftEntry = useMemo(() => {
    if (zpZwiftState.status !== 'loaded' || targetRiderId === null) return undefined;
    return zpZwiftState.data.find((e) => Number(e.zwid) === targetRiderId);
  }, [zpZwiftState, targetRiderId]);

  const bestZpEntry = zpProfileEntry ?? zpViewEntry ?? zpZwiftEntry;
  const riderCategory = bestZpEntry?.category ?? zrEntry?.event?.subgroupId;

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
    const raceDateSec = bestZpEntry?.event_date ?? zrEntry?.event?.time ?? publicEventDateSec;
    const eventTitle =
      bestZpEntry?.event_title ??
      zrEntry?.event?.title ??
      (publicEventState.status === 'loaded' ? publicEventState.data.name : undefined);
    return matchActivityForRace(activitiesState.data, {
      subgroupIds,
      raceDateSec,
      eventTitle,
    });
  }, [activitiesState, publicEventState, bestZpEntry, zrEntry]);

  const defaultSubgroupId = useMemo(() => {
    const subgroups =
      publicEventState.status === 'loaded' ? (publicEventState.data.eventSubgroups ?? []) : [];
    const byCategory = resolveSubgroupForCategory(subgroups, riderCategory);
    if (byCategory?.id) return byCategory.id;
    if (typeof matchedActivity?.eventSubgroupId === 'number' && matchedActivity.eventSubgroupId > 0) {
      return matchedActivity.eventSubgroupId;
    }
    return subgroups[0]?.id ?? null;
  }, [publicEventState, riderCategory, matchedActivity]);

  const selectedSubgroupId =
    subgroupChoice && subgroupChoice.raceKey === raceKey ? subgroupChoice.subgroupId : defaultSubgroupId;

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
    if (publicEventState.status === 'loading' || activitiesState.status === 'loading') {
      return { status: 'loading' };
    }
    return null;
  }, [selectedSubgroupId, coreResultsRaw, subgroupKey, publicEventState.status, activitiesState.status]);

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
      null
    );
  }, [matchedActivity, myCoreEntry]);

  useEffect(() => {
    if (!activityIdStr) return;
    let cancelled = false;
    getAccessToken()
      .then((token) => fetchActivityDetail(token, activityIdStr))
      .then((data) => {
        if (!cancelled) setActivityDetailRaw({ key: activityIdStr, state: { status: 'loaded', data } });
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
  const riderName =
    targetProfileState.status === 'loaded'
      ? [targetProfileState.data.firstName, targetProfileState.data.lastName]
          .filter(Boolean)
          .join(' ') || `Rider ${targetRiderId}`
      : bestZpEntry?.name || `Rider ${targetRiderId}`;

  const publicEvent = publicEventState.status === 'loaded' ? publicEventState.data : undefined;
  const activityDetail =
    activityDetailState?.status === 'loaded' ? activityDetailState.data : undefined;
  const selectedSubgroup = publicEvent?.eventSubgroups?.find((sg) => sg.id === selectedSubgroupId);

  const raceTitle =
    bestZpEntry?.event_title ||
    zrEntry?.event?.title ||
    publicEvent?.name ||
    activityDetail?.eventInfo?.name ||
    `Event ${eventId}`;
  const raceDateSec =
    bestZpEntry?.event_date ??
    zrEntry?.event?.time ??
    (publicEvent?.eventStart ? Math.floor(Date.parse(publicEvent.eventStart) / 1000) : undefined);

  const truePlace = zrEntry?.place?.positionInCategory;
  const zrFieldSize = zrEntry?.place?.penTotal;
  const coreRank = myCoreEntry?.rank;
  const coreFieldSize =
    coreResultsState?.status === 'loaded' ? coreResultsState.data.length : undefined;
  const zpPlace =
    typeof bestZpEntry?.position_in_cat === 'number' ? bestZpEntry.position_in_cat : undefined;
  const zpCatFieldCount =
    zpViewState.status === 'loaded' && riderCategory
      ? zpViewState.data.filter(
          (e) => (e.category ?? '').trim().toUpperCase() === riderCategory.trim().toUpperCase(),
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
    (myCoreEntry?.activityData?.durationInMilliseconds != null
      ? myCoreEntry.activityData.durationInMilliseconds / 1000
      : undefined);
  const gapSec = bestZpEntry?.gap ?? zrEntry?.race?.gap;
  const distMeters =
    bestZpEntry?.distance != null
      ? bestZpEntry.distance * 1000
      : zrEntry?.race?.distance != null
        ? zrEntry.race.distance * 1000
        : zrEntry?.event?.distance != null
          ? zrEntry.event.distance * 1000
          : myCoreEntry?.activityData?.segmentDistanceInCentimeters != null
            ? myCoreEntry.activityData.segmentDistanceInCentimeters / 100
            : (selectedSubgroup?.distanceInMeters ?? publicEvent?.distanceInMeters);
  const elevationMeters =
    zrEntry?.event?.elevation ??
    (myCoreEntry?.activityData?.elevationInCentimeters != null
      ? myCoreEntry.activityData.elevationInCentimeters / 100
      : matchedActivity?.totalElevation);

  const avgPower = zpVal(bestZpEntry?.avg_power) ??
    (myCoreEntry?.sensorData?.avgWatts != null
      ? Math.round(myCoreEntry.sensorData.avgWatts)
      : undefined);
  const np = zpVal(bestZpEntry?.np);
  const maxWatts =
    activityDetail?.maxWatts != null
      ? Math.round(activityDetail.maxWatts)
      : matchedActivity?.maxWatts != null
        ? Math.round(matchedActivity.maxWatts)
        : undefined;
  const avgWkg =
    zpVal(bestZpEntry?.avg_wkg) ??
    (zrEntry?.race?.wkgAvg != null ? zrEntry.race.wkgAvg.toFixed(2) : undefined) ??
    (myCoreEntry?.sensorData?.avgWatts != null && myCoreEntry?.profileData?.weightInGrams
      ? (myCoreEntry.sensorData.avgWatts / (myCoreEntry.profileData.weightInGrams / 1000)).toFixed(2)
      : undefined);
  const raceFtp = zpVal(bestZpEntry?.wftp) ?? bestZpEntry?.ftp ?? activityDetail?.profileFtp;
  const raceWeightGrams =
    zpNum(bestZpEntry?.weight) != null
      ? zpNum(bestZpEntry?.weight)! * 1000
      : zrEntry?.race?.weight != null
        ? zrEntry.race.weight * 1000
        : myCoreEntry?.profileData?.weightInGrams;
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

  const equipment = extractEquipmentIds(myCoreEntry, matchedActivity, activityDetail, targetRiderId);
  const eventImageUrl = zrEntry?.event?.imageUrl || publicEvent?.imageUrl;
  const activityImageUrl = matchedActivity?.primaryImageUrl;
  const laps =
    zrEntry?.event?.numLaps ??
    (bestZpEntry?.laps ? Number(bestZpEntry.laps) : undefined) ??
    selectedSubgroup?.laps ??
    publicEvent?.laps ??
    activityDetail?.eventInfo?.laps;

  const powerCurveRows = [
    {
      interval: '5s',
      zpW: zpVal(bestZpEntry?.w5),
      zpWkg: zpVal(bestZpEntry?.wkg5),
      zrWkg: zrEntry?.race?.wkg5?.toFixed(2),
      coreW: undefined as number | undefined,
    },
    {
      interval: '15s',
      zpW: zpVal(bestZpEntry?.w15),
      zpWkg: zpVal(bestZpEntry?.wkg15),
      zrWkg: zrEntry?.race?.wkg15?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP15Seconds,
    },
    {
      interval: '30s',
      zpW: zpVal(bestZpEntry?.w30),
      zpWkg: zpVal(bestZpEntry?.wkg30),
      zrWkg: zrEntry?.race?.wkg30?.toFixed(2),
      coreW: undefined,
    },
    {
      interval: '1m',
      zpW: zpVal(bestZpEntry?.w60),
      zpWkg: zpVal(bestZpEntry?.wkg60),
      zrWkg: zrEntry?.race?.wkg60?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP1Minute,
    },
    {
      interval: '2m',
      zpW: zpVal(bestZpEntry?.w120),
      zpWkg: zpVal(bestZpEntry?.wkg120),
      zrWkg: zrEntry?.race?.wkg120?.toFixed(2),
      coreW: undefined,
    },
    {
      interval: '5m',
      zpW: zpVal(bestZpEntry?.w300),
      zpWkg: zpVal(bestZpEntry?.wkg300),
      zrWkg: zrEntry?.race?.wkg300?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP5Minutes,
    },
    {
      interval: '20m',
      zpW: zpVal(bestZpEntry?.w1200),
      zpWkg: zpVal(bestZpEntry?.wkg1200),
      zrWkg: zrEntry?.race?.wkg1200?.toFixed(2),
      coreW: myCoreEntry?.criticalP?.criticalP20Minutes,
    },
  ];

  const eloFactors = zrEntry?.velo?.elo?.factors
    ? Object.entries(zrEntry.velo.elo.factors)
    : [];

  const apiSources: ApiSourceStatus[] = [
    {
      id: 'zp_profile',
      provider: 'ZwiftPower',
      endpoint: `/api/zwiftpower/cache3/profile/${targetRiderId}_all.json`,
      status: zpRacesState.status,
      summary:
        zpRacesState.status === 'loaded'
          ? zpProfileEntry
            ? `Matched event ${eventId} in ${zpRacesState.data.length} entries`
            : `Not found in ${zpRacesState.data.length} ZP profile entries`
          : zpRacesState.status === 'error'
            ? zpRacesState.message
            : 'Loading…',
    },
    {
      id: 'zp_view',
      provider: 'ZwiftPower',
      endpoint: `/api/zwiftpower/cache3/results/${eventId}_view.json`,
      status: zpViewState.status,
      summary:
        zpViewState.status === 'loaded'
          ? `${zpViewState.data.length} filtered finishers${zpViewEntry ? ' (rider present)' : ' (rider omitted)'}`
          : zpViewState.status === 'error'
            ? zpViewState.message
            : 'Loading…',
    },
    {
      id: 'zp_zwift',
      provider: 'ZwiftPower',
      endpoint: `/api/zwiftpower/cache3/results/${eventId}_zwift.json`,
      status: zpZwiftState.status,
      summary:
        zpZwiftState.status === 'loaded'
          ? `${zpZwiftState.data.length} raw finishers${zpZwiftEntry ? ' (rider present)' : ''}`
          : zpZwiftState.status === 'error'
            ? zpZwiftState.message
            : 'Loading…',
    },
    {
      id: 'zr_rider',
      provider: 'ZwiftRacing.app',
      endpoint: `/api/zwiftracing/riders/${targetRiderId}`,
      status: zrRiderState.status,
      summary:
        zrRiderState.status === 'loaded'
          ? zrEntry
            ? `Matched event ${eventId} (~90d window)`
            : 'Not in ~90d ZwiftRacing history or unscored'
          : zrRiderState.status === 'error'
            ? zrRiderState.message
            : 'Loading…',
    },
    {
      id: 'core_event',
      provider: 'Zwift Core',
      endpoint: `/api/zwift/api/public/events/${eventId}`,
      status: publicEventState.status,
      summary:
        publicEventState.status === 'loaded'
          ? `${publicEventState.data.eventSubgroups?.length ?? 0} subgroups returned`
          : publicEventState.status === 'error'
            ? publicEventState.message
            : 'Loading…',
    },
    {
      id: 'core_results',
      provider: 'Zwift Core',
      endpoint:
        selectedSubgroupId != null
          ? `/api/zwift/api/race-results/entries?event_subgroup_id=${selectedSubgroupId}`
          : '/api/zwift/api/race-results/entries?event_subgroup_id=…',
      status: coreResultsState?.status ?? 'unavailable',
      summary:
        coreResultsState?.status === 'loaded'
          ? `${coreResultsState.data.length} unfiltered subgroup finishers${myCoreEntry ? ` (rank ${myCoreEntry.rank ?? '—'})` : ''}`
          : coreResultsState?.status === 'error'
            ? coreResultsState.message
            : coreResultsState?.status === 'loading'
              ? 'Loading…'
              : 'No subgroup ID resolved automatically',
    },
    {
      id: 'core_activities',
      provider: 'Zwift Core',
      endpoint: `/api/zwift/api/profiles/${targetRiderId}/activities?start=0&limit=30`,
      status: activitiesState.status,
      summary:
        activitiesState.status === 'loaded'
          ? matchedActivity
            ? `Matched activity ${matchedActivity.id_str ?? matchedActivity.id}`
            : `Not in latest ${activitiesState.data.length} activities`
          : activitiesState.status === 'error'
            ? activitiesState.message
            : 'Loading…',
    },
    {
      id: 'core_activity_detail',
      provider: 'Zwift Core',
      endpoint: activityIdStr
        ? `/api/zwift/api/activities/${activityIdStr}?fetchSnapshots=true&fetchEvent=true`
        : '/api/zwift/api/activities/{id_str}',
      status: activityDetailState?.status ?? 'unavailable',
      summary:
        activityDetailState?.status === 'loaded'
          ? `Loaded activity ${activityIdStr}`
          : activityDetailState?.status === 'error'
            ? activityDetailState.message
            : activityDetailState?.status === 'loading'
              ? 'Loading…'
              : 'No matching activity ID found',
    },
  ];

  return (
    <main className="min-h-dvh max-w-4xl mx-auto p-4 sm:p-8 space-y-6">
      <AppHeader
        isOwnProfile={isOwnProfile}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        backTo={backPath}
        backLabel={`← ${riderName}`}
      />

      {/* Hero & 3-Way Placing Comparison */}
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
              {zrEntry?.event?.subType ? ` · ${zrEntry.event.subType}` : ''}
              {zrEntry?.event?.routeName ? ` · ${zrEntry.event.routeName}` : ''}
              {laps ? ` · ${laps} lap${laps === 1 ? '' : 's'}` : ''}
              {bestZpEntry?.tname ? ` · Team ${bestZpEntry.tname}` : ''}
              {` · event ${eventId}`}
              {selectedSubgroupId ? ` · subgroup ${selectedSubgroupId}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <PlacingBadge
              truePlace={bestVerifiedPlace}
              fieldSize={truePlace != null ? zrFieldSize : coreFieldSize}
              zpPlace={zpPlace}
              didNotFinish={zrEntry?.place?.didNotFinish}
              disqualified={zrEntry?.place?.disqualified}
              penalty={bestZpEntry?.penalty}
            />
            {bestVerifiedPlace != null &&
              !zrEntry?.place?.didNotFinish &&
              !zrEntry?.place?.disqualified &&
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

        {(eventImageUrl || activityImageUrl) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activityImageUrl && (
              <figure className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
                <img
                  src={activityImageUrl}
                  alt={`Activity snapshot for ${raceTitle}`}
                  loading="lazy"
                  className="w-full h-44 object-cover"
                />
                <figcaption className="px-3 py-1.5 text-[11px] text-slate-400">
                  Zwift activity snapshot (<code>primaryImageUrl</code>)
                </figcaption>
              </figure>
            )}
            {eventImageUrl && (
              <figure className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
                <img
                  src={eventImageUrl}
                  alt={`Event artwork for ${raceTitle}`}
                  loading="lazy"
                  className="w-full h-44 object-cover"
                />
                <figcaption className="px-3 py-1.5 text-[11px] text-slate-400">
                  Official event banner
                </figcaption>
              </figure>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              ZwiftRacing (True Place)
            </p>
            <p className="text-xl font-bold">
              {zrEntry?.place?.didNotFinish
                ? 'DNF'
                : zrEntry?.place?.disqualified
                  ? 'DQ'
                  : truePlace != null
                    ? `${ordinal(truePlace)}${zrFieldSize ? ` / ${zrFieldSize}` : ''}`
                    : '—'}
            </p>
            <p className="text-[11px] text-slate-400">
              {truePlace != null
                ? 'Includes private riders (~90d window)'
                : zrRiderState.status === 'loading'
                  ? 'Loading…'
                  : 'Outside ~90d window or unscored'}
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
                  : 'Rider not found in selected subgroup'}
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
            { label: 'Avg Speed', value: formatSpeed(activityDetail?.avgSpeedInMetersPerSecond, units) },
            { label: 'Max Speed', value: formatSpeed(activityDetail?.maxSpeedInMetersPerSecond, units) },
            {
              label: 'Power Type',
              value:
                zrEntry?.sensor?.powerType ??
                myCoreEntry?.sensorData?.powerType ??
                (bestZpEntry?.power_type != null ? `ZP type ${bestZpEntry.power_type}` : undefined),
            },
            {
              label: 'Steering',
              value:
                formatBoolean(zrEntry?.sensor?.steering) ??
                formatBoolean(myCoreEntry?.sensorData?.pairedSteeringDevice),
            },
            {
              label: 'Trainer Diff.',
              value:
                zrEntry?.sensor?.trainerDifficulty != null
                  ? `${Math.round(zrEntry.sensor.trainerDifficulty * 100)}%`
                  : undefined,
            },
            {
              label: 'HRM',
              value:
                formatBoolean(zrEntry?.sensor?.heartRateMonitor) ??
                (bestZpEntry?.hrm != null ? formatBoolean(bestZpEntry.hrm) : undefined),
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
            ZwiftRacing vELO deltas, Strength of Field, series points, and ZwiftPower ranking
            metrics.
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
                  zrEntry?.velo?.elo?.before != null && zrEntry?.velo?.elo?.after != null
                    ? `${zrEntry.velo.elo.before.toFixed(1)} → ${zrEntry.velo.elo.after.toFixed(1)}`
                    : undefined,
              },
              {
                label: 'Adjusted Δ',
                value:
                  zrEntry?.velo?.elo?.adjustedChange != null
                    ? `${zrEntry.velo.elo.adjustedChange >= 0 ? '+' : ''}${zrEntry.velo.elo.adjustedChange.toFixed(2)}`
                    : undefined,
              },
              {
                label: 'Raw Δ',
                value:
                  zrEntry?.velo?.elo?.rawChange != null
                    ? `${zrEntry.velo.elo.rawChange >= 0 ? '+' : ''}${zrEntry.velo.elo.rawChange.toFixed(2)}`
                    : undefined,
              },
              {
                label: 'SOF (eventRating)',
                value:
                  zrEntry?.velo?.elo?.eventRating != null
                    ? zrEntry.velo.elo.eventRating.toFixed(0)
                    : undefined,
              },
              {
                label: 'Expected Pos',
                value:
                  zrEntry?.velo?.elo?.expectedPosition != null
                    ? zrEntry.velo.elo.expectedPosition.toFixed(1)
                    : undefined,
              },
              {
                label: 'Intensity',
                value:
                  zrEntry?.velo?.intensity != null
                    ? zrEntry.velo.intensity.toFixed(2)
                    : undefined,
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
                label: 'TT Points',
                value: zrEntry?.velo?.points?.tt != null ? zrEntry.velo.points.tt : undefined,
              },
              {
                label: 'Legacy Rating',
                value:
                  zrEntry?.legacy?.ratingBefore != null && zrEntry?.legacy?.rating != null
                    ? `${zrEntry.legacy.ratingBefore.toFixed(0)} → ${zrEntry.legacy.rating.toFixed(0)}`
                    : undefined,
              },
              {
                label: 'Legacy Δ',
                value:
                  zrEntry?.legacy?.ratingDelta != null
                    ? `${zrEntry.legacy.ratingDelta >= 0 ? '+' : ''}${zrEntry.legacy.ratingDelta.toFixed(1)}`
                    : undefined,
              },
              { label: 'Points Status', value: zrEntry?.pointsStatus },
            ]}
          />

          {eloFactors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {eloFactors.map(([k, v]) => (
                <span
                  key={k}
                  className="rounded-lg bg-slate-950/70 border border-slate-800 px-2.5 py-1 text-[11px] font-mono text-slate-300"
                >
                  {k}: {typeof v === 'number' ? v.toFixed(2) : String(v)}
                </span>
              ))}
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
              { label: 'Skill Gain', value: bestZpEntry?.skill_gain },
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

      {/* Tier 2: Zwift Core Activity, Equipment & Telemetry */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
        <div>
          <h2 className="text-lg font-bold">Zwift Core Activity, Equipment &amp; Telemetry</h2>
          <p className="text-xs text-slate-400">
            Activity metadata, equipped frame/wheel IDs, and <code>.fit</code> / fitness stream
            references from Zwift Core.
          </p>
        </div>

        <MetricGrid
          items={[
            { label: 'Activity ID', value: activityIdStr ?? undefined },
            { label: 'World ID', value: matchedActivity?.worldId ?? publicEvent?.worldId },
            { label: 'Route ID', value: selectedSubgroup?.routeId ?? publicEvent?.routeId },
            { label: 'Frame ID', value: equipment.frameId },
            { label: 'Wheel ID', value: equipment.wheelId },
            { label: 'Ride Ons', value: matchedActivity?.activityRideOnCount },
            { label: 'Comments', value: matchedActivity?.activityCommentCount },
            {
              label: 'Completed',
              value:
                activityDetail?.percentageCompleted != null
                  ? `${Math.round(activityDetail.percentageCompleted)}%`
                  : undefined,
            },
            { label: 'FIT Bucket', value: matchedActivity?.fitFileBucket },
            { label: 'FIT Key', value: matchedActivity?.fitFileKey },
            { label: 'Fitness Status', value: activityDetail?.fitnessData?.status },
            { label: 'Notable Moment', value: matchedActivity?.notableMomentType ?? undefined },
          ]}
        />

        {(activityDetail?.fitnessData?.fullDataUrl || activityDetail?.fitnessData?.smallDataUrl) && (
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 text-xs space-y-1">
            {activityDetail.fitnessData.fullDataUrl && (
              <p className="break-all text-slate-300">
                <span className="text-slate-400">fitnessData.fullDataUrl:</span>{' '}
                <code>{activityDetail.fitnessData.fullDataUrl}</code>
              </p>
            )}
            {activityDetail.fitnessData.smallDataUrl && (
              <p className="break-all text-slate-300">
                <span className="text-slate-400">fitnessData.smallDataUrl:</span>{' '}
                <code>{activityDetail.fitnessData.smallDataUrl}</code>
              </p>
            )}
          </div>
        )}

        {activityDetailState?.status === 'error' && (
          <p className="text-xs text-amber-400">
            Activity detail unavailable: {activityDetailState.message}
          </p>
        )}
      </section>

      {/* Tier 2: Full Standings */}
      <RaceDetailStandings
        raceKey={raceKey}
        targetRiderId={targetRiderId}
        publicEvent={publicEventState}
        selectedSubgroupId={selectedSubgroupId}
        onSelectSubgroupId={(id) => setSubgroupChoice({ raceKey, subgroupId: id })}
        coreResults={coreResultsState}
        zpViewResults={zpViewState}
        zpZwiftResults={zpZwiftState}
        defaultCategory={riderCategory}
        units={units}
      />

      {/* API Coverage & Raw Payload Inspector */}
      <RaceApiExplorer
        sources={apiSources}
        zpProfileEntry={zpProfileEntry}
        zpViewEntry={zpViewEntry}
        zpZwiftEntry={zpZwiftEntry}
        zpViewAll={zpViewState}
        zpZwiftAll={zpZwiftState}
        zrEntry={zrEntry}
        publicEvent={publicEventState}
        coreSubgroupEntry={myCoreEntry}
        coreSubgroupAll={coreResultsState}
        matchedActivity={matchedActivity}
        activityDetail={activityDetailState}
      />
    </main>
  );
}
