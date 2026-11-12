import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ProfilePage from './ProfilePage';

/** "/" — landing + login button when signed out, profile when signed in. */
export default function HomePage() {
  const { loading, profile } = useAuth();

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">Loading…</main>
    );
  }
  if (profile) return <ProfilePage profile={profile} />;

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#fc6719] text-white font-black text-3xl">
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
          className="block w-full rounded-lg bg-[#fc6719] py-3 font-bold text-white"
        >
          Log in with Zwift
        </Link>
      </div>
    </main>
  );
}
