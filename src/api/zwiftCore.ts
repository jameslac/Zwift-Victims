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

export interface ZwiftActivity {
  id: number;
  id_str?: string;
  profileId?: number;
  worldId?: number;
  name?: string;
  description?: string;
  privateActivity?: boolean;
  sport?: string;
  startDate?: string;
  endDate?: string;
  lastSaveDate?: string;
  autoClosed?: boolean;
  duration?: string;
  distanceInMeters?: number;
  totalElevation?: number;
  avgWatts?: number;
  maxWatts?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  maxCadence?: number;
  calories?: number;
  movingTimeInMs?: number;
  clubId?: string;
  eventSubgroupId?: number;
  fitFileBucket?: string;
  fitFileKey?: string;
  primaryImageUrl?: string;
  fitnessPrivacy?: string;
  privacy?: string;
  activityRideOnCount?: number;
  activityCommentCount?: number;
  notableMomentType?: string | null;
  profile?: Record<string, unknown>;
  /** /api/profiles/{id}/activities returns many nested/raw fields; keep them all accessible. */
  [key: string]: unknown;
}

export interface ZwiftRaceResultEntry {
  id?: number;
  profileId?: number;
  eventSubgroupId?: number;
  rank?: number;
  profileData?: {
    firstName?: string;
    lastName?: string;
    gender?: string;
    weightInGrams?: number;
    heightInCentimeters?: number;
    imageSrc?: string;
    [key: string]: unknown;
  };
  activityData?: {
    activityId?: number | string;
    durationInMilliseconds?: number;
    endDate?: string;
    segmentDistanceInCentimeters?: number;
    elevationInCentimeters?: number;
    calories?: number;
    [key: string]: unknown;
  };
  sensorData?: {
    avgWatts?: number;
    heartRateData?: {
      avgHeartRate?: number;
      maxHeartRate?: number;
      [key: string]: unknown;
    };
    pairedSteeringDevice?: boolean;
    powerType?: string;
    [key: string]: unknown;
  };
  flaggedCheating?: boolean;
  flaggedSandbagging?: boolean;
  criticalP?: {
    criticalP15Seconds?: number;
    criticalP1Minute?: number;
    criticalP5Minutes?: number;
    criticalP20Minutes?: number;
    [key: string]: unknown;
  };
  /** /api/race-results/entries returns additional fields; keep them all accessible. */
  [key: string]: unknown;
}

export interface ZwiftActivityDetail {
  id?: number;
  id_str?: string;
  avgHeartRate?: number;
  maxHeartRate?: number;
  maxWatts?: number;
  avgCadenceInRotationsPerMinute?: number;
  maxCadenceInRotationsPerMinute?: number;
  avgSpeedInMetersPerSecond?: number;
  maxSpeedInMetersPerSecond?: number;
  percentageCompleted?: number;
  profileFtp?: number;
  profileMaxHeartRate?: number;
  fitnessData?: {
    status?: string;
    fullDataUrl?: string;
    smallDataUrl?: string;
    [key: string]: unknown;
  };
  eventInfo?: {
    id?: number;
    eventSubGroupId?: number;
    name?: string;
    durationInSeconds?: number;
    distanceInMeters?: number;
    laps?: number;
    sport?: string;
    subgroupTotalEntrantCount?: number;
    subgroupEventLabel?: number;
    eventSubgroups?: Array<{
      id?: number;
      name?: string;
      label?: number;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  subgroupResults?: {
    topResults?: Array<Record<string, unknown>>;
    nearPlayerResults?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  /** /api/activities/{id} returns many more fields; keep them all accessible. */
  [key: string]: unknown;
}

export interface ZwiftEventSubgroup {
  id: number;
  name?: string;
  description?: string;
  subgroupLabel?: string;
  label?: number;
  routeId?: number;
  laps?: number;
  distanceInMeters?: number;
  durationInSeconds?: number;
  totalEntrantCount?: number;
  totalSignedUpCount?: number;
  eventSubgroupStart?: string;
  rulesId?: number;
  [key: string]: unknown;
}

export interface ZwiftPublicEvent {
  id: number;
  name?: string;
  description?: string;
  eventStart?: string;
  eventType?: string;
  sport?: string;
  routeId?: number;
  worldId?: number;
  laps?: number;
  distanceInMeters?: number;
  durationInSeconds?: number;
  imageUrl?: string;
  rulesId?: number;
  cullingType?: string;
  eventSubgroups?: ZwiftEventSubgroup[];
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

async function fetchAuthorizedJson<T>(accessToken: string, url: string, label: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new AuthError('Session expired.');
  if (!res.ok) throw new Error(`Failed to load ${label} (${res.status}).`);
  return res.json() as Promise<T>;
}

export const fetchMyProfile = (accessToken: string): Promise<ZwiftProfile> =>
  fetchAuthorizedJson<ZwiftProfile>(accessToken, '/api/zwift/api/profiles/me', 'profile');

export const fetchProfileById = (accessToken: string, riderId: number): Promise<ZwiftProfile> =>
  fetchAuthorizedJson<ZwiftProfile>(accessToken, `/api/zwift/api/profiles/${riderId}`, 'profile');

export const fetchActivityDetail = (
  accessToken: string,
  activityIdStr: string,
): Promise<ZwiftActivityDetail> =>
  fetchAuthorizedJson<ZwiftActivityDetail>(
    accessToken,
    `/api/zwift/api/activities/${encodeURIComponent(activityIdStr)}?fetchSnapshots=true&fetchEvent=true`,
    'activity detail',
  );

export async function fetchRiderActivities(
  accessToken: string,
  riderId: number,
  options: { start?: number; limit?: number } = {},
): Promise<ZwiftActivity[]> {
  const params = new URLSearchParams({
    start: String(options.start ?? 0),
    limit: String(options.limit ?? 20),
  });
  const data = await fetchAuthorizedJson<ZwiftActivity[] | { activities?: ZwiftActivity[] }>(
    accessToken,
    `/api/zwift/api/profiles/${riderId}/activities?${params.toString()}`,
    'activities',
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.activities) ? data.activities : [];
}

export const fetchPublicEvent = (
  accessToken: string,
  eventId: string | number,
): Promise<ZwiftPublicEvent> =>
  fetchAuthorizedJson<ZwiftPublicEvent>(
    accessToken,
    `/api/zwift/api/public/events/${encodeURIComponent(String(eventId))}`,
    'event details',
  );

export async function fetchRaceResults(
  accessToken: string,
  eventSubgroupId: number,
): Promise<ZwiftRaceResultEntry[]> {
  const params = new URLSearchParams({
    event_subgroup_id: String(eventSubgroupId),
  });
  const data = await fetchAuthorizedJson<
    ZwiftRaceResultEntry[] | { entries?: ZwiftRaceResultEntry[] }
  >(accessToken, `/api/zwift/api/race-results/entries?${params.toString()}`, 'race results');
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.entries) ? data.entries : [];
}
