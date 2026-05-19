/**
 * Smoke test (stdio): spawns the server, lists tools via MCP, expects > 0.
 * Does NOT contact OCI — purely a wiring / registration test.
 */
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MIN_EXPECTED_TOOLS = 25;

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    env: {
      ...process.env,
      // Avoid touching real OCI during smoke
      OCI_AUTH_METHOD: process.env.OCI_AUTH_METHOD ?? "api_key",
      LOG_LEVEL: "warn",
    },
  });

  const client = new Client({ name: "smoke-stdio", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`✓ tools registered: ${tools.length}`);
  for (const t of tools.slice(0, 5)) console.log(`  - ${t.name}`);
  if (tools.length > 5) console.log(`  … and ${tools.length - 5} more`);

  if (tools.length < MIN_EXPECTED_TOOLS) {
    console.error(`✗ expected at least ${MIN_EXPECTED_TOOLS}, got ${tools.length}`);
    await client.close();
    process.exit(1);
  }

  // Verify essential categories present
  const names = new Set(tools.map((t) => t.name));
  const required = [
    "oke_list_clusters",
    "oke_create_cluster",
    "oke_delete_cluster",
    "oke_get_kubeconfig",
    "vault_list",
    "secret_create",
    "secret_get",
    "k8s_apply_manifest",
    "k8s_create_secret_from_vault",
    "fn_invoke",
    "streaming_tail_pod_logs",
    "oci_whoami",
  ];
  const missing = required.filter((n) => !names.has(n));
  if (missing.length) {
    console.error("✗ missing required tools:", missing);
    await client.close();
    process.exit(1);
  }
  console.log("✓ all required tools present");

  await client.close();
  console.log("✓ smoke OK");
}

main().catch((e) => {
  console.error("✗ smoke failed:", e);
  process.exit(1);
});
