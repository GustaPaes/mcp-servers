/**
 * Centralised configuration loaded from environment variables.
 * Single source of truth — every other module imports from here.
 */
import path from "node:path";
import os from "node:os";

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? "").trim());
const envOr = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

export const config = Object.freeze({
  // ----- Auth -----
  authMethod: envOr("OCI_AUTH_METHOD", "api_key"),
  ociConfigFile: envOr("OCI_CONFIG_FILE", path.join(os.homedir(), ".oci", "config")),
  ociConfigProfile: envOr("OCI_CONFIG_PROFILE", "DEFAULT"),
  region: envOr("OCI_REGION", null),
  tenancyOcid: envOr("OCI_TENANCY_OCID", null),
  defaultCompartmentOcid: envOr("OCI_DEFAULT_COMPARTMENT_OCID", null),

  // ----- Safety -----
  allowDestructive: truthy(envOr("OCI_MCP_ALLOW_DESTRUCTIVE", "false")),
  allowSecretReveal: truthy(envOr("OCI_MCP_ALLOW_SECRET_REVEAL", "false")),
  defaultDryRun: truthy(envOr("OCI_MCP_DEFAULT_DRY_RUN", "true")),
  allowThirdPartyMutation: truthy(envOr("OCI_MCP_ALLOW_THIRD_PARTY_MUTATION", "false")),
  ownershipLedgerPath: envOr("OCI_MCP_OWNERSHIP_LEDGER", "./.ownership-ledger.json"),

  // ----- Logging -----
  logLevel: envOr("LOG_LEVEL", "info"),
  auditLogFile: envOr("AUDIT_LOG_FILE", "./logs/audit.jsonl"),
  redactSecrets: truthy(envOr("LOG_REDACT_SECRETS", "true")),

  // ----- Transport -----
  httpPort: Number(envOr("MCP_HTTP_PORT", 3020)),
  httpHost: envOr("MCP_HTTP_HOST", "127.0.0.1"),
  httpBaseUrl: envOr("MCP_HTTP_BASE_URL", "http://127.0.0.1:3020"),
  httpToken: envOr("MCP_HTTP_TOKEN", ""),
  httpBodyLimitBytes: Number(envOr("MCP_HTTP_BODY_LIMIT_BYTES", 1_048_576)),
  httpSessionTtlMs: Number(envOr("MCP_HTTP_SESSION_TTL_MS", 30 * 60_000)),
  httpMaxSessions: Number(envOr("MCP_HTTP_MAX_SESSIONS", 50)),

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
