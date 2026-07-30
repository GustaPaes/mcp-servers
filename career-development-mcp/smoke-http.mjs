import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";

const port = Number(process.env.MCP_HTTP_PORT ?? (32_000 + Math.floor(Math.random() * 1_000)));
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("HTTP server did not become ready");
}

async function main() {
  const child = spawn(process.execPath, ["index.js", "--http"], {
    env: { ...process.env, MCP_HTTP_PORT: String(port), MCP_HTTP_HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    const health = await waitForReady();

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: process.env.MCP_HTTP_TOKEN ? { headers: { Authorization: `Bearer ${process.env.MCP_HTTP_TOKEN}` } } : {},
    });
    const client = new Client({ name: "career-development-mcp-http-smoke", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const result = await client.callTool({ name: "guide_pdi_list", arguments: {} });
    console.log(JSON.stringify({ health: await health.json(), hasStructuredContent: Boolean(result.structuredContent) }, null, 2));
    await client.close();
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
