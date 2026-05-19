/**
 * index.js -- Entry point minimalista.
 * Delega para src/http.js (HTTP Streamable) ou src/server.js (stdio).
 */
const cliArgs = new Set(process.argv.slice(2));

if (cliArgs.has("--http") || cliArgs.has("--http:streamable")) {
  const { startHttpStreamable } = await import("./src/http.js");
  await startHttpStreamable(Number(process.env.MCP_HTTP_PORT ?? 3010));
} else {
  const { startStdio } = await import("./src/server.js");
  await startStdio();
}
