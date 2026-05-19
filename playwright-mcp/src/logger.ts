/**
 * logger.ts — Structured logger that ALWAYS writes to stderr.
 *
 * CRITICAL: stdio transport uses stdout for the MCP protocol. Any console.log()
 * silently corrupts the protocol. This logger guarantees stderr-only output.
 *
 * Optional file sink: if PWMCP_LOG_FILE is set, logs are also written there.
 */
import pino, { type Logger, type DestinationStream } from "pino";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const VALID_LEVELS = new Set(["error", "warn", "info", "debug", "trace", "silent"]);
const level = VALID_LEVELS.has(config.logLevel) ? config.logLevel : "info";

let destination: DestinationStream;
if (config.logFile) {
  try {
    fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
    const fileStream = pino.destination({ dest: config.logFile, sync: false, mkdir: true });
    destination = pino.multistream([
      { stream: process.stderr },
      { stream: fileStream },
    ]) as unknown as DestinationStream;
  } catch {
    destination = process.stderr;
  }
} else {
  destination = process.stderr;
}

export const logger: Logger = pino(
  {
    level,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  destination,
);
