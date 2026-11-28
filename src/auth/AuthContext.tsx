import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  getAccessToken: () => Promise<string>;
  getTokenSet: () => Promise<TokenSet>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ZwiftProfile | null>(null);
  const [loading, setLoading] = useState(() => loadTokens() !== null);
  const refreshInFlightRef = useRef<Promise<TokenSet> | null>(null);
  const sessionGenRef = useRef(0);

  const logout = useCallback(() => {
    sessionGenRef.current += 1;
    refreshInFlightRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
    setProfile(null);
  }, []);

  const ensureFreshTokens = useCallback(
    async (tokens: TokenSet): Promise<TokenSet> => {
      // Refresh slightly early so API calls don't race expiry.
      if (tokens.expiresAt - Date.now() >= 60_000) return tokens;
      if (refreshInFlightRef.current) return refreshInFlightRef.current;

      const gen = sessionGenRef.current;
      const req = refresh(tokens.refreshToken)
        .then((refreshed) => {
          if (sessionGenRef.current === gen) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
          }
          return refreshed;
        })
        .catch((e) => {
          if (e instanceof AuthError && sessionGenRef.current === gen) {
            logout();
          }
          throw e;
        })
        .finally(() => {
          if (refreshInFlightRef.current === req) {
            refreshInFlightRef.current = null;
          }
        });

      refreshInFlightRef.current = req;
      return req;
    },
    [logout],
  );

  const loadWith = useCallback(
    async (tokens: TokenSet) => {
      const active = await ensureFreshTokens(tokens);
      setProfile(await fetchMyProfile(active.accessToken));
    },
    [ensureFreshTokens],
  );

  const getTokenSet = useCallback(async (): Promise<TokenSet> => {
    const tokens = loadTokens();
    if (!tokens) {
      logout();
      throw new AuthError('Not authenticated.');
    }
    return ensureFreshTokens(tokens);
  }, [ensureFreshTokens, logout]);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const active = await getTokenSet();
    return active.accessToken;
  }, [getTokenSet]);

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
      sessionGenRef.current += 1;
      refreshInFlightRef.current = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
      await loadWith(tokens);
    },
    [loadWith],
  );

  const value = useMemo(
    () => ({ loading, profile, login, logout, getAccessToken, getTokenSet }),
    [loading, profile, login, logout, getAccessToken, getTokenSet],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
