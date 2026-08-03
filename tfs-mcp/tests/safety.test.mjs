import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWorkItemId } from "../src/formatters.js";
import {
  assessMutation,
  buildMutationPlan,
  detectHighImpact,
  normalizeMutationControls,
} from "../src/safety.js";
import { redactAuditValue } from "../src/audit.js";

test("normalizeWorkItemId accepts numeric ids and TFS URLs", () => {
  assert.equal(normalizeWorkItemId(123), 123);
  assert.equal(normalizeWorkItemId("456"), 456);
  assert.equal(normalizeWorkItemId("https://tfs.example.com/Default/_workitems/edit/789"), 789);
});

test("mutation controls default to dry-run and block real mutation", () => {
  const controls = normalizeMutationControls({});
  const plan = buildMutationPlan({
    tool: "tfs_update_work_item",
    target: { id: 123 },
    operation: "update",
    changes: [{ field: "System.Title", valuePreview: "x" }],
    controls,
  });

  const assessment = assessMutation(plan, controls);

  assert.equal(assessment.willMutate, false);
  assert.match(assessment.blockReasons.join("\n"), /dry_run/);
});

test("high impact targets require exact confirm_high_impact", () => {
  const controls = normalizeMutationControls({
    dry_run: false,
    confirm: true,
    reason: "approved change",
    requestedBy: "qa",
  });
  const impact = detectHighImpact("refs/heads/release/2026.06");
  const plan = buildMutationPlan({
    tool: "tfs_add_pr_comment",
    target: { pullRequestId: 42 },
    operation: "comment",
    changes: [],
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: "42",
  });

  const assessment = assessMutation(plan, controls);

  assert.equal(assessment.willMutate, false);
  assert.match(assessment.blockReasons.join("\n"), /confirm_high_impact="42"/);
  assert.equal(detectHighImpact("refs/heads/releases/2026.06").highImpact, true);
});

test("operational execution can bypass confirmation while remaining guarded by optional dry-run", () => {
  const controls = normalizeMutationControls({ dry_run: false });
  const plan = buildMutationPlan({
    tool: "tfs_pipeline_queue",
    target: { definitionId: 42, branch: "refs/heads/release/2026.08" },
    operation: "queue pipeline run",
    changes: { templateParameterNames: ["environment"] },
    controls,
    confirmationRequired: false,
    highImpact: true,
    highImpactMatch: "release",
    highImpactConfirmation: "42",
  });

  const assessment = assessMutation(plan, controls);

  assert.equal(plan.confirmation.required, false);
  assert.equal(plan.confirmation.highImpactConfirmationRequired, null);
  assert.equal(assessment.willMutate, true);
  assert.deepEqual(assessment.blockReasons, []);
});

test("confirmation-optional execution still honors an explicit dry-run", () => {
  const controls = normalizeMutationControls({ dry_run: true });
  const plan = buildMutationPlan({
    tool: "tfs_pipeline_queue",
    target: { definitionId: 42 },
    operation: "queue pipeline run",
    changes: {},
    controls,
    confirmationRequired: false,
  });

  const assessment = assessMutation(plan, controls);

  assert.equal(assessment.willMutate, false);
  assert.deepEqual(assessment.blockReasons, ["dry_run requested a preview"]);
});

test("audit redaction masks sensitive values and long payloads", () => {
  const redacted = redactAuditValue({
    Authorization: "Bearer abc.def.ghi",
    comment: "x".repeat(500),
    field: "System.Title",
  });

  assert.equal(redacted.Authorization.redacted, true);
  assert.equal(redacted.Authorization.preview, "[REDACTED]");
  assert.equal(redacted.comment.redacted, true);
  assert.equal(redacted.comment.length, 500);
  assert.equal(redacted.field, "System.Title");
});
