/**
 * server.ts — registers all tools on a low-level MCP Server using the dispatch
 * table pattern (TOOL_DEFS + TOOL_HANDLERS). Mirrors tfs-mcp and career-development-mcp.
 *
 * Why low-level?
 *  - Full control over annotations (readOnlyHint, destructiveHint, idempotentHint)
 *  - Uniform JSON Schema (single source of input contract)
 *  - Matches the dominant pattern of the in-house MCPs
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./logger.js";
import type { ToolDef, ToolHandler, ToolModule } from "./types.js";

import { browserTools } from "./tools/browser.js";
import { pageTools } from "./tools/page.js";
import { interactionTools } from "./tools/interaction.js";
import { extractionTools } from "./tools/extraction.js";
import { visualTools } from "./tools/visual.js";
import { networkTools } from "./tools/network.js";
import { advancedTools } from "./tools/advanced.js";

function withToolMetadata(def: ToolDef): ToolDef {
  // Force additionalProperties:false on input schemas (defense-in-depth).
  const schema = def.inputSchema as { additionalProperties?: unknown };
  if (schema && typeof schema === "object" && schema.additionalProperties == null) {
    (schema as Record<string, unknown>).additionalProperties = false;
  }
  return def;
}

const MODULES: ToolModule[] = [
  browserTools,
  pageTools,
  interactionTools,
  extractionTools,
  visualTools,
  networkTools,
  advancedTools,
];

const TOOL_DEFS: ToolDef[] = MODULES.flatMap((m) => m.defs.map(withToolMetadata));
const TOOL_HANDLERS: Record<string, ToolHandler> = MODULES.reduce<Record<string, ToolHandler>>(
  (acc, m) => Object.assign(acc, m.handlers),
  {},
);

// Sanity check at module load: every def has a handler.
for (const def of TOOL_DEFS) {
  if (!TOOL_HANDLERS[def.name]) {
    throw new Error(`tool ${def.name} declared without a handler`);
  }
}

export function createServer(): Server {
  const server = new Server(
    { name: "playwright-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${name}`);
    }
    const start = Date.now();
    try {
      const result = await handler(args);
      const elapsed = Date.now() - start;
      logger.info({ tool: name, ms: elapsed }, "tool ok");
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text }],
        ...(result && typeof result === "object"
          ? { structuredContent: Array.isArray(result) ? { items: result } : result }
          : {}),
      };
    } catch (err) {
      const elapsed = Date.now() - start;
      const message = (err as Error).message ?? String(err);
      logger.warn({ tool: name, ms: elapsed, err: message }, "tool failed");
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: message, tool: name }, null, 2) },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export const TOOL_NAMES = TOOL_DEFS.map((d) => d.name);
