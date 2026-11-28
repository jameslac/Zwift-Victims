import { useEffect, useState } from 'react';
import { fetchPowerProfile, getCachedPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerProfile, ZwiftProfile } from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppShell';
import McpConnectModal from '../components/McpConnectModal';
import PowerBestsSection from '../components/PowerBestsSection';
import ZwiftRacingProfileSection from '../components/ZwiftRacingProfileSection';
import { useFavorites } from '../lib/FavoritesContext';
import { useUnits } from '../lib/UnitsContext';
import { extractPowerProfileMetrics } from '../lib/powerBests';
import { getXpProgress } from '../lib/profileXp';
import type { AsyncState } from '../lib/raceHistory';
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
  const { isFavorite, toggleFavorite } = useFavorites();
  const [subTab, setSubTab] = useState<ProfileSubTab>('overview');
  const [mcpOpen, setMcpOpen] = useState(false);

  const { zpState, zrState } = useRiderRaceHistory(profile.id, {
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

  return (
    <main className="min-h-dvh max-w-5xl mx-auto p-4 sm:p-8 pb-24 md:pb-12 space-y-5">
      <AppHeader
        isOwnProfile={isOwnProfile}
        targetRiderId={profile.id}
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        activeTab="profile"
      />

      {/* Compact Rider Identity Hero (No Duplicate Metrics) */}
      <section className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-6 space-y-4 shadow-xl">
        <div
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-20"
          style={{ background: 'var(--zv-accent)' }}
          aria-hidden="true"
        />

        <div className="relative flex items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 sm:gap-4 min-w-0 flex-1">
            {profile.imageSrc ? (
              <img
                src={profile.imageSrc}
                alt={name}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-accent shadow-lg shrink-0"
              />
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-800 border-2 border-accent flex items-center justify-center text-2xl sm:text-3xl font-black text-slate-100 shadow-lg shrink-0">
                {name[0]}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-3xl font-black tracking-tight text-slate-100 leading-snug break-words">
                {name}
              </h1>
              <p className="text-xs text-slate-400 font-mono mt-0.5">Zwift ID #{profile.id}</p>
            </div>
          </div>

          {/* Right-aligned Category Badge & Favorite Action */}
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 shrink-0 ml-auto">
            {riderCategory && (
              <span
                className={`rounded-full border px-3 py-1 text-xs font-extrabold tracking-wide ${categoryPillTone(
                  riderCategory,
                )}`}
              >
                Cat {riderCategory}
              </span>
            )}

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
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
                  favorited
                    ? 'bg-amber-500/15 border-amber-400/50 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-slate-950/80 border-slate-700 text-slate-200 hover:border-amber-400/50 hover:text-amber-300'
                }`}
              >
                <span aria-hidden="true">{favorited ? '★' : '☆'}</span>
                <span>{favorited ? 'Favorited' : 'Add to Victims'}</span>
              </button>
            )}
          </div>
        </div>

        <XpProgressBar profile={profile} />
      </section>

      {/* Sub-Tabbed Profile Navigation */}
      <div
        role="tablist"
        aria-label="Profile sections"
        className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-900 border border-slate-800 p-1.5"
      >
        {(
          [
            { id: 'overview', label: 'Overview & Bio', shortLabel: 'Overview' },
            { id: 'zwiftracing', label: 'ZwiftRacing & Phenotype', shortLabel: 'ZwiftRacing' },
            { id: 'power', label: 'Power Curve & Bests', shortLabel: 'Power Curve' },
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
              className={`rounded-xl py-2.5 px-2 sm:px-3 text-xs sm:text-sm font-bold transition-all ${
                active
                  ? 'bg-accent text-accent-foreground shadow'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              }`}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview & Bio (Every Metric Shown Once) */}
      {subTab === 'overview' && (
        <div className="space-y-4">
          {isOwnProfile && (
            <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Power &amp; Physiological Thresholds
              </h2>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <TelemetryTile
                  label="FTP"
                  value={profile.ftp ? `${profile.ftp} W` : undefined}
                  subValue={formatWkg(profile.ftp, profile.weight)}
                  highlight
                />
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
                    zftp !== undefined && profile.weight
                      ? formatWkg(zftp, profile.weight)
                      : undefined
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
                    zmap !== undefined && profile.weight
                      ? formatWkg(zmap, profile.weight)
                      : undefined
                  }
                />
                <TelemetryTile
                  label="VO2max"
                  value={
                    powerProfileState?.status === 'loading'
                      ? '…'
                      : vo2max !== undefined
                        ? vo2max.toFixed(1)
                        : undefined
                  }
                  subValue={vo2max !== undefined ? 'mL/kg/min' : undefined}
                />
              </dl>
            </section>
          )}

          <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Rider Bio &amp; Career Totals
              </h2>
              <span className="text-[11px] text-slate-400">
                {units === 'metric' ? 'Metric (kg, km)' : 'Imperial (lb, mi)'}
              </span>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {!isOwnProfile && (
                <TelemetryTile
                  label="FTP"
                  value={profile.ftp ? `${profile.ftp} W` : undefined}
                  subValue={formatWkg(profile.ftp, profile.weight)}
                  highlight
                />
              )}
              <TelemetryTile
                label="Racing Score (ZRS)"
                value={racingScore}
                highlight={isOwnProfile && racingScore !== undefined}
              />
              <TelemetryTile label="Weight" value={formatWeight(profile.weight, units)} />
              <TelemetryTile label="Height" value={formatHeight(profile.height, units)} />
              <TelemetryTile
                label="Total Distance"
                value={formatDistance(profile.totalDistance, units)}
              />
              <TelemetryTile
                label="Total Climbed"
                value={formatElevation(profile.totalDistanceClimbed, units)}
              />
              <TelemetryTile label="Drops" value={formatDrops(profile.totalGold)} />
            </dl>
          </section>

          {isOwnProfile && (
            <section className="rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-accent/15 border border-accent/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-text">
                    Remote MCP
                  </span>
                  <h2 className="text-sm font-extrabold text-slate-100">Connect AI / MCP</h2>
                </div>
                <p className="text-xs text-slate-400">
                  Link Gemini CLI, Claude Code, or Claude Desktop to query your Zwift races and
                  telemetry on demand.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMcpOpen(true)}
                className="shrink-0 rounded-xl bg-accent px-4 py-2 text-xs font-extrabold text-accent-foreground hover:opacity-95 transition-opacity self-start sm:self-center"
              >
                Connect AI / MCP
              </button>
            </section>
          )}
        </div>
      )}

      {/* Tab 2: ZwiftRacing & Phenotype */}
      {subTab === 'zwiftracing' && (
        <ZwiftRacingProfileSection profileId={profile.id} zrState={zrState} />
      )}

      {/* Tab 3: Power Curve & Interval Bests */}
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
      {mcpOpen && <McpConnectModal onClose={() => setMcpOpen(false)} />}
    </main>
  );
}
