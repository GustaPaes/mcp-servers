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
import { validateConfigForAuth } from "./config.js";

export async function startHttpStreamable({ port, host }) {
  validateConfigForAuth();
  const sessions = new Map(); // sessionId -> { server, transport }

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.statusCode = 404;
      res.end("Not Found. Use /mcp");
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
      entry = { server: mcp, transport };
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
