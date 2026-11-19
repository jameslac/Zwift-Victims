import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPowerProfile, getCachedPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerProfile, ZwiftProfile } from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppShell';
import PowerBestsSection from '../components/PowerBestsSection';
import ZwiftRacingProfileSection from '../components/ZwiftRacingProfileSection';
import { useFavorites } from '../lib/FavoritesContext';
import { useTheme } from '../lib/ThemeContext';
import { useUnits } from '../lib/UnitsContext';
import { extractPowerProfileMetrics } from '../lib/powerBests';
import { getXpProgress } from '../lib/profileXp';
import type { AsyncState } from '../lib/raceHistory';
import { COLOR_SCHEMES, NAV_STYLES, PROFILE_LAYOUTS } from '../lib/themeConfig';
import {
  formatDistance,
  formatDrops,
  formatElevation,
  formatHeight,
  formatWeight,
  formatWkg,
} from '../lib/units';
import {
  formatRiderCategory,
  formatRiderName,
  getFavoriteCategory,
} from '../lib/useRiderProfile';
import { useRiderRaceHistory } from '../lib/useRiderRaceHistory';
import {
  buildPhenotypeProfile,
  buildVeloSummary,
  getVeloTier,
} from '../lib/zwiftRacingProfile';

function categoryPillTone(cat: string | undefined): string {
  const lead = cat?.trim().toUpperCase()[0];
  switch (lead) {
    case 'A':
      return 'bg-red-500/15 border-red-500/40 text-red-300';
    case 'B':
      return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    case 'C':
      return 'bg-sky-500/15 border-sky-500/40 text-sky-300';
    case 'D':
      return 'bg-amber-500/15 border-amber-500/40 text-amber-300';
    case 'E':
      return 'bg-violet-500/15 border-violet-500/40 text-violet-300';
    default:
      return 'bg-slate-800 border-slate-700 text-slate-200';
  }
}

