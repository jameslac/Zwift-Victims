/**
 * Safe recursive-descent parser for the TanStack Router SSR `$_TSR.router`
 * seroval payload embedded in ZwiftRacing.app HTML responses (no eval).
 */

function parseSeroval(src: string): unknown {
  const refs: unknown[] = [];
  let i = 0;
  const n = src.length;

  function skipWs(): void {
    while (i < n && src.charCodeAt(i) <= 32) i++;
  }

  function parseString(): string {
    i++; // opening quote
    let out = '';
    while (i < n && src[i] !== '"') {
      if (src[i] === '\\') {
        i++;
        if (i >= n) break;
        const esc = src[i++];
        if (esc === 'n') out += '\n';
        else if (esc === 'r') out += '\r';
        else if (esc === 't') out += '\t';
        else if (esc === 'x') {
          out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16));
          i += 2;
        } else if (esc === 'u') {
          out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
          i += 4;
        } else {
          out += esc;
        }
      } else {
        out += src[i++];
      }
    }
    if (i < n && src[i] === '"') i++; // closing quote
    return out;
  }

  function parseValue(): unknown {
    skipWs();
    if (i >= n) return undefined;

    if (src.startsWith('$R[', i)) {
      i += 3;
      const start = i;
      while (i < n && src[i] !== ']') i++;
      const idx = Number(src.slice(start, i));
      if (i < n && src[i] === ']') i++;
      skipWs();
      if (i < n && src[i] === '=') {
        i++;
        const val = parseValue();
        refs[idx] = val;
        return val;
      }
      return refs[idx];
    }

    const ch = src[i];
    if (ch === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      skipWs();
      while (i < n && src[i] !== '}') {
        const before = i;
        let key: string;
        if (src[i] === '"') {
          key = parseString();
        } else {
          const start = i;
          while (i < n && src[i] !== ':' && src[i] !== '}') i++;
          key = src.slice(start, i).trim();
        }
        skipWs();
        if (i < n && src[i] === ':') i++;
        if (key) obj[key] = parseValue();
        skipWs();
        if (i < n && src[i] === ',') i++;
        skipWs();
        if (i === before) break;
      }
      if (i < n && src[i] === '}') i++;
      return obj;
    }

    if (ch === '[') {
      i++;
      const arr: unknown[] = [];
      skipWs();
      while (i < n && src[i] !== ']') {
        const before = i;
        arr.push(parseValue());
        skipWs();
        if (i < n && src[i] === ',') i++;
        skipWs();
        if (i === before) break;
      }
      if (i < n && src[i] === ']') i++;
      return arr;
    }

    if (ch === '"') return parseString();
    if (ch === '!') {
      i++;
      return src[i++] === '0';
    }

    const start = i;
    while (i < n && src[i] !== ',' && src[i] !== '}' && src[i] !== ']') i++;
    const raw = src.slice(start, i).trim();
    if (raw === 'null') return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'void 0' || raw === 'undefined') return undefined;
    return Number(raw);
  }

  return parseValue();
}

export interface ZwiftRacingExtracted {
  rider: Record<string, unknown> | null;
  overview: Record<string, unknown> | null;
}

export function extractZwiftRacingData(html: string): ZwiftRacingExtracted {
  const match = html.match(/\$_TSR\.router=\(\$R=>([\s\S]*?)\)\(\$R\["tsr"\]\)/);
  if (!match?.[1]) return { rider: null, overview: null };

  const root = parseSeroval(match[1]);
  if (!root || typeof root !== 'object') return { rider: null, overview: null };

  const matches = (root as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) return { rider: null, overview: null };

  let rider: Record<string, unknown> | null = null;
  let overview: Record<string, unknown> | null = null;

  for (const item of matches) {
    if (!item || typeof item !== 'object') continue;
    const loaderData = (item as { l?: unknown }).l;
    if (!loaderData || typeof loaderData !== 'object') continue;
    const rec = loaderData as Record<string, unknown>;
    if ('riderId' in rec && 'velo' in rec) rider = rec;
    if ('riderId' in rec && 'history' in rec) overview = rec;
  }

  return { rider, overview };
}
