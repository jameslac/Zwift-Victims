import { Link } from 'react-router-dom';
import { useRiderProfile } from '../lib/useRiderProfile';
import ProfilePage from './ProfilePage';

/** "/" & "/riders/:riderId" — landing when signed out, rider profile when signed in. */
export default function HomePage() {
  const resolution = useRiderProfile();

  if (resolution.status === 'loading') {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">
        {resolution.riderIdParam ? `Loading rider ${resolution.riderIdParam}…` : 'Loading…'}
      </main>
    );
  }

  if (resolution.status === 'invalid_id') {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <p className="text-red-400 text-sm">
            Invalid Zwift rider ID: &ldquo;{resolution.riderIdParam}&rdquo;.
          </p>
          <Link
            to="/"
            className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            Back to my profile
          </Link>
        </div>
      </main>
    );
  }

  if (resolution.status === 'error') {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <p className="text-red-400 text-sm">{resolution.message}</p>
          <Link
            to="/"
            className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            Back to my profile
          </Link>
        </div>
      </main>
    );
  }

  if (resolution.status === 'loaded') {
    return (
      <ProfilePage
        key={resolution.profile.id}
        profile={resolution.profile}
        isOwnProfile={resolution.isOwnProfile}
      />
    );
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl text-center space-y-6">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl text-white font-black text-3xl shadow-lg"
          style={{
            background: 'linear-gradient(135deg, var(--zv-accent), var(--zv-accent-secondary))',
          }}
        >
          Z
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">Zwift Victims</h1>
          <p className="text-slate-400 text-sm">
            Head-to-head Zwift race records, analytics &amp; equipment comparisons with your
            friends.
          </p>
        </div>
        <Link
          to="/login"
          className="block w-full rounded-xl bg-accent hover:bg-accent-hover transition-colors py-3 font-bold text-white"
        >
          Log in with Zwift
        </Link>
      </div>
    </main>
  );
}
