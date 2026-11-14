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
  return units === 'metric' ? `${km.toFixed(1)} km` : `${(km * 0.621371).toFixed(1)} mi`;
}

export function formatElevation(meters: number | undefined, units: UnitSystem): string {
  if (meters === undefined || meters === null || !Number.isFinite(meters)) return '—';
  return units === 'metric' ? `${Math.round(meters)} m` : `${Math.round(meters * 3.28084)} ft`;
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
