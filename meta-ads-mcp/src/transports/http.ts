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
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { buildMcpServer } from '../mcp/buildServer.js';

interface Session {
  transport: StreamableHTTPServerTransport;
  closeServer: () => Promise<void>;
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
  return allowed.has(match[1].trim());
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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

  if (allowed.size === 0 && env.MCP_HTTP_HOST !== '127.0.0.1' && env.MCP_HTTP_HOST !== 'localhost') {
    log.warn(
      { host: env.MCP_HTTP_HOST },
      'HTTP transport sem MCP_HTTP_BEARER_TOKENS em host não-local. EXTREMAMENTE inseguro.',
    );
  }

  const sessions = new Map<string, Session>();

  async function createSession(): Promise<{ id: string; session: Session }> {
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
    const session: Session = { transport, closeServer };
    transport.onclose = () => {
      sessions.delete(id);
      void closeServer();
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
            const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
            await s.transport.handleRequest(req, res, body);
            return;
          }

          if (req.method === 'POST') {
            // Sem session-id => nova sessão de inicialização.
            const { id, session } = await createSession();
            sessions.set(id, session);
            const body = await readJsonBody(req);
            await session.transport.handleRequest(req, res, body);
            // Pode ter sido remapeado pelo SDK; sincroniza.
            const real = session.transport.sessionId;
            if (real && real !== id) {
              sessions.delete(id);
              sessions.set(real, session);
            }
            return;
          }

          writeJson(res, 400, { error: 'invalid or missing session id' });
          return;
        }

        // Stateless: cria sessão one-shot.
        const { session } = await createSession();
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
        try {
          await session.transport.handleRequest(req, res, body);
        } finally {
          await session.closeServer();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err: message }, 'http.handler.error');
        if (!res.headersSent) {
          writeJson(res, 500, { error: 'internal error', message });
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
    for (const s of sessions.values()) {
      try {
        await s.transport.close();
      } catch {
        /* ignore */
      }
      await s.closeServer();
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
