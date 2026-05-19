/**
 * OCI Functions (FaaS) tools — list, deploy (metadata), invoke, delete.
 */
import { z } from "zod";
import {
  functionsManagementClient,
  functionsInvokeClient,
} from "../../lib/ociClient.js";
import { paginateAll } from "../../lib/pagination.js";
import { withRetry } from "../../lib/retries.js";
import { config } from "../../config.js";
import {
  CompartmentOcid,
  ApplicationOcid,
  FunctionOcid,
  Ocid,
  SafetyInputs,
  FreeformTags,
  MCP_OWNER_TAG,
} from "../../schemas.js";
import {
  guardMutation,
  effectiveDryRun,
  buildDryRunPlan,
} from "../../safety/guards.js";
import * as ownership from "../../safety/ownership.js";

const compartmentField = (z) =>
  CompartmentOcid.default(config.defaultCompartmentOcid ?? undefined);

export const fn_list_applications = {
  description: "List Functions Applications in a compartment.",
  input: z.object({
    compartmentId: compartmentField(z),
    max: z.number().int().positive().max(500).default(100),
  }),
  async handler({ compartmentId, max }) {
    const c = await functionsManagementClient();
    const items = await paginateAll(
      (params) => c.listApplications({ compartmentId, ...params }),
      {},
      { max }
    );
    return {
      count: items.length,
      applications: items.map((a) => ({
        id: a.id,
        name: a.displayName,
        subnets: a.subnetIds,
        lifecycleState: a.lifecycleState,
      })),
    };
  },
};

export const fn_list_functions = {
  description: "List functions inside an Application.",
  input: z.object({
    applicationId: ApplicationOcid,
    max: z.number().int().positive().max(500).default(100),
  }),
  async handler({ applicationId, max }) {
    const c = await functionsManagementClient();
    const items = await paginateAll(
      (params) => c.listFunctions({ applicationId, ...params }),
      {},
      { max }
    );
    return {
      count: items.length,
      functions: items.map((f) => ({
        id: f.id,
        name: f.displayName,
        image: f.image,
        invokeEndpoint: f.invokeEndpoint,
        memoryInMBs: f.memoryInMBs,
        timeoutInSeconds: f.timeoutInSeconds,
        lifecycleState: f.lifecycleState,
      })),
    };
  },
};

export const fn_get_function = {
  description: "Get a single Function's details.",
  input: z.object({ id: FunctionOcid }),
  async handler({ id }) {
    const c = await functionsManagementClient();
    const r = await c.getFunction({ functionId: id });
    return r.function;
  },
};

export const fn_create_application = {
  description: "Create a new Functions Application (logical container for functions).",
  input: z.object({
    name: z.string().min(1),
    compartmentId: compartmentField(z),
    subnetIds: z.array(Ocid).min(1),
    config: z.record(z.string(), z.string()).optional(),
    freeformTags: FreeformTags,
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const guard = guardMutation({
      input,
      action: "create",
      name: input.name,
      resourceType: "fn_application",
    });
    if (!guard.ok) return guard;

    const payload = {
      compartmentId: input.compartmentId,
      displayName: input.name,
      subnetIds: input.subnetIds,
      config: input.config,
      freeformTags: { ...MCP_OWNER_TAG, ...(input.freeformTags ?? {}) },
    };
    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "create",
        resourceType: "fn_application",
        target: input.name,
        payload,
      });
    }
    const c = await functionsManagementClient();
    const res = await withRetry(() =>
      c.createApplication({ createApplicationDetails: payload })
    );
    ownership.record({
      ocid: res.application.id,
      type: "fn_application",
      name: res.application.displayName,
      compartment: input.compartmentId,
    });
    return { ok: true, application: res.application };
  },
};

export const fn_create_function = {
  description: "Register a function (image already in OCIR).",
  input: z.object({
    name: z.string().min(1),
    applicationId: ApplicationOcid,
    image: z.string().describe("OCIR image, e.g. region.ocir.io/tenancy/repo/img:tag"),
    imageDigest: z.string().optional(),
    memoryInMBs: z.number().int().min(128).default(256),
    timeoutInSeconds: z.number().int().min(30).max(300).default(120),
    config: z.record(z.string(), z.string()).optional(),
    freeformTags: FreeformTags,
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const guard = guardMutation({
      input,
      action: "create",
      name: input.name,
      resourceType: "fn_function",
    });
    if (!guard.ok) return guard;

    const payload = {
      applicationId: input.applicationId,
      displayName: input.name,
      image: input.image,
      imageDigest: input.imageDigest,
      memoryInMBs: input.memoryInMBs,
      timeoutInSeconds: input.timeoutInSeconds,
      config: input.config,
      freeformTags: { ...MCP_OWNER_TAG, ...(input.freeformTags ?? {}) },
    };
    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "create",
        resourceType: "fn_function",
        target: input.name,
        payload,
      });
    }
    const c = await functionsManagementClient();
    const res = await withRetry(() =>
      c.createFunction({ createFunctionDetails: payload })
    );
    ownership.record({
      ocid: res.function.id,
      type: "fn_function",
      name: res.function.displayName,
    });
    return { ok: true, function: res.function };
  },
};

export const fn_invoke = {
  description:
    "Invoke a Function synchronously and return its response. Streaming responses are accumulated.",
  input: z.object({
    functionId: FunctionOcid,
    invokeEndpoint: z.string().url().describe("From fn_get_function.invokeEndpoint"),
    body: z.union([z.string(), z.record(z.unknown())]).optional(),
    fnIntent: z.enum(["httprequest", "cloudevent"]).default("httprequest"),
    fnInvokeType: z.enum(["sync", "detached"]).default("sync"),
  }),
  async handler({ functionId, invokeEndpoint, body, fnIntent, fnInvokeType }) {
    const c = await functionsInvokeClient(invokeEndpoint);
    const payload = typeof body === "string" ? body : body ? JSON.stringify(body) : "";
    const res = await c.invokeFunction({
      functionId,
      invokeFunctionBody: payload,
      fnIntent,
      fnInvokeType,
    });
    const chunks = [];
    if (res.value) {
      for await (const chunk of res.value) chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    return { status: "ok", response: text };
  },
};

export const fn_delete_function = {
  description: "DELETE a Function. Destructive; requires confirm.",
  input: z.object({ id: FunctionOcid, ...SafetyInputs.shape }),
  async handler(input) {
    const c = await functionsManagementClient();
    let name = null;
    try {
      const r = await c.getFunction({ functionId: input.id });
      name = r.function?.displayName;
    } catch {
      /* */
    }
    const guard = guardMutation({
      input,
      action: "delete",
      ocid: input.id,
      name,
      resourceType: "fn_function",
      destructive: true,
    });
    if (!guard.ok) return guard;
    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "delete",
        resourceType: "fn_function",
        target: name ?? input.id,
        payload: {},
      });
    }
    await c.deleteFunction({ functionId: input.id });
    ownership.remove(input.id);
    return { ok: true };
  },
};
