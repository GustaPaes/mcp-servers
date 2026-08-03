/**
 * HTTP transport — Streamable HTTP (MCP spec 2025-03-26+).
 *
 * Recursos:
 *  - Stateful (recomendado): cada sessão tem um McpServer dedicado e ID Mcp-Session-Id.
 *  - Stateless (sessionIdGenerator=undefined): cada request cria/destrói a sessão.
 *  - Bearer auth opcional via MCP_HTTP_BEARER_TOKENS (CSV). Vazio = sem auth
 *    (apenas localhost em desenvolvimento).
 *  - Endpoint único: POST/GET/DELETE em /mcp.
 *  - Healthcheck simples em GET /healthz (não passa por MCP).
 *
 * NUNCA expor sem auth fora de localhost. Para deploy público use reverse proxy
 * com TLS + tokens fortes + IP allowlist.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { buildMcpServer } from '../mcp/buildServer.js';

interface Session {
  id: string;
  transport: StreamableHTTPServerTransport;
  closeServer: () => Promise<void>;
  timer?: NodeJS.Timeout;
  closing?: boolean;
}

const SESSION_HEADER = 'mcp-session-id';

function parseBearerTokens(csv: string): Set<string> {
  return new Set(
    csv
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );
}

function isAuthorized(req: IncomingMessage, allowed: Set<string>): boolean {
  if (allowed.size === 0) return true;
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !match[1]) return false;
  const supplied = createHash('sha256').update(match[1].trim()).digest();
  return [...allowed].some((token) => {
    const expected = createHash('sha256').update(token).digest();
    return timingSafeEqual(supplied, expected);
  });
}

class HttpInputError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > limitBytes) throw new HttpInputError(413, 'payload_too_large');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpInputError(400, 'invalid_json');
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function runHttp(): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  const allowed = parseBearerTokens(env.MCP_HTTP_BEARER_TOKENS);
  const stateful = env.MCP_HTTP_STATEFUL;

  if (
    allowed.size === 0 &&
    !['127.0.0.1', 'localhost', '::1'].includes(env.MCP_HTTP_HOST.toLowerCase())
  ) {
    throw new Error(
      'MCP_HTTP_BEARER_TOKENS is required when MCP_HTTP_HOST is not loopback',
    );
  }

  const sessions = new Map<string, Session>();

  async function closeSession(session: Session): Promise<void> {
    if (session.closing) return;
    session.closing = true;
    sessions.delete(session.id);
    if (session.timer) clearTimeout(session.timer);
    try {
      await session.transport.close();
    } catch {
      /* ignore */
    }
    await session.closeServer();
  }

  function touchSession(session: Session): void {
    if (!stateful) return;
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(
      () => void closeSession(session),
      env.MCP_HTTP_SESSION_TTL_MS,
    );
    session.timer.unref?.();
  }

  async function createSession(): Promise<{ id: string; session: Session }> {
    if (stateful && sessions.size >= env.MCP_HTTP_MAX_SESSIONS) {
      throw new HttpInputError(503, 'session_limit_reached');
    }
    const { server } = await buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: stateful ? () => randomUUID() : undefined,
    });
    await server.connect(transport);

    const closeServer = async () => {
      try {
        await server.close();
      } catch {
        /* ignore */
      }
    };

    // Para modo stateful, o ID só fica disponível depois da inicialização.
    // Vamos gerar um id provisório e remapear no primeiro response.
    const id = transport.sessionId ?? randomUUID();
    const session: Session = { id, transport, closeServer };
    touchSession(session);
    transport.onclose = () => {
      void closeSession(session);
    };
    return { id, session };
  }

  const httpServer = createServer((req, res) => {
    void (async () => {
      try {
        if (!req.url) {
          writeJson(res, 400, { error: 'missing url' });
          return;
        }

        // Healthcheck — não autenticado, não MCP.
        if (req.method === 'GET' && req.url.startsWith('/healthz')) {
          writeJson(res, 200, { ok: true, transport: 'http', sessions: sessions.size });
          return;
        }

        if (!req.url.startsWith('/mcp')) {
          writeJson(res, 404, { error: 'not found' });
          return;
        }

        if (!isAuthorized(req, allowed)) {
          writeJson(res, 401, { error: 'unauthorized' });
          return;
        }

        const sessionId = req.headers[SESSION_HEADER] as string | undefined;

        if (stateful) {
          if (sessionId && sessions.has(sessionId)) {
            const s = sessions.get(sessionId)!;
            touchSession(s);
            const body =
              req.method === 'POST'
                ? await readJsonBody(req, env.MCP_HTTP_BODY_LIMIT_BYTES)
                : undefined;
            await s.transport.handleRequest(req, res, body);
            return;
          }

          if (req.method === 'POST') {
            const body = await readJsonBody(req, env.MCP_HTTP_BODY_LIMIT_BYTES);
            const method =
              body && typeof body === 'object' && 'method' in body
                ? (body as { method?: unknown }).method
                : undefined;
            if (method !== 'initialize') {
              writeJson(res, 400, { error: 'missing session id; initialize first' });
              return;
            }
            // Sem session-id e initialize válido => nova sessão.
            const { id, session } = await createSession();
            sessions.set(id, session);
            await session.transport.handleRequest(req, res, body);
            // Pode ter sido remapeado pelo SDK; sincroniza.
            const real = session.transport.sessionId;
            if (real && real !== id) {
              sessions.delete(id);
              session.id = real;
              sessions.set(real, session);
            }
            return;
          }

          writeJson(res, 400, { error: 'invalid or missing session id' });
          return;
        }

        // Stateless: cria sessão one-shot.
        const { session } = await createSession();
        const body =
          req.method === 'POST'
            ? await readJsonBody(req, env.MCP_HTTP_BODY_LIMIT_BYTES)
            : undefined;
        try {
          await session.transport.handleRequest(req, res, body);
        } finally {
          await closeSession(session);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err: message }, 'http.handler.error');
        if (!res.headersSent) {
          if (err instanceof HttpInputError) {
            writeJson(res, err.status, { error: err.code });
          } else {
            writeJson(res, 500, { error: 'internal_error' });
          }
        } else {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
      }
    })();
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(env.MCP_HTTP_PORT, env.MCP_HTTP_HOST, () => resolve());
  });

  log.info(
    {
      transport: 'http',
      host: env.MCP_HTTP_HOST,
      port: env.MCP_HTTP_PORT,
      stateful,
      authRequired: allowed.size > 0,
    },
    'meta-ads-mcp HTTP listening',
  );

  // Graceful shutdown.
  const shutdown = async () => {
    log.info('shutting down HTTP transport');
    httpServer.close();
    await Promise.allSettled([...sessions.values()].map((session) => closeSession(session)));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
