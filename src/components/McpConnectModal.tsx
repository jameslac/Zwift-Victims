import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  buildClaudeCodeCommand,
  buildClaudeCodeJson,
  buildClaudeDesktopConfigJson,
  buildGeminiCliCommand,
  buildGeminiCliSettingsJson,
  createMcpToken,
  fetchMcpTokens,
  revokeAllMcpTokens,
  revokeMcpToken,
} from '../api/mcpTokens';
import type { McpTokenSummary } from '../api/mcpTokens';
import { AuthError } from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';

type ClientTab = 'gemini' | 'claude-code' | 'claude-desktop';

const TOKEN_PLACEHOLDER = '<YOUR_MCP_TOKEN>';

const EXPIRY_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
] as const;

const TOOL_CATALOG = [
  { name: 'get_activities', desc: 'List/filter races, rides, workouts, and free rides' },
  { name: 'get_activity_detail', desc: 'Metadata, physiology summary, and race impact' },
  { name: 'get_activity_stream', desc: 'Resampled or 1s telemetry CSV/JSON with row caps' },
  { name: 'get_power_curve', desc: 'All-time, 90-day, and ZwiftPower race bests' },
  { name: 'get_race_results', desc: 'Unified pen standings, vELO, ZRS, and splits' },
  { name: 'get_intervals', desc: 'FIT laps and detected high-intensity work intervals' },
] as const;

