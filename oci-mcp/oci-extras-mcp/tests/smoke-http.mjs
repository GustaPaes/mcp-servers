/**
 * Smoke test (HTTP Streamable transport).
 * Boots the server in a child process, opens a session, lists tools, exits.
 */
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 31_000 + Math.floor(Math.random() * 1_000);

async function waitForReady(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.status < 500) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become ready");
}

async function main() {
  const child = spawn(process.execPath, ["index.js", "--http"], {
    env: {
      ...process.env,
      MCP_HTTP_PORT: String(PORT),
      MCP_HTTP_HOST: "127.0.0.1",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    await waitForReady(`http://127.0.0.1:${PORT}/healthz`);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${PORT}/mcp`)
    );
    const client = new Client({ name: "smoke-http", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    console.log(`✓ HTTP transport OK — ${tools.length} tools`);
    await client.close();
  } finally {
    child.kill();
  }
}

main().catch((e) => {
  console.error("✗ http smoke failed:", e);
  process.exit(1);
});
