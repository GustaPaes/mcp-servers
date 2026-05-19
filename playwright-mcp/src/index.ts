#!/usr/bin/env node
/**
 * index.ts — Playwright MCP entrypoint.
 *
 * Default transport: stdio (the universal MCP transport for desktop clients).
 * Logs go to stderr (see src/logger.ts). Stdout is reserved for the protocol.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, TOOL_NAMES } from "./server.js";
import { sessionManager } from "./session-manager.js";
import { ensureOutputDir } from "./output-dir.js";
import { logger } from "./logger.js";
import { config } from "./config.js";

async function main(): Promise<void> {
  ensureOutputDir();
  sessionManager.start();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    {
      tools: TOOL_NAMES.length,
      output: config.outputDir,
      max_sessions: config.maxSessions,
      ttl_min: config.sessionTtlMinutes,
    },
    "playwright-mcp ready (stdio)",
  );

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    try {
      await sessionManager.stop();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "error while closing sessions");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("beforeExit", () => void shutdown("beforeExit"));
}

main().catch((err) => {
  // logger goes to stderr; this also goes to stderr by default
  // eslint-disable-next-line no-console
  console.error("playwright-mcp fatal:", err);
  process.exit(1);
});
