/**
 * logger.js — Logger exclusivo para stderr.
 */
import pino from "pino";

const VALID_LEVELS = new Set(["error", "warn", "info", "debug", "trace", "silent"]);
const rawLevel = process.env.LOG_LEVEL ?? "info";
const level = VALID_LEVELS.has(rawLevel) ? rawLevel : "info";

export const logger = pino(
  {
    level,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["authorization", "cookie", "token", "secret", "password", "clientSecret", "accessToken", "sessionId"],
      censor: "[REDACTED]",
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  process.stderr
);
