import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(target);
  }
}

collect(path.join(root, "src"));
files.push(path.join(root, "index.js"));
for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}
console.log(`syntax ok: ${files.length} files`);
