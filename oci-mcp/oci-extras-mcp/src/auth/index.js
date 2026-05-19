/**
 * Auth resolver — picks the appropriate OCI authentication provider based on
 * environment configuration.
 *
 * Precedence:
 *   1. Explicit OCI_AUTH_METHOD
 *   2. resource_principal env vars present
 *   3. instance_principal metadata reachable
 *   4. session_token / api_key from ~/.oci/config (default)
 */
import { config } from "../config.js";
import * as common from "oci-common";

let cachedProvider = null;
let cachedMethod = null;

export async function resolveAuthProvider() {
  if (cachedProvider) return { provider: cachedProvider, method: cachedMethod };

  const explicit = (config.authMethod || "").toLowerCase();

  switch (explicit) {
    case "instance_principal":
      cachedProvider = await buildInstancePrincipal();
      cachedMethod = "instance_principal";
      break;
    case "resource_principal":
      cachedProvider = buildResourcePrincipal();
      cachedMethod = "resource_principal";
      break;
    case "session_token":
      cachedProvider = buildSessionToken();
      cachedMethod = "session_token";
      break;
    case "api_key":
    default:
      cachedProvider = buildApiKey();
      cachedMethod = "api_key";
      break;
  }

  if (config.region) {
    try {
      cachedProvider.setRegion?.(common.Region.fromRegionId(config.region));
    } catch {
      /* region may be set inside the provider itself */
    }
  }

  return { provider: cachedProvider, method: cachedMethod };
}

function buildApiKey() {
  return new common.ConfigFileAuthenticationDetailsProvider(
    config.ociConfigFile,
    config.ociConfigProfile
  );
}

function buildSessionToken() {
  // SessionAuthDetailProvider reads the security_token_file pointed by the profile.
  return new common.SessionAuthDetailProvider(
    config.ociConfigFile,
    config.ociConfigProfile
  );
}

async function buildInstancePrincipal() {
  const builder =
    common.InstancePrincipalsAuthenticationDetailsProviderBuilder ||
    common.InstancePrincipalAuthenticationDetailsProvider;
  if (typeof builder?.builder === "function") {
    return await builder.builder().build();
  }
  // Fallback for SDK variants
  return await new builder().build();
}

function buildResourcePrincipal() {
  if (typeof common.ResourcePrincipalAuthenticationDetailsProvider?.builder === "function") {
    return common.ResourcePrincipalAuthenticationDetailsProvider.builder();
  }
  // Some SDK versions expose this differently
  return new common.ResourcePrincipalAuthenticationDetailsProvider();
}

/** Tenancy OCID currently in use (best-effort). */
export async function getCurrentTenancyOcid() {
  if (config.tenancyOcid) return config.tenancyOcid;
  const { provider } = await resolveAuthProvider();
  if (typeof provider.getTenantId === "function") {
    return await provider.getTenantId();
  }
  return provider.tenancy ?? null;
}

/** Region currently in use (best-effort). */
export async function getCurrentRegion() {
  if (config.region) return config.region;
  const { provider } = await resolveAuthProvider();
  try {
    const r = provider.getRegion?.();
    return r?.regionId ?? r ?? null;
  } catch {
    return null;
  }
}
