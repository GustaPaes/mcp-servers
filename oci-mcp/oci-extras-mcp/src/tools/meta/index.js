/**
 * Meta / discovery tools.
 */
import { z } from "zod";
import { identityClient } from "../../lib/ociClient.js";
import { paginateAll } from "../../lib/pagination.js";
import { config } from "../../config.js";
import { resolveAuthProvider, getCurrentRegion, getCurrentTenancyOcid } from "../../auth/index.js";
import * as ownership from "../../safety/ownership.js";
import { CompartmentOcid } from "../../schemas.js";

export const oci_whoami = {
  description: "Show current authentication context: method, region, tenancy, profile.",
  input: z.object({}),
  async handler() {
    const { method } = await resolveAuthProvider();
    return {
      authMethod: method,
      region: await getCurrentRegion(),
      tenancyOcid: await getCurrentTenancyOcid(),
      profile: config.ociConfigProfile,
      configFile: config.ociConfigFile,
      defaultCompartment: config.defaultCompartmentOcid,
      safety: {
        allowDestructive: config.allowDestructive,
        allowSecretReveal: config.allowSecretReveal,
        defaultDryRun: config.defaultDryRun,
        allowThirdPartyMutation: config.allowThirdPartyMutation,
      },
      ownershipLedger: config.ownershipLedgerPath,
    };
  },
};

export const oci_list_regions = {
  description: "List subscribed OCI regions for the current tenancy.",
  input: z.object({}),
  async handler() {
    const id = await identityClient();
    const tenancyId = await getCurrentTenancyOcid();
    const r = await id.listRegionSubscriptions({ tenancyId });
    return { regions: r.items };
  },
};

export const oci_list_compartments = {
  description: "List compartments within the tenancy (recursive).",
  input: z.object({
    compartmentId: CompartmentOcid.optional().describe("Defaults to tenancy root"),
    accessLevel: z.enum(["ANY", "ACCESSIBLE"]).default("ACCESSIBLE"),
    max: z.number().int().positive().max(1000).default(200),
  }),
  async handler({ compartmentId, accessLevel, max }) {
    const id = await identityClient();
    const root = compartmentId ?? (await getCurrentTenancyOcid());
    const items = await paginateAll(
      (params) =>
        id.listCompartments({
          compartmentId: root,
          compartmentIdInSubtree: true,
          accessLevel,
          ...params,
        }),
      {},
      { max }
    );
    return {
      count: items.length,
      compartments: items.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.compartmentId,
        lifecycleState: c.lifecycleState,
      })),
    };
  },
};

export const oci_list_availability_domains = {
  description: "List ADs in the active region for a compartment.",
  input: z.object({ compartmentId: CompartmentOcid.optional() }),
  async handler({ compartmentId }) {
    const id = await identityClient();
    const cid = compartmentId ?? (await getCurrentTenancyOcid());
    const r = await id.listAvailabilityDomains({ compartmentId: cid });
    return { availabilityDomains: r.items };
  },
};

export const oci_ledger_dump = {
  description: "Dump the ownership ledger (resources created/adopted by this MCP).",
  input: z.object({ type: z.string().optional() }),
  async handler({ type }) {
    return { items: ownership.list({ type }) };
  },
};
