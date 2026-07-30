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

const READ_ONLY_TOOLS = new Set([
  "k8s_list_namespaces",
  "k8s_list_pods",
  "k8s_describe_pod",
  "streaming_tail_oci_log",
  "streaming_tail_pod_logs",
  "fn_list_applications",
  "fn_list_functions",
  "fn_get_function",
  "vault_list",
  "vault_get",
  "kms_key_list",
  "secret_list",
  "secret_get",
  "oke_list_clusters",
  "oke_get_cluster",
  "oke_list_node_pools",
  "oke_get_node_pool",
  "oke_list_addons",
  "oke_get_work_request",
  "oke_recommend_setup",
  "oke_get_kubeconfig",
  "oke_list_owned",
  "oci_whoami",
  "oci_list_regions",
  "oci_list_compartments",
  "oci_list_availability_domains",
  "oci_ledger_dump",
]);

const DESTRUCTIVE_TOOLS = new Set([
  "k8s_delete_object",
  "fn_delete_function",
  "kms_key_disable",
  "secret_schedule_deletion",
  "oke_delete_cluster",
  "oke_delete_node_pool",
]);

const MUTATING_TOOLS = new Set(
  Object.keys(ALL_TOOLS).filter((name) => !READ_ONLY_TOOLS.has(name))
);

for (const name of Object.keys(ALL_TOOLS)) {
  if (!READ_ONLY_TOOLS.has(name) && !MUTATING_TOOLS.has(name)) {
    throw new Error(`Missing explicit tool safety classification: ${name}`);
  }
}

function toolAnnotations(name) {
  const readOnly = READ_ONLY_TOOLS.has(name);
  const destructive = DESTRUCTIVE_TOOLS.has(name);
  return {
    title: name.replaceAll("_", " "),
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: readOnly,
    openWorldHint: true,
  };
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
    if (!def?.handler || !def?.input) continue;
    server.registerTool(
      name,
      {
        description: def.description ?? name,
        inputSchema: def.input.shape ?? def.input,
        annotations: toolAnnotations(name),
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
