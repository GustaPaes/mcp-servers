/**
 * oci-extras-mcp entry point.
 * - Default: stdio transport (for MCP clients like Cursor, Claude Desktop, Cline).
 * - With --http or --http:streamable: HTTP Streamable transport for remote/SSE.
 */
import "dotenv/config";

const cliArgs = new Set(process.argv.slice(2));

if (cliArgs.has("--http") || cliArgs.has("--http:streamable")) {
  const { config } = await import("./src/config.js");
  const { startHttpStreamable } = await import("./src/http.js");
  await startHttpStreamable({ port: config.httpPort, host: config.httpHost });
} else {
  const { startStdio } = await import("./src/server.js");
  await startStdio();
}
