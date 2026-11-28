import { AuthError } from './zwiftCore';
import type { TokenSet } from './zwiftCore';

export interface McpTokenSummary {
  tokenId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
}

export interface McpTokensListResponse {
  configured: boolean;
  tokens: McpTokenSummary[];
  setupNote?: string;
}

export interface McpTokenCreateResponse {
  token: string;
  metadata: McpTokenSummary;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    if (typeof body?.message === 'string' && body.message.trim()) return body.message.trim();
    if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  } catch {
    // Ignore non-JSON bodies
  }
  return fallback;
}

export async function fetchMcpTokens(accessToken: string): Promise<McpTokensListResponse> {
  const res = await fetch('/api/mcp/tokens', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new AuthError('Session expired.');
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to load MCP tokens (${res.status}).`));
  }
  return (await res.json()) as McpTokensListResponse;
}

export async function createMcpToken(
  tokenSet: TokenSet,
  opts: { label?: string; ttlDays?: number } = {},
): Promise<McpTokenCreateResponse> {
  const res = await fetch('/api/mcp/tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenSet.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt,
      label: opts.label,
      ttlDays: opts.ttlDays,
    }),
  });
  if (res.status === 401) throw new AuthError('Session expired.');
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to generate MCP token (${res.status}).`));
  }
  return (await res.json()) as McpTokenCreateResponse;
}

export async function revokeMcpToken(accessToken: string, tokenId: string): Promise<void> {
  const res = await fetch(`/api/mcp/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new AuthError('Session expired.');
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to revoke MCP token (${res.status}).`));
  }
}

export async function revokeAllMcpTokens(accessToken: string): Promise<number> {
  const res = await fetch('/api/mcp/tokens', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new AuthError('Session expired.');
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to revoke MCP tokens (${res.status}).`));
  }
  const data = (await res.json()) as { revokedCount?: number };
  return typeof data.revokedCount === 'number' ? data.revokedCount : 0;
}

export function buildGeminiCliSettingsJson(opts: {
  endpointUrl: string;
  token: string;
}): string {
  return JSON.stringify(
    {
      mcpServers: {
        'zwift-victims': {
          httpUrl: opts.endpointUrl,
          headers: {
            Authorization: `Bearer ${opts.token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function buildGeminiCliCommand(opts: { endpointUrl: string; token: string }): string {
  return `gemini mcp add --transport http --header "Authorization: Bearer ${opts.token}" zwift-victims ${opts.endpointUrl}`;
}

export function buildClaudeCodeCommand(opts: { endpointUrl: string; token: string }): string {
  return `claude mcp add --transport http zwift-victims ${opts.endpointUrl} --header "Authorization: Bearer ${opts.token}"`;
}

export function buildClaudeCodeJson(opts: { endpointUrl: string; token: string }): string {
  return JSON.stringify(
    {
      mcpServers: {
        'zwift-victims': {
          type: 'http',
          url: opts.endpointUrl,
          headers: {
            Authorization: `Bearer ${opts.token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function buildClaudeDesktopConfigJson(opts: {
  endpointUrl: string;
  token: string;
}): string {
  return JSON.stringify(
    {
      mcpServers: {
        'zwift-victims': {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            opts.endpointUrl,
            '--header',
            'Authorization:${AUTH_HEADER}',
          ],
          env: {
            AUTH_HEADER: `Bearer ${opts.token}`,
          },
        },
      },
    },
    null,
    2,
  );
}
