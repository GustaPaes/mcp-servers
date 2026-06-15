/**
 * audit.js — Append-only JSONL audit for TFS mutations.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { TFS_AUDIT_LOG_PATH } from "./config.js";
import { logger } from "./logger.js";

const SECRET_PATTERNS = [
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b[A-Za-z0-9_=-]{48,}\b/g,
];

const SENSITIVE_KEYS = new Set([
  "pat",
  "token",
  "authorization",
  "password",
  "secret",
  "description",
  "acceptance_criteria",
  "comment",
  "value",
]);

export function createCorrelationId() {
  return randomUUID();
}

function redactString(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]");
  if (text.length > 300) return `${text.slice(0, 300)}...[truncated:${text.length}]`;
  return text;
}

export function redactAuditValue(value, key = "") {
  if (value == null) return value;
  const normalizedKey = String(key).toLowerCase();
  if (SENSITIVE_KEYS.has(normalizedKey)) {
    if (typeof value === "string") {
      return {
        redacted: true,
        length: value.length,
        preview: redactString(value).slice(0, 80),
      };
    }
    return { redacted: true, type: typeof value };
  }
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactAuditValue(childValue, childKey),
      ])
    );
  }
  return value;
}

export function writeAuditEvent(event) {
  const entry = redactAuditValue({
    timestamp: new Date().toISOString(),
    ...event,
  });

  try {
    fs.mkdirSync(path.dirname(TFS_AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(TFS_AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to write TFS audit event");
  }
}
