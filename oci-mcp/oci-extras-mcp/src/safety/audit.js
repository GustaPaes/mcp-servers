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

const REDACT_KEY_PATTERNS = [
  /secret/i,
  /password/i,
  /token/i,
  /private[_-]?key/i,
  /api[_-]?key/i,
  /client[_-]?secret/i,
  /^authorization$/i,
  /^value$/i,
  /^yaml$/i,
  /kubeconfig/i,
  /^data$/i,
  /cert(ificate)?/i,
];

function shouldRedactKey(key) {
  return REDACT_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redact(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = shouldRedactKey(k) ? "***REDACTED***" : redact(v);
    }
    return out;
  }
  if (typeof obj === "string" && /^-----BEGIN/.test(obj)) {
    return "***REDACTED-PEM***";
  }
  if (typeof obj === "string" && /\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(obj)) {
    return obj.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***REDACTED***");
  }
  if (typeof obj === "string" && /\b(access_token|client_secret|refresh_token|api_key)=/i.test(obj)) {
    return obj.replace(
      /\b(access_token|client_secret|refresh_token|api_key)=([^&\s"']+)/gi,
      "$1=***REDACTED***"
    );
  }
  if (typeof obj === "string" && /\b[A-Za-z0-9+/]{80,}={0,2}\b/.test(obj)) {
    return "***REDACTED-LONG-TOKEN***";
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

auditStream.on("error", (error) => {
  logger.error({ error: { message: error.message, code: error.code } }, "audit stream error");
});

export function normaliseError(error) {
  return redact({
    message: error instanceof Error ? error.message : String(error),
    code: error?.code,
    statusCode: error?.statusCode ?? error?.status,
    opcRequestId: error?.opcRequestId,
  });
}

export function audit(event) {
  const safeEvent = redact(event);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...safeEvent,
  });
  auditStream.write(line + "\n");
  logger.debug(safeEvent, "audit");
}

export function closeAuditStream() {
  return new Promise((resolve) => auditStream.end(resolve));
}
