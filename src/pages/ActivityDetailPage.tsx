import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  fetchActivityDetail,
  fetchProfileById,
  fetchRiderActivityDetail,
} from '../api/zwiftCore';
import type { ZwiftActivity, ZwiftActivityDetail, ZwiftProfile } from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';
import { ActivityTypeBadge, AppHeader, MetricGrid, RaceExternalLinks } from '../components/RaceUi';
import {
  classifyActivity,
  decodeHtmlEntities,
  extractActivityPhotos,
  formatDateTime,
  formatZwiftWorld,
  parseDurationStringMs,
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

const LOADING_STATE: AsyncState<never> = { status: 'loading' };

function readKeyed<T>(raw: KeyedState<T> | null, expectedKey: string): AsyncState<T> {
  return raw && raw.key === expectedKey ? raw.state : LOADING_STATE;
}

function toErrMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function finitePositive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function parseIsoMs(iso: string | undefined): number {
  if (!iso) return NaN;
  const normalized = iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return Date.parse(normalized);
}

function getPowerZoneLabel(pctFtp: number): { zone: string; tone: string } {
  if (pctFtp < 56) return { zone: 'Z1 · Active Recovery', tone: 'bg-slate-400' };
  if (pctFtp < 76) return { zone: 'Z2 · Endurance', tone: 'bg-sky-400' };
  if (pctFtp < 91) return { zone: 'Z3 · Tempo', tone: 'bg-emerald-400' };
  if (pctFtp < 106) return { zone: 'Z4 · Threshold', tone: 'bg-amber-400' };
  if (pctFtp < 121) return { zone: 'Z5 · VO2max', tone: 'bg-[#fc6719]' };
  return { zone: 'Z6 · Anaerobic', tone: 'bg-red-500' };
}

export default function ActivityDetailPage() {
  const { loading: authLoading, profile, logout, getAccessToken } = useAuth();
  const { riderId: riderIdParam, activityId } = useParams<{
    riderId?: string;
    activityId?: string;
  }>();
  const location = useLocation();
  const passedRace = (location.state as { race?: MergedRace } | null)?.race;

  const validActivityId = Boolean(activityId && /^\d+$/.test(activityId));
  const validRiderParam = !riderIdParam || /^\d+$/.test(riderIdParam);
  const targetRiderId =
    riderIdParam && /^\d+$/.test(riderIdParam) ? Number(riderIdParam) : (profile?.id ?? null);
  const isOwnProfile = Boolean(profile && targetRiderId === profile.id);
  const activityKey =
    profile && targetRiderId !== null && validActivityId ? `${targetRiderId}:${activityId}` : '';

  const { units, setUnits } = useUnits(profile?.useMetric === false ? 'imperial' : 'metric');

  const [detailRaw, setDetailRaw] = useState<KeyedState<ZwiftActivityDetail> | null>(null);
  const [remoteProfileRaw, setRemoteProfileRaw] = useState<KeyedState<ZwiftProfile> | null>(null);

  useEffect(() => {
    if (!activityKey || targetRiderId === null || !activityId) return;
    let cancelled = false;

    getAccessToken()
      .then((token) =>
        fetchActivityDetail(token, activityId).catch(() =>
          fetchRiderActivityDetail(token, targetRiderId, activityId),
        ),
      )
      .then((data) => {
        if (!cancelled) setDetailRaw({ key: activityKey, state: { status: 'loaded', data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetailRaw({
            key: activityKey,
            state: {
              status: 'error',
              message: toErrMsg(err, 'Failed to load activity details.'),
            },
          });
        }
      });

    if (!isOwnProfile) {
      getAccessToken()
        .then((token) => fetchProfileById(token, targetRiderId))
        .then((data) => {
          if (!cancelled) setRemoteProfileRaw({ key: activityKey, state: { status: 'loaded', data } });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setRemoteProfileRaw({
              key: activityKey,
              state: {
                status: 'error',
                message: toErrMsg(err, 'Failed to load rider profile.'),
              },
            });
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [activityKey, targetRiderId, activityId, isOwnProfile, getAccessToken]);

  const detailState = readKeyed(detailRaw, activityKey);
  const targetProfileState: AsyncState<ZwiftProfile> = useMemo(() => {
    if (isOwnProfile && profile) return { status: 'loaded', data: profile };
    return readKeyed(remoteProfileRaw, activityKey);
  }, [isOwnProfile, profile, remoteProfileRaw, activityKey]);

  const detail = detailState.status === 'loaded' ? detailState.data : undefined;
  const targetProfile =
    targetProfileState.status === 'loaded' ? targetProfileState.data : undefined;
  const baseActivity: ZwiftActivity | undefined =
    passedRace?.activityId === activityId ? passedRace?.activity : undefined;

  if (authLoading) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <p className="text-sm text-slate-400">Checking session…</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
          <h1 className="text-xl font-extrabold">Log in to view activity details</h1>
          <p className="text-sm text-slate-400">
            Zwift Core activity telemetry and snapshots require your Zwift session.
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

  if (!validActivityId || !validRiderParam || targetRiderId === null || !activityId) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <p className="text-red-400 text-sm">Invalid rider or activity ID in URL.</p>
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
  const activityProfileRec = (detail?.profile ?? baseActivity?.profile) as
    | Record<string, unknown>
    | undefined;
  const rawRiderName = targetProfile
    ? [targetProfile.firstName, targetProfile.lastName].filter(Boolean).join(' ') ||
      `Rider ${targetRiderId}`
    : [activityProfileRec?.firstName, activityProfileRec?.lastName]
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .join(' ') || `Rider ${targetRiderId}`;
  const riderName = decodeHtmlEntities(rawRiderName);

  const combinedForClassification: ZwiftActivity | ZwiftActivityDetail | undefined =
    detail ?? baseActivity;
  const classified =
    passedRace?.activityType && passedRace?.activityTypeLabel
      ? { activityType: passedRace.activityType, activityTypeLabel: passedRace.activityTypeLabel }
      : classifyActivity(passedRace?.zp, passedRace?.zr, combinedForClassification);

  const title = decodeHtmlEntities(
    detail?.name?.trim() ||
      baseActivity?.name?.trim() ||
      passedRace?.title ||
      `Zwift Activity ${activityId}`,
  );
  const description = decodeHtmlEntities(
    detail?.description?.trim() || baseActivity?.description?.trim(),
  );
  const startDate = detail?.startDate ?? baseActivity?.startDate;
  const endDate = detail?.endDate ?? baseActivity?.endDate;
  const worldName = formatZwiftWorld(detail?.worldId ?? baseActivity?.worldId);
  const sportRaw = detail?.sport ?? baseActivity?.sport;
  const sportLabel =
    typeof sportRaw === 'string' && sportRaw.trim()
      ? sportRaw.charAt(0).toUpperCase() + sportRaw.slice(1).toLowerCase()
      : undefined;

  const startMs = parseIsoMs(startDate);
  const endMs = parseIsoMs(endDate);
  const elapsedMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? endMs - startMs
      : undefined;
  const movingTimeMs =
    finitePositive(detail?.movingTimeInMs) ??
    finitePositive(baseActivity?.movingTimeInMs) ??
    parseDurationStringMs(detail?.duration ?? baseActivity?.duration) ??
    elapsedMs;
  const movingSec = movingTimeMs != null ? movingTimeMs / 1000 : undefined;

  const distanceMeters =
    finitePositive(detail?.distanceInMeters) ?? finitePositive(baseActivity?.distanceInMeters);
  const elevationMeters =
    detail?.totalElevation != null && Number.isFinite(detail.totalElevation)
      ? detail.totalElevation
      : baseActivity?.totalElevation != null && Number.isFinite(baseActivity.totalElevation)
        ? baseActivity.totalElevation
        : undefined;

  const avgWatts = finitePositive(detail?.avgWatts) ?? finitePositive(baseActivity?.avgWatts);
  const maxWatts = finitePositive(detail?.maxWatts) ?? finitePositive(baseActivity?.maxWatts);
  const normalizedPower = finitePositive(detail?.normalizedPower);

  const weightGrams =
    finitePositive(activityProfileRec?.weight) ?? finitePositive(targetProfile?.weight);
  const avgWkg =
    avgWatts != null && weightGrams != null
      ? `${(avgWatts / (weightGrams / 1000)).toFixed(2)} W/kg`
      : undefined;

  const avgSpeedMps =
    finitePositive(detail?.avgSpeedInMetersPerSecond) ??
    (distanceMeters != null && movingSec != null && movingSec > 0
      ? distanceMeters / movingSec
      : undefined);
  const maxSpeedMps = finitePositive(detail?.maxSpeedInMetersPerSecond);
  const speedText =
    avgSpeedMps != null && maxSpeedMps != null
      ? `${formatSpeed(avgSpeedMps, units)} / ${formatSpeed(maxSpeedMps, units)}`
      : avgSpeedMps != null
        ? formatSpeed(avgSpeedMps, units)
        : undefined;

  const avgHr = finitePositive(detail?.avgHeartRate) ?? finitePositive(baseActivity?.avgHeartRate);
  const maxHr = finitePositive(detail?.maxHeartRate) ?? finitePositive(baseActivity?.maxHeartRate);
  const hrText =
    avgHr != null || maxHr != null
      ? `${avgHr != null ? Math.round(avgHr) : '—'} / ${maxHr != null ? Math.round(maxHr) : '—'} bpm`
      : undefined;

  const avgCadence =
    finitePositive(detail?.avgCadenceInRotationsPerMinute) ??
    finitePositive(detail?.avgCadence) ??
    finitePositive(baseActivity?.avgCadence);
  const maxCadence =
    finitePositive(detail?.maxCadenceInRotationsPerMinute) ??
    finitePositive(detail?.maxCadence) ??
    finitePositive(baseActivity?.maxCadence);
  const cadenceText =
    avgCadence != null || maxCadence != null
      ? `${avgCadence != null ? Math.round(avgCadence) : '—'} / ${maxCadence != null ? Math.round(maxCadence) : '—'} rpm`
      : undefined;

  const calories = finitePositive(detail?.calories) ?? finitePositive(baseActivity?.calories);
  const workKj =
    avgWatts != null && movingSec != null ? Math.round((avgWatts * movingSec) / 1000) : undefined;

  const activityFtp = finitePositive(detail?.profileFtp) ?? finitePositive(targetProfile?.ftp);
  const ftpPct =
    avgWatts != null && activityFtp != null
      ? Math.round((avgWatts / activityFtp) * 100)
      : undefined;
  const powerZone = ftpPct != null ? getPowerZoneLabel(ftpPct) : undefined;

  const profileMaxHr = finitePositive(detail?.profileMaxHeartRate);
  const maxHrPct =
    maxHr != null && profileMaxHr != null
      ? Math.round((maxHr / profileMaxHr) * 100)
      : undefined;
  const hrEfficiency =
    avgWatts != null && avgHr != null ? `${(avgWatts / avgHr).toFixed(2)} W/bpm` : undefined;

  const climbingDensity =
    elevationMeters != null && distanceMeters != null && distanceMeters > 0
      ? units === 'metric'
        ? `${(elevationMeters / (distanceMeters / 1000)).toFixed(1)} m/km`
        : `${((elevationMeters * 3.28084) / ((distanceMeters / 1000) * 0.621371)).toFixed(0)} ft/mi`
      : undefined;
  const vamMetersPerHour =
    elevationMeters != null && elevationMeters > 0 && movingSec != null && movingSec > 0
      ? Math.round((elevationMeters / movingSec) * 3600)
      : undefined;

  const rideOns = detail?.activityRideOnCount ?? baseActivity?.activityRideOnCount;
  const commentsCount = detail?.activityCommentCount ?? baseActivity?.activityCommentCount;
  const privacy = detail?.privacy ?? baseActivity?.privacy;
  const isPrivate = detail?.privateActivity ?? baseActivity?.privateActivity;

  const linkedEventId =
    passedRace?.eventId || (detail?.eventInfo?.id ? String(detail.eventInfo.id) : '');
  const linkedEventSubgroup =
    passedRace?.zr?.event?.subgroupId ?? passedRace?.zp?.category ?? undefined;

  const photos = extractActivityPhotos(baseActivity, detail);

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

      {detailState.status === 'error' && (
        <div
          role="alert"
          className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 text-xs text-amber-200"
        >
          Unable to load full Zwift Core detail endpoint ({detailState.message}).{' '}
          {baseActivity
            ? 'Showing summary metrics from the activity feed.'
            : 'Some metrics may be unavailable.'}
        </div>
      )}

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs text-slate-400">
              Activity Details ·{' '}
              <Link to={backPath} className="text-accent-text hover:underline font-medium">
                {riderName}
              </Link>{' '}
              (ID {targetRiderId})
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold">{title}</h1>
            <p className="text-xs text-slate-400">
              {formatDateTime(startDate)}
              {worldName ? ` · ${worldName}` : ''}
              {sportLabel ? ` · ${sportLabel}` : ''}
              {rideOns != null && rideOns > 0 ? ` · ${rideOns} Ride Ons` : ''}
              {commentsCount != null && commentsCount > 0 ? ` · ${commentsCount} comments` : ''}
              {` · activity ${activityId}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <ActivityTypeBadge
              type={classified.activityType}
              label={classified.activityTypeLabel}
            />
            <span className="rounded-full bg-slate-700/40 border border-slate-600 px-2.5 py-0.5 text-xs text-slate-300">
              {linkedEventId ? 'Zwift Event' : 'Zwift Feed'}
            </span>
            {isPrivate && (
              <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
                Private
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <RaceExternalLinks
            zpZid={passedRace?.zp?.zid != null ? String(passedRace.zp.zid) : undefined}
            zrEventId={
              passedRace?.zr?.event?.eventId != null
                ? String(passedRace.zr.event.eventId)
                : undefined
            }
            zrSubgroup={passedRace?.zr ? linkedEventSubgroup : undefined}
            routeName={passedRace?.zr?.event?.routeName}
            activityId={activityId}
            align="start"
            showLabels
          />

          {linkedEventId && (
            <Link
              to={`/riders/${targetRiderId}/races/${encodeURIComponent(linkedEventId)}`}
              state={passedRace ? { race: passedRace } : undefined}
              className="inline-flex items-center rounded-lg border border-[#fc6719]/50 bg-[#fc6719]/10 px-3 py-1.5 text-xs font-semibold text-[#fc6719] hover:bg-[#fc6719]/20 transition-colors"
            >
              View Event Standings &amp; Ratings →
            </Link>
          )}
        </div>

        {description && (
          <p className="rounded-xl bg-slate-950/60 border border-slate-800/80 px-4 py-3 text-sm text-slate-300 whitespace-pre-line">
            {description}
          </p>
        )}

        {photos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {photos.map((photo) => (
              <a
                key={photo.url}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-xl overflow-hidden border border-slate-800 bg-slate-950 block hover:border-[#fc6719]/70 transition-colors"
              >
                <img
                  src={photo.url}
                  alt={`${photo.label} for ${title}`}
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

        {detailState.status === 'loading' && (
          <p className="text-xs text-slate-400">Loading detailed Zwift Core telemetry…</p>
        )}

        <MetricGrid
          items={[
            { label: 'Moving Time', value: formatDurationMs(movingTimeMs) },
            { label: 'Elapsed Time', value: formatDurationMs(elapsedMs) },
            { label: 'Distance', value: formatDistance(distanceMeters, units) },
            { label: 'Elevation', value: formatElevation(elevationMeters, units) },
            {
              label: 'Avg Power',
              value: avgWatts != null ? `${Math.round(avgWatts)} W` : undefined,
            },
            {
              label: 'Max Power',
              value: maxWatts != null ? `${Math.round(maxWatts)} W` : undefined,
            },
            { label: 'Avg W/kg', value: avgWkg },
            { label: 'Avg / Max Speed', value: speedText },
            { label: 'Avg / Max HR', value: hrText },
            { label: 'Avg / Max Cadence', value: cadenceText },
            {
              label: 'Calories',
              value: calories != null ? `${Math.round(calories).toLocaleString()} kcal` : undefined,
            },
            {
              label: 'Work',
              value: workKj != null ? `${workKj.toLocaleString()} kJ` : undefined,
            },
          ]}
        />
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
        <div>
          <h2 className="text-lg font-bold">Effort &amp; Physiology Breakdown</h2>
          <p className="text-xs text-slate-400">
            Session intensity, aerobic efficiency, and climbing metrics derived from Zwift Core
            activity data.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">Power &amp; FTP Intensity</h3>
              {ftpPct != null && (
                <span className="text-xs font-semibold text-[#fc6719]">{ftpPct}% FTP</span>
              )}
            </div>
            {powerZone && ftpPct != null && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>{powerZone.zone}</span>
                  <span>
                    {avgWatts != null ? `${Math.round(avgWatts)} W` : '—'} /{' '}
                    {activityFtp != null ? `${Math.round(activityFtp)} W` : '—'}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${powerZone.tone}`}
                    style={{ width: `${Math.min(100, ftpPct)}%` }}
                  />
                </div>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div>
                <dt className="text-slate-400">Avg Power</dt>
                <dd className="font-semibold">
                  {avgWatts != null ? `${Math.round(avgWatts)} W` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Normalized Power</dt>
                <dd className="font-semibold">
                  {normalizedPower != null ? `${Math.round(normalizedPower)} W` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Max Power</dt>
                <dd className="font-semibold">
                  {maxWatts != null ? `${Math.round(maxWatts)} W` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Activity FTP</dt>
                <dd className="font-semibold">
                  {activityFtp != null ? `${Math.round(activityFtp)} W` : '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
            <h3 className="text-sm font-bold">Heart Rate &amp; Efficiency</h3>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-slate-400">Avg HR</dt>
                <dd className="font-semibold">
                  {avgHr != null ? `${Math.round(avgHr)} bpm` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Max HR</dt>
                <dd className="font-semibold">
                  {maxHr != null ? `${Math.round(maxHr)} bpm` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Peak % Max HR</dt>
                <dd className="font-semibold">
                  {maxHrPct != null
                    ? `${maxHrPct}% (${Math.round(profileMaxHr!)} bpm)`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Aerobic Efficiency</dt>
                <dd className="font-semibold">{hrEfficiency ?? '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
            <h3 className="text-sm font-bold">Pace &amp; Climbing</h3>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-slate-400">Avg Speed</dt>
                <dd className="font-semibold">{formatSpeed(avgSpeedMps, units)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Max Speed</dt>
                <dd className="font-semibold">{formatSpeed(maxSpeedMps, units)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Climbing Density</dt>
                <dd className="font-semibold">{climbingDensity ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Avg VAM</dt>
                <dd className="font-semibold">
                  {vamMetersPerHour != null ? `${vamMetersPerHour.toLocaleString()} m/h` : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
        <h2 className="text-lg font-bold">Activity Metadata &amp; Event Context</h2>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">World</dt>
            <dd className="mt-0.5 font-semibold">{worldName ?? '—'}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">Sport</dt>
            <dd className="mt-0.5 font-semibold">{sportLabel ?? '—'}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">Started</dt>
            <dd className="mt-0.5 font-semibold">{formatDateTime(startDate)}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">Finished</dt>
            <dd className="mt-0.5 font-semibold">{formatDateTime(endDate)}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">Privacy</dt>
            <dd className="mt-0.5 font-semibold">{privacy ?? (isPrivate ? 'Private' : 'Public')}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">Ride Ons</dt>
            <dd className="mt-0.5 font-semibold">{rideOns ?? 0}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">Comments</dt>
            <dd className="mt-0.5 font-semibold">{commentsCount ?? 0}</dd>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <dt className="text-slate-400">Rider Weight (Activity)</dt>
            <dd className="mt-0.5 font-semibold">{formatWeight(weightGrams, units)}</dd>
          </div>
        </dl>

        {detail?.eventInfo && (
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <p className="font-bold text-slate-200">
                Linked Event: {decodeHtmlEntities(detail.eventInfo.name) || `Event ${linkedEventId}`}
              </p>
              <p className="text-slate-400">
                {detail.eventInfo.laps ? `${detail.eventInfo.laps} laps` : ''}
                {detail.eventInfo.subgroupTotalEntrantCount
                  ? `${detail.eventInfo.laps ? ' · ' : ''}${detail.eventInfo.subgroupTotalEntrantCount} entrants`
                  : ''}
                {detail.eventInfo.eventSubGroupId
                  ? ` · subgroup ${detail.eventInfo.eventSubGroupId}`
                  : ''}
              </p>
            </div>
            {linkedEventId && (
              <Link
                to={`/riders/${targetRiderId}/races/${encodeURIComponent(linkedEventId)}`}
                state={passedRace ? { race: passedRace } : undefined}
                className="font-semibold text-[#fc6719] hover:underline"
              >
                Inspect full event standings →
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
