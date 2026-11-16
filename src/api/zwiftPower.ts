/** ZwiftPower metric tuple `[value, flaggedOrEstimated]` returned in cache3 JSON. */
export type ZwiftPowerTuple<T = number | string> = [T, number];

export interface ZwiftPowerRaceEntry {
  DT_RowId?: string;
  ftp?: string;
  friend?: number;
  pt?: string;
  label?: string;
  zid?: string;
  pos?: number;
  position_in_cat?: number;
  name?: string;
  cp?: number;
  zwid?: number;
  res_id?: string;
  lag?: number;
  uid?: string;
  time?: ZwiftPowerTuple<number>;
  time_gun?: number;
  gap?: number;
  vtta?: string;
  vttat?: number;
  male?: number;
  tid?: string;
  topen?: string;
  tname?: string;
  tc?: string;
  tbc?: string;
  tbd?: string;
  zeff?: number;
  category?: string;
  height?: ZwiftPowerTuple<number>;
  flag?: string;
  avg_hr?: ZwiftPowerTuple<number>;
  max_hr?: ZwiftPowerTuple<number>;
  hrmax?: ZwiftPowerTuple<number>;
  hrm?: number;
  weight?: ZwiftPowerTuple<string>;
  power_type?: number;
  display_pos?: number;
  src?: number;
  age?: string;
  zada?: number;
  note?: string;
  div?: number;
  divw?: number;
  skill?: number | string;
  skill_b?: number | string;
  skill_gain?: number | string;
  np?: ZwiftPowerTuple<number>;
  hrr?: ZwiftPowerTuple<string>;
  hreff?: ZwiftPowerTuple<string>;
  avg_power?: ZwiftPowerTuple<number>;
  avg_wkg?: ZwiftPowerTuple<string>;
  wkg_ftp?: ZwiftPowerTuple<string>;
  wftp?: ZwiftPowerTuple<number>;
  wkg_guess?: number;
  wkg1200?: ZwiftPowerTuple<string>;
  wkg300?: ZwiftPowerTuple<string>;
  wkg120?: ZwiftPowerTuple<string>;
  wkg60?: ZwiftPowerTuple<string>;
  wkg30?: ZwiftPowerTuple<string>;
  wkg15?: ZwiftPowerTuple<string>;
  wkg5?: ZwiftPowerTuple<string>;
  w1200?: ZwiftPowerTuple<string>;
  w300?: ZwiftPowerTuple<string>;
  w120?: ZwiftPowerTuple<string>;
  w60?: ZwiftPowerTuple<string>;
  w30?: ZwiftPowerTuple<string>;
  w15?: ZwiftPowerTuple<string>;
  w5?: ZwiftPowerTuple<string>;
  is_guess?: number;
  upg?: number;
  penalty?: string;
  reg?: number;
  fl?: string;
  pts?: string;
  pts_pos?: string;
  info?: number;
  info_notes?: unknown[];
  strike?: number;
  event_title?: string;
  f_t?: string;
  distance?: number;
  event_date?: number;
  rt?: string;
  laps?: string;
  dur?: string;
  /** /cache3/profile/{id}_all.json may return extra fields; keep them all accessible. */
  [key: string]: unknown;
}

export async function fetchZwiftPowerRaces(riderId: number): Promise<ZwiftPowerRaceEntry[]> {
  const res = await fetch(`/api/zwiftpower/cache3/profile/${riderId}_all.json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Failed to load ZwiftPower history (${res.status}).`);
  const payload = (await res.json()) as { data?: ZwiftPowerRaceEntry[] };
  const races = Array.isArray(payload?.data) ? payload.data : [];
  return [...races].sort((a, b) => Number(b.event_date ?? 0) - Number(a.event_date ?? 0));
}

function sortRank(entry: ZwiftPowerRaceEntry): number {
  const raw = entry.pos ?? entry.position_in_cat;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) && num > 0 ? num : Number.MAX_SAFE_INTEGER;
}

export async function fetchZwiftPowerEventResults(
  eventId: string | number,
  variant: 'view' | 'zwift' = 'view',
): Promise<ZwiftPowerRaceEntry[]> {
  const res = await fetch(
    `/api/zwiftpower/cache3/results/${encodeURIComponent(String(eventId))}_${variant}.json`,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Failed to load ZwiftPower event results (${res.status}).`);
  const payload = (await res.json()) as ZwiftPowerRaceEntry[] | { data?: ZwiftPowerRaceEntry[] };
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return [...entries].sort((a, b) => sortRank(a) - sortRank(b));
}