function XpProgressBar({ profile }: { profile: ZwiftProfile }) {
  const xp = getXpProgress(profile);
  if (!xp) return null;

  const xpLabel =
    xp.totalXp !== null && xp.nextLevelXp !== null
      ? `${xp.totalXp.toLocaleString()} / ${xp.nextLevelXp.toLocaleString()} XP`
      : xp.totalXp !== null
        ? `${xp.totalXp.toLocaleString()} XP`
        : null;

  return (
    <div className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-3.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-accent/20 border border-accent/40 px-2.5 py-0.5 text-xs font-extrabold text-accent-text">
            {xp.level !== null ? `Level ${xp.level}` : 'XP Progress'}
          </span>
          {xpLabel && <span className="font-semibold text-slate-200 tabular-nums">{xpLabel}</span>}
        </div>
        <div className="text-xs text-slate-400">
          {xp.xpRemaining !== null && xp.level !== null && xp.xpRemaining > 0 ? (
            <>
              <span className="font-bold text-slate-100">{xp.progressPct}%</span>
              <span> · {xp.xpRemaining.toLocaleString()} XP to Level {xp.level + 1}</span>
            </>
          ) : (
            <span className="font-bold text-slate-100">{xp.progressPct}%</span>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={xp.level !== null ? `Level ${xp.level} XP progress` : 'XP progress'}
        aria-valuenow={xp.progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${xp.progressPct}%`,
            background: 'linear-gradient(90deg, var(--zv-accent), var(--zv-accent-secondary))',
          }}
        />
      </div>
    </div>
  );
}

function TelemetryTile({
  label,
  value,
  subValue,
  highlight = false,
}: {
  label: string;
  value: string | number | undefined;
  subValue?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        highlight
          ? 'bg-accent/10 border-accent/35'
          : 'bg-slate-950/70 border-slate-800/90'
      }`}
    >
      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd
        className={`mt-1 text-lg sm:text-xl font-extrabold tabular-nums ${
          highlight ? 'text-accent-text' : 'text-slate-100'
        }`}
      >
        {value ?? '—'}
      </dd>
      {subValue && <dd className="mt-0.5 text-xs text-slate-400 tabular-nums">{subValue}</dd>}
    </div>
  );
}

function RedesignQuickBar() {
  const {
    colorScheme,
    setColorScheme,
    navStyle,
    setNavStyle,
    profileLayout,
    setProfileLayout,
    setStudioOpen,
  } = useTheme();
  const [minimized, setMinimized] = useState(false);

  if (minimized) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold text-accent-text hover:bg-accent/20 transition-colors"
        >
          <span>Show UI Redesign Switcher</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Interactive UI Redesign Switcher"
      className="rounded-2xl bg-slate-900/90 border border-accent/35 p-3.5 sm:p-4 space-y-3 shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
            UI Redesign Preview
          </span>
          <p className="text-xs text-slate-300">
            Test color palettes, navigation styles, and profile layouts live on mobile &amp; web:
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStudioOpen(true)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text"
          >
            Full Studio
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-label="Minimize redesign preview bar"
            className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 text-xs">
        {/* Color Scheme Pills */}
        <div className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-2.5 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Color Scheme
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_SCHEMES.map((scheme) => {
              const active = colorScheme === scheme.id;
              return (
                <button
                  key={scheme.id}
                  type="button"
                  onClick={() => setColorScheme(scheme.id)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold transition-all ${
                    active
                      ? 'border-accent bg-accent/20 text-slate-100'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: scheme.accentHex }}
                  />
                  <span>{scheme.name.replace('Classic ', '')}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation Style Pills */}
        <div className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-2.5 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Navigation Style
          </div>
          <div className="flex flex-wrap gap-1.5">
            {NAV_STYLES.map((style) => {
              const active = navStyle === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setNavStyle(style.id)}
                  aria-pressed={active}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all ${
                    active
                      ? 'border-accent bg-accent text-white'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {style.shortName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Profile Layout Pills */}
        <div className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-2.5 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Profile Layout
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_LAYOUTS.map((layout) => {
              const active = profileLayout === layout.id;
              return (
                <button
                  key={layout.id}
                  type="button"
                  onClick={() => setProfileLayout(layout.id)}
                  aria-pressed={active}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all ${
                    active
                      ? 'border-accent bg-accent text-white'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {layout.shortName}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

type ProfileSubTab = 'overview' | 'zwiftracing' | 'power';

export default function ProfilePage({
  profile,
  isOwnProfile = true,
}: {
  profile: ZwiftProfile;
  isOwnProfile?: boolean;
}) {
  const { logout, getAccessToken } = useAuth();
  const { units, setUnits } = useUnits(profile.useMetric === false ? 'imperial' : 'metric');
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { profileLayout } = useTheme();
  const [subTab, setSubTab] = useState<ProfileSubTab>('overview');

  const { zpState, zrState, mergedRaces } = useRiderRaceHistory(profile.id, {
    includeActivities: false,
  });

  const [powerProfileState, setPowerProfileState] = useState<AsyncState<ZwiftPowerProfile> | null>(
    () => {
      if (!isOwnProfile) return null;
      const cached = getCachedPowerProfile();
      return cached ? { status: 'loaded', data: cached } : { status: 'loading' };
    },
  );

  useEffect(() => {
    if (!isOwnProfile) return;
    let cancelled = false;
    getAccessToken()
      .then(fetchPowerProfile)
      .then((data) => {
        if (!cancelled) setPowerProfileState({ status: 'loaded', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPowerProfileState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load Zwift power profile.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profile.id, isOwnProfile, getAccessToken]);

  const name = formatRiderName(profile);
  const metrics = profile.competitionMetrics;
  const { zftp, zmap, vo2max } = extractPowerProfileMetrics(
    powerProfileState?.status === 'loaded' ? powerProfileState.data : null,
  );
  const racingScore =
    metrics?.racingScore != null && Number.isFinite(metrics.racingScore)
      ? Math.round(metrics.racingScore)
      : undefined;
  const riderCategory = formatRiderCategory(profile);
  const favoriteCategory = getFavoriteCategory(profile);
  const favorited = isFavorite(profile.id);
  const xp = getXpProgress(profile);

  const zrData = zrState.status === 'loaded' ? zrState.data : null;
  const veloSummary = zrData ? buildVeloSummary(zrData.rider, zrData.overview) : null;
  const liveVelo = veloSummary?.velo2.live ?? veloSummary?.legacy.live;
  const liveVeloTier =
    veloSummary?.velo2.live !== undefined
      ? getVeloTier(veloSummary.velo2.live, 'velo2')
      : veloSummary?.legacy.live !== undefined
        ? getVeloTier(veloSummary.legacy.live, 'legacy')
        : null;
  const phenotype = zrData ? buildPhenotypeProfile(zrData.rider) : null;

  const historyPath = isOwnProfile ? '/history' : `/riders/${profile.id}/history`;
  const rivalsCount = favorites.filter((f) => f.id !== profile.id).length;

  const riderHeroSection = (
    <section className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-7 space-y-5 shadow-xl">
      {/* Subtle top-right accent glow */}
      <div
        className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-20"
        style={{ background: 'var(--zv-accent)' }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 text-center sm:text-left">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
          <div className="relative shrink-0">
            {profile.imageSrc ? (
              <img
                src={profile.imageSrc}
                alt={name}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-2 border-accent shadow-lg"
              />
            ) : (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-slate-800 border-2 border-accent flex items-center justify-center text-3xl font-black text-slate-100 shadow-lg">
                {name[0]}
              </div>
            )}
            {xp?.level !== null && xp?.level !== undefined && (
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow">
                LVL {xp.level}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-100">
                {name}
              </h1>
              {riderCategory && (
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${categoryPillTone(
                    riderCategory,
                  )}`}
                >
                  Cat {riderCategory}
                </span>
              )}
              {!isOwnProfile && (
                <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                  Rider Profile
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-slate-400">
              <span className="font-mono">Zwift ID #{profile.id}</span>
              {racingScore !== undefined && (
                <span className="rounded-md bg-slate-950/80 border border-slate-800 px-2 py-0.5 font-semibold text-slate-200">
                  ZRS {racingScore}
                </span>
              )}
              {liveVelo !== undefined && (
                <span className="rounded-md bg-slate-950/80 border border-slate-800 px-2 py-0.5 font-semibold text-slate-200">
                  vELO {liveVelo.toFixed(0)}
                  {liveVeloTier ? ` · ${liveVeloTier.name}` : ''}
                </span>
              )}
              {phenotype?.label && phenotype.label !== 'Unclassified' && (
                <span className="rounded-md bg-accent/15 border border-accent/35 px-2 py-0.5 font-bold text-accent-text">
                  {phenotype.label}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Quick Action & Page Shortcuts */}
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 shrink-0">
          {!isOwnProfile && (
            <button
              type="button"
              onClick={() =>
                toggleFavorite({
                  id: profile.id,
                  name,
                  imageSrc: profile.imageSrc,
                  category: favoriteCategory,
                })
              }
              aria-pressed={favorited}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs sm:text-sm font-bold transition-colors ${
                favorited
                  ? 'bg-amber-500/15 border-amber-400/50 text-amber-300 hover:bg-amber-500/25'
                  : 'bg-slate-950/80 border-slate-700 text-slate-200 hover:border-amber-400/50 hover:text-amber-300'
              }`}
            >
              <span aria-hidden="true">{favorited ? '★' : '☆'}</span>
              <span>{favorited ? 'Favorited' : 'Add to Victims'}</span>
            </button>
          )}

          <Link
            to={historyPath}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
          >
            <span>Race History</span>
            {mergedRaces.length > 0 && (
              <span className="rounded-full bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-300 tabular-nums">
                {mergedRaces.length}
              </span>
            )}
            <span>→</span>
          </Link>

          {isOwnProfile && (
            <Link
              to="/victims"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
            >
              <span>Victims</span>
              {rivalsCount > 0 && (
                <span className="rounded-full bg-accent/20 text-accent-text px-1.5 py-0.2 text-[10px] font-extrabold tabular-nums">
                  {rivalsCount}
                </span>
              )}
              <span>→</span>
            </Link>
          )}
        </div>
      </div>

      <XpProgressBar profile={profile} />

      {/* Primary Power Thresholds Strip inside Hero */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
          <span>Power &amp; Physiological Thresholds</span>
          {vo2max !== undefined && (
            <span className="text-accent-text">VO2max {vo2max.toFixed(1)} mL/kg/min</span>
          )}
        </div>
        <dl
          className={`grid grid-cols-2 ${
            isOwnProfile ? 'sm:grid-cols-4' : 'sm:grid-cols-2'
          } gap-2.5`}
        >
          <TelemetryTile
            label="FTP"
            value={profile.ftp ? `${profile.ftp} W` : undefined}
            subValue={formatWkg(profile.ftp, profile.weight)}
            highlight
          />
          <TelemetryTile
            label="FTP W/kg"
            value={formatWkg(profile.ftp, profile.weight)}
            subValue={formatWeight(profile.weight, units)}
          />
          {isOwnProfile && (
            <>
              <TelemetryTile
                label="zFTP"
                value={
                  powerProfileState?.status === 'loading'
                    ? '…'
                    : zftp !== undefined
                      ? `${Math.round(zftp)} W`
                      : undefined
                }
                subValue={
                  zftp !== undefined && profile.weight ? formatWkg(zftp, profile.weight) : undefined
                }
              />
              <TelemetryTile
                label="zMAP"
                value={
                  powerProfileState?.status === 'loading'
                    ? '…'
                    : zmap !== undefined
                      ? `${Math.round(zmap)} W`
                      : undefined
                }
                subValue={
                  zmap !== undefined && profile.weight ? formatWkg(zmap, profile.weight) : undefined
                }
              />
            </>
          )}
        </dl>
      </div>
    </section>
  );

  const competitiveAndCareerBento = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Competitive Standing Card */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Competitive Standing
          </h2>
          <Link
            to={historyPath}
            className="text-xs font-semibold text-accent-text hover:underline"
          >
            View {mergedRaces.length > 0 ? `${mergedRaces.length} races` : 'races'} →
          </Link>
        </div>
        <dl className="grid grid-cols-2 gap-2.5">
          <TelemetryTile
            label="Racing Score"
            value={racingScore}
            subValue={riderCategory ? `Cat ${riderCategory}` : undefined}
          />
          <TelemetryTile
            label="Category"
            value={riderCategory}
            subValue={
              phenotype?.label && phenotype.label !== 'Unclassified' ? phenotype.label : undefined
            }
          />
          <TelemetryTile
            label="Live vELO"
            value={liveVelo !== undefined ? liveVelo.toFixed(1) : undefined}
            subValue={liveVeloTier?.name}
          />
          <TelemetryTile
            label="Tracked Races"
            value={zpState.status === 'loaded' ? mergedRaces.length : '…'}
            subValue={
              zrData?.rider?.race?.wins !== undefined
                ? `${zrData.rider.race.wins} ZR wins`
                : undefined
            }
          />
        </dl>
      </section>

      {/* Physique & Career Totals Card */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Physique &amp; Career Odometer
          </h2>
          <span className="text-[11px] text-slate-400">
            {units === 'metric' ? 'Metric' : 'Imperial'}
          </span>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <TelemetryTile label="Weight" value={formatWeight(profile.weight, units)} />
          <TelemetryTile label="Height" value={formatHeight(profile.height, units)} />
          <TelemetryTile label="Drops" value={formatDrops(profile.totalGold)} />
          <TelemetryTile
            label="Total Distance"
            value={formatDistance(profile.totalDistance, units)}
          />
          <TelemetryTile
            label="Total Climbed"
            value={formatElevation(profile.totalDistanceClimbed, units)}
          />
          <TelemetryTile
            label="XP Level"
            value={xp?.level != null ? `Level ${xp.level}` : undefined}
            subValue={xp ? `${xp.progressPct}% to next` : undefined}
          />
        </dl>
      </section>
    </div>
  );

  return (
    <main className="min-h-dvh max-w-5xl mx-auto p-4 sm:p-8 pb-24 md:pb-12 space-y-6">
      <AppHeader
        isOwnProfile={isOwnProfile}
        targetRiderId={profile.id}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        activeTab="profile"
      />

      <RedesignQuickBar />

      {profileLayout === 'bento' && (
        <div className="space-y-6">
          {riderHeroSection}
          {competitiveAndCareerBento}
          <ZwiftRacingProfileSection profileId={profile.id} zrState={zrState} />
          <PowerBestsSection
            riderName={name}
            isOwnProfile={isOwnProfile}
            weightGrams={profile.weight}
            units={units}
            ftp={profile.ftp}
            zftp={zftp}
            zmap={zmap}
            powerProfileState={powerProfileState}
            zpState={zpState}
          />
        </div>
      )}

      {profileLayout === 'split' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Sticky Dossier Column */}
          <div className="lg:col-span-4 lg:sticky lg:top-20 space-y-4">
            {riderHeroSection}
            <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Standing &amp; Career
              </h2>
              <dl className="grid grid-cols-2 gap-2.5">
                <TelemetryTile label="Racing Score" value={racingScore} />
                <TelemetryTile label="Category" value={riderCategory} />
                <TelemetryTile label="Weight" value={formatWeight(profile.weight, units)} />
                <TelemetryTile label="Height" value={formatHeight(profile.height, units)} />
                <TelemetryTile
                  label="Distance"
                  value={formatDistance(profile.totalDistance, units)}
                />
                <TelemetryTile
                  label="Climbed"
                  value={formatElevation(profile.totalDistanceClimbed, units)}
                />
                <TelemetryTile label="Drops" value={formatDrops(profile.totalGold)} />
                <TelemetryTile
                  label="Races"
                  value={zpState.status === 'loaded' ? mergedRaces.length : '…'}
                />
              </dl>
            </section>
          </div>

          {/* Right Analytics Column */}
          <div className="lg:col-span-8 space-y-6">
            <ZwiftRacingProfileSection profileId={profile.id} zrState={zrState} />
            <PowerBestsSection
              riderName={name}
              isOwnProfile={isOwnProfile}
              weightGrams={profile.weight}
              units={units}
              ftp={profile.ftp}
              zftp={zftp}
              zmap={zmap}
              powerProfileState={powerProfileState}
              zpState={zpState}
            />
          </div>
        </div>
      )}

      {profileLayout === 'tabbed' && (
        <div className="space-y-5">
          {riderHeroSection}

          <div
            role="tablist"
            aria-label="Profile sections"
            className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-900 border border-slate-800 p-1.5"
          >
            {(
              [
                { id: 'overview', label: 'Standing & Career' },
                { id: 'zwiftracing', label: 'ZwiftRacing & Phenotype' },
                { id: 'power', label: 'Power Curve & Bests' },
              ] as const
            ).map((tab) => {
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSubTab(tab.id)}
                  className={`rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold transition-all ${
                    active
                      ? 'bg-accent text-white shadow'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {subTab === 'overview' && competitiveAndCareerBento}
          {subTab === 'zwiftracing' && (
            <ZwiftRacingProfileSection profileId={profile.id} zrState={zrState} />
          )}
          {subTab === 'power' && (
            <PowerBestsSection
              riderName={name}
              isOwnProfile={isOwnProfile}
              weightGrams={profile.weight}
              units={units}
              ftp={profile.ftp}
              zftp={zftp}
              zmap={zmap}
              powerProfileState={powerProfileState}
              zpState={zpState}
            />
          )}
        </div>
      )}
    </main>
  );
}
