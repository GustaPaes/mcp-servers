/**
 * output-dir.ts — guarantees the output directory and well-known subfolders exist.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

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
  const p = path.join(config.outputDir, sub, ...rest);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
