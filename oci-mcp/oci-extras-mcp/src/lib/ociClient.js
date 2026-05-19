/**
 * OCI client factories — lazy, cached singletons keyed by service.
 */
import { resolveAuthProvider } from "../auth/index.js";

const cache = new Map();

async function getOrCreate(key, factory) {
  if (cache.has(key)) return cache.get(key);
  const { provider } = await resolveAuthProvider();
  const client = await factory(provider);
  cache.set(key, client);
  return client;
}

export async function containerEngineClient() {
  return getOrCreate("ce", async (auth) => {
    const ce = await import("oci-containerengine");
    const c = new ce.ContainerEngineClient({ authenticationDetailsProvider: auth });
    return c;
  });
}

export async function workRequestClient() {
  return getOrCreate("wr", async (auth) => {
    const wr = await import("oci-containerengine");
    return new wr.WorkRequestClient({ authenticationDetailsProvider: auth });
  });
}

export async function vaultClient() {
  return getOrCreate("vault", async (auth) => {
    const v = await import("oci-vault");
    return new v.VaultsClient({ authenticationDetailsProvider: auth });
  });
}

export async function kmsVaultClient() {
  return getOrCreate("kmsv", async (auth) => {
    const k = await import("oci-keymanagement");
    return new k.KmsVaultClient({ authenticationDetailsProvider: auth });
  });
}

export async function kmsManagementClient(endpoint) {
  // KMS management requires a per-vault management endpoint
  return getOrCreate(`kmsm:${endpoint}`, async (auth) => {
    const k = await import("oci-keymanagement");
    const c = new k.KmsManagementClient({ authenticationDetailsProvider: auth });
    if (endpoint) c.endpoint = endpoint;
    return c;
  });
}

export async function secretsClient() {
  return getOrCreate("secrets", async (auth) => {
    const s = await import("oci-secrets");
    return new s.SecretsClient({ authenticationDetailsProvider: auth });
  });
}

export async function vaultsControlClient() {
  return getOrCreate("vaultctrl", async (auth) => {
    const v = await import("oci-vault");
    return new v.VaultsClient({ authenticationDetailsProvider: auth });
  });
}

export async function identityClient() {
  return getOrCreate("id", async (auth) => {
    const id = await import("oci-identity");
    return new id.IdentityClient({ authenticationDetailsProvider: auth });
  });
}

export async function functionsManagementClient() {
  return getOrCreate("fnmgmt", async (auth) => {
    const fn = await import("oci-functions");
    return new fn.FunctionsManagementClient({ authenticationDetailsProvider: auth });
  });
}

export async function functionsInvokeClient(invokeEndpoint) {
  return getOrCreate(`fninv:${invokeEndpoint}`, async (auth) => {
    const fn = await import("oci-functions");
    const c = new fn.FunctionsInvokeClient({ authenticationDetailsProvider: auth });
    if (invokeEndpoint) c.endpoint = invokeEndpoint;
    return c;
  });
}

export async function loggingSearchClient() {
  return getOrCreate("logsearch", async (auth) => {
    const ls = await import("oci-loggingsearch");
    return new ls.LogSearchClient({ authenticationDetailsProvider: auth });
  });
}

export async function computeClient() {
  return getOrCreate("compute", async (auth) => {
    const core = await import("oci-core");
    return new core.ComputeClient({ authenticationDetailsProvider: auth });
  });
}

export async function virtualNetworkClient() {
  return getOrCreate("vcn", async (auth) => {
    const core = await import("oci-core");
    return new core.VirtualNetworkClient({ authenticationDetailsProvider: auth });
  });
}
