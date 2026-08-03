import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) {
  throw new Error("Run this validator through npm so npm_execpath is available");
}

const jobs = [
  {
    name: "azure-mcp",
    cwd: "azure-mcp",
    commands: [["test"], ["run", "lint:powershell"]],
  },
  {
    name: "career-development-mcp",
    cwd: "career-development-mcp",
    commands: [["test"], ["run", "smoke:http"]],
  },
  {
    name: "tfs-mcp",
    cwd: "tfs-mcp",
    commands: [["test"], ["run", "test:smoke"], ["run", "smoke:http"]],
  },
  {
    name: "playwright-mcp",
    cwd: "playwright-mcp",
    commands: [["test"], ["run", "build"]],
  },
  {
    name: "oci-extras-mcp",
    cwd: "oci-mcp/oci-extras-mcp",
    commands: [["run", "lint"], ["test"]],
  },
  {
    name: "meta-ads-mcp",
    cwd: "meta-ads-mcp",
    commands: [["run", "lint"], ["test"], ["run", "typecheck"], ["run", "build"]],
  },
  {
    name: "meta-ads-web-panel",
    cwd: "meta-ads-mcp/web-panel",
    commands: [["test"], ["run", "typecheck"], ["run", "build"]],
  },
];

function boundedConcurrency() {
  const configured = Number(process.env.MCP_VALIDATE_CONCURRENCY ?? 4);
  if (!Number.isSafeInteger(configured) || configured < 1 || configured > 6) {
    throw new Error("MCP_VALIDATE_CONCURRENCY must be an integer between 1 and 6");
  }
  return Math.min(configured, jobs.length);
}

function runNpm(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args, "--workspaces=false"], {
      cwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

async function runJob(job) {
  const startedAt = performance.now();
  const cwd = path.join(root, job.cwd);
  for (const command of job.commands) await runNpm(cwd, command);
  return { name: job.name, durationMs: Math.round(performance.now() - startedAt) };
}

const queue = [...jobs];
const results = [];
const failures = [];
async function worker() {
  while (queue.length) {
    const job = queue.shift();
    try {
      results.push(await runJob(job));
    } catch (error) {
      failures.push({ name: job.name, error: error.message });
    }
  }
}

await Promise.all(Array.from({ length: boundedConcurrency() }, () => worker()));
console.log(JSON.stringify({
  ok: failures.length === 0,
  concurrency: boundedConcurrency(),
  passed: results.sort((left, right) => left.name.localeCompare(right.name)),
  failed: failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
