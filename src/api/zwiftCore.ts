export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
}

export interface ZwiftCompetitionMetrics {
  racingScore?: number | null;
  category?: string | null;
  categoryWomen?: string | null;
  [key: string]: unknown;
}

export interface ZwiftProfile {
  id: number;
  firstName?: string;
  lastName?: string;
  male?: boolean;
  imageSrc?: string;
  countryCode?: number | string;
  useMetric?: boolean;
  /** grams */
  weight?: number;
  /** millimetres */
  height?: number;
  ftp?: number;
  /** Cumulative distance in meters */
  totalDistance?: number;
  /** Cumulative elevation climbed in meters */
  totalDistanceClimbed?: number;
  /** Cumulative Drops (in-game currency) */
  totalGold?: number;
  /** Cumulative XP earned */
  totalExperiencePoints?: number;
  /** Cumulative XP target for next level (may be 0) */
  targetExperiencePoints?: number;
  /** Encoded as level * 100 + progressPct (e.g. 3542 = Level 35, 42%) */
  achievementLevel?: number;
  competitionMetrics?: ZwiftCompetitionMetrics | null;
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
    competitionMetrics?: ZwiftCompetitionMetrics | null;
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
  racingScore?: number;
  competitionMetrics?: ZwiftCompetitionMetrics | null;
  scoreHistory?: {
    previousScore?: number;
    newScore?: number;
    scoreChangeType?: string;
    [key: string]: unknown;
  };
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
  primaryImageUrl?: string;
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
  activitySnapshots?: Array<Record<string, unknown>>;
  snapshots?: Array<Record<string, unknown>>;
  images?: Array<Record<string, unknown>>;
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
  rangeAccessLabel?: string | null;
  fromPaceValue?: number;
  toPaceValue?: number;
  paceType?: number;
  rulesSet?: string[];
  tags?: string[];
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
  categoryEnforcement?: boolean;
  accessExpression?: string | null;
  rangeAccessLabel?: string | null;
  rulesSet?: string[];
  tags?: string[];
  eventSubgroups?: ZwiftEventSubgroup[];
  [key: string]: unknown;
}

export interface ZwiftPowerCurvePoint {
  value?: number;
  watts?: number;
  power?: number;
  wkg?: number;
  date?: string;
  timestamp?: string;
  activityId?: string | number;
  [key: string]: unknown;
}

export interface ZwiftPowerProfile {
  zftp?: number;
  zmap?: number;
  vo2max?: number;
  validPowerProfile?: boolean;
  category?: string;
  categoryWomen?: string;
  cpBestEfforts?: {
    pointsWatts?: Record<string, ZwiftPowerCurvePoint | number>;
    pointsWkg?: Record<string, ZwiftPowerCurvePoint | number>;
    activityIds?: Record<string, string | number>;
    [key: string]: unknown;
  };
  relevantCpEfforts?: {
    pointsWatts?: Record<string, ZwiftPowerCurvePoint | number>;
    pointsWkg?: Record<string, ZwiftPowerCurvePoint | number>;
    activityIds?: Record<string, string | number>;
    [key: string]: unknown;
  };
  /** /api/power-curve/power-profile returns additional fields; keep them all accessible. */
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

function mergeProfiles(primary: ZwiftProfile, secondary: ZwiftProfile): ZwiftProfile {
  const merged: ZwiftProfile = { ...secondary };
  for (const [key, value] of Object.entries(primary)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }

  if (primary.competitionMetrics || secondary.competitionMetrics) {
    const mergedMetrics: ZwiftCompetitionMetrics = { ...secondary.competitionMetrics };
    if (primary.competitionMetrics) {
      for (const [key, value] of Object.entries(primary.competitionMetrics)) {
        if (value !== null && value !== undefined) {
          mergedMetrics[key] = value;
        }
      }
    }
    merged.competitionMetrics = mergedMetrics;
  }

  return merged;
}

const profileCache = new Map<number, ZwiftProfile>();
const profileInFlight = new Map<number, Promise<ZwiftProfile>>();

/** Returns a previously loaded Zwift profile from the in-memory session cache, if present. */
export function getCachedProfileById(riderId: number): ZwiftProfile | undefined {
  return profileCache.get(riderId);
}

export async function fetchMyProfile(accessToken: string): Promise<ZwiftProfile> {
  const me = await fetchAuthorizedJson<ZwiftProfile>(
    accessToken,
    '/api/zwift/api/profiles/me',
    'profile',
  );
  const metrics = me.competitionMetrics;
  const missingZrs = metrics?.racingScore == null;
  const missingCategory = metrics?.category == null && metrics?.categoryWomen == null;

  let finalProfile = me;

  // Zwift's /profiles/me omits/nulls competitionMetrics, whereas /profiles/{id} populates them.
  if (typeof me.id === 'number' && (missingZrs || missingCategory)) {
    try {
      const publicProfile = await fetchProfileById(accessToken, me.id);
      finalProfile = mergeProfiles(me, publicProfile);
    } catch (err) {
      if (err instanceof AuthError) throw err;
    }
  }

  if (typeof finalProfile.id === 'number') {
    profileCache.set(finalProfile.id, finalProfile);
  }
  return finalProfile;
}

export function fetchProfileById(accessToken: string, riderId: number): Promise<ZwiftProfile> {
  const cached = profileCache.get(riderId);
  if (cached) return Promise.resolve(cached);

  const pending = profileInFlight.get(riderId);
  if (pending) return pending;

  const request = fetchAuthorizedJson<ZwiftProfile>(
    accessToken,
    `/api/zwift/api/profiles/${riderId}`,
    'profile',
  )
    .then((loaded) => {
      profileCache.set(riderId, loaded);
      return loaded;
    })
    .finally(() => {
      profileInFlight.delete(riderId);
    });

  profileInFlight.set(riderId, request);
  return request;
}

export const fetchPowerProfile = (accessToken: string): Promise<ZwiftPowerProfile> =>
  fetchAuthorizedJson<ZwiftPowerProfile>(
    accessToken,
    '/api/zwift/api/power-curve/power-profile',
    'power profile',
  );

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
