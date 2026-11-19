export type UnitSystem = 'metric' | 'imperial';

export function formatWeight(grams: number | undefined, units: UnitSystem): string {
  if (!grams) return '—';
  const kg = grams / 1000;
  return units === 'metric' ? `${kg.toFixed(1)} kg` : `${(kg * 2.20462).toFixed(1)} lb`;
}

export function formatHeight(mm: number | undefined, units: UnitSystem): string {
  if (!mm) return '—';
  if (units === 'metric') return `${Math.round(mm / 10)} cm`;
  const totalInches = Math.round(mm / 25.4);
  return `${Math.floor(totalInches / 12)}′ ${totalInches % 12}″`;
}

export function formatWkg(ftp: number | undefined, grams: number | undefined): string {
  if (!ftp || !grams) return '—';
  return `${(ftp / (grams / 1000)).toFixed(2)} W/kg`;
}

export function formatDistance(meters: number | undefined, units: UnitSystem): string {
  if (meters === undefined || meters === null || !Number.isFinite(meters)) return '—';
  const km = meters / 1000;
  const value = units === 'metric' ? km : km * 0.621371;
  const unit = units === 'metric' ? 'km' : 'mi';
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} ${unit}`;
}

export function formatElevation(meters: number | undefined, units: UnitSystem): string {
  if (meters === undefined || meters === null || !Number.isFinite(meters)) return '—';
  const value = units === 'metric' ? Math.round(meters) : Math.round(meters * 3.28084);
  const unit = units === 'metric' ? 'm' : 'ft';
  return `${value.toLocaleString()} ${unit}`;
}

export function formatDrops(drops: number | undefined): string {
  if (drops === undefined || drops === null || !Number.isFinite(drops)) return '—';
  return Math.round(drops).toLocaleString();
}

export function formatSpeed(mps: number | undefined, units: UnitSystem): string {
  if (mps === undefined || mps === null || !Number.isFinite(mps)) return '—';
  return units === 'metric'
    ? `${(mps * 3.6).toFixed(1)} km/h`
    : `${(mps * 2.23694).toFixed(1)} mph`;
}

export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
