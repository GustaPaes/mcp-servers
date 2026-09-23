import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { inspectPublishableText, isPrivatePublishablePath } from "./repository-policy.mjs";

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

function loadPrivateTerms() {
  const fromEnvironment = String(process.env.MCP_REPOSITORY_FORBIDDEN_TERMS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const localPolicy = path.join(root, "local-private", "repository-policy.json");
  if (!fs.existsSync(localPolicy)) return fromEnvironment;
  const parsed = JSON.parse(fs.readFileSync(localPolicy, "utf8"));
  if (!parsed || !Array.isArray(parsed.forbiddenTerms)) {
    throw new Error("local-private/repository-policy.json must define forbiddenTerms as an array");
  }
  return [...fromEnvironment, ...parsed.forbiddenTerms];
}

let forbiddenTerms = [];
try {
  forbiddenTerms = loadPrivateTerms();
} catch (error) {
  errors.push(`invalid private repository policy: ${error.message}`);
}

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", ...options });
}

function publishableFiles() {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(root, file)));
}

function meetsNodeBaseline(range) {
  const minimums = [...String(range ?? "").matchAll(/>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/g)]
    .map((match) => match.slice(1, 4).map((value) => Number(value ?? 0)));
  return minimums.some(([major, minor, patch]) => major > 20
    || (major === 20 && (minor > 19 || (minor === 19 && patch >= 0))));
}

if (!fs.existsSync(path.join(root, "AGENTS.md"))) {
  errors.push("missing workspace-wide AGENTS.md");
}

for (const server of expectedServers) {
  const directory = path.join(root, server);
  if (!fs.existsSync(directory)) errors.push(`missing server directory: ${server}`);
  if (!fs.existsSync(path.join(directory, "AGENTS.md"))) warnings.push(`missing AGENTS.md: ${server}`);
  try {
    git(["check-ignore", "--no-index", "--quiet", `${server}/local-private/probe.txt`]);
  } catch {
    errors.push(`local-private is not ignored for server: ${server}`);
  }
}

const publishable = publishableFiles();
for (const file of publishable) {
  const normalized = file.replaceAll("\\", "/");
  if (isPrivatePublishablePath(normalized)) {
    errors.push(`private or generated path is publishable: ${normalized}`);
  }
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) continue;
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch (error) {
    errors.push(`cannot inspect publishable path ${normalized}: ${error.message}`);
    continue;
  }
  if (!stat.isFile()) continue;
  if (stat.size > 2_000_000) {
    warnings.push(`large publishable file skipped by content policy: ${normalized}`);
    continue;
  }
  const text = fs.readFileSync(absolute, "utf8");
  errors.push(...inspectPublishableText(normalized, text, { forbiddenTerms }));
  if (normalized.endsWith("package.json")) {
    try {
      const packageMetadata = JSON.parse(text);
      if (!meetsNodeBaseline(packageMetadata.engines?.node)) {
        errors.push(`package does not require Node >=20.19.0: ${normalized}`);
      }
    } catch (error) {
      errors.push(`invalid package.json ${normalized}: ${error.message}`);
    }
  }
}

const summary = {
  policyVersion: 3,
  ok: errors.length === 0,
  servers: expectedServers.length,
  publishableFiles: publishable.length,
  errors: [...new Set(errors)].sort(),
  warnings: [...new Set(warnings)].sort(),
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;
