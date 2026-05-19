/**
 * logger.js — Logger exclusivo para stderr.
 *
 * CRÍTICO: Em modo stdio, stdout é o canal do protocolo MCP.
 * Qualquer console.log() corrompe silenciosamente o protocolo.
 * Este logger garante que TUDO vai para stderr, independente do modo.
 *
 * Usa pino — padrão da comunidade Node.js 2026 (16M downloads/semana).
 * pino.destination(process.stderr) = escrita direta no fd 2, sem intermediários.
 */
import pino from "pino";

const VALID_LEVELS = new Set(["error", "warn", "info", "debug", "trace", "silent"]);
const rawLevel = process.env.LOG_LEVEL ?? "info";
const level = VALID_LEVELS.has(rawLevel) ? rawLevel : "info";

export const logger = pino(
  {
    level,
    base: null,                              // remove pid/hostname — output mais limpo
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }), // "info" em vez de número 30
    },
  },
  process.stderr  // ← NUNCA process.stdout
);
