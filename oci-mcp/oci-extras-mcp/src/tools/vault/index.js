/**
 * Vault, KMS Keys & Secrets tools.
 * Resources created here are recorded in the ownership ledger.
 * Secret values are masked unless reveal flag is granted.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  vaultClient,
  kmsVaultClient,
  kmsManagementClient,
  secretsClient,
  vaultsControlClient,
} from "../../lib/ociClient.js";
import { paginateAll } from "../../lib/pagination.js";
import { withRetry } from "../../lib/retries.js";
import { config } from "../../config.js";
import {
  CompartmentOcid,
  VaultOcid,
  KeyOcid,
  SecretOcid,
  SafetyInputs,
  FreeformTags,
  DefinedTags,
  MCP_OWNER_TAG,
} from "../../schemas.js";
import {
  guardMutation,
  guardSecretReveal,
  effectiveDryRun,
  buildDryRunPlan,
} from "../../safety/guards.js";
import * as ownership from "../../safety/ownership.js";

const compartmentField = (z) =>
  CompartmentOcid.default(config.defaultCompartmentOcid ?? undefined);

// ==========================================================================
// VAULT
// ==========================================================================

export const vault_list = {
  description: "List Vaults in a compartment.",
  input: z.object({
    compartmentId: compartmentField(z),
    max: z.number().int().positive().max(500).default(100),
  }),
  async handler({ compartmentId, max }) {
    const v = await kmsVaultClient();
    const items = await paginateAll(
      (params) => v.listVaults({ compartmentId, ...params }),
      {},
      { max }
    );
    return {
      count: items.length,
      vaults: items.map((vlt) => ({
        id: vlt.id,
        name: vlt.displayName,
        vaultType: vlt.vaultType,
        managementEndpoint: vlt.managementEndpoint,
        cryptoEndpoint: vlt.cryptoEndpoint,
        lifecycleState: vlt.lifecycleState,
      })),
    };
  },
};

export const vault_get = {
  description: "Get full details of a Vault.",
  input: z.object({ id: VaultOcid }),
  async handler({ id }) {
    const v = await kmsVaultClient();
    const r = await v.getVault({ vaultId: id });
    return r.vault;
  },
};

export const vault_create = {
  description: "Create a new Vault.",
  input: z.object({
    name: z.string().min(1),
    compartmentId: compartmentField(z),
    vaultType: z.enum(["DEFAULT", "VIRTUAL_PRIVATE"]).default("DEFAULT"),
    freeformTags: FreeformTags,
    definedTags: DefinedTags,
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const guard = guardMutation({
      input,
      action: "create",
      name: input.name,
      resourceType: "vault",
    });
    if (!guard.ok) return guard;

    const payload = {
      compartmentId: input.compartmentId,
      displayName: input.name,
      vaultType: input.vaultType,
      freeformTags: { ...MCP_OWNER_TAG, ...(input.freeformTags ?? {}) },
      definedTags: input.definedTags,
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "create",
        resourceType: "vault",
        target: input.name,
        payload,
      });
    }

    const v = await kmsVaultClient();
    const opcRetryToken = randomUUID();
    const res = await withRetry(() =>
      v.createVault({ createVaultDetails: payload, opcRetryToken })
    );
    ownership.record({
      ocid: res.vault.id,
      type: "vault",
      name: res.vault.displayName,
      compartment: input.compartmentId,
    });
    return { ok: true, vault: res.vault };
  },
};

// ==========================================================================
// KMS KEYS
// ==========================================================================

export const kms_key_list = {
  description: "List KMS keys in a vault. Requires the vault's managementEndpoint.",
  input: z.object({
    compartmentId: compartmentField(z),
    managementEndpoint: z.string().url(),
    max: z.number().int().positive().max(500).default(100),
  }),
  async handler({ compartmentId, managementEndpoint, max }) {
    const c = await kmsManagementClient(managementEndpoint);
    const items = await paginateAll(
      (params) => c.listKeys({ compartmentId, ...params }),
      {},
      { max }
    );
    return { count: items.length, keys: items };
  },
};

export const kms_key_create = {
  description: "Create a KMS master encryption key inside a vault.",
  input: z.object({
    name: z.string().min(1),
    compartmentId: compartmentField(z),
    managementEndpoint: z.string().url(),
    algorithm: z.enum(["AES", "RSA", "ECDSA"]).default("AES"),
    length: z.number().int().default(32),
    protectionMode: z.enum(["SOFTWARE", "HSM"]).default("HSM"),
    freeformTags: FreeformTags,
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const guard = guardMutation({
      input,
      action: "create",
      name: input.name,
      resourceType: "kms_key",
    });
    if (!guard.ok) return guard;

    const payload = {
      compartmentId: input.compartmentId,
      displayName: input.name,
      keyShape: { algorithm: input.algorithm, length: input.length },
      protectionMode: input.protectionMode,
      freeformTags: { ...MCP_OWNER_TAG, ...(input.freeformTags ?? {}) },
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "create",
        resourceType: "kms_key",
        target: input.name,
        payload,
      });
    }

    const c = await kmsManagementClient(input.managementEndpoint);
    const opcRetryToken = randomUUID();
    const res = await withRetry(() =>
      c.createKey({ createKeyDetails: payload, opcRetryToken })
    );
    ownership.record({
      ocid: res.key.id,
      type: "kms_key",
      name: res.key.displayName,
      compartment: input.compartmentId,
    });
    return { ok: true, key: res.key };
  },
};

export const kms_key_rotate = {
  description: "Rotate a KMS key (creates a new key version).",
  input: z.object({
    keyId: KeyOcid,
    managementEndpoint: z.string().url(),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const c = await kmsManagementClient(input.managementEndpoint);
    let name = null;
    try {
      const r = await c.getKey({ keyId: input.keyId });
      name = r.key.displayName;
    } catch {
      /* */
    }
    const guard = guardMutation({
      input,
      action: "update",
      ocid: input.keyId,
      name,
      resourceType: "kms_key",
    });
    if (!guard.ok) return guard;

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "rotate",
        resourceType: "kms_key",
        target: name ?? input.keyId,
        payload: { keyId: input.keyId },
      });
    }
    const res = await c.createKeyVersion({ keyId: input.keyId });
    return { ok: true, keyVersion: res.keyVersion };
  },
};

