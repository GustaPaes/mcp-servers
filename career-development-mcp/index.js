/**
 * index.js -- Entry point minimalista.
 * Delega para src/http.js (HTTP Streamable) ou src/server.js (stdio).
 */
const cliArgs = new Set(process.argv.slice(2));

if (cliArgs.has("--http") || cliArgs.has("--http:streamable")) {
  const [{ startHttpStreamable }, { MCP_HTTP_HOST, MCP_HTTP_PORT }] = await Promise.all([
    import("./src/http.js"),
    import("./src/config.js"),
  ]);
  await startHttpStreamable(MCP_HTTP_PORT, MCP_HTTP_HOST);
} else {
  const { startStdio } = await import("./src/server.js");
  await startStdio();
}
