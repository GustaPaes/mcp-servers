import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const port = Number(process.env.MCP_HTTP_PORT ?? 3020);
const baseUrl = `http://127.0.0.1:${port}`;

async function main() {
  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) throw new Error(`Health endpoint falhou com status ${health.status}`);

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: process.env.MCP_HTTP_TOKEN ? { headers: { Authorization: `Bearer ${process.env.MCP_HTTP_TOKEN}` } } : {},
  });
  const client = new Client({ name: "career-development-mcp-http-smoke", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const result = await client.callTool({ name: "guide_pdi_list", arguments: {} });
  console.log(JSON.stringify({ health: await health.json(), hasStructuredContent: Boolean(result.structuredContent) }, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
