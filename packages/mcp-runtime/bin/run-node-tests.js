#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_FILE = /\.test\.(?:cjs|mjs|js)$/i;

function collect(input, files) {
  const absolute = path.resolve(input);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    if (TEST_FILE.test(absolute)) files.push(absolute);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    collect(path.join(absolute, entry.name), files);
  }
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) inputs.push("tests");
const files = [];
for (const input of inputs) collect(input, files);
files.sort((left, right) => left.localeCompare(right, "en"));
if (files.length === 0) {
  console.error(`No *.test.js, *.test.mjs or *.test.cjs files found under: ${inputs.join(", ")}`);
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
