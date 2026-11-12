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
