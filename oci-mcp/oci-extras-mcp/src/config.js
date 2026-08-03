/**
 * Centralised configuration loaded from environment variables.
 * Single source of truth — every other module imports from here.
 */
import path from "node:path";
import os from "node:os";

const envOr = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

const booleanEnv = (name, fallback) => {
  const value = String(envOr(name, fallback)).trim();
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new Error(`${name} must be a boolean (true/false)`);
};

const integerEnv = (name, fallback, min, max) => {
  const value = Number(envOr(name, fallback));
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const enumEnv = (name, fallback, allowed) => {
  const value = String(envOr(name, fallback)).trim();
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
};

const urlEnv = (name, fallback) => {
  const value = String(envOr(name, fallback)).trim();
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
};

if (!booleanEnv("LOG_REDACT_SECRETS", "true")) {
  throw new Error("LOG_REDACT_SECRETS cannot be disabled; audit redaction is mandatory");
}

export const config = Object.freeze({
  // ----- Auth -----
  authMethod: enumEnv("OCI_AUTH_METHOD", "api_key", [
    "api_key",
    "session_token",
    "instance_principal",
    "resource_principal",
  ]),
  ociConfigFile: envOr("OCI_CONFIG_FILE", path.join(os.homedir(), ".oci", "config")),
  ociConfigProfile: envOr("OCI_CONFIG_PROFILE", "DEFAULT"),
  region: envOr("OCI_REGION", null),
  tenancyOcid: envOr("OCI_TENANCY_OCID", null),
  defaultCompartmentOcid: envOr("OCI_DEFAULT_COMPARTMENT_OCID", null),

  // ----- Safety -----
  allowDestructive: booleanEnv("OCI_MCP_ALLOW_DESTRUCTIVE", "false"),
  allowSecretReveal: booleanEnv("OCI_MCP_ALLOW_SECRET_REVEAL", "false"),
  defaultDryRun: booleanEnv("OCI_MCP_DEFAULT_DRY_RUN", "true"),
  allowThirdPartyMutation: booleanEnv("OCI_MCP_ALLOW_THIRD_PARTY_MUTATION", "false"),
  ownershipLedgerPath: envOr("OCI_MCP_OWNERSHIP_LEDGER", "./.ownership-ledger.json"),
  requestTimeoutMs: integerEnv("OCI_MCP_REQUEST_TIMEOUT_MS", 30_000, 1_000, 120_000),

  // ----- Logging -----
  logLevel: enumEnv("LOG_LEVEL", "info", ["trace", "debug", "info", "warn", "error", "fatal"]),
  auditLogFile: envOr("AUDIT_LOG_FILE", "./logs/audit.jsonl"),
  redactSecrets: true,

  // ----- Transport -----
  httpPort: integerEnv("MCP_HTTP_PORT", 3020, 1, 65_535),
  httpHost: envOr("MCP_HTTP_HOST", "127.0.0.1"),
  httpBaseUrl: urlEnv("MCP_HTTP_BASE_URL", "http://127.0.0.1:3020"),
  httpToken: envOr("MCP_HTTP_TOKEN", ""),
  httpBodyLimitBytes: integerEnv("MCP_HTTP_BODY_LIMIT_BYTES", 1_048_576, 1_024, 16 * 1024 * 1024),
  httpSessionTtlMs: integerEnv("MCP_HTTP_SESSION_TTL_MS", 30 * 60_000, 10_000, 24 * 60 * 60_000),
  httpMaxSessions: integerEnv("MCP_HTTP_MAX_SESSIONS", 50, 1, 1_000),

  // ----- Kubernetes -----
  kubeconfigPath: envOr("KUBECONFIG", path.join(os.homedir(), ".kube", "config")),
});

/** Throws if a required field is missing for the active auth method. */
export function validateConfigForAuth() {
  if (config.authMethod === "api_key" || config.authMethod === "session_token") {
    if (!config.ociConfigProfile) {
      throw new Error("OCI_CONFIG_PROFILE must be set for api_key / session_token auth");
    }
  }
  // instance_principal & resource_principal are validated lazily by the SDK.
}
