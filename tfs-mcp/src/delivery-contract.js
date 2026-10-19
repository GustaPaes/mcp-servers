import { z } from "zod";
import { MutationControlsSchema } from "./safety.js";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,79}$/);
const provenance = z.strictObject({
  commit: sha,
  executor: label,
  command: z.string().min(1).max(300),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime(),
});
export const DeliveryInput = z.strictObject({
  repo: z.string().min(1).max(200),
  pull_request_id: z.number().int().positive(),
  work_item_id: z.number().int().positive(),
  source_sha: sha,
  reports: z.array(z.strictObject({
    path: z.string().min(1).max(4096), sha256: digest,
    format: z.enum(["summary-json", "jest-json", "junit", "trx"]), provenance,
    label: label.optional(),
  })).max(20).default([]),
  media: z.array(z.strictObject({
    path: z.string().min(1).max(4096), sha256: digest,
    scenario: label, kind: z.enum(["image", "video"]), provenance,
    redacted: z.literal(true),
  })).max(20).default([]),
  required_scenarios: z.array(label).max(20).default([]),
  require_video_per_scenario: z.boolean().default(false),
  build_ids: z.array(z.number().int().positive()).max(20).default([]),
  limitations: z.array(z.string().min(1).max(300)).max(10).default([]),
});
export const PublishDeliveryInput = DeliveryInput.extend({
  plan_digest: digest,
  evidence_level: z.enum(["unverified", "partial", "verified"]),
  final: z.literal(true),
  recovered_uploads: z.array(z.strictObject({ sha256: digest, attachment_id: z.string().uuid() })).max(20).default([]),
  dry_run: z.boolean().default(false),
  confirm: z.boolean().optional(), reason: z.string().max(500).optional(),
  requestedBy: z.string().max(200).optional(), requested_by: z.string().max(200).optional(),
  confirm_high_impact: z.string().max(500).optional(),
});
const strings = z.array(z.string().max(2000)).max(50);
const observedProvenance = z.strictObject({ commit: sha, executor: label, commandSha256: digest,
  startedAt: z.string().datetime(), finishedAt: z.string().datetime() });
const observedFile = { sha256: digest, bytes: z.number().int().min(1).max(104_857_600), provenance: observedProvenance };
const counts = z.strictObject({ schemaVersion: z.literal(1), total: z.number().int().min(0).max(1_000_000),
  passed: z.number().int().min(0).max(1_000_000), failed: z.number().int().min(0).max(1_000_000),
  skipped: z.number().int().min(0).max(1_000_000), executionFailed: z.boolean().optional() });
const evidenceLevel = z.enum(['unverified', 'partial', 'verified']);
const preparedData = z.strictObject({ planDigest: digest, evidenceLevel, sourceSha: sha, pending: strings,
  placement: z.strictObject({ repository: z.string().max(200), projectId: z.string().uuid(),
    sourceRef: z.string().max(1000), targetRef: z.string().max(1000), targetSha: sha, status: z.string().max(100) }),
  mergeSha: sha.nullable(),
  reports: z.array(z.strictObject({ ...observedFile, label: label.optional(), format: z.enum(['summary-json', 'jest-json', 'junit', 'trx']), counts })).max(20),
  media: z.array(z.strictObject({ ...observedFile, scenario: label, kind: z.enum(['image', 'video']),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']),
    extension: z.enum(['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm']) })).max(20),
  builds: z.array(z.strictObject({ id: z.number().int().positive(), matching: z.boolean(), sourceSha: z.string().max(100).nullable(),
    status: z.string().max(100), result: z.string().max(100) })).max(20), checklist: strings,
});
const publishedData = z.strictObject({
  status: z.enum(['published', 'partial']).optional(), evidenceLevel: evidenceLevel.optional(), sourceSha: sha.optional(),
  planDigest: digest.optional(), attachments: z.number().int().min(0).max(20).optional(),
  workItemRevision: z.number().int().positive().optional(), pending: strings.optional(),
  correlationId: z.string().uuid(), dryRun: z.boolean(), willMutate: z.boolean(),
  blockReasons: strings.optional(), mutationPlan: z.record(z.string(), z.unknown()).optional(),
});
function definition(name, schema, dataSchema, description) {
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(schema);
  const { $schema: _outputDialect, ...outputSchema } = z.toJSONSchema(z.strictObject({
    data: dataSchema, meta: z.strictObject({ testsExecutedByServer: z.literal(false) }), warnings: strings,
  }));
  return { name, description, inputSchema, outputSchema };
}
export const DELIVERY_TOOLS = [
  definition("tfs_prepare_pr_delivery", DeliveryInput, preparedData,
    "Prepare final evidence for the current PR commit. Parse bounded local reports, verify hashes, inspect pipeline runs and return honest pending checks. Does not execute tests or publish."),
  definition("tfs_publish_pr_delivery", PublishDeliveryInput, publishedData,
    "Publish final or explicitly partial evidence once: managed PR/work-item sections and owned media attachments. Requires a fresh preparation digest; never posts progress comments, closes items or merges PRs."),
];
Object.assign(DELIVERY_TOOLS[1].inputSchema.properties, MutationControlsSchema);
