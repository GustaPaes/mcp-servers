/**
 * http.js — Modo HTTP Streamable MCP.
 * Inclui Bearer auth para uso remoto, body limit e health endpoint rico.
 */
import http from "http";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, getToolCount } from "./server.js";
import {
  MCP_HTTP_BODY_LIMIT_BYTES,
  MCP_HTTP_HOST,
  MCP_HTTP_MAX_SESSIONS,
  MCP_HTTP_SESSION_TTL_MS,
  MCP_HTTP_TOKEN,
} from "./config.js";
import { checkTfsConnectivity } from "./tfs-client.js";
import { logger } from "./logger.js";

// Session store: sessionId → { transport, expiresAt, timer }
const sessions = new Map();
let readinessCache = { expiresAt: 0, value: null };

async function getReadiness() {
  if (readinessCache.value && readinessCache.expiresAt > Date.now()) {
    return readinessCache.value;
  }
  const value = await checkTfsConnectivity();
  readinessCache = { value, expiresAt: Date.now() + 15_000 };
  return value;
}

function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host ?? "").toLowerCase());
}

async function closeSession(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  clearTimeout(entry.timer);
  sessions.delete(sessionId);
  await entry.transport?.close?.().catch?.(() => {});
  await entry.server?.close?.().catch?.(() => {});
}

function registerSession(sessionId, transport, server) {
  const entry = {
    transport,
    server,
    expiresAt: 0,
    timer: undefined,
  };
  sessions.set(sessionId, entry);
  touchSession(sessionId, entry);
}

function touchSession(sessionId, entry) {
  clearTimeout(entry.timer);
  entry.expiresAt = Date.now() + MCP_HTTP_SESSION_TTL_MS;
  entry.timer = setTimeout(() => void closeSession(sessionId), MCP_HTTP_SESSION_TTL_MS);
  entry.timer.unref?.();
}

export async function startHttpStreamable(port, host = MCP_HTTP_HOST) {
  if (!isLoopback(host) && !MCP_HTTP_TOKEN) {
    throw new Error("MCP_HTTP_TOKEN is required when MCP_HTTP_HOST is not loopback");
  }

  const httpServer = http.createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;

      // ── Liveness endpoint (unauthenticated, no external I/O) ────────────
      if ((urlPath === "/health" || urlPath === "/healthz") && req.method === "GET") {
        const body = JSON.stringify({
          status: "ok",
          transport: "streamable-http",
          endpoint: `http://${host}:${port}/mcp`,
          tools: getToolCount(),
          version: "2.1.0",
          activeSessions: sessions.size,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        return;
      }

      // ── Bearer auth, mandatory when token is configured or host is remote ─
      if (MCP_HTTP_TOKEN) {
        const authHeader = (req.headers["authorization"] ?? "").trim();
        const expected = `Bearer ${MCP_HTTP_TOKEN}`;
        if (authHeader !== expected) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }

      // ── Readiness endpoint (authenticated when a token is configured) ───
      if (urlPath === "/readyz" && req.method === "GET") {
        const tfsHealth = await getReadiness();
        res.writeHead(tfsHealth.ok ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: tfsHealth.ok ? "ready" : "not_ready",
          tfs: { ok: tfsHealth.ok, latencyMs: tfsHealth.latencyMs },
        }));
        return;
      }

      // ── MCP endpoint ────────────────────────────────────────────────────
      if (urlPath !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }

      if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }

      // Parse body for POST requests
      let parsedBody;
      if (req.method === "POST") {
        const chunks = [];
        let totalBytes = 0;
        for await (const chunk of req) {
          const buffer = Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > MCP_HTTP_BODY_LIMIT_BYTES) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "payload_too_large" }));
            return;
          }
          chunks.push(buffer);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          parsedBody = raw ? JSON.parse(raw) : undefined;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_json" }));
          return;
        }
      }

      // Resolve or create session
      const sessionId = req.headers["mcp-session-id"];
      let transport;

      if (sessionId && sessions.has(sessionId)) {
        // Existing session — reuse transport
        const entry = sessions.get(sessionId);
        if (entry.expiresAt < Date.now()) {
          closeSession(sessionId);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "session_expired" }));
          return;
        }
        touchSession(sessionId, entry);
        transport = entry.transport;
      } else if (!sessionId && req.method === "POST" && parsedBody?.method === "initialize") {
        if (sessions.size >= MCP_HTTP_MAX_SESSIONS) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "session_limit_reached" }));
          return;
        }
        // New session — initialize
        let mcpServer;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            registerSession(sid, transport, mcpServer);
            logger.debug({ sessionId: sid }, "MCP session initialized");
          },
          onsessionclosed: (sid) => {
            void closeSession(sid);
            logger.debug({ sessionId: sid }, "MCP session closed");
          },
        });
        mcpServer = buildMcpServer();
        await mcpServer.connect(transport);
      } else {
        // Unknown session or bad request
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad_request", message: "Missing or unknown mcp-session-id. Send initialize first." }));
        return;
      }

      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      logger.error({ err: err.message }, "HTTP request error");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  logger.info(
    {
      host,
      port,
      endpoint: `http://${host}:${port}/mcp`,
      health: `http://${host}:${port}/healthz`,
      readiness: `http://${host}:${port}/readyz`,
    },
    "MCP HTTP server started"
  );

  const shutdown = async () => {
    await Promise.allSettled([...sessions.keys()].map((sessionId) => closeSession(sessionId)));
    await new Promise((resolve) => httpServer.close(() => resolve()));
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  return httpServer;
}
