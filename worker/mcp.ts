import { authenticateMcpRequest } from './mcpAuth';
import type { McpEnv, McpSession } from './mcpAuth';
import { MCP_TOOLS, McpToolError, executeMcpTool } from './mcpTools';

const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const MAX_JSON_RPC_BATCH = 20;

const MCP_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version',
  'Cache-Control': 'no-store',
};

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function mcpJsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...MCP_CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function rpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  };
}

function negotiateProtocolVersion(requested: unknown): string {
  if (
    typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return DEFAULT_PROTOCOL_VERSION;
}

function hasValidId(id: unknown): id is string | number | null {
  return id === null || typeof id === 'string' || typeof id === 'number';
}

async function handleJsonRpcMessage(
  msg: unknown,
  session: McpSession,
): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return rpcError(null, -32600, 'Invalid Request');
  }

  const req = msg as JsonRpcRequest;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string' || !req.method) {
    const id = hasValidId(req.id) ? req.id : null;
    return rpcError(id, -32600, 'Invalid JSON-RPC 2.0 request');
  }

  const hasId = Object.prototype.hasOwnProperty.call(req, 'id') && req.id !== undefined;
  if (!hasId || req.method.startsWith('notifications/')) {
    return null;
  }

  if (!hasValidId(req.id)) {
    return rpcError(null, -32600, 'Invalid JSON-RPC id');
  }
  const id = req.id;

  switch (req.method) {
    case 'initialize': {
      const params =
        req.params && typeof req.params === 'object'
          ? (req.params as Record<string, unknown>)
          : {};
      const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
      return rpcSuccess(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'zwift-victims',
          title: 'Zwift Victims MCP',
          version: '1.0.0',
        },
        instructions:
          'Read-only access to the authenticated Zwift rider’s activities, FIT/fitnessData telemetry streams, power curve, race results, and intervals. Start with get_activities to find activityId/eventId values, then call get_activity_detail, get_activity_stream (defaults to 5s resampling and 720 rows), or get_race_results as needed.',
      });
    }

    case 'ping':
      return rpcSuccess(id, {});

    case 'tools/list':
      return rpcSuccess(id, { tools: MCP_TOOLS });

    case 'tools/call': {
      const params =
        req.params && typeof req.params === 'object'
          ? (req.params as Record<string, unknown>)
          : null;
      const toolName = params && typeof params.name === 'string' ? params.name : '';
      if (!toolName) {
        return rpcError(id, -32602, 'Invalid params: tool "name" is required.');
      }

      try {
        const result = await executeMcpTool(toolName, params?.arguments ?? {}, session);
        return rpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (err) {
        if (err instanceof McpToolError) {
          return rpcSuccess(id, {
            content: [{ type: 'text', text: err.message }],
            isError: true,
          });
        }
        const safeMsg = err instanceof Error ? err.message : 'Unexpected tool error';
        console.error(`MCP tool "${toolName}" failed:`, safeMsg);
        return rpcSuccess(id, {
          content: [
            {
              type: 'text',
              text: 'Tool execution failed due to an upstream or internal error.',
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

export async function handleMcpEndpoint(request: Request, env: McpEnv): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }

  if (request.method === 'GET') {
    return mcpJsonResponse(
      {
        error: 'method_not_allowed',
        message: 'This stateless Streamable HTTP MCP endpoint accepts POST JSON-RPC requests.',
      },
      405,
      { Allow: 'POST, DELETE, OPTIONS' },
    );
  }

  if (request.method === 'DELETE') {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return mcpJsonResponse({ error: 'method_not_allowed' }, 405, {
      Allow: 'POST, DELETE, OPTIONS',
    });
  }

  const auth = await authenticateMcpRequest(request, env);
  if (!auth.ok) {
    const headers: Record<string, string> | undefined =
      auth.status === 401
        ? {
            'WWW-Authenticate': 'Bearer realm="zwift-victims-mcp", error="invalid_token"',
          }
        : undefined;
    return mcpJsonResponse({ error: auth.error, message: auth.message }, auth.status, headers);
  }

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return mcpJsonResponse(
      {
        error: 'unsupported_media_type',
        message: 'Content-Type must be application/json.',
      },
      415,
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return mcpJsonResponse(rpcError(null, -32700, 'Parse error: invalid JSON'), 400);
  }

  const headerVersion = request.headers.get('MCP-Protocol-Version');
  const responseProtocolHeader = headerVersion
    ? { 'MCP-Protocol-Version': negotiateProtocolVersion(headerVersion) }
    : undefined;

  if (Array.isArray(parsedBody)) {
    if (parsedBody.length === 0) {
      return mcpJsonResponse(
        rpcError(null, -32600, 'Invalid Request: batch array cannot be empty'),
        400,
      );
    }
    if (parsedBody.length > MAX_JSON_RPC_BATCH) {
      return mcpJsonResponse(
        rpcError(null, -32600, `Batch size exceeds limit of ${MAX_JSON_RPC_BATCH}`),
        400,
      );
    }
    const responses = (
      await Promise.all(parsedBody.map((item) => handleJsonRpcMessage(item, auth.session)))
    ).filter((r): r is JsonRpcResponse => r !== null);

    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
    }
    return mcpJsonResponse(responses, 200, responseProtocolHeader);
  }

  const single = await handleJsonRpcMessage(parsedBody, auth.session);
  if (single === null) {
    return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
  }
  return mcpJsonResponse(single, 200, responseProtocolHeader);
}
