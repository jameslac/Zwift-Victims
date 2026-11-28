import {
  extractBearerToken,
  fetchZwiftMeProfile,
  jsonResponse,
  refreshZwiftAccessToken,
} from './zwiftUpstream';

export interface McpEnv {
  MCP_TOKENS?: KVNamespace;
  MCP_TOKEN_PEPPER?: string;
}

const MCP_TOKEN_PREFIX = 'zv_mcp_';
const MAX_TOKENS_PER_RIDER = 10;
const DEFAULT_TTL_DAYS = 90;
const MIN_TTL_DAYS = 1;
const MAX_TTL_DAYS = 365;
const LAST_USED_UPDATE_INTERVAL_MS = 15 * 60_000;
const ZWIFT_REFRESH_BUFFER_MS = 2 * 60_000;
const TOKEN_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_BEARER_RE = /^Bearer\s+zv_mcp_([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{32,128})$/;

const KV_SETUP_NOTE =
  'Bind a Cloudflare KV namespace named MCP_TOKENS in wrangler.jsonc (or Worker Settings -> Bindings) to enable persistent MCP tokens.';

export interface McpTokenSummary {
  tokenId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
}

interface StoredMcpTokenRecord {
  version: 1;
  tokenId: string;
  riderId: number;
  riderName: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  keyCheck: string;
  iv: string;
  ciphertext: string;
}

interface EncryptedZwiftBundle {
  zwiftAccessToken: string;
  zwiftRefreshToken?: string;
  zwiftExpiresAt?: number;
}

export interface McpSession {
  tokenId: string;
  riderId: number;
  riderName: string;
  zwiftAccessToken: string;
  refreshZwiftToken: () => Promise<string | null>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toArrayBufferBytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(view.byteLength));
  out.set(view);
  return out;
}

function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return toArrayBufferBytes(encoder.encode(value));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + '='.repeat(pad));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256Buffer(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', utf8Bytes(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256Buffer(value);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function deriveAesKey(secret: string, pepper?: string): Promise<CryptoKey> {
  const material = `zv-mcp-enc-v1:${secret}${pepper ? `:${pepper}` : ''}`;
  const rawKey = await sha256Buffer(material);
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptBundle(
  key: CryptoKey,
  aad: string,
  bundle: EncryptedZwiftBundle,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const plaintext = utf8Bytes(JSON.stringify(bundle));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: utf8Bytes(aad),
    },
    key,
    plaintext,
  );
  return {
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(encrypted)),
  };
}

async function decryptBundle(
  key: CryptoKey,
  aad: string,
  ivB64: string,
  ciphertextB64: string,
): Promise<EncryptedZwiftBundle | null> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64Url(ivB64),
        additionalData: utf8Bytes(aad),
      },
      key,
      fromBase64Url(ciphertextB64),
    );
    const parsed = JSON.parse(decoder.decode(decrypted)) as Partial<EncryptedZwiftBundle>;
    if (typeof parsed.zwiftAccessToken !== 'string' || !parsed.zwiftAccessToken) return null;
    return {
      zwiftAccessToken: parsed.zwiftAccessToken,
      zwiftRefreshToken:
        typeof parsed.zwiftRefreshToken === 'string' && parsed.zwiftRefreshToken
          ? parsed.zwiftRefreshToken
          : undefined,
      zwiftExpiresAt:
        typeof parsed.zwiftExpiresAt === 'number' && Number.isFinite(parsed.zwiftExpiresAt)
          ? parsed.zwiftExpiresAt
          : undefined,
    };
  } catch {
    return null;
  }
}

function tokenKvKey(tokenId: string): string {
  return `mcp:tok:${tokenId}`;
}

function riderIndexKvKey(riderId: number): string {
  return `mcp:rider:${riderId}`;
}

function tokenAad(tokenId: string, riderId: number): string {
  return `zv-mcp:${tokenId}:${riderId}`;
}

function sanitizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return 'MCP Client';
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return 'MCP Client';
  return cleaned.slice(0, 48);
}

function clampTtlDays(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return DEFAULT_TTL_DAYS;
  return Math.min(MAX_TTL_DAYS, Math.max(MIN_TTL_DAYS, Math.round(num)));
}

function remainingTtlSeconds(expiresAtIso: string): number {
  const ms = Date.parse(expiresAtIso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 60;
  return Math.max(60, Math.ceil(ms / 1000));
}

async function readRiderIndex(kv: KVNamespace, riderId: number): Promise<McpTokenSummary[]> {
  const raw = await kv.get(riderIndexKvKey(riderId), 'text');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as McpTokenSummary[]) : [];
  } catch {
    return [];
  }
}

