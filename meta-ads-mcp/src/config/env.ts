import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ACCOUNTS_CONFIG_PATH: z.string().default('./config/accounts.json'),
  AUDIT_LOG_PATH: z.string().default('./data/audit.log'),
  STORAGE_PATH: z.string().default('./data/storage.json'),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v25.0'),
  META_GRAPH_API_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  READ_ONLY: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  DRY_RUN: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  GLOBAL_MAX_DAILY_BUDGET: z
    .string()
    .default('1000')
    .transform((v) => Number(v))
    .pipe(z.number().positive()),
  GLOBAL_MAX_BUDGET_CHANGE_PCT: z
    .string()
    .default('25')
    .transform((v) => Number(v))
    .pipe(z.number().positive().max(100)),
  HTTP_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  HTTP_MAX_RETRIES: z
    .string()
    .default('4')
    .transform((v) => Number(v))
    .pipe(z.number().int().min(0).max(10)),
  HTTP_RETRY_BASE_DELAY_MS: z
    .string()
    .default('500')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),

  // ---- Transport ----------------------------------------------------------
  // stdio (default) for Claude Desktop / Cursor / opencode style integrations.
  // http  for Streamable HTTP (multi-client, remote, web panel).
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_HOST: z.string().default('127.0.0.1'),
  MCP_HTTP_PORT: z
    .string()
    .default('8787')
    .transform((v) => Number(v))
    .pipe(z.number().int().min(1).max(65535)),
  // Comma-separated list of bearer tokens accepted on Authorization header.
  // Empty string (default) disables auth — ONLY safe for localhost.
  MCP_HTTP_BEARER_TOKENS: z.string().default(''),
  // Stateful sessions (recommended) or stateless ("undefined" sessionIdGenerator).
  MCP_HTTP_STATEFUL: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  MCP_HTTP_BODY_LIMIT_BYTES: z
    .string()
    .default('1048576')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  MCP_HTTP_SESSION_TTL_MS: z
    .string()
    .default('1800000')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  MCP_HTTP_MAX_SESSIONS: z
    .string()
    .default('50')
    .transform((v) => Number(v))
    .pipe(z.number().int().positive().max(1000)),

  // ---- Storage backend ----------------------------------------------------
  // file (default) | memory | prisma (Postgres via Prisma client)
  STORAGE_BACKEND: z.enum(['file', 'memory', 'prisma']).default('file'),
  // Used only when STORAGE_BACKEND=prisma. Read by Prisma at client init.
  DATABASE_URL: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper — never call from production code. */
export function _resetEnvForTests(): void {
  cached = undefined;
}
