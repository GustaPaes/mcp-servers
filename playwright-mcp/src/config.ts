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
  if (!Number.isFinite(n) || String(n) !== v.trim()) throw new Error(`${key} must be an integer`);
  return n;
}
function envPositiveInt(key: string, fallback: number, allowZero = false): number {
  const n = envInt(key, fallback);
  if (!Number.isSafeInteger(n) || !(n > 0 || (allowZero && n === 0))) {
    throw new Error(`${key} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return n;
}
function envBoundedInt(key: string, fallback: number, minimum: number, maximum: number): number {
  const n = envInt(key, fallback);
  if (!Number.isSafeInteger(n) || n < minimum || n > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return n;
}
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new Error(`${key} must be true or false`);
}
function parseViewport(s: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(s.trim());
  if (!m) throw new Error("PWMCP_DEFAULT_VIEWPORT must use <width>x<height>");
  return { width: Number.parseInt(m[1]!, 10), height: Number.parseInt(m[2]!, 10) };
}

const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "output");
const DEFAULT_UPLOAD_DIR = path.join(REPO_ROOT, "local-private", "uploads");

export type BrowserName = "chromium" | "firefox" | "webkit";
const validBrowsers: ReadonlySet<BrowserName> = new Set(["chromium", "firefox", "webkit"]);

const rawBrowser = envStr("PWMCP_DEFAULT_BROWSER", "chromium").toLowerCase() as BrowserName;
if (!validBrowsers.has(rawBrowser)) throw new Error(`unsupported PWMCP_DEFAULT_BROWSER: ${rawBrowser}`);
const defaultBrowser: BrowserName = rawBrowser;

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
  maxArtifactFileBytes: envBoundedInt("PWMCP_MAX_ARTIFACT_FILE_BYTES", 50_000_000, 1_024, 1_000_000_000),
  maxOutputBytes: envBoundedInt("PWMCP_MAX_OUTPUT_BYTES", 500_000_000, 1_024, 5_000_000_000),
  maxNetworkBodyBytes: envPositiveInt("PWMCP_MAX_NETWORK_BODY_BYTES", 65_536),
  maxResponseBytes: envBoundedInt("PWMCP_MAX_RESPONSE_BYTES", 1_000_000, 8_192, 10_000_000),
  maxResponsePreviewChars: envBoundedInt("PWMCP_MAX_RESPONSE_PREVIEW_CHARS", 32_000, 1_024, 250_000),
  maxInputStringChars: envBoundedInt("PWMCP_MAX_INPUT_STRING_CHARS", 50_000, 256, 1_000_000),
  maxInputItems: envBoundedInt("PWMCP_MAX_INPUT_ITEMS", 100, 1, 10_000),
  maxResultItems: envBoundedInt("PWMCP_MAX_RESULT_ITEMS", 500, 1, 10_000),
  maxSnapshotDepth: envBoundedInt("PWMCP_MAX_SNAPSHOT_DEPTH", 30, 1, 100),
  maxRouteMatches: envBoundedInt("PWMCP_MAX_ROUTE_MATCHES", 1_000, 1, 100_000),
  maxUploadFiles: envBoundedInt("PWMCP_MAX_UPLOAD_FILES", 10, 1, 100),
  maxUploadFileBytes: envBoundedInt("PWMCP_MAX_UPLOAD_FILE_BYTES", 25_000_000, 1, 1_000_000_000),

  strict: envBool("PWMCP_STRICT", true),
  allowEval: envBool("PWMCP_ALLOW_EVAL", false),
  allowSecretReveal: envBool("PWMCP_ALLOW_SECRET_REVEAL", false),
  allowBrowserInstall: envBool("PWMCP_ALLOW_BROWSER_INSTALL", false),
  allowedFileRoots: envStr("PWMCP_ALLOWED_FILE_ROOTS", DEFAULT_UPLOAD_DIR)
    .split(path.delimiter)
    .filter(Boolean)
    .map((root) => path.resolve(root)),
  allowedHosts: envStr("PWMCP_ALLOWED_HOSTS", "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  blockPrivateNetworks: envBool("PWMCP_BLOCK_PRIVATE_NETWORKS", true),
  dnsCacheTtlMs: envBoundedInt("PWMCP_DNS_CACHE_TTL_MS", 60_000, 1_000, 3_600_000),
  allowedProfileRoots: envStr(
    "PWMCP_ALLOWED_PROFILE_ROOTS",
    path.join(REPO_ROOT, "local-private", "profiles"),
  )
    .split(path.delimiter)
    .filter(Boolean)
    .map((root) => path.resolve(root)),
  evalTimeoutMs: envPositiveInt("PWMCP_EVAL_TIMEOUT_MS", 5000),
  actionTimeoutMs: envBoundedInt("PWMCP_ACTION_TIMEOUT_MS", 10_000, 100, 120_000),
  navigationTimeoutMs: envBoundedInt("PWMCP_NAVIGATION_TIMEOUT_MS", 30_000, 100, 180_000),
  maxToolTimeoutMs: envBoundedInt("PWMCP_MAX_TOOL_TIMEOUT_MS", 120_000, 1_000, 600_000),
  maxActionDelayMs: envBoundedInt("PWMCP_MAX_ACTION_DELAY_MS", 10_000, 0, 60_000),

});

export type Config = typeof config;
