/** Flatten nested JSON into dotted-key/value string pairs for display. */
export function flatten(obj: unknown, prefix = ''): [string, string][] {
  if (obj === null || typeof obj !== 'object') return [[prefix, String(obj)]];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return [[prefix, Array.isArray(obj) ? '[]' : '{}']];
  return entries.flatMap(([k, v]) => {
    const key = prefix ? (Array.isArray(obj) ? `${prefix}[${k}]` : `${prefix}.${k}`) : k;
    return v !== null && typeof v === 'object'
      ? flatten(v, key)
      : [[key, String(v)] as [string, string]];
  });
}

export function formatUnixSeconds(sec: number | undefined): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return 'Unknown date';
  return new Date(sec * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
