/**
 * Reusable Zod schemas for OCI primitives.
 */
import { z } from "zod";

export const Ocid = z
  .string()
  .regex(/^ocid1\.[a-z0-9]+\.[a-z0-9-]+\..*$/i, "Invalid OCID format");

export const CompartmentOcid = Ocid.describe("Compartment OCID (ocid1.compartment...)");
export const ClusterOcid = Ocid.describe("OKE Cluster OCID");
export const NodePoolOcid = Ocid.describe("OKE Node Pool OCID");
export const VaultOcid = Ocid.describe("Vault OCID");
export const KeyOcid = Ocid.describe("KMS Key OCID");
export const SecretOcid = Ocid.describe("Secret OCID");
export const FunctionOcid = Ocid.describe("Function OCID");
export const ApplicationOcid = Ocid.describe("Functions Application OCID");
export const LogOcid = Ocid.describe("Log OCID");

export const RegionId = z
  .string()
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
