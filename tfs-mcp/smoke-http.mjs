/**
 * smoke-http.mjs — Smoke test para o modo HTTP Streamable.
 *
 * Uso: node smoke-http.mjs
 * Sai com código 0 em sucesso, 1 em falha.
 *
 * O que testa:
 *  1. Sobe o servidor MCP em modo HTTP na porta configurada
 *  2. Aguarda GET /health retornar 200 (max 5s, intervals de 200ms)
 *  3. Conecta via StreamableHTTPClientTransport
 *  4. Chama listTools() e verifica que > 0 tools foram retornadas
 *  5. Verifica que pelo menos uma premium tool tem outputSchema
 *  6. Derruba o servidor e sai com código 0
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.MCP_HTTP_PORT ?? 3010);
const BASE_URL = `http://localhost:${PORT}`;
const HEALTH_URL = `${BASE_URL}/health`;
const MCP_URL = `${BASE_URL}/mcp`;

const PREMIUM_TOOLS = new Set([
  "tfs_prepare_pr_review",
  "tfs_release_readiness",
  "tfs_team_focus_report",
  "tfs_work_item_handoff",
  "tfs_delivery_risk_report",
]);

const EXPECTED_MIN_TOOLS = 20;
const MAX_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 200;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ─── Start server ──────────────────────────────────────────────────────────

console.log(`[smoke] Starting MCP HTTP server on port ${PORT}...`);
const serverProc = spawn(process.execPath, ["index.js", "--http"], {
  cwd: SCRIPT_DIR,
  env: { ...process.env, MCP_HTTP_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

serverProc.stdout.on("data", (d) => process.stderr.write(`[server stdout] ${d}`));
serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
serverProc.on("error", (e) => fail(`Failed to spawn server: ${e.message}`));

let exitCalled = false;
function fail(msg) {
  if (exitCalled) return;
  exitCalled = true;
  console.error(`[smoke] FAIL: ${msg}`);
  serverProc.kill();
  process.exit(1);
}

function pass(msg) {
  if (exitCalled) return;
  exitCalled = true;
  console.log(`[smoke] PASS: ${msg}`);
  serverProc.kill();
  process.exit(0);
}

// ─── Wait for /health ──────────────────────────────────────────────────────

async function pollHealth(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

// ─── Main ──────────────────────────────────────────────────────────────────

(async () => {
  const deadline = Date.now() + MAX_WAIT_MS;
  const ready = await pollHealth(deadline);
  if (!ready) {
    fail(`Server did not respond to GET /health within ${MAX_WAIT_MS}ms`);
    return;
  }
  console.log("[smoke] Health check passed");

  // Verify health response body
  try {
    const healthRes = await fetch(HEALTH_URL);
    const health = await healthRes.json();
    if (health.status !== "ok") fail(`Health status is '${health.status}', expected 'ok'`);
    if (!health.tools || health.tools < EXPECTED_MIN_TOOLS) {
      fail(`Health reports ${health.tools} tools, expected >= ${EXPECTED_MIN_TOOLS}`);
    }
    console.log(`[smoke] Health: tools=${health.tools}, transport=${health.transport}`);
  } catch (e) {
    fail(`Failed to parse health response: ${e.message}`);
    return;
  }

  // Connect MCP client
  let client;
  try {
    client = new Client({ name: "smoke-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
    await client.connect(transport);
    console.log("[smoke] MCP client connected");
  } catch (e) {
    fail(`Failed to connect MCP client: ${e.message}`);
    return;
  }

  // List tools
  let tools;
  try {
    const result = await client.listTools();
    tools = result.tools ?? [];
    console.log(`[smoke] listTools() returned ${tools.length} tools`);
  } catch (e) {
    fail(`listTools() threw: ${e.message}`);
    return;
  }

  if (tools.length < EXPECTED_MIN_TOOLS) {
    fail(`Expected >= ${EXPECTED_MIN_TOOLS} tools, got ${tools.length}`);
    return;
  }

  // Check premium tools have outputSchema
  const premiumTools = tools.filter((t) => PREMIUM_TOOLS.has(t.name));
  const withSchema = premiumTools.filter((t) => t.outputSchema != null);
  console.log(
    `[smoke] Premium tools: ${premiumTools.length} found, ${withSchema.length} with outputSchema`
  );

  if (withSchema.length === 0) {
    fail("No premium tool has outputSchema");
    return;
  }

  // Verify new tool tfs_work_item_create exists
  const createTool = tools.find((t) => t.name === "tfs_work_item_create");
  if (!createTool) {
    fail("tfs_work_item_create tool is missing");
    return;
  }
  console.log("[smoke] tfs_work_item_create found:", createTool.annotations?.readOnlyHint === false ? "mutating ✓" : "✓");

  await client.close().catch(() => {});
  pass(`All checks passed (${tools.length} tools, ${withSchema.length} premium with outputSchema)`);
})().catch((e) => fail(String(e)));
