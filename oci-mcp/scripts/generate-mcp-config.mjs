#!/usr/bin/env node
/**
 * Generates MCP client config snippets for the chosen client.
 *
 * Usage:
 *   node scripts/generate-mcp-config.mjs --client claude|cursor|cline|vscode|opencode [--out path]
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const client = args.client;
if (!client) {
  console.error("Usage: --client claude|cursor|cline|vscode|opencode [--out path]");
  process.exit(1);
}

const map = {
  claude: "config/claude_desktop_config.json",
  cursor: "config/cursor_mcp.json",
  cline: "config/cline_mcp_settings.json",
  vscode: "config/vscode_mcp.json",
  opencode: "config/opencode.json",
};

const src = map[client];
if (!src) {
  console.error(`Unknown client '${client}'. Valid: ${Object.keys(map).join(", ")}`);
  process.exit(1);
}

const srcPath = path.join(ROOT, src);
const content = fs.readFileSync(srcPath, "utf8");

if (args.out) {
  fs.writeFileSync(args.out, content);
  console.log(`✓ wrote ${args.out}`);
} else {
  process.stdout.write(content);
}
