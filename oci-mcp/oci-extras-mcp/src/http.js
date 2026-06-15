/**
 * HTTP Streamable MCP transport.
 *
 * Uses @modelcontextprotocol/sdk's StreamableHTTPServerTransport which already
 * implements the MCP HTTP+SSE protocol. We expose a /mcp POST endpoint and a
 * /mcp GET endpoint for SSE.
 */
import http from "node:http";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import { logger } from "./safety/audit.js";
import { config, validateConfigForAuth } from "./config.js";

function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host ?? "").toLowerCase());
}

function isAuthorized(req) {
  if (!config.httpToken) return true;
  return String(req.headers.authorization ?? "") === `Bearer ${config.httpToken}`;
}

export async function startHttpStreamable({ port, host }) {
  validateConfigForAuth();
  if (!isLoopback(host) && !config.httpToken) {
    throw new Error("MCP_HTTP_TOKEN is required when binding oci-extras-mcp HTTP outside loopback");
  }
  const sessions = new Map(); // sessionId -> { server, transport, timer }

  function closeSession(sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    sessions.delete(sessionId);
    entry.transport?.close?.().catch?.(() => {});
  }

  const server = http.createServer(async (req, res) => {
    if ((req.url === "/health" || req.url === "/healthz") && req.method === "GET") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok", transport: "streamable-http", activeSessions: sessions.size }));
      return;
    }

    if (!req.url?.startsWith("/mcp")) {
      res.statusCode = 404;
      res.end("Not Found. Use /mcp");
      return;
    }

    if (!isAuthorized(req)) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (contentLength > config.httpBodyLimitBytes) {
      res.statusCode = 413;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "payload_too_large" }));
      return;
    }

    let sessionId = req.headers["mcp-session-id"];
    let entry = sessionId ? sessions.get(sessionId) : null;

    if (!entry) {
      sessionId = crypto.randomUUID();
      const mcp = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });
      await mcp.connect(transport);
      const timer = setTimeout(() => closeSession(sessionId), config.httpSessionTtlMs);
      entry = { server: mcp, transport, timer };
      sessions.set(sessionId, entry);
      res.setHeader("mcp-session-id", sessionId);
      logger.info({ sessionId }, "new MCP session");
    }

    try {
      await entry.transport.handleRequest(req, res);
    } catch (err) {
      logger.error({ err }, "transport error");
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  logger.info({ host, port, url: `http://${host}:${port}/mcp` }, "oci-extras-mcp HTTP ready");
  return server;
}