export const kms_key_disable = {
  description: "Disable a KMS key. Destructive.",
  input: z.object({
    keyId: KeyOcid,
    managementEndpoint: z.string().url(),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const c = await kmsManagementClient(input.managementEndpoint);
    let name = null;
    try {
      const r = await c.getKey({ keyId: input.keyId });
      name = r.key.displayName;
    } catch {
      /* */
    }
    const guard = guardMutation({
      input,
      action: "delete",
      ocid: input.keyId,
      name,
      resourceType: "kms_key",
      destructive: true,
    });
    if (!guard.ok) return guard;

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "disable",
        resourceType: "kms_key",
        target: name ?? input.keyId,
        payload: {},
      });
    }
    const res = await c.disableKey({ keyId: input.keyId });
    return { ok: true, key: res.key };
  },
};

// ==========================================================================
// SECRETS
// ==========================================================================

export const secret_list = {
  description: "List secrets in a compartment (metadata only).",
  input: z.object({
    compartmentId: compartmentField(z),
    vaultId: VaultOcid.optional(),
    name: z.string().optional(),
    max: z.number().int().positive().max(500).default(100),
  }),
  async handler({ compartmentId, vaultId, name, max }) {
    const v = await vaultsControlClient();
    const items = await paginateAll(
      (params) => v.listSecrets({ compartmentId, vaultId, name, ...params }),
      {},
      { max }
    );
    return {
      count: items.length,
      secrets: items.map((s) => ({
        id: s.id,
        name: s.secretName,
        vaultId: s.vaultId,
        keyId: s.keyId,
        lifecycleState: s.lifecycleState,
        timeCreated: s.timeCreated,
      })),
    };
  },
};

export const secret_get = {
  description:
    "Get a secret's metadata + (optionally) value. Value is masked unless reveal:true AND OCI_MCP_ALLOW_SECRET_REVEAL=true.",
  input: z.object({
    secretId: SecretOcid,
    versionNumber: z.number().int().positive().optional(),
    reveal: z.boolean().default(false),
  }),
  async handler(input) {
    const v = await vaultsControlClient();
    const meta = await v.getSecret({ secretId: input.secretId });

    const revealGuard = guardSecretReveal(input);
    if (!revealGuard.ok) return revealGuard;

    let value;
    if (!revealGuard.mask) {
      const sc = await secretsClient();
      const bundle = await sc.getSecretBundle({
        secretId: input.secretId,
        versionNumber: input.versionNumber,
      });
      const content = bundle.secretBundle?.secretBundleContent;
      const raw = content?.content;
      if (raw && content?.contentType === "BASE64") {
        value = Buffer.from(raw, "base64").toString("utf-8");
      } else {
        value = raw;
      }
    } else {
      value = "***REDACTED***";
    }
    return {
      metadata: meta.secret,
      value,
      revealed: !revealGuard.mask,
    };
  },
};

