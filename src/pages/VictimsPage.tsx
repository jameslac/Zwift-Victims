import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppShell';
import VictimSignupsPanel from '../components/VictimSignupsPanel';
import ZwiftVictimsSection from '../components/ZwiftVictimsSection';
import { useFavorites } from '../lib/FavoritesContext';
import { useUnits } from '../lib/UnitsContext';
import { useRiderRaceHistory } from '../lib/useRiderRaceHistory';
import { useVictimSignups } from '../lib/useVictimSignups';

type VictimsSubTab = 'rivals' | 'signups';

export default function VictimsPage() {
  const { loading, profile, logout } = useAuth();
  const { units, setUnits } = useUnits(profile?.useMetric === false ? 'imperial' : 'metric');
  const { favorites, removeFavorite } = useFavorites();
  const [subTab, setSubTab] = useState<VictimsSubTab>('rivals');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const profileId = profile?.id ?? 0;
  const { zpState, zrState, mergedRaces } = useRiderRaceHistory(profileId);
  const {
    signupsByRiderId,
    groupedUpcomingEvents,
    loading: signupsLoading,
    errorCount: signupsErrorCount,
    refresh: refreshSignups,
  } = useVictimSignups(profileId, favorites);

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">Loading…</main>
    );
  }

  if (!profile) {
    return <Navigate to="/" replace />;
  }

  const rivalsCount = favorites.filter((f) => f.id !== profile.id).length;
  const upcomingCount = groupedUpcomingEvents.length;

  return (
    <main className="min-h-dvh max-w-5xl mx-auto p-4 sm:p-8 pb-24 md:pb-12 space-y-6">
      <AppHeader
        isOwnProfile
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        activeTab="victims"
      />

      {/* Sub-Tabbed Victims Navigation */}
      <div
        role="tablist"
        aria-label="Victims sections"
        className="grid grid-cols-2 gap-1.5 rounded-2xl bg-slate-900 border border-slate-800 p-1.5"
      >
        {(
          [
            { id: 'rivals', label: 'Rivals & H2H', count: rivalsCount },
            { id: 'signups', label: 'Upcoming Signups', count: upcomingCount },
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
              className={`inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold transition-all ${
                active
                  ? 'bg-accent text-accent-foreground shadow'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`rounded-full px-2 py-0.2 text-[11px] font-extrabold tabular-nums ${
                    active
                      ? 'bg-black/25 text-accent-foreground'
                      : tab.id === 'signups'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                        : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {subTab === 'rivals' ? (
        <ZwiftVictimsSection
          profileId={profile.id}
          favorites={favorites}
          onRemoveFavorite={removeFavorite}
          profileRaces={mergedRaces}
          profileZpState={zpState}
          profileZrState={zrState}
          units={units}
          signupsByRiderId={signupsByRiderId}
          signupsLoading={signupsLoading}
        />
      ) : (
        <VictimSignupsPanel
          groupedEvents={groupedUpcomingEvents}
          loading={signupsLoading}
          errorCount={signupsErrorCount}
          rivalsCount={rivalsCount}
          units={units}
          nowMs={nowMs}
          onRefresh={refreshSignups}
        />
      )}
    </main>
  );
}