async function writeRiderIndex(
  kv: KVNamespace,
  riderId: number,
  summaries: McpTokenSummary[],
): Promise<void> {
  if (summaries.length === 0) {
    await kv.delete(riderIndexKvKey(riderId));
    return;
  }
  let maxTtl = 86400;
  for (const s of summaries) {
    const ttl = remainingTtlSeconds(s.expiresAt);
    if (ttl > maxTtl) maxTtl = ttl;
  }
  await kv.put(riderIndexKvKey(riderId), JSON.stringify(summaries), {
    expirationTtl: maxTtl,
  });
}

async function loadTokenRecord(
  kv: KVNamespace,
  tokenId: string,
): Promise<StoredMcpTokenRecord | null> {
  const raw = await kv.get(tokenKvKey(tokenId), 'text');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredMcpTokenRecord;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.tokenId === 'string' &&
      typeof parsed.riderId === 'number' &&
      typeof parsed.keyCheck === 'string' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.ciphertext === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function isMcpStorageConfigured(env: McpEnv): boolean {
  return Boolean(env.MCP_TOKENS);
}

export function parseMcpBearerToken(
  authHeader: string | null,
): { tokenId: string; secret: string } | null {
  if (!authHeader) return null;
  const match = authHeader.trim().match(TOKEN_BEARER_RE);
  if (!match) return null;
  return { tokenId: match[1], secret: match[2] };
}

export async function listRiderMcpTokens(
  env: McpEnv,
  riderId: number,
): Promise<McpTokenSummary[]> {
  const kv = env.MCP_TOKENS;
  if (!kv) return [];

  const index = await readRiderIndex(kv, riderId);
  if (index.length === 0) return [];

  const now = Date.now();
  const active: McpTokenSummary[] = [];
  let changed = false;

  const records = await Promise.all(index.map((entry) => loadTokenRecord(kv, entry.tokenId)));
  for (let i = 0; i < index.length; i++) {
    const entry = index[i];
    const record = records[i];
    if (!record || record.riderId !== riderId || Date.parse(record.expiresAt) <= now) {
      changed = true;
      continue;
    }
    if (record.lastUsedAt !== entry.lastUsedAt || record.label !== entry.label) {
      changed = true;
    }
    active.push({
      tokenId: record.tokenId,
      label: record.label,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
    });
  }

  if (changed) {
    await writeRiderIndex(kv, riderId, active);
  }

  return active;
}

export async function mintMcpToken(
  env: McpEnv,
  input: {
    riderId: number;
    riderName: string;
    zwiftAccessToken: string;
    zwiftRefreshToken?: string;
    zwiftExpiresAt?: number;
    label?: unknown;
    ttlDays?: unknown;
  },
): Promise<
  | { ok: true; token: string; metadata: McpTokenSummary }
  | { ok: false; status: number; error: string; message: string }
> {
  const kv = env.MCP_TOKENS;
  if (!kv) {
    return {
      ok: false,
      status: 503,
      error: 'mcp_kv_not_configured',
      message: KV_SETUP_NOTE,
    };
  }

  const active = await listRiderMcpTokens(env, input.riderId);
  if (active.length >= MAX_TOKENS_PER_RIDER) {
    return {
      ok: false,
      status: 400,
      error: 'token_limit_reached',
      message: `Maximum of ${MAX_TOKENS_PER_RIDER} active MCP tokens reached. Revoke an unused token first.`,
    };
  }

  const tokenId = randomBase64Url(16);
  const secret = randomBase64Url(32);
  const ttlDays = clampTtlDays(input.ttlDays);
  const ttlSec = ttlDays * 86400;
  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlSec * 1000).toISOString();
  const label = sanitizeLabel(input.label);

  const keyCheck = await sha256Hex(`zv-mcp-chk-v1:${secret}`);
  const aesKey = await deriveAesKey(secret, env.MCP_TOKEN_PEPPER);
  const { iv, ciphertext } = await encryptBundle(aesKey, tokenAad(tokenId, input.riderId), {
    zwiftAccessToken: input.zwiftAccessToken,
    zwiftRefreshToken: input.zwiftRefreshToken,
    zwiftExpiresAt: input.zwiftExpiresAt,
  });

  const record: StoredMcpTokenRecord = {
    version: 1,
    tokenId,
    riderId: input.riderId,
    riderName: input.riderName,
    label,
    createdAt,
    expiresAt,
    keyCheck,
    iv,
    ciphertext,
  };

  const summary: McpTokenSummary = {
    tokenId,
    label,
    createdAt,
    expiresAt,
  };

  await kv.put(tokenKvKey(tokenId), JSON.stringify(record), { expirationTtl: ttlSec });
  await writeRiderIndex(kv, input.riderId, [summary, ...active]);

  return {
    ok: true,
    token: `${MCP_TOKEN_PREFIX}${tokenId}.${secret}`,
    metadata: summary,
  };
}