export const secret_create = {
  description: "Create a new secret (KMS-protected).",
  input: z.object({
    name: z.string().min(1),
    compartmentId: compartmentField(z),
    vaultId: VaultOcid,
    keyId: KeyOcid,
    secretContent: z.string().describe("The secret value (will be base64-encoded server-side)."),
    description: z.string().optional(),
    freeformTags: FreeformTags,
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const guard = guardMutation({
      input,
      action: "create",
      name: input.name,
      resourceType: "secret",
    });
    if (!guard.ok) return guard;

    const payload = {
      compartmentId: input.compartmentId,
      vaultId: input.vaultId,
      keyId: input.keyId,
      secretName: input.name,
      description: input.description,
      secretContent: {
        contentType: "BASE64",
        content: Buffer.from(input.secretContent, "utf-8").toString("base64"),
      },
      freeformTags: { ...MCP_OWNER_TAG, ...(input.freeformTags ?? {}) },
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "create",
        resourceType: "secret",
        target: input.name,
        payload: { ...payload, secretContent: "***REDACTED***" },
      });
    }

    const v = await vaultsControlClient();
    const opcRetryToken = randomUUID();
    const res = await withRetry(() =>
      v.createSecret({ createSecretDetails: payload, opcRetryToken })
    );
    ownership.record({
      ocid: res.secret.id,
      type: "secret",
      name: res.secret.secretName,
      compartment: input.compartmentId,
    });
    return { ok: true, secret: { id: res.secret.id, name: res.secret.secretName } };
  },
};

export const secret_update_version = {
  description: "Update a secret with a new version (rotation).",
  input: z.object({
    secretId: SecretOcid,
    secretContent: z.string(),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const v = await vaultsControlClient();
    let name = null;
    try {
      const m = await v.getSecret({ secretId: input.secretId });
      name = m.secret?.secretName;
    } catch {
      /* */
    }

    const guard = guardMutation({
      input,
      action: "update",
      ocid: input.secretId,
      name,
      resourceType: "secret",
    });
    if (!guard.ok) return guard;

    const payload = {
      secretContent: {
        contentType: "BASE64",
        content: Buffer.from(input.secretContent, "utf-8").toString("base64"),
      },
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "update",
        resourceType: "secret",
        target: name ?? input.secretId,
        payload: { secretContent: "***REDACTED***" },
      });
    }

    const res = await v.updateSecret({ secretId: input.secretId, updateSecretDetails: payload });
    return { ok: true, secret: { id: res.secret.id, currentVersionNumber: res.secret.currentVersionNumber } };
  },
};

export const secret_schedule_deletion = {
  description: "Schedule deletion of a secret. Destructive.",
  input: z.object({
    secretId: SecretOcid,
    timeOfDeletion: z
      .string()
      .datetime()
      .describe("ISO 8601 — must be at least 1 day in the future."),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const v = await vaultsControlClient();
    let name = null;
    try {
      const m = await v.getSecret({ secretId: input.secretId });
      name = m.secret?.secretName;
    } catch {
      /* */
    }
    const guard = guardMutation({
      input,
      action: "delete",
      ocid: input.secretId,
      name,
      resourceType: "secret",
      destructive: true,
    });
    if (!guard.ok) return guard;

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "schedule_deletion",
        resourceType: "secret",
        target: name ?? input.secretId,
        payload: { timeOfDeletion: input.timeOfDeletion },
      });
    }

    await v.scheduleSecretDeletion({
      secretId: input.secretId,
      scheduleSecretDeletionDetails: { timeOfDeletion: new Date(input.timeOfDeletion) },
    });
    ownership.remove(input.secretId);
    return { ok: true, scheduledFor: input.timeOfDeletion };
  },
};

export const secret_register_existing = {
  description:
    "Adopt a pre-existing secret into the ownership ledger. Use only after explicit user authorisation.",
  input: z.object({ ocid: SecretOcid, confirm: z.string() }),
  async handler({ ocid, confirm }) {
    if (confirm !== ocid) return { ok: false, error: "confirm must equal the OCID exactly." };
    const v = await vaultsControlClient();
    let name = "(unknown)";
    let compartment = null;
    try {
      const m = await v.getSecret({ secretId: ocid });
      name = m.secret?.secretName;
      compartment = m.secret?.compartmentId;
    } catch {
      /* */
    }
    ownership.record({
      ocid,
      type: "secret",
      name,
      compartment,
      extra: { adoptedAt: new Date().toISOString() },
    });
    return { ok: true };
  },
};
