export interface ZwiftRacingRider {
  riderId?: number;
  name?: string;
  imageSrc?: string;
  country?: string;
  male?: boolean;
  age?: string;
  height?: number;
  weight?: number;
  zpCategory?: string;
  zpFTP?: number;
  visibility?: string;
  banned?: boolean;
  optOut?: boolean;
  club?: {
    clubId?: number;
    name?: string;
    backgroundColor?: string;
    textColor?: string;
    borderColor?: string;
    [key: string]: unknown;
  } | null;
  velo?: {
    race?: number;
    timeTrial?: number;
    handicap?: number;
    max30?: number;
    max90?: number;
    factors?: Record<string, number>;
    skill?: Record<string, number>;
    [key: string]: unknown;
  };
  seed?: {
    race?: number;
    factors?: Record<string, number>;
    [key: string]: unknown;
  };
  points?: Record<string, unknown>;
  power?: {
    CP?: number;
    AWC?: number;
    compoundScore?: number;
    powerRating?: number;
    w5?: number;
    w15?: number;
    w30?: number;
    w60?: number;
    w120?: number;
    w300?: number;
    w1200?: number;
    wkg5?: number;
    wkg15?: number;
    wkg30?: number;
    wkg60?: number;
    wkg120?: number;
    wkg300?: number;
    wkg1200?: number;
    [key: string]: unknown;
  };
  race?: {
    finishes?: number;
    wins?: number;
    podiums?: number;
    dnfs?: number;
    [key: string]: unknown;
  };
  phenotype?: {
    version?: number;
    label?: string;
    value?: number;
    bias?: number;
    confidence?: number;
    scores?: Record<string, number>;
    windowDays?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ZwiftRacingRaceEntry {
  event?: {
    eventId?: string;
    time?: number;
    title?: string;
    type?: string;
    subType?: string;
    imageUrl?: string;
    subgroupId?: string;
    distance?: number;
    elevation?: number;
    numLaps?: number;
    routeName?: string;
    scoringEnabled?: boolean;
    resultsFinalized?: boolean;
    [key: string]: unknown;
  };
  place?: {
    positionInCategory?: number;
    penTotal?: number;
    didNotFinish?: boolean;
    disqualified?: boolean;
    [key: string]: unknown;
  };
  race?: {
    time?: number;
    gap?: number;
    source?: string;
    weight?: number;
    height?: number;
    age?: string;
    distance?: number;
    wkgAvg?: number;
    wkg5?: number;
    wkg15?: number;
    wkg30?: number;
    wkg60?: number;
    wkg120?: number;
    wkg300?: number;
    wkg1200?: number;
    [key: string]: unknown;
  };
  sensor?: {
    powerType?: string;
    steering?: boolean;
    trainerDifficulty?: number;
    heartRateMonitor?: boolean;
    [key: string]: unknown;
  };
  velo?: {
    intensity?: number;
    seed?: {
      before?: number;
      after?: number;
      eventRating?: number;
      expectedPosition?: number;
      confidence?: number;
      factors?: Record<string, unknown>;
      [key: string]: unknown;
    };
    elo?: {
      before?: number;
      after?: number;
      eventRating?: number;
      expectedPosition?: number;
      adjustedChange?: number;
      rawChange?: number;
      factors?: Record<string, unknown>;
      [key: string]: unknown;
    };
    points?: {
      value?: number | null;
      gc?: number | null;
      sprint?: number | null;
      climb?: number | null;
      tt?: number | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  legacy?: {
    rating?: number;
    ratingBefore?: number;
    ratingDelta?: number;
    eventRating?: number;
    [key: string]: unknown;
  };
  pointsStatus?: string;
  classement?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ZwiftRacingCategoryRank {
  category?: number;
  place?: number;
  total?: number;
  [key: string]: unknown;
}

export interface ZwiftRacingRankingEntry {
  ranking?: number | null;
  open?: ZwiftRacingCategoryRank | null;
  women?: ZwiftRacingCategoryRank | null;
  delta7d?: number | null;
  [key: string]: unknown;
}

export interface ZwiftRacingRankings {
  gc?: ZwiftRacingRankingEntry;
  sprint?: ZwiftRacingRankingEntry;
  climb?: ZwiftRacingRankingEntry;
  tt?: ZwiftRacingRankingEntry;
  [key: string]: unknown;
}

export interface ZwiftRacingLegacyHistoryEntry {
  event?: {
    eventId?: string;
    time?: number;
    title?: string;
    [key: string]: unknown;
  };
  rating?: number;
  archived?: boolean;
  [key: string]: unknown;
}

export interface ZwiftRacingOverview {
  riderId?: number;
  days?: number;
  latest?: ZwiftRacingRaceEntry[];
  history?: ZwiftRacingRaceEntry[];
  scoring?: Array<Record<string, unknown>>;
  rankings?: ZwiftRacingRankings;
  gcOverallPlace?: { rank?: number; total?: number } | number | null;
  legacyRatings?: {
    live?: number | null;
    max30?: number | null;
    max90?: number | null;
    max30Expires?: number | null;
    max90Expires?: number | null;
    [key: string]: unknown;
  };
  legacyHistory?: ZwiftRacingLegacyHistoryEntry[];
  [key: string]: unknown;
}

export interface ZwiftRacingRiderResponse {
  rider: ZwiftRacingRider | null;
  overview: ZwiftRacingOverview | null;
}

export interface ZwiftRacingEventRider {
  riderId?: number;
  position?: number;
  expectedPosition?: number;
  expectedPlaceRange?: { low?: number; high?: number };
  source?: string;
  name?: string;
  club?: {
    clubId?: number;
    name?: string;
    backgroundColor?: string;
    textColor?: string;
    borderColor?: string;
    [key: string]: unknown;
  } | null;
  weight?: number;
  height?: number;
  age?: string;
  male?: boolean;
  country?: string;
  imageSrc?: string;
  category?: string;
  visibility?: string;
  didNotFinish?: boolean;
  disqualified?: boolean;
  time?: number;
  gap?: number;
  distance?: number;
  avgSpeed?: number;
  np?: number | null;
  wkgAvg?: number;
  wkg5?: number;
  wkg15?: number;
  wkg30?: number;
  wkg60?: number;
  wkg120?: number;
  wkg300?: number;
  wkg1200?: number;
  eventRating?: number;
  ratingBefore?: number;
  ratingDelta?: number;
  rating?: number;
  zrCS?: number;
  power?: Record<string, number>;
  race?: {
    rating?: number;
    finishes?: number;
    wins?: number;
    podiums?: number;
    dnfs?: number;
    [key: string]: unknown;
  };
  phenotype?: {
    version?: number;
    label?: string;
    confidence?: number;
    scores?: Record<string, number>;
    [key: string]: unknown;
  };
  velo?: {
    intensity?: number;
    seed?: {
      before?: number;
      after?: number;
      eventRating?: number;
      expectedPosition?: number;
      confidence?: number;
      factors?: Record<string, unknown>;
      [key: string]: unknown;
    };
    elo?: {
      before?: number;
      after?: number;
      eventRating?: number;
      expectedPosition?: number;
      adjustedChange?: number;
      rawChange?: number;
      factors?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  riderVelo?: {
    race?: number;
    factors?: Record<string, number>;
    [key: string]: unknown;
  };
  riderSeed?: {
    race?: number;
    factors?: Record<string, number>;
    [key: string]: unknown;
  };
  sensor?: {
    powerType?: string;
    steering?: boolean;
    trainerDifficulty?: number;
    heartRateMonitor?: boolean;
    [key: string]: unknown;
  };
  pointsStatus?: string;
  classement?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ZwiftRacingEventPen {
  id?: string;
  order?: number;
  name?: string;
  rangeLabel?: string;
  avgRating?: number;
  ratedRiders?: number;
  results?: {
    count?: number;
    averageRating?: number;
    [key: string]: unknown;
  };
  points?: {
    total?: number;
    average?: number;
    sof?: number;
    winningTime?: number;
    avgSpeed?: number;
    [key: string]: unknown;
  };
  velo?: Record<string, unknown>;
  riders?: ZwiftRacingEventRider[];
  [key: string]: unknown;
}

export interface ZwiftRacingEventResponse {
  eventId?: string;
  time?: number;
  distance?: number;
  elevation?: number;
  title?: string;
  type?: string;
  subType?: string;
  staggeredStart?: boolean;
  numLaps?: number;
  source?: string;
  tags?: string[];
  rules?: {
    powerMeterRequired?: boolean;
    powerupsAllowed?: boolean;
    draftingDisabled?: boolean;
    [key: string]: unknown;
  };
  velo?: Record<string, unknown>;
  route?: {
    routeId?: string;
    world?: string;
    name?: string;
    url?: string;
    [key: string]: unknown;
  };
  imageUrl?: string;
  ladderId?: string | null;
  courseProfile?: {
    points?: Array<{ distanceKm?: number; elevationM?: number }>;
    [key: string]: unknown;
  };
  mode?: string;
  hasPoints?: boolean;
  hasRankPoints?: boolean;
  resultsFinalized?: boolean;
  pens?: ZwiftRacingEventPen[];
  [key: string]: unknown;
}

export async function fetchZwiftRacingRider(riderId: number): Promise<ZwiftRacingRiderResponse> {
  const res = await fetch(`/api/zwiftracing/riders/${riderId}`);
  if (res.status === 404) return { rider: null, overview: null };
  if (!res.ok) throw new Error(`Failed to load ZwiftRacing.app data (${res.status}).`);
  return (await res.json()) as ZwiftRacingRiderResponse;
}

export async function fetchZwiftRacingEvent(
  eventId: string | number,
): Promise<ZwiftRacingEventResponse | null> {
  const res = await fetch(`/api/zwiftracing/events/${encodeURIComponent(String(eventId))}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load ZwiftRacing.app event (${res.status}).`);
  return (await res.json()) as ZwiftRacingEventResponse;
}
