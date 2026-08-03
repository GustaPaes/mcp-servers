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
  const supplied = String(req.headers.authorization ?? "");
  const expected = `Bearer ${config.httpToken}`;
  const suppliedDigest = crypto.createHash("sha256").update(supplied).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

async function readJsonBody(req, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      const error = new Error("payload_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (total === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("invalid_json");
    error.statusCode = 400;
    throw error;
  }
}

export async function startHttpStreamable({ port, host }) {
  validateConfigForAuth();
  if (!isLoopback(host) && !config.httpToken) {
    throw new Error("MCP_HTTP_TOKEN is required when binding oci-extras-mcp HTTP outside loopback");
  }
  const sessions = new Map(); // sessionId -> { server, transport, timer, activeRequests }

  async function closeSession(sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry || entry.closing) return;
    entry.closing = true;
    clearTimeout(entry.timer);
    sessions.delete(sessionId);
    await Promise.allSettled([
      entry.transport?.close?.(),
      entry.server?.close?.(),
    ]);
  }

  function scheduleExpiry(sessionId, entry) {
    clearTimeout(entry.timer);
    if (entry.closing || entry.activeRequests > 0) return;
    entry.timer = setTimeout(() => void closeSession(sessionId), config.httpSessionTtlMs);
    entry.timer.unref?.();
  }

  function beginRequest(entry) {
    clearTimeout(entry.timer);
    entry.activeRequests += 1;
  }

  function endRequest(sessionId, entry) {
    entry.activeRequests = Math.max(0, entry.activeRequests - 1);
    scheduleExpiry(sessionId, entry);
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

    try {
      const requestBody = req.method === "POST"
        ? await readJsonBody(req, config.httpBodyLimitBytes)
        : undefined;
      let sessionId = req.headers["mcp-session-id"];
      if (Array.isArray(sessionId)) sessionId = sessionId[0];
      let entry = sessionId ? sessions.get(sessionId) : null;

      if (!entry) {
        const method = requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
          ? requestBody.method
          : undefined;
        if (req.method !== "POST" || method !== "initialize") {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "missing_or_invalid_session; initialize first" }));
          return;
        }
        if (sessions.size >= config.httpMaxSessions) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "session_limit_reached" }));
          return;
        }
        sessionId = crypto.randomUUID();
        const mcp = buildServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });
        await mcp.connect(transport);
        entry = { server: mcp, transport, timer: undefined, activeRequests: 0, closing: false };
        sessions.set(sessionId, entry);
        transport.onclose = () => void closeSession(sessionId);
        res.setHeader("mcp-session-id", sessionId);
        logger.info({ sessionId }, "new MCP session");
      }

      beginRequest(entry);
      try {
        await entry.transport.handleRequest(req, res, requestBody);
      } finally {
        endRequest(sessionId, entry);
      }
    } catch (err) {
      logger.error(
        { error: { message: err instanceof Error ? err.message : String(err) } },
        "transport error"
      );
      if (!res.headersSent) {
        res.statusCode = err.statusCode ?? 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          error: err.statusCode ? err.message : "internal_server_error",
        }));
      }
    }
  });

  server.on("close", () => {
    void Promise.allSettled([...sessions.keys()].map((sessionId) => closeSession(sessionId)));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  logger.info({ host, port, url: `http://${host}:${port}/mcp` }, "oci-extras-mcp HTTP ready");
  return server;
}
