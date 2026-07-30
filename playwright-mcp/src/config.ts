/**
 * config.ts — single source of truth for environment-driven configuration.
 *
 * Rule: NO other module reads process.env directly. Import `config` from here.
 * Loads .env from CWD on first import; missing values fall back to sensible defaults.
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v == null || v === "" ? fallback : v;
}
function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function envPositiveInt(key: string, fallback: number, allowZero = false): number {
  const n = envInt(key, fallback);
  return Number.isSafeInteger(n) && (n > 0 || (allowZero && n === 0)) ? n : fallback;
}
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}
function parseViewport(s: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(s.trim());
  if (!m) return { width: 1366, height: 768 };
  return { width: Number.parseInt(m[1]!, 10), height: Number.parseInt(m[2]!, 10) };
}

const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "output");

export type BrowserName = "chromium" | "firefox" | "webkit";
const validBrowsers: ReadonlySet<BrowserName> = new Set(["chromium", "firefox", "webkit"]);

const rawBrowser = envStr("PWMCP_DEFAULT_BROWSER", "chromium").toLowerCase() as BrowserName;
const defaultBrowser: BrowserName = validBrowsers.has(rawBrowser) ? rawBrowser : "chromium";

export const config = Object.freeze({
  repoRoot: REPO_ROOT,

  logLevel: envStr("LOG_LEVEL", "info"),
  logFile: envStr("PWMCP_LOG_FILE", ""),

  defaultHeadless: envBool("PWMCP_DEFAULT_HEADLESS", false),
  defaultBrowser,
  defaultChannel: envStr("PWMCP_DEFAULT_CHANNEL", ""),
  defaultViewport: parseViewport(envStr("PWMCP_DEFAULT_VIEWPORT", "1366x768")),
  defaultLocale: envStr("PWMCP_DEFAULT_LOCALE", "pt-BR"),
  defaultTimezone: envStr("PWMCP_DEFAULT_TIMEZONE", "America/Sao_Paulo"),

  maxSessions: envPositiveInt("PWMCP_MAX_SESSIONS", 5),
  sessionTtlMinutes: envPositiveInt("PWMCP_SESSION_TTL_MINUTES", 30, true),
  sessionSweepIntervalSeconds: envPositiveInt("PWMCP_SESSION_SWEEP_INTERVAL_SECONDS", 60),

  outputDir: path.resolve(envStr("PWMCP_OUTPUT_DIR", DEFAULT_OUTPUT_DIR)),
  maxArtifactBytes: envPositiveInt("PWMCP_MAX_ARTIFACT_BYTES", 2_000_000),
  maxNetworkBodyBytes: envPositiveInt("PWMCP_MAX_NETWORK_BODY_BYTES", 65_536),

  strict: envBool("PWMCP_STRICT", true),
  allowSecretReveal: envBool("PWMCP_ALLOW_SECRET_REVEAL", false),
  allowBrowserInstall: envBool("PWMCP_ALLOW_BROWSER_INSTALL", false),
  allowedFileRoots: envStr("PWMCP_ALLOWED_FILE_ROOTS", REPO_ROOT)
    .split(path.delimiter)
    .filter(Boolean)
    .map((root) => path.resolve(root)),
  allowedProfileRoots: envStr(
    "PWMCP_ALLOWED_PROFILE_ROOTS",
    path.join(REPO_ROOT, "local-private", "profiles"),
  )
    .split(path.delimiter)
    .filter(Boolean)
    .map((root) => path.resolve(root)),
  evalTimeoutMs: envPositiveInt("PWMCP_EVAL_TIMEOUT_MS", 5000),
  actionTimeoutMs: envPositiveInt("PWMCP_ACTION_TIMEOUT_MS", 10_000),
  navigationTimeoutMs: envPositiveInt("PWMCP_NAVIGATION_TIMEOUT_MS", 30_000),

  httpPort: envPositiveInt("PWMCP_HTTP_PORT", 0, true),
  httpHost: envStr("PWMCP_HTTP_HOST", "127.0.0.1"),
});

export type Config = typeof config;
