export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
}

export interface ZwiftProfile {
  id: number;
  firstName?: string;
  lastName?: string;
  imageSrc?: string;
  countryCode?: number | string;
  /** grams */
  weight?: number;
  /** millimetres */
  height?: number;
  ftp?: number;
  competitionMetrics?: {
    racingScore?: number;
    category?: string;
    categoryWomen?: string;
  };
  /** /api/profiles/me returns many more fields; keep them all accessible. */
  [key: string]: unknown;
}

export class AuthError extends Error {}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const res = await fetch('/api/zwift/auth/token', {
    method: 'POST',
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    throw new AuthError(
      res.status === 401 || res.status === 400
        ? 'Invalid email or password.'
        : `Zwift login failed (${res.status}).`,
    );
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export const login = (username: string, password: string) =>
  tokenRequest({ grant_type: 'password', username, password });

export const refresh = (refreshToken: string) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

export async function fetchMyProfile(accessToken: string): Promise<ZwiftProfile> {
  const res = await fetch('/api/zwift/api/profiles/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new AuthError('Session expired.');
  if (!res.ok) throw new Error(`Failed to load profile (${res.status}).`);
  return res.json();
}
