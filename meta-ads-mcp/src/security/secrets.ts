/**
 * Helpers to read secrets safely. The principle is simple:
 *   - Tokens live in environment variables (or an external secret manager).
 *   - They are NEVER serialized to disk, logs, MCP responses or stack traces.
 */

export function readSecretFromEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`Secret env var "${name}" is not set`);
  }
  return v;
}

/** Returns a token-shaped string that is safe to display in logs / errors. */
export function maskToken(token: string): string {
  if (!token) return '[empty]';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-2)} (len=${token.length})`;
}
