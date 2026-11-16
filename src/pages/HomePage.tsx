import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchProfileById } from '../api/zwiftCore';
import type { ZwiftProfile } from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';
import ProfilePage from './ProfilePage';

/** "/" & "/riders/:riderId" — landing when signed out, rider profile when signed in. */
export default function HomePage() {
  const { loading, profile, getAccessToken } = useAuth();
  const { riderId } = useParams<{ riderId?: string }>();
  const parsedRiderId = riderId && /^\d+$/.test(riderId) ? Number(riderId) : null;
  const isInvalidRiderId = Boolean(riderId) && parsedRiderId === null;
  const needsRemoteFetch =
    Boolean(profile) && parsedRiderId !== null && parsedRiderId !== profile!.id;

  const [fetched, setFetched] = useState<{
    riderId: number;
    profile: ZwiftProfile | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!needsRemoteFetch || parsedRiderId === null) return;
    let cancelled = false;
    getAccessToken()
      .then((token) => fetchProfileById(token, parsedRiderId))
      .then((loaded) => {
        if (!cancelled) setFetched({ riderId: parsedRiderId, profile: loaded, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetched({
            riderId: parsedRiderId,
            profile: null,
            error: err instanceof Error ? err.message : 'Failed to load rider profile.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getAccessToken, needsRemoteFetch, parsedRiderId]);

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center text-slate-400">Loading…</main>
    );
  }

  if (profile) {
    if (isInvalidRiderId) {
      return (
        <main className="min-h-dvh flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
            <p className="text-red-400 text-sm">Invalid Zwift rider ID: &ldquo;{riderId}&rdquo;.</p>
            <Link
              to="/"
              className="inline-block rounded-lg bg-[#fc6719] px-4 py-2 text-sm font-bold text-white"
            >
              Back to my profile
            </Link>
          </div>
        </main>
      );
    }

    if (needsRemoteFetch) {
      if (fetched?.riderId !== parsedRiderId) {
        return (
          <main className="min-h-dvh flex items-center justify-center text-slate-400">
            Loading rider {parsedRiderId}…
          </main>
        );
      }
      if (fetched.error || !fetched.profile) {
        return (
          <main className="min-h-dvh flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
              <p className="text-red-400 text-sm">
                {fetched.error ?? `Unable to load rider ${parsedRiderId}.`}
              </p>
              <Link
                to="/"
                className="inline-block rounded-lg bg-[#fc6719] px-4 py-2 text-sm font-bold text-white"
              >
                Back to my profile
              </Link>
            </div>
          </main>
        );
      }
      return (
        <ProfilePage
          key={fetched.profile.id}
          profile={fetched.profile}
          isOwnProfile={false}
        />
      );
    }

    return <ProfilePage key={profile.id} profile={profile} isOwnProfile />;
  }

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
