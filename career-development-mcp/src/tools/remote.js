import path from "node:path";
import { z } from "zod";
import { TOOL_RISK, redactSensitiveValue } from "@gustapaes/mcp-runtime";
import { DATA_DIR } from "../config.js";
import {
  readRemoteConfig,
  requireRemoteConfig,
} from "../integrations/remote-config.js";
import { createRemoteHttp } from "../integrations/remote-http.js";
import { createIdpProvider } from "../integrations/idp-provider.js";
import { createRemoteChanges } from "../integrations/remote-changes.js";
import {
  actionReviewInput,
  assessAction,
  analyzeRemotePlan,
} from "../analytics/action-review.js";

const id = z.string().regex(/^[1-9]\d{0,14}$/);
const short = z.string().trim().min(1).max(512);
const long = z.string().trim().min(1).max(8000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Use a real calendar date in YYYY-MM-DD format.");
const action = z
  .object({
    id,
    planId: id,
    title: z.string().max(512),
    description: z.string().max(8000),
    dueDate: z.string().nullable(),
    status: z.string().max(64),
  })
  .strict();
const plan = z
  .object({
    id,
    title: z.string().max(512),
    description: z.string().max(8000),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    status: z.string().max(64),
  })
  .strict();
const comment = z
  .object({ id, text: z.string().max(8000), createdAt: z.string().nullable() })
  .strict();
const detail = z
  .object({
    plan,
    actions: z.array(action).max(100),
    revision: z.string().length(64),
    capturedAt: z.string(),
    comments: z.array(comment).max(100).optional(),
    commentsHasMore: z.boolean().optional(),
  })
  .strict();
const target = z
  .object({ planId: id.nullable(), actionId: id.nullable() })
  .strict();
const newAction = z
  .object({ title: short, description: long, dueDate: date })
  .strict();
const operations = [
  "plan_create",
  "plan_update",
  "action_create",
  "action_update",
  "action_status",
  "comment_add",
];
const changes = z
  .object({
    title: short.optional(),
    description: long.optional(),
    startDate: date.optional(),
    endDate: date.optional(),
    dueDate: date.optional(),
    status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
    text: long.optional(),
    actions: z.array(newAction).min(1).max(30).optional(),
    expectations: z.array(short).max(30).optional(),
    commentId: id.optional(),
    commentPage: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
const prepareInput = z
  .object({
    operation: z.enum(operations),
    planId: id.optional(),
    actionId: id.optional(),
    changes,
  })
  .strict();
const byOperation = {
  plan_create: z
    .object({
      title: short,
      description: long,
      startDate: date,
      endDate: date,
      actions: z.array(newAction).min(1).max(30),
      expectations: z.array(short).max(30).default([]),
    })
    .strict(),
  plan_update: z
    .object({
      title: short.optional(),
      description: long.optional(),
      startDate: date.optional(),
      endDate: date.optional(),
    })
    .strict(),
  action_create: newAction,
  action_update: z
    .object({
      title: short.optional(),
      description: long.optional(),
      dueDate: date.optional(),
    })
    .strict(),
  action_status: z
    .object({
      status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]),
      commentId: id.optional(),
      commentPage: z.number().int().min(0).max(1000).optional(),
    })
    .strict(),
  comment_add: z.object({ text: long }).strict(),
};

export function validateRemoteChange(args) {
  const input = prepareInput.parse(args);
  input.changes = byOperation[input.operation].parse(input.changes);
  if (Buffer.byteLength(JSON.stringify(input.changes)) > 65536)
    throw new Error(
      "The combined change payload exceeds 64 KiB. Reduce the text or number of actions.",
    );
  if (
    redactSensitiveValue(JSON.stringify(input.changes)) !==
    JSON.stringify(input.changes)
  )
    throw new Error(
      "Credential-like values are not allowed in PDI text or evidence. Keep authentication only in the private environment.",
    );
  if (!Object.keys(input.changes).length)
    throw new Error("At least one changed field is required.");
  if (input.operation === "plan_create") {
    if (input.planId || input.actionId)
      throw new Error("A new plan cannot specify existing target identifiers.");
    if (input.changes.startDate > input.changes.endDate)
      throw new Error("Plan startDate must not follow endDate.");
    if (
      input.changes.actions.some(
        (a) =>
          a.dueDate < input.changes.startDate ||
          a.dueDate > input.changes.endDate,
      )
    )
      throw new Error("Action deadlines must be inside the plan period.");
  } else if (!input.planId) throw new Error("An existing planId is required.");
  if (
    ["action_update", "action_status"].includes(input.operation) &&
    !input.actionId
  )
    throw new Error("actionId is required for an existing action.");
  if (
    !["action_update", "action_status", "comment_add"].includes(
      input.operation,
    ) &&
    input.actionId
  )
    throw new Error("actionId is not applicable to this operation.");
  if (
    input.operation === "action_status" &&
    input.changes.status === "COMPLETED" &&
    !input.changes.commentId
  )
    throw new Error(
      "A completed action requires commentId of the previously published evidence comment.",
    );
  return input;
}

const envelope = (data) =>
  z.object({ data, warnings: z.array(z.string().max(2000)).max(30) }).strict();
const anyRecord = z.record(z.string(), z.unknown());
const previewOut = envelope(
  z
    .object({
      previewId: z.string().uuid(),
      confirmationDigest: z.string().length(64),
      operation: z.enum(operations),
      target,
      before: anyRecord.nullable(),
      after: anyRecord,
      expiresAt: z.string(),
    })
    .strict(),
);
const reviewOut = envelope(
  z
    .object({
      recommendation: z.enum(["keep_open", "ready_for_review"]),
      gaps: z.array(z.string()),
      suggestedComment: z.string().max(200000),
    })
    .strict(),
);
const analyzeOut = envelope(
  z
    .object({
      planId: id,
      title: z.string(),
      capturedAt: z.string(),
      completed: z.number(),
      total: z.number(),
      progress: z.number(),
      issues: z.array(z.string()),
      actions: z
        .array(
          z
            .object({
              actionId: id,
              title: z.string(),
              status: z.string(),
              issues: z.array(z.string()),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
);

export function createRemoteTools({
  config = readRemoteConfig(),
  provider,
  changesService,
  directory = path.join(DATA_DIR, "remote-previews"),
} = {}) {
  const service =
    provider ?? createIdpProvider(createRemoteHttp(config), config.routes);
  const guarded =
    changesService ??
    createRemoteChanges({ config, provider: service, directory });
  const warnings = () =>
    config.unknownKeys.length
      ? [`Unknown configuration keys: ${config.unknownKeys.join(", ")}`]
      : [];
  const make = (
    name,
    description,
    input,
    output,
    handler,
    risk = TOOL_RISK.READ,
    openWorld = true,
  ) => ({
    name,
    definition: {
      name,
      description,
      inputSchema: z.toJSONSchema(input),
      outputSchema: z.toJSONSchema(output),
    },
    handler: async (args) => output.parse(await handler(input.parse(args))),
    policy: { risk, idempotent: risk === TOOL_RISK.READ, openWorld },
  });
  const empty = z.object({}).strict();
  const getInput = z
    .object({
      planId: id,
      includeComments: z.boolean().default(false),
      commentPage: z.number().int().min(0).max(1000).default(0),
      commentLimit: z.number().int().min(1).max(100).default(25),
    })
    .strict();
  return [
    make(
      "guide_remote_status",
      "Inspect optional live career-provider configuration; checkConnection=true verifies current authentication. Never returns credentials or private paths.",
      z.object({ checkConnection: z.boolean().default(false) }).strict(),
      envelope(
        z
          .object({
            provider: z.enum(["none", "idp"]),
            configured: z.boolean(),
            authenticationConfigured: z.boolean(),
            connected: z.boolean().nullable(),
          })
          .strict(),
      ),
      async ({ checkConnection }) => {
        const configured = config.provider !== "none" && !!config.origin;
        let connected = null;
        if (checkConnection) {
          requireRemoteConfig(config);
          await service.self();
          connected = true;
        }
        return {
          data: {
            provider: config.provider,
            configured,
            authenticationConfigured: !!(
              config.token ||
              config.cookie ||
              config.sessionFile
            ),
            connected,
          },
          warnings: warnings(),
        };
      },
    ),
    make(
      "guide_remote_plans_list",
      "Read a bounded page of the authenticated employee's current remote PDIs. Does not read or silently fall back to local snapshots.",
      z
        .object({
          page: z.number().int().min(0).max(1000).default(0),
          limit: z.number().int().min(1).max(100).default(25),
        })
        .strict(),
      envelope(
        z
          .object({
            items: z.array(plan).max(100),
            page: z.number(),
            limit: z.number(),
            hasMore: z.boolean(),
          })
          .strict(),
      ),
      async (args) => ({
        data: await service.list(args),
        warnings: warnings(),
      }),
    ),
    make(
      "guide_remote_plan_get",
      "Read a current remote plan, its actions, revision digest and optionally a page of comments, restricted to the authenticated employee.",
      getInput,
      envelope(detail),
      async (args) => ({
        data: (
          await service.get(args.planId, {
            comments: args.includeComments,
            page: args.commentPage,
            limit: args.commentLimit,
          })
        ).data,
        warnings: warnings(),
      }),
    ),
    make(
      "guide_remote_plan_analyze",
      "Analyze current remote action progress, writing gaps and evidence needs without changing the PDI.",
      z.object({ planId: id }).strict(),
      analyzeOut,
      async ({ planId }) => analyzeRemotePlan((await service.get(planId)).data),
    ),
    make(
      "guide_action_assess",
      "Assess supplied evidence against explicit action criteria and draft an evidence-linked conclusion or progress comment. References and criterion completeness require human review; never equates PBI status with learning completion.",
      actionReviewInput,
      reviewOut,
      async (args) => assessAction(args),
      TOOL_RISK.READ,
      false,
    ),
    make(
      "guide_remote_change_prepare",
      "Prepare an expiring private before/after preview for plan creation/editing, action creation/editing/status or an evidence comment. No remote write. Completing an action requires an existing commentId that names it and links evidence. Unknown fields are rejected per operation.",
      prepareInput,
      previewOut,
      async (args) => ({
        data: await guarded.prepare(validateRemoteChange(args)),
        warnings: [
          ...warnings(),
          "Review the exact target and before/after, obtain explicit approval, then apply using this previewId and confirmationDigest. Remote reads are checked again immediately before writing. The provider has no documented atomic compare-and-swap; avoid concurrent editing in other clients.",
        ],
      }),
      TOOL_RISK.LOCAL_STATE,
      true,
    ),
    make(
      "guide_remote_change_apply",
      "Apply exactly one reviewed preview after explicit user approval. Checks expiry, identity, current plan digest and evidence comment. Audits before writing, serializes writes and never resends an uncertain operation. Reusing an applied preview returns its saved receipt.",
      z
        .object({
          previewId: z.string().uuid(),
          confirmationDigest: z.string().length(64),
          confirm: z.literal(true),
        })
        .strict(),
      envelope(
        z
          .object({
            previewId: z.string().uuid(),
            operation: z.enum(operations),
            applied: z.literal(true),
            replayed: z.boolean(),
            receipt: z
              .object({
                commentId: id.optional(),
                planId: id.optional(),
                actionId: id.optional(),
                revision: z.string().optional(),
              })
              .strict(),
          })
          .strict(),
      ),
      async (args) => ({
        data: await guarded.apply(args),
        warnings: warnings(),
      }),
      TOOL_RISK.REMOTE_WRITE,
      true,
    ),
  ];
}

export const REMOTE_TOOLS = createRemoteTools();
