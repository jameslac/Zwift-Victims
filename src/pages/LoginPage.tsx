import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { profile, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (profile) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-base focus:outline-none focus:border-[#fc6719]';

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <form
          onSubmit={onSubmit}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4 shadow-xl"
        >
          <h1 className="text-2xl font-extrabold">Log in with Zwift</h1>
          <label className="block space-y-1 text-sm text-slate-300">
            Zwift email
            <input
              className={input}
              type="email"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm text-slate-300">
            Password
            <input
              className={input}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-[#fc6719] py-2.5 font-bold text-white disabled:opacity-60"
          >
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <aside className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
          <p className="font-semibold text-slate-300">Why am I typing my Zwift password here?</p>
          <p>
            Zwift doesn&apos;t offer a &ldquo;Sign in with Zwift&rdquo; redirect for third-party
            apps, so this is the only way to connect your account.
          </p>
          <p>
            We never store your password. It is relayed once to Zwift to get a login token, and
            only that token is kept — on this device, in your browser storage. Log out to remove it.
          </p>
        </aside>
      </div>
    </main>
  );
}
