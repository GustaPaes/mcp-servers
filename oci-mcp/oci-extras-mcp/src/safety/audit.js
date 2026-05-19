/**
 * Audit logger — every tool invocation is appended to a JSONL file with
 * structured fields. Secret values are redacted.
 */
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { config } from "../config.js";

// Ensure logs directory exists
function ensureDir(file) {
  try {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}
ensureDir(config.auditLogFile);

// JSONL audit stream (append-only)
const auditStream = fs.createWriteStream(config.auditLogFile, { flags: "a" });

const REDACT_KEYS = new Set([
  "secretContent",
  "secret",
  "value",
  "password",
  "token",
  "privateKey",
  "private_key",
  "api_key",
  "client_secret",
  "Authorization",
]);

export function redact(obj) {
  if (!config.redactSecrets) return obj;
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = REDACT_KEYS.has(k) ? "***REDACTED***" : redact(v);
    }
    return out;
  }
  if (typeof obj === "string" && obj.length > 200 && /^-----BEGIN/.test(obj)) {
    return "***REDACTED-PEM***";
  }
  return obj;
}

// Pretty stderr logger (does not pollute stdout used by stdio MCP transport)
export const logger = pino(
  {
    level: config.logLevel,
    base: { service: "oci-extras-mcp" },
    redact: {
      paths: [
        "*.privateKey",
        "*.private_key",
        "*.secretContent",
        "*.password",
        "*.token",
        "headers.Authorization",
      ],
      censor: "***REDACTED***",
    },
  },
  pino.destination(2) // stderr
);

export function audit(event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
    input: redact(event.input),
    output: redact(event.output),
  });
  auditStream.write(line + "\n");
  logger.debug(event, "audit");
}