export async function revokeMcpToken(
  env: McpEnv,
  riderId: number,
  tokenId: string,
): Promise<boolean> {
  const kv = env.MCP_TOKENS;
  if (!kv || !TOKEN_ID_RE.test(tokenId)) return false;

  const index = await readRiderIndex(kv, riderId);
  const inIndex = index.some((item) => item.tokenId === tokenId);
  const record = await loadTokenRecord(kv, tokenId);

  if (!inIndex && (!record || record.riderId !== riderId)) {
    return false;
  }
  if (record && record.riderId !== riderId) {
    return false;
  }

  await kv.delete(tokenKvKey(tokenId));
  const nextIndex = index.filter((item) => item.tokenId !== tokenId);
  await writeRiderIndex(kv, riderId, nextIndex);
  return true;
}

export async function revokeAllRiderMcpTokens(env: McpEnv, riderId: number): Promise<number> {
  const kv = env.MCP_TOKENS;
  if (!kv) return 0;

  const index = await readRiderIndex(kv, riderId);
  await Promise.all(index.map((item) => kv.delete(tokenKvKey(item.tokenId))));
  await kv.delete(riderIndexKvKey(riderId));
  return index.length;
}

export async function authenticateMcpRequest(
  request: Request,
  env: McpEnv,
): Promise<
  | { ok: true; session: McpSession }
  | { ok: false; status: number; error: string; message: string }
> {
  const kv = env.MCP_TOKENS;
  if (!kv) {
    return {
      ok: false,
      status: 503,
      error: 'mcp_kv_not_configured',
      message: KV_SETUP_NOTE,
    };
  }

  const parsed = parseMcpBearerToken(request.headers.get('Authorization'));
  if (!parsed) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Valid Bearer MCP token required.',
    };
  }

  const record = await loadTokenRecord(kv, parsed.tokenId);
  if (!record || Date.parse(record.expiresAt) <= Date.now()) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      message: 'MCP token is invalid or expired.',
    };
  }

  const expectedCheck = await sha256Hex(`zv-mcp-chk-v1:${parsed.secret}`);
  if (!timingSafeEqualHex(record.keyCheck, expectedCheck)) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      message: 'MCP token verification failed.',
    };
  }

  const aesKey = await deriveAesKey(parsed.secret, env.MCP_TOKEN_PEPPER);
  const aad = tokenAad(record.tokenId, record.riderId);
  const initialBundle = await decryptBundle(aesKey, aad, record.iv, record.ciphertext);
  if (!initialBundle) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      message: 'Unable to decrypt MCP token session.',
    };
  }

  let currentBundle: EncryptedZwiftBundle = initialBundle;
  let currentRecord: StoredMcpTokenRecord = record;

  async function persistState(nextBundle: EncryptedZwiftBundle, touchLastUsed: boolean): Promise<void> {
    const encrypted = await encryptBundle(aesKey, aad, nextBundle);
    const updated: StoredMcpTokenRecord = {
      ...currentRecord,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      lastUsedAt: touchLastUsed ? new Date().toISOString() : currentRecord.lastUsedAt,
    };
    currentBundle = nextBundle;
    currentRecord = updated;
    await kv!.put(tokenKvKey(updated.tokenId), JSON.stringify(updated), {
      expirationTtl: remainingTtlSeconds(updated.expiresAt),
    });
  }

  const now = Date.now();
  const isNearZwiftExpiry =
    currentBundle.zwiftExpiresAt !== undefined &&
    currentBundle.zwiftExpiresAt - now < ZWIFT_REFRESH_BUFFER_MS;
  const isZwiftExpired =
    currentBundle.zwiftExpiresAt !== undefined && currentBundle.zwiftExpiresAt <= now;

  if (isNearZwiftExpiry && currentBundle.zwiftRefreshToken) {
    const refreshed = await refreshZwiftAccessToken(currentBundle.zwiftRefreshToken);
    if (refreshed) {
      await persistState(
        {
          zwiftAccessToken: refreshed.accessToken,
          zwiftRefreshToken: refreshed.refreshToken,
          zwiftExpiresAt: refreshed.expiresAt,
        },
        true,
      );
    } else if (isZwiftExpired) {
      return {
        ok: false,
        status: 401,
        error: 'zwift_session_expired',
        message: 'Your Zwift refresh token has expired. Generate a new MCP token in Zwift Victims.',
      };
    }
  } else if (isZwiftExpired) {
    return {
      ok: false,
      status: 401,
      error: 'zwift_session_expired',
      message: 'Your Zwift access token has expired. Generate a new MCP token in Zwift Victims.',
    };
  } else {
    const lastUsedMs = currentRecord.lastUsedAt ? Date.parse(currentRecord.lastUsedAt) : 0;
    if (!lastUsedMs || now - lastUsedMs >= LAST_USED_UPDATE_INTERVAL_MS) {
      await persistState(currentBundle, true);
    }
  }

  let refreshPromise: Promise<string | null> | null = null;
  const session: McpSession = {
    tokenId: currentRecord.tokenId,
    riderId: currentRecord.riderId,
    riderName: currentRecord.riderName,
    get zwiftAccessToken() {
      return currentBundle.zwiftAccessToken;
    },
    refreshZwiftToken: async () => {
      if (!currentBundle.zwiftRefreshToken) return null;
      if (!refreshPromise) {
        refreshPromise = (async () => {
          const refreshed = await refreshZwiftAccessToken(currentBundle.zwiftRefreshToken!);
          if (!refreshed) return null;
          await persistState(
            {
              zwiftAccessToken: refreshed.accessToken,
              zwiftRefreshToken: refreshed.refreshToken,
              zwiftExpiresAt: refreshed.expiresAt,
            },
            true,
          );
          return refreshed.accessToken;
        })().finally(() => {
          refreshPromise = null;
        });
      }
      return refreshPromise;
    },
  };

  return { ok: true, session };
}

