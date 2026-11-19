import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppShell';
import ZwiftVictimsSection from '../components/ZwiftVictimsSection';
import { useFavorites } from '../lib/FavoritesContext';
import { useUnits } from '../lib/UnitsContext';
import { useRiderRaceHistory } from '../lib/useRiderRaceHistory';

export default function VictimsPage() {
  const { loading, profile, logout } = useAuth();
  const { units, setUnits } = useUnits(profile?.useMetric === false ? 'imperial' : 'metric');
  const { favorites, removeFavorite } = useFavorites();

  const { zpState, zrState, mergedRaces } = useRiderRaceHistory(profile?.id ?? 0);

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">Loading…</main>
    );
  }

  if (!profile) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="min-h-dvh max-w-5xl mx-auto p-4 sm:p-8 pb-24 md:pb-12 space-y-6">
      <AppHeader
        isOwnProfile
        units={units}
        onUnitsChange={setUnits}
        onLogout={logout}
        activeTab="victims"
      />

      <ZwiftVictimsSection
        profileId={profile.id}
        favorites={favorites}
        onRemoveFavorite={removeFavorite}
        profileRaces={mergedRaces}
        profileZpState={zpState}
        profileZrState={zrState}
      />
    </main>
  );
}
