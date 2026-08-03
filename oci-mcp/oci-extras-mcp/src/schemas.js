/**
 * Reusable Zod schemas for OCI primitives.
 */
import { z } from "zod";

const OCID_PATTERN =
  /^ocid1\.[a-z][a-z0-9_-]{1,63}\.[a-z0-9-]{2,16}\.(?:[a-z0-9-]{0,64}\.){1,2}[A-Za-z0-9][A-Za-z0-9._~:+/-]{7,}$/;

export const Ocid = z.string().max(512).regex(OCID_PATTERN, "Invalid OCID format");

function ocidFor(resourceTypes, description) {
  const types = Array.isArray(resourceTypes) ? resourceTypes : [resourceTypes];
  return Ocid.refine(
    (value) => types.some((type) => value.startsWith(`ocid1.${type}.`)),
    `Expected ${types.join(" or ")} OCID`
  ).describe(description);
}

export const CompartmentOcid = ocidFor("compartment", "Compartment OCID");
export const ClusterOcid = ocidFor("cluster", "OKE Cluster OCID");
export const NodePoolOcid = ocidFor("nodepool", "OKE Node Pool OCID");
export const VaultOcid = ocidFor("vault", "Vault OCID");
export const KeyOcid = ocidFor("key", "KMS Key OCID");
export const SecretOcid = ocidFor("secret", "Secret OCID");
export const FunctionOcid = ocidFor("fnfunc", "Function OCID");
export const ApplicationOcid = ocidFor("fnapp", "Functions Application OCID");
export const LogOcid = ocidFor("log", "Log OCID");

export const RegionId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9-]+$/i)
  .describe("OCI region identifier (e.g. sa-saopaulo-1)");

/** Common safety inputs accepted by every write/destructive tool. */
export const SafetyInputs = z.object({
  dryRun: z
    .boolean()
    .optional()
    .describe(
      "If true (default when OCI_MCP_DEFAULT_DRY_RUN=true), simulate the operation without executing it."
    ),
  confirm: z
    .string()
    .optional()
    .describe(
      "Must equal the resource name or OCID for destructive operations or for any mutation on a resource not created by this MCP."
    ),
  humanAck: z
    .boolean()
    .optional()
    .describe(
      "Set true after the user explicitly acknowledged the previous requiresHumanAck response. Required for third-party resource mutations."
    ),
});

export const FreeformTags = z
  .record(z.string(), z.string())
  .optional()
  .describe("Freeform key/value tags to apply to the resource");

export const DefinedTags = z
  .record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
  .optional()
  .describe("Defined tags: { Namespace: { key: value } }");

/** Mark resources created by this MCP so the ledger can recognise them. */
export const MCP_OWNER_TAG = { Owner: "oci-extras-mcp" };