export async function handleMcpTokensApi(
  request: Request,
  env: McpEnv,
  subPath: string,
): Promise<Response> {
  const isCollectionPath = subPath === '' || subPath === '/';
  const singleMatch = isCollectionPath ? null : subPath.match(/^\/([A-Za-z0-9_-]{16,64})$/);
  if (!isCollectionPath && !singleMatch) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  if (isCollectionPath && !['GET', 'POST', 'DELETE'].includes(request.method)) {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }
  if (singleMatch && request.method !== 'DELETE') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const zwiftToken = extractBearerToken(request);
  if (!zwiftToken) {
    return jsonResponse({ error: 'unauthorized', message: 'Zwift Bearer token required.' }, 401);
  }

  const me = await fetchZwiftMeProfile(zwiftToken);
  if (!me.ok || !me.profile || typeof me.profile.id !== 'number') {
    if (me.status === 401 || me.status === 403) {
      return jsonResponse({ error: 'unauthorized', message: 'Invalid or expired Zwift session.' }, 401);
    }
    return jsonResponse(
      { error: 'auth_verification_unavailable', message: 'Unable to verify Zwift session.' },
      503,
    );
  }

  const riderId = me.profile.id;
  const riderName =
    [me.profile.firstName, me.profile.lastName].filter(Boolean).join(' ').trim() ||
    `Rider ${riderId}`;

  if (isCollectionPath && request.method === 'GET') {
    if (!isMcpStorageConfigured(env)) {
      return jsonResponse({
        configured: false,
        tokens: [],
        setupNote: KV_SETUP_NOTE,
      });
    }
    const tokens = await listRiderMcpTokens(env, riderId);
    return jsonResponse({ configured: true, tokens });
  }

  if (!isMcpStorageConfigured(env)) {
    return jsonResponse({ error: 'mcp_kv_not_configured', message: KV_SETUP_NOTE }, 503);
  }

  if (isCollectionPath && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as {
      refreshToken?: unknown;
      expiresAt?: unknown;
      label?: unknown;
      ttlDays?: unknown;
    } | null;
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'invalid_request', message: 'JSON body required.' }, 400);
    }

    const refreshToken =
      typeof body.refreshToken === 'string' && body.refreshToken.trim()
        ? body.refreshToken.trim()
        : undefined;
    const expiresAt =
      typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)
        ? body.expiresAt
        : undefined;

    const minted = await mintMcpToken(env, {
      riderId,
      riderName,
      zwiftAccessToken: zwiftToken,
      zwiftRefreshToken: refreshToken,
      zwiftExpiresAt: expiresAt,
      label: body.label,
      ttlDays: body.ttlDays,
    });

    if (!minted.ok) {
      return jsonResponse({ error: minted.error, message: minted.message }, minted.status);
    }
    return jsonResponse({ token: minted.token, metadata: minted.metadata }, 201);
  }

  if (isCollectionPath && request.method === 'DELETE') {
    const revokedCount = await revokeAllRiderMcpTokens(env, riderId);
    return jsonResponse({ revokedCount });
  }

  if (singleMatch && request.method === 'DELETE') {
    const revoked = await revokeMcpToken(env, riderId, singleMatch[1]);
    if (!revoked) {
      return jsonResponse({ error: 'token_not_found', message: 'Token not found.' }, 404);
    }
    return jsonResponse({ revoked: true, tokenId: singleMatch[1] });
  }

  return jsonResponse({ error: 'method_not_allowed' }, 405);
}
