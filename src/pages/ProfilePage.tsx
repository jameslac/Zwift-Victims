import { useAuth } from '../auth/AuthContext';
import { useUnits } from '../lib/UnitsContext';
import { formatHeight, formatWeight, formatWkg } from '../lib/units';
import type { UnitSystem } from '../lib/units';
import type { ZwiftProfile } from '../api/zwiftCore';

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{value ?? '—'}</dd>
    </div>
  );
}

export default function ProfilePage({ profile }: { profile: ZwiftProfile }) {
  const { logout } = useAuth();
  const { units, setUnits } = useUnits();
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Zwift rider';
  const metrics = profile.competitionMetrics;

  return (
    <main className="min-h-dvh max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <span className="font-extrabold text-lg">Zwift Victims</span>
        <div className="flex items-center gap-2">
          <select
            aria-label="Units"
            value={units}
            onChange={(e) => setUnits(e.target.value as UnitSystem)}
            className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm"
          >
            <option value="metric">Metric (kg, cm)</option>
            <option value="imperial">Imperial (lb, ft)</option>
          </select>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Log out
          </button>
        </div>
      </header>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
          {profile.imageSrc ? (
            <img
              src={profile.imageSrc}
              alt={name}
              className="w-24 h-24 rounded-full object-cover border-2 border-[#fc6719]"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center text-3xl font-bold">
              {name[0]}
            </div>
          )}
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold">{name}</h1>
            <p className="text-sm text-slate-400">Zwift ID {profile.id}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="FTP" value={profile.ftp ? `${profile.ftp} W` : undefined} />
          <Stat label="W/kg" value={formatWkg(profile.ftp, profile.weight)} />
          <Stat label="Weight" value={formatWeight(profile.weight, units)} />
          <Stat label="Height" value={formatHeight(profile.height, units)} />
          <Stat label="Racing Score" value={metrics?.racingScore} />
          <Stat label="Category" value={metrics?.category ?? metrics?.categoryWomen} />
        </dl>
      </section>
    </main>
  );
}
