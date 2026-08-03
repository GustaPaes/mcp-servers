/**
 * safety.js — Shared mutation guards for TFS tools.
 */
import { createCorrelationId, writeAuditEvent } from "./audit.js";

const HIGH_IMPACT_PATTERN = /\b(prod|prd|production|produção|release|main|master|hml|homolog|preprod|pre-prod|live)\b/i;

export const MutationControlsSchema = {
  dry_run: {
    type: "boolean",
    default: true,
    description: "Defaults to true. Set false only after reviewing the returned mutation plan.",
  },
  confirm: {
    type: "boolean",
    description: "Required as true for real mutations.",
  },
  reason: {
    type: "string",
    description: "Human-readable reason for the mutation.",
  },
  requestedBy: {
    type: "string",
    description: "Name, email or ticket identifying who requested the mutation.",
  },
  requested_by: {
    type: "string",
    description: "Alias for requestedBy.",
  },
  confirm_high_impact: {
    type: "string",
    description: "Required for high-impact targets; must match the identifier requested in the dry-run plan.",
  },
};

export function normalizeMutationControls(input = {}) {
  return {
    dryRun: input.dry_run !== false,
    confirm: input.confirm === true,
    reason: String(input.reason ?? "").trim(),
    requestedBy: String(input.requestedBy ?? input.requested_by ?? "").trim(),
    confirmHighImpact: String(input.confirm_high_impact ?? "").trim(),
  };
}

export function detectHighImpact(...values) {
  const joined = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(" ");
  const match = joined.match(HIGH_IMPACT_PATTERN);
  return {
    highImpact: Boolean(match),
    match: match?.[0] ?? null,
  };
}

export function buildMutationPlan({
  tool,
  target,
  operation,
  changes,
  controls,
  confirmationRequired = true,
  highImpact,
  highImpactMatch,
  highImpactConfirmation,
  authAlias,
  repo,
}) {
  return {
    tool,
    target,
    operation,
    changes,
    dryRun: controls.dryRun,
    confirmation: {
      required: confirmationRequired,
      confirm: controls.confirm,
      reasonProvided: controls.reason.length >= 5,
      requestedBy: controls.requestedBy || null,
      highImpact: Boolean(highImpact),
      highImpactMatch: highImpactMatch ?? null,
      highImpactConfirmationRequired:
        confirmationRequired && highImpact ? highImpactConfirmation : null,
      highImpactConfirmed:
        !confirmationRequired ||
        !highImpact ||
        controls.confirmHighImpact === String(highImpactConfirmation ?? ""),
    },
    context: {
      authAlias: authAlias || "default",
      repo: repo || null,
    },
  };
}

export function assessMutation(plan, controls) {
  const blockReasons = [];
  if (controls.dryRun) blockReasons.push("dry_run requested a preview");
  if (plan.confirmation.required !== false) {
    if (!controls.confirm) blockReasons.push("confirm must be true");
    if (controls.reason.length < 5) blockReasons.push("reason must have at least 5 characters");
    if (controls.requestedBy.length < 2) blockReasons.push("requestedBy/requested_by must identify the requester");
    if (
      plan.confirmation.highImpact &&
      controls.confirmHighImpact !== String(plan.confirmation.highImpactConfirmationRequired ?? "")
    ) {
      blockReasons.push(
        `high-impact target requires confirm_high_impact="${plan.confirmation.highImpactConfirmationRequired}"`
      );
    }
  }

  return {
    willMutate: blockReasons.length === 0,
    blockReasons,
  };
}

export function auditMutationPlan({ plan, assessment, status, result, correlationId = createCorrelationId() }) {
  writeAuditEvent({
    correlationId,
    status,
    tool: plan.tool,
    target: plan.target,
    operation: plan.operation,
    changes: plan.changes,
    dryRun: plan.dryRun,
    willMutate: assessment.willMutate,
    blockReasons: assessment.blockReasons,
    authAlias: plan.context.authAlias,
    repo: plan.context.repo,
    result,
  });
  return correlationId;
}

export function blockedMutationResponse(plan, assessment) {
  const correlationId = auditMutationPlan({
    plan,
    assessment,
    status: "blocked",
  });
  return {
    dryRun: true,
    willMutate: false,
    blockReasons: assessment.blockReasons,
    correlationId,
    mutationPlan: plan,
  };
}

export async function executeGuardedMutation({ plan, controls, apply }) {
  const assessment = assessMutation(plan, controls);
  if (!assessment.willMutate) return blockedMutationResponse(plan, assessment);

  const correlationId = auditMutationPlan({ plan, assessment, status: "applying" });
  try {
    const result = await apply();
    auditMutationPlan({ plan, assessment, status: "applied", result, correlationId });
    return { ...result, correlationId, dryRun: false, willMutate: true };
  } catch (err) {
    auditMutationPlan({
      plan,
      assessment,
      status: "failed",
      result: { error: err instanceof Error ? err.message : String(err) },
      correlationId,
    });
    throw err;
  }
}
