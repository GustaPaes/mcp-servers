import http from "http";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, TOTAL_TOOLS } from "./server.js";
import { MCP_HTTP_TOKEN, SERVER_VERSION } from "./config.js";
import { logger } from "./logger.js";

const sessions = new Map();

export async function startHttpStreamable(port) {
  const httpServer = http.createServer(async (req, res) => {
    try {
      if (req.url === "/health" && req.method === "GET") {
        const body = JSON.stringify({
          status: "ok",
          transport: "streamable-http",
          endpoint: `http://localhost:${port}/mcp`,
          tools: TOTAL_TOOLS,
          version: SERVER_VERSION,
          activeSessions: sessions.size,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        return;
      }

      if (MCP_HTTP_TOKEN) {
        const authHeader = (req.headers.authorization ?? "").trim();
        if (authHeader !== `Bearer ${MCP_HTTP_TOKEN}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }

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

      const sessionId = req.headers["mcp-session-id"];
      let transport;

      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId);
      } else if (!sessionId && req.method === "POST" && parsedBody?.method === "initialize") {
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
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad_request", message: "Missing or unknown mcp-session-id. Send initialize first." }));
        return;
      }

      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, "HTTP request error");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
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

  logger.info({ port, endpoint: `http://localhost:${port}/mcp`, health: `http://localhost:${port}/health` }, "MCP HTTP server started");
}
