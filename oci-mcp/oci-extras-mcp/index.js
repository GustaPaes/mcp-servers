/**
 * oci-extras-mcp entry point.
 * - Default: stdio transport (for MCP clients like Cursor, Claude Desktop, Cline).
 * - With --http or --http:streamable: HTTP Streamable transport for remote/SSE.
 */
import "dotenv/config";

const cliArgs = new Set(process.argv.slice(2));

if (cliArgs.has("--http") || cliArgs.has("--http:streamable")) {
  const { startHttpStreamable } = await import("./src/http.js");
  const port = Number(process.env.MCP_HTTP_PORT ?? 3020);
  const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
  await startHttpStreamable({ port, host });
} else {
  const { startStdio } = await import("./src/server.js");
  await startStdio();
}
