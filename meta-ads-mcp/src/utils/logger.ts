import pino, { type Logger } from 'pino';
import { getEnv } from '../config/env.js';

/**
 * Patterns that look like Meta access tokens or other secrets. We redact
 * defensively even though we never knowingly log them.
 */
const SECRET_PATTERNS: RegExp[] = [
  /EAA[A-Za-z0-9_-]{20,}/g, // Facebook Graph API user/page tokens usually start with EAA
  /\baccess_token=([^&\s"]+)/gi,
  /\b(client_secret|api_key|refresh_token)=([^&\s"]+)/gi,
  /"access_token"\s*:\s*"([^"]+)"/g,
  /\bBearer\s+[A-Za-z0-9._-]+/g,
];

export function redactSecrets(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === 'string') {
    let out = input;
    for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
    return out;
  }
  if (Array.isArray(input)) return input.map(redactSecrets);
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/token|secret|password|api[_-]?key/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return input;
}

let cachedLogger: Logger | undefined;

export function getLogger(): Logger {
  if (cachedLogger) return cachedLogger;
  const env = getEnv();
  // MCP servers communicate over stdio. ALL diagnostic output MUST go to stderr.
  // Pino is configured to write to stderr (fd=2) so it never breaks the MCP protocol.
  cachedLogger = pino(
    {
      level: env.LOG_LEVEL,
      base: { service: 'meta-ads-mcp' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        log: (obj) => redactSecrets(obj) as Record<string, unknown>,
      },
      redact: {
        paths: [
          'access_token',
          'token',
          'authorization',
          '*.access_token',
          '*.token',
          'headers.authorization',
        ],
        censor: '[REDACTED]',
      },
    },
    pino.destination({ fd: 2, sync: false }),
  );
  return cachedLogger;
}
