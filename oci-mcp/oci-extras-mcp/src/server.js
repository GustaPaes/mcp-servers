/**
 * MCP server (stdio transport).
 * Aggregates every tool from src/tools/* and exposes them via @modelcontextprotocol/sdk.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { config, validateConfigForAuth } from "./config.js";
import { logger } from "./safety/audit.js";
import { withSafety } from "./safety/wrap.js";

import * as okeTools from "./tools/oke/index.js";
import * as vaultTools from "./tools/vault/index.js";
import * as k8sTools from "./tools/kubernetes/index.js";
import * as fnTools from "./tools/functions/index.js";
import * as streamingTools from "./tools/streaming/index.js";
import * as metaTools from "./tools/meta/index.js";

const ALL_TOOLS = {
  ...okeTools,
  ...vaultTools,
  ...k8sTools,
  ...fnTools,
  ...streamingTools,
  ...metaTools,
};

export function buildServer() {
  const server = new McpServer(
    { name: "oci-extras-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  for (const [name, def] of Object.entries(ALL_TOOLS)) {
    if (!def?.handler || !def?.input) continue;
    server.registerTool(
      name,
      {
        description: def.description ?? name,
        inputSchema: def.input.shape ?? def.input,
      },
      async (args, ctx) => {
        const wrapped = withSafety(name, (a) => def.handler(a, ctx));
        const result = await wrapped(args ?? {});
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return {
          content: [{ type: "text", text }],
          ...(result && typeof result === "object" ? { structuredContent: Array.isArray(result) ? { items: result } : result } : {}),
          isError: result?.ok === false,
        };
      }
    );
  }

  logger.info({ count: Object.keys(ALL_TOOLS).length }, "tools registered");
  return server;
}

export async function startStdio() {
  validateConfigForAuth();
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ transport: "stdio", profile: config.ociConfigProfile }, "oci-extras-mcp ready");
}
