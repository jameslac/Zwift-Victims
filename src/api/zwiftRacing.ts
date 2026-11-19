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
    seed?: Record<string, unknown>;
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

export interface ZwiftRacingOverview {
  riderId?: number;
  days?: number;
  latest?: ZwiftRacingRaceEntry[];
  history?: ZwiftRacingRaceEntry[];
  scoring?: Array<Record<string, unknown>>;
  rankings?: Record<string, unknown>;
  gcOverallPlace?: number | null;
  legacyRatings?: {
    live?: number;
    max30?: number;
    max90?: number;
    max30Expires?: number;
    max90Expires?: number;
    [key: string]: unknown;
  };
  legacyHistory?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ZwiftRacingRiderResponse {
  rider: ZwiftRacingRider | null;
  overview: ZwiftRacingOverview | null;
}

export async function fetchZwiftRacingRider(riderId: number): Promise<ZwiftRacingRiderResponse> {
  const res = await fetch(`/api/zwiftracing/riders/${riderId}`);
  if (res.status === 404) return { rider: null, overview: null };
  if (!res.ok) throw new Error(`Failed to load ZwiftRacing.app data (${res.status}).`);
  return (await res.json()) as ZwiftRacingRiderResponse;
}
