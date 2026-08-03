/**
 * output-dir.ts — guarantees the output directory and well-known subfolders exist.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { resolveInside } from "@gustapaes/mcp-runtime";

const SUBDIRS = ["screenshots", "videos", "traces", "har", "pdf", "downloads", "storage"] as const;
export type OutputSubdir = (typeof SUBDIRS)[number];

let initialized = false;

export function ensureOutputDir(): string {
  if (!initialized) {
    fs.mkdirSync(config.outputDir, { recursive: true });
    for (const sub of SUBDIRS) fs.mkdirSync(path.join(config.outputDir, sub), { recursive: true });
    initialized = true;
  }
  return config.outputDir;
}

export function outputPath(sub: OutputSubdir, ...rest: string[]): string {
  ensureOutputDir();
  const base = path.resolve(config.outputDir, sub);
  const p = resolveInside(base, ...rest);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function directoryBytes(root: string): number {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
      if (total > config.maxOutputBytes) return total;
    }
  }
  return total;
}

export function assertOutputQuotaAvailable(): void {
  const root = ensureOutputDir();
  const bytes = directoryBytes(root);
  if (bytes >= config.maxOutputBytes) {
    throw new Error(`output quota reached (${bytes} bytes); remove old local artifacts or raise PWMCP_MAX_OUTPUT_BYTES`);
  }
}

export function enforceArtifactFileLimit(filePath: string): number {
  const size = fs.statSync(filePath).size;
  if (size > config.maxArtifactFileBytes) {
    fs.rmSync(filePath, { force: true });
    throw new Error(`artifact exceeded PWMCP_MAX_ARTIFACT_FILE_BYTES (${size} bytes) and was removed`);
  }
  const total = directoryBytes(ensureOutputDir());
  if (total > config.maxOutputBytes) {
    fs.rmSync(filePath, { force: true });
    throw new Error(`output exceeded PWMCP_MAX_OUTPUT_BYTES (${total} bytes); newest artifact was removed`);
  }
  return size;
}
