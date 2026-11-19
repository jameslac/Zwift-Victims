export function formatUnixSeconds(sec: number | undefined): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return 'Unknown date';
  return new Date(sec * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
