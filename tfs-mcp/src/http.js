/**
 * http.js — Modo HTTP Streamable MCP.
 * Inclui auth opcional via Bearer token e health endpoint rico.
 */
import http from "http";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./server.js";
import { MCP_HTTP_TOKEN } from "./config.js";
import { checkTfsConnectivity } from "./tfs-client.js";
import { logger } from "./logger.js";

const TOTAL_TOOLS = 21;

// Session store: sessionId → { transport }
const sessions = new Map();

export async function startHttpStreamable(port) {
  const httpServer = http.createServer(async (req, res) => {
    try {
      // ── Health endpoint (unauthenticated) ───────────────────────────────
      if (req.url === "/health" && req.method === "GET") {
        const tfsHealth = await checkTfsConnectivity();
        const body = JSON.stringify({
          status: "ok",
          transport: "streamable-http",
          endpoint: `http://localhost:${port}/mcp`,
          tools: TOTAL_TOOLS,
          tfs: tfsHealth,
          version: "2.0.0",
          activeSessions: sessions.size,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        return;
      }

      // ── Optional Bearer auth ────────────────────────────────────────────
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
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
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
        transport = sessions.get(sessionId);
      } else if (!sessionId && req.method === "POST" && parsedBody?.method === "initialize") {
        // New session — initialize
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport);
            logger.debug({ sessionId: sid }, "MCP session initialized");
          },
          onsessionclosed: (sid) => {
            sessions.delete(sid);
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
    httpServer.listen(port, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  logger.info(
    { port, endpoint: `http://localhost:${port}/mcp`, health: `http://localhost:${port}/health` },
    "MCP HTTP server started"
  );
}
