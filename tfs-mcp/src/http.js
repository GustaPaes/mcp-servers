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
  MCP_HTTP_SESSION_TTL_MS,
  MCP_HTTP_TOKEN,
} from "./config.js";
import { checkTfsConnectivity } from "./tfs-client.js";
import { logger } from "./logger.js";

// Session store: sessionId → { transport, expiresAt, timer }
const sessions = new Map();

function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host ?? "").toLowerCase());
}

function closeSession(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  clearTimeout(entry.timer);
  sessions.delete(sessionId);
  entry.transport?.close?.().catch?.(() => {});
}

function registerSession(sessionId, transport) {
  const timer = setTimeout(() => closeSession(sessionId), MCP_HTTP_SESSION_TTL_MS);
  sessions.set(sessionId, {
    transport,
    expiresAt: Date.now() + MCP_HTTP_SESSION_TTL_MS,
    timer,
  });
}

export async function startHttpStreamable(port, host = MCP_HTTP_HOST) {
  if (!isLoopback(host) && !MCP_HTTP_TOKEN) {
    throw new Error("MCP_HTTP_TOKEN is required when MCP_HTTP_HOST is not loopback");
  }

  const httpServer = http.createServer(async (req, res) => {
    try {
      // ── Health endpoint (unauthenticated) ───────────────────────────────
      if ((req.url === "/health" || req.url === "/healthz") && req.method === "GET") {
        const tfsHealth = await checkTfsConnectivity();
        const body = JSON.stringify({
          status: "ok",
          transport: "streamable-http",
          endpoint: `http://${host}:${port}/mcp`,
          tools: getToolCount(),
          tfs: tfsHealth,
          version: "2.0.0",
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

      // ── MCP endpoint ────────────────────────────────────────────────────
      const urlPath = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
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
        transport = entry.transport;
      } else if (!sessionId && req.method === "POST" && parsedBody?.method === "initialize") {
        // New session — initialize
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            registerSession(sid, transport);
            logger.debug({ sessionId: sid }, "MCP session initialized");
          },
          onsessionclosed: (sid) => {
            closeSession(sid);
            logger.debug({ sessionId: sid }, "MCP session closed");
          },
        });
        const server = buildMcpServer();
        await server.connect(transport);
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
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
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
    { host, port, endpoint: `http://${host}:${port}/mcp`, health: `http://${host}:${port}/healthz` },
    "MCP HTTP server started"
  );
}
