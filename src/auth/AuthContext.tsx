import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthError, fetchMyProfile, login as zwiftLogin, refresh } from '../api/zwiftCore';
import type { TokenSet, ZwiftProfile } from '../api/zwiftCore';

const STORAGE_KEY = 'zv.tokens';

function loadTokens(): TokenSet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}

interface AuthState {
  /** true while restoring a stored session on first load */
  loading: boolean;
  profile: ZwiftProfile | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ZwiftProfile | null>(null);
  const [loading, setLoading] = useState(() => loadTokens() !== null);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfile(null);
  }, []);

  const loadWith = useCallback(async (tokens: TokenSet) => {
    let active = tokens;
    // Refresh slightly early so the profile call doesn't race expiry.
    if (active.expiresAt - Date.now() < 60_000) {
      active = await refresh(active.refreshToken);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    }
    setProfile(await fetchMyProfile(active.accessToken));
  }, []);

  // Restore session on startup.
  useEffect(() => {
    const tokens = loadTokens();
    if (!tokens) return;
    loadWith(tokens)
      .catch((e) => {
        if (e instanceof AuthError) logout();
      })
      .finally(() => setLoading(false));
  }, [loadWith, logout]);

  const login = useCallback(
    async (username: string, password: string) => {
      const tokens = await zwiftLogin(username, password);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
      await loadWith(tokens);
    },
    [loadWith],
  );

  const value = useMemo(
    () => ({ loading, profile, login, logout }),
    [loading, profile, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
