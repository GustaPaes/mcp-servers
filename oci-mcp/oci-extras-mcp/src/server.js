/**
 * MCP server (stdio transport).
 * Aggregates every tool from src/tools/* and exposes them via @modelcontextprotocol/sdk.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { config, validateConfigForAuth } from "./config.js";
import { logger } from "./safety/audit.js";
import { withSafety } from "./safety/wrap.js";
import { TOOL_POLICIES, annotationsFor, validateToolManifest } from "./tool-manifest.js";

import * as okeTools from "./tools/oke/index.js";
import * as vaultTools from "./tools/vault/index.js";
import * as k8sTools from "./tools/kubernetes/index.js";
import * as fnTools from "./tools/functions/index.js";
import * as streamingTools from "./tools/streaming/index.js";
import * as metaTools from "./tools/meta/index.js";

export const ALL_TOOLS = {
  ...okeTools,
  ...vaultTools,
  ...k8sTools,
  ...fnTools,
  ...streamingTools,
  ...metaTools,
};

validateToolManifest(ALL_TOOLS);

export const ToolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  errors: z.array(z.string()).optional(),
  meta: z.record(z.unknown()).optional(),
}).strict();

function envelope(result, name) {
  const policy = TOOL_POLICIES[name];
  if (result?.ok === false) {
    const message = result.error ?? result.reason ?? result.message ?? "Operation failed";
    return {
      ok: false,
      errors: [String(message)],
      data: result.requiresHumanAck ? result : undefined,
      meta: { risk: policy.risk, code: result.code, statusCode: result.statusCode },
    };
  }
  return { ok: true, data: result, meta: { risk: policy.risk } };
}

export function buildServer() {
  const server = new McpServer(
    { name: "oci-extras-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Inspect OCI context before mutations. Prefer dry-run where supported. " +
        "Never reveal credentials, kubeconfig, secret values, or private keys. " +
        "Require explicit confirmation for destructive or production-impacting operations.",
    }
  );

  for (const [name, def] of Object.entries(ALL_TOOLS)) {
    const inputSchema = typeof def.input.strict === "function" ? def.input.strict() : def.input;
    server.registerTool(
      name,
      {
        description: def.description ?? name,
        inputSchema: inputSchema.shape ?? inputSchema,
        outputSchema: ToolOutputSchema.shape,
        annotations: annotationsFor(name),
      },
      async (args, ctx) => {
        const wrapped = withSafety(name, (a) => def.handler(inputSchema.parse(a), ctx));
        const result = envelope(await wrapped(args ?? {}), name);
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