function formatShortDate(iso: string | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function CopySnippetBlock({
  label,
  code,
  copiedKey,
  copyId,
  onCopy,
}: {
  label: string;
  code: string;
  copiedKey: string | null;
  copyId: string;
  onCopy: (key: string, text: string) => void;
}) {
  const isCopied = copiedKey === copyId;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/85 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800/90 bg-slate-900/60">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 truncate">
          {label}
        </span>
        <button
          type="button"
          onClick={() => onCopy(copyId, code)}
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors ${
            isCopied
              ? 'border-accent/60 bg-accent/15 text-accent-text'
              : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-accent/60 hover:text-accent-text'
          }`}
        >
          {isCopied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function McpConnectModal({ onClose }: { onClose: () => void }) {
  const { getAccessToken, getTokenSet } = useAuth();

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean>(true);
  const [setupNote, setSetupNote] = useState<string | null>(null);
  const [tokens, setTokens] = useState<McpTokenSummary[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [labelInput, setLabelInput] = useState('');
  const [ttlDays, setTtlDays] = useState<number>(90);
  const [minting, setMinting] = useState(false);
  const [mintedToken, setMintedToken] = useState<string | null>(null);

  const [clientTab, setClientTab] = useState<ClientTab>('gemini');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const endpointUrl = useMemo(
    () => (typeof window !== 'undefined' ? `${window.location.origin}/mcp` : '/mcp'),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    getAccessToken()
      .then(fetchMcpTokens)
      .then((res) => {
        if (cancelled) return;
        setConfigured(res.configured);
        setSetupNote(res.setupNote ?? null);
        setTokens(res.tokens);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) {
          onClose();
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load MCP tokens.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getAccessToken, onClose]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      setErrorMsg('Clipboard access was denied by your browser.');
    }
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (minting || !configured) return;

    setMinting(true);
    setErrorMsg(null);
    try {
      const tokenSet = await getTokenSet();
      const created = await createMcpToken(tokenSet, {
        label: labelInput.trim() || 'MCP Client',
        ttlDays,
      });
      setMintedToken(created.token);
      setTokens((prev) => [created.metadata, ...prev]);
      setLabelInput('');
    } catch (err) {
      if (err instanceof AuthError) {
        onClose();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate MCP token.');
    } finally {
      setMinting(false);
    }
  }

  async function handleRevokeSingle(tokenId: string) {
    setBusyTokenId(tokenId);
    setErrorMsg(null);
    try {
      const accessToken = await getAccessToken();
      await revokeMcpToken(accessToken, tokenId);
      setTokens((prev) => prev.filter((t) => t.tokenId !== tokenId));
      setConfirmRevokeId(null);
      if (mintedToken?.includes(tokenId)) {
        setMintedToken(null);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        onClose();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Failed to revoke MCP token.');
    } finally {
      setBusyTokenId(null);
    }
  }

  async function handleRevokeAll() {
    setBusyTokenId('__all__');
    setErrorMsg(null);
    try {
      const accessToken = await getAccessToken();
      await revokeAllMcpTokens(accessToken);
      setTokens([]);
      setMintedToken(null);
      setConfirmRevokeAll(false);
    } catch (err) {
      if (err instanceof AuthError) {
        onClose();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Failed to revoke tokens.');
    } finally {
      setBusyTokenId(null);
    }
  }

  const activeSnippetToken = mintedToken ?? TOKEN_PLACEHOLDER;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Connect AI / MCP"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88dvh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700/90 shadow-2xl p-4 sm:p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/15 border border-accent/40 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-accent-text">
              <span>Remote MCP · Read-Only</span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-100">
              Connect AI / MCP
            </h2>
            <p className="text-xs text-slate-400">
              Query your own rides, power curves, race standings, and FIT telemetry directly from
              Gemini CLI, Claude Code, or Claude Desktop without exporting files.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Connect AI / MCP"
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Done
          </button>
        </div>

        {/* Endpoint URL */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Streamable HTTP Endpoint
            </p>
            <p className="text-xs sm:text-sm font-mono text-slate-100 break-all mt-0.5">
              {endpointUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyText('endpoint', endpointUrl)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
              copiedKey === 'endpoint'
                ? 'border-accent/60 bg-accent/15 text-accent-text'
                : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-accent/60 hover:text-accent-text'
            }`}
          >
            {copiedKey === 'endpoint' ? 'Copied!' : 'Copy URL'}
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200"
          >
            {errorMsg}
          </div>
        )}

        {!configured && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-1.5 text-xs text-amber-200">
            <p className="font-bold text-amber-100">Worker KV Storage Not Bound Yet</p>
            <p className="leading-relaxed">
              {setupNote ??
                'Create and bind a Cloudflare KV namespace named MCP_TOKENS in wrangler.jsonc (or Worker Settings -> Bindings) to mint persistent personal MCP tokens.'}
            </p>
          </div>
        )}

        {/* Generate Personal Token */}
        <form
          onSubmit={handleGenerate}
          className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 sm:p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Generate Personal MCP Token
            </h3>
            <span className="text-[11px] text-slate-400">
              Scoped strictly to your Zwift account
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              maxLength={48}
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Device label (e.g. MacBook Gemini CLI)"
              aria-label="MCP token label"
              disabled={!configured || minting}
              className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!configured || minting}
              className="rounded-xl bg-accent px-4 py-2 text-xs sm:text-sm font-extrabold text-accent-foreground hover:opacity-95 transition-opacity disabled:opacity-40 shrink-0"
            >
              {minting ? 'Generating…' : 'Generate Token'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 mr-1">Expires in:</span>
            {EXPIRY_OPTIONS.map((opt) => {
              const active = ttlDays === opt.days;
              return (
                <button
                  key={opt.days}
                  type="button"
                  onClick={() => setTtlDays(opt.days)}
                  aria-pressed={active}
                  disabled={!configured || minting}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    active
                      ? 'border-accent bg-accent/15 text-accent-text'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {mintedToken && (
            <div className="rounded-xl border border-accent/50 bg-accent/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-accent-text">
                  New Token (Shown Once)
                </p>
                <button
                  type="button"
                  onClick={() => void copyText('minted-token', mintedToken)}
                  className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-extrabold text-accent-foreground"
                >
                  {copiedKey === 'minted-token' ? 'Copied!' : 'Copy Token'}
                </button>
              </div>
              <p className="text-xs font-mono text-slate-100 break-all select-all bg-slate-950/80 rounded-lg p-2 border border-slate-800">
                {mintedToken}
              </p>
              <p className="text-[11px] text-slate-300">
                The snippets below now include this token. Store it in your client config — it
                cannot be viewed again after closing this dialog.
              </p>
            </div>
          )}
        </form>

        {/* Client Setup Snippets */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Client Configuration Snippets
            </h3>
            {!mintedToken && (
              <span className="text-[11px] text-slate-400">
                Generate a token above to auto-fill snippets
              </span>
            )}
          </div>

          <div
            role="tablist"
            aria-label="MCP client setup tabs"
            className="grid grid-cols-3 gap-1 rounded-xl bg-slate-950 border border-slate-800 p-1"
          >
            {(
              [
                { id: 'gemini', label: 'Gemini CLI' },
                { id: 'claude-code', label: 'Claude Code' },
                { id: 'claude-desktop', label: 'Claude Desktop' },
              ] as const
            ).map((tab) => {
              const active = clientTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setClientTab(tab.id)}
                  className={`rounded-lg py-2 px-2 text-xs font-bold transition-colors ${
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {clientTab === 'gemini' && (
            <div className="space-y-2.5">
              <CopySnippetBlock
                label="CLI Command"
                copyId="gemini-cmd"
                copiedKey={copiedKey}
                onCopy={(k, v) => void copyText(k, v)}
                code={buildGeminiCliCommand({ endpointUrl, token: activeSnippetToken })}
              />
              <CopySnippetBlock
                label="~/.gemini/settings.json"
                copyId="gemini-json"
                copiedKey={copiedKey}
                onCopy={(k, v) => void copyText(k, v)}
                code={buildGeminiCliSettingsJson({ endpointUrl, token: activeSnippetToken })}
              />
            </div>
          )}

          {clientTab === 'claude-code' && (
            <div className="space-y-2.5">
              <CopySnippetBlock
                label="CLI Command"
                copyId="cc-cmd"
                copiedKey={copiedKey}
                onCopy={(k, v) => void copyText(k, v)}
                code={buildClaudeCodeCommand({ endpointUrl, token: activeSnippetToken })}
              />
              <CopySnippetBlock
                label=".mcp.json"
                copyId="cc-json"
                copiedKey={copiedKey}
                onCopy={(k, v) => void copyText(k, v)}
                code={buildClaudeCodeJson({ endpointUrl, token: activeSnippetToken })}
              />
            </div>
          )}

          {clientTab === 'claude-desktop' && (
            <div className="space-y-2">
              <CopySnippetBlock
                label="claude_desktop_config.json (via mcp-remote)"
                copyId="cd-json"
                copiedKey={copiedKey}
                onCopy={(k, v) => void copyText(k, v)}
                code={buildClaudeDesktopConfigJson({ endpointUrl, token: activeSnippetToken })}
              />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                macOS:{' '}
                <code className="text-slate-300">
                  ~/Library/Application Support/Claude/claude_desktop_config.json
                </code>{' '}
                · Windows:{' '}
                <code className="text-slate-300">%APPDATA%\Claude\claude_desktop_config.json</code>
              </p>
            </div>
          )}

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Web apps (<code className="text-slate-300">claude.ai</code> custom connectors and{' '}
            <code className="text-slate-300">gemini.google.com</code>) require OAuth 2.1; for
            browser chat sessions, use <strong className="text-slate-300">Select &amp; Export</strong>{' '}
            on Race History to attach CSVs directly.
          </p>
        </div>

        {/* Active Tokens */}
        <div className="space-y-2.5 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Active Tokens {!loading && configured ? `(${tokens.length}/10)` : ''}
            </h3>
            {tokens.length >= 2 && (
              <div className="flex items-center gap-1.5">
                {confirmRevokeAll ? (
                  <>
                    <button
                      type="button"
                      disabled={busyTokenId === '__all__'}
                      onClick={() => void handleRevokeAll()}
                      className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {busyTokenId === '__all__' ? 'Revoking…' : 'Confirm Revoke All'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeAll(false)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-300"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRevokeAll(true)}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/20"
                  >
                    Revoke All
                  </button>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <p className="text-xs text-slate-400">Checking active tokens…</p>
          ) : tokens.length === 0 ? (
            <p className="text-xs text-slate-400">
              No active MCP tokens yet. Generate one above to connect a client.
            </p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((tok) => {
                const confirming = confirmRevokeId === tok.tokenId;
                const busy = busyTokenId === tok.tokenId;
                return (
                  <li
                    key={tok.tokenId}
                    className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-100 break-words">
                          {tok.label}
                        </span>
                        <code className="text-[11px] font-mono text-slate-400">
                          zv_mcp_{tok.tokenId.slice(0, 8)}…
                        </code>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Created {formatShortDate(tok.createdAt)} · Expires{' '}
                        {formatShortDate(tok.expiresAt)}
                        {tok.lastUsedAt ? ` · Last used ${formatShortDate(tok.lastUsedAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {confirming ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleRevokeSingle(tok.tokenId)}
                            className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
                          >
                            {busy ? 'Revoking…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRevokeId(null)}
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(tok.tokenId)}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-red-500/50 hover:text-red-300 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Available Tools Accordion */}
        <div className="border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => setToolsExpanded((prev) => !prev)}
            aria-expanded={toolsExpanded}
            className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-accent-text transition-colors py-1"
          >
            <span>Available Read-Only MCP Tools ({TOOL_CATALOG.length})</span>
            <span>{toolsExpanded ? 'Hide' : 'Show'}</span>
          </button>
          {toolsExpanded && (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TOOL_CATALOG.map((tool) => (
                <div
                  key={tool.name}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5"
                >
                  <code className="text-xs font-bold text-accent-text">{tool.name}</code>
                  <p className="text-[11px] text-slate-400 mt-0.5">{tool.desc}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
