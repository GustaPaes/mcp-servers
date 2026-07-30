import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const expectedServers = [
  "azure-mcp",
  "career-development-mcp",
  "meta-ads-mcp",
  "oci-mcp",
  "playwright-mcp",
  "tfs-mcp",
];
const errors = [];
const warnings = [];

function publishableFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
}

for (const server of expectedServers) {
  const directory = path.join(root, server);
  if (!fs.existsSync(directory)) errors.push(`missing server directory: ${server}`);
  if (!fs.existsSync(path.join(directory, "AGENTS.md"))) warnings.push(`missing AGENTS.md: ${server}`);
}

const publishable = publishableFiles();
for (const file of publishable) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.includes("/local-private/") || normalized.endsWith("/.env")) {
    errors.push(`private path is publishable: ${normalized}`);
  }
  const absolute = path.join(root, file);
  if (!fs.statSync(absolute).isFile() || fs.statSync(absolute).size > 2_000_000) continue;
  const text = fs.readFileSync(absolute, "utf8");
  const isDoctor = normalized === "scripts/portfolio-doctor.mjs";
  if (/[A-Z]:\\Users\\/i.test(text)) errors.push(`personal absolute path found: ${normalized}`);
  if (!isDoctor && /\b(?:ndd|nddcargo|team\s*guide|teamguide)\b/i.test(text)) {
    errors.push(`organization-specific marker found: ${normalized}`);
  }
  if (!isDoctor && /\bgustavo\.liz\b/i.test(text)) {
    errors.push(`personal corporate identifier found: ${normalized}`);
  }
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  if (emails.some((email) => !/@(?:example\.com|acme\.example)$/i.test(email))) {
    errors.push(`non-example email found: ${normalized}`);
  }
  const workItemReferences = [
    ...text.matchAll(/\b(?:US|PBI|work item)\s*#?(\d{5,})\b/gi),
  ];
  if (workItemReferences.some((reference) => reference[1] !== "12345")) {
    errors.push(`real-looking work item reference found: ${normalized}`);
  }
  if (/["']requestedBy["']\s*:\s*["']user:(?!operator|example)/i.test(text)) {
    errors.push(`non-neutral requestedBy example found: ${normalized}`);
  }
  if (/(?:^|[\s"'`])(?:ocid1\.[a-z]+\.[a-z0-9-]+\.[a-z0-9-]*\.[a-z0-9]{20,}|EAA[A-Za-z0-9]{20,})/m.test(text)) {
    errors.push(`credential-like identifier found: ${normalized}`);
  }
}

const summary = {
  ok: errors.length === 0,
  servers: expectedServers.length,
  publishableFiles: publishable.length,
  errors,
  warnings,
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;
