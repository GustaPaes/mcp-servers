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
import { annotationsForRisk, assertToolManifest } from "@gustapaes/mcp-runtime";
import { TOOL_POLICY } from "./tool-policy.js";
import {
  applyContractLimits,
  boundedToolResult,
  OBJECT_OUTPUT_SCHEMA,
  validateToolArguments,
} from "./tool-contract.js";

import { browserTools } from "./tools/browser.js";
import { pageTools } from "./tools/page.js";
import { interactionTools } from "./tools/interaction.js";
import { extractionTools } from "./tools/extraction.js";
import { visualTools } from "./tools/visual.js";
import { networkTools } from "./tools/network.js";
import { advancedTools } from "./tools/advanced.js";

function withToolMetadata(def: ToolDef): ToolDef {
  const policy = TOOL_POLICY[def.name];
  if (!policy) throw new Error(`tool ${def.name} has no risk policy`);
  const inputSchema = applyContractLimits(structuredClone(def.inputSchema));
  return {
    ...def,
    inputSchema,
    outputSchema: def.outputSchema ?? OBJECT_OUTPUT_SCHEMA,
    annotations: {
    title: def.annotations?.title ?? def.name.replaceAll("_", " "),
    ...annotationsForRisk(policy.risk, policy),
    ...def.annotations,
    ...annotationsForRisk(policy.risk, policy),
    },
  };
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

const TOOL_DEFS: ToolDef[] = MODULES.flatMap((m) => m.defs);
const TOOL_HANDLERS: Record<string, ToolHandler> = MODULES.reduce<Record<string, ToolHandler>>(
  (acc, m) => Object.assign(acc, m.handlers),
  {},
);

assertToolManifest({ definitions: TOOL_DEFS, handlers: TOOL_HANDLERS, policies: TOOL_POLICY, label: "Playwright MCP" });
export const PUBLISHED_TOOL_DEFS: ToolDef[] = TOOL_DEFS.map(withToolMetadata);

export function createServer(): Server {
  const server = new Server(
    { name: "playwright-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Browser automation can act on signed-in sessions. Confirm consequential actions, " +
        "keep strict mode enabled, do not expose cookies or browser storage, and upload files " +
        "only from configured allowed roots.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: PUBLISHED_TOOL_DEFS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${name}`);
    }
    const definition = PUBLISHED_TOOL_DEFS.find((tool) => tool.name === name)!;
    const start = Date.now();
    try {
      validateToolArguments(definition.inputSchema, args);
      const result = await handler(args);
      const bounded = boundedToolResult(result);
      const elapsed = Date.now() - start;
      logger.info({ tool: name, ms: elapsed }, "tool ok");
      const text = JSON.stringify(bounded, null, 2);
      return {
        content: [{ type: "text", text }],
        structuredContent: bounded,
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

export const TOOL_NAMES = PUBLISHED_TOOL_DEFS.map((d) => d.name);
