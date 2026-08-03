/**
 * tools/branch-policy.js — Governança segura de Build Validation policies.
 */
import { z } from "zod";
import { buildProjectUrl, TFS_REPO } from "../config.js";
import { getRequestContext } from "../request-context.js";
import {
  auditMutationPlan,
  buildMutationPlan,
  detectHighImpact,
  executeGuardedMutation,
  normalizeMutationControls,
} from "../safety.js";
import { tfsGet, tfsPost, tfsPut } from "../tfs-client.js";

export const BUILD_VALIDATION_POLICY_TYPE_ID = "0609b952-1397-4640-95ec-e00a01b2c241";

const MAX_FILENAME_PATTERNS = 100;
const MAX_FILENAME_PATTERN_LENGTH = 512;
const MAX_VALID_DURATION_MINUTES = 365 * 24 * 60;
const POLICY_LIST_TOP = 1000;
const AMBIGUOUS_WRITE_STATUS = new Set([0, 429, 500, 502, 503, 504]);
const INVALID_GIT_REF_CHARACTER = /[\x00-\x20\x7f~^:?*[\\]/;
const policyIdentityLocks = new Map();

const MutationInput = {
  auth_alias: z.string().trim().min(1).optional(),
  dry_run: z.boolean().default(true),
  confirm: z.boolean().optional(),
  reason: z.string().optional(),
  requestedBy: z.string().optional(),
  requested_by: z.string().optional(),
  confirm_high_impact: z.string().optional(),
};

const UpsertBuildValidationPolicyArgs = z.strictObject({
  repository: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1),
  branch_match_kind: z.enum(["exact", "prefix"]).default("exact"),
  build_definition_id: z.number().int().positive().optional(),
  build_definition_name: z.string().trim().min(1).optional(),
  allow_cross_repository: z.boolean().default(false),
  display_name: z.string().trim().min(1).max(256).optional(),
  filename_patterns: z.array(z.string().max(MAX_FILENAME_PATTERN_LENGTH))
    .max(MAX_FILENAME_PATTERNS)
    .default([]),
  enabled: z.boolean().default(true),
  blocking: z.boolean().default(true),
  manual_queue_only: z.boolean().default(false),
  queue_on_source_update_only: z.boolean().default(false),
  valid_duration: z.number().int().min(0).max(MAX_VALID_DURATION_MINUTES).default(0),
  ...MutationInput,
})
  .refine(value => value.build_definition_id || value.build_definition_name, {
    message: "Informe build_definition_id ou build_definition_name.",
  })
  .refine(value => value.queue_on_source_update_only || value.valid_duration === 0, {
    message: "valid_duration deve ser 0 quando queue_on_source_update_only for false.",
    path: ["valid_duration"],
  });

export function normalizePolicyBranch(branch, branchMatchKind = "exact") {
  const normalized = String(branch ?? "").trim().replace(/^\/+/, "");
  if (!normalized) throw new Error("branch não pode ser vazia.");
  if (normalized.startsWith("refs/") && !normalized.startsWith("refs/heads/")) {
    throw new Error("branch deve apontar para refs/heads, não para tags ou outros refs.");
  }
  const refName = normalized.startsWith("refs/heads/")
    ? normalized
    : `refs/heads/${normalized}`;
  if (refName === "refs/heads/") throw new Error("branch não pode ser vazia.");
  const prefix = normalizeMatchKind(branchMatchKind) === "Prefix";
  const candidate = prefix && refName.endsWith("/") ? refName.slice(0, -1) : refName;
  const components = candidate.split("/");
  const invalidComponent = components.some(component => (
    !component
    || component.startsWith(".")
    || component.endsWith(".")
    || component.toLowerCase().endsWith(".lock")
  ));
  if (
    invalidComponent
    || (!prefix && refName.endsWith("/"))
    || refName.includes("//")
    || refName.includes("..")
    || refName.includes("@{")
    || INVALID_GIT_REF_CHARACTER.test(refName)
  ) {
    throw new Error(`branch '${refName}' não é uma ref Git válida para uma policy.`);
  }
  return refName;
}

export function normalizeFilenamePatterns(patterns = []) {
  const normalized = [];
  const seen = new Set();
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern ?? "").trim();
    if (!pattern) throw new Error("filename_patterns não aceita valores vazios.");
    if (pattern.includes(";") || /[\r\n\0]/.test(pattern)) {
      throw new Error("Informe cada filename_pattern separadamente e sem quebras de linha.");
    }
    const matchPattern = pattern.startsWith("!") ? pattern.slice(1) : pattern;
    if (!matchPattern || !/^[/*?]/.test(matchPattern)) {
      throw new Error(
        `filename_pattern '${pattern}' deve começar com '/', '*' ou '?', opcionalmente após '!'.`,
      );
    }
    if (!seen.has(pattern)) {
      normalized.push(pattern);
      seen.add(pattern);
    }
  }
  return normalized;
}

function normalizeMatchKind(matchKind) {
  return String(matchKind ?? "exact").toLowerCase() === "prefix" ? "Prefix" : "Exact";
}

function scopeMatches(scope, repositoryId, branch) {
  return String(scope?.repositoryId ?? "").toLowerCase() === String(repositoryId).toLowerCase()
    && String(scope?.refName ?? "") === branch;
}

function policyIdentityKey(repositoryId, branch, buildDefinitionId) {
  return JSON.stringify([
    String(repositoryId).toLowerCase(),
    branch,
    Number(buildDefinitionId),
  ]);
}

function withPolicyIdentityLock(identity, action) {
  const previous = policyIdentityLocks.get(identity) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  policyIdentityLocks.set(identity, current);
  return current.finally(() => {
    if (policyIdentityLocks.get(identity) === current) policyIdentityLocks.delete(identity);
  });
}

function policyMatchesIdentity(policy, repositoryId, branch, buildDefinitionId) {
  return String(policy?.type?.id ?? "").toLowerCase() === BUILD_VALIDATION_POLICY_TYPE_ID
    && Number(policy?.settings?.buildDefinitionId) === Number(buildDefinitionId)
    && (policy?.settings?.scope ?? []).some(scope => scopeMatches(scope, repositoryId, branch));
}

function summarizeBuildValidationPolicy(policy, fallback = {}) {
  if (!policy) return null;
  const scope = (policy.settings?.scope ?? [])[0] ?? {};
  return {
    policyId: policy.id ?? null,
    revision: policy.revision ?? null,
    enabled: Boolean(policy.isEnabled),
    blocking: Boolean(policy.isBlocking),
    buildDefinitionId: Number(policy.settings?.buildDefinitionId),
    displayName: policy.settings?.displayName ?? null,
    manualQueueOnly: Boolean(policy.settings?.manualQueueOnly),
    queueOnSourceUpdateOnly: Boolean(policy.settings?.queueOnSourceUpdateOnly),
    validDuration: Number(policy.settings?.validDuration ?? 0),
    filenamePatterns: [...(policy.settings?.filenamePatterns ?? [])],
    repositoryId: scope.repositoryId ?? fallback.repositoryId ?? null,
    branch: scope.refName ?? fallback.branch ?? null,
    branchMatchKind: normalizeMatchKind(scope.matchKind ?? fallback.branchMatchKind),
  };
}

export function buildBuildValidationPolicyPayload({
  existing,
  repositoryId,
  branch,
  branchMatchKind = "exact",
  buildDefinitionId,
  displayName,
  filenamePatterns = [],
  enabled = true,
  blocking = true,
  manualQueueOnly = false,
  queueOnSourceUpdateOnly = false,
  validDuration = 0,
}) {
  const payload = {
    isEnabled: enabled,
    isBlocking: blocking,
    type: { id: BUILD_VALIDATION_POLICY_TYPE_ID },
    settings: {
      ...(existing?.settings ?? {}),
      buildDefinitionId: Number(buildDefinitionId),
      displayName,
      manualQueueOnly,
      queueOnSourceUpdateOnly,
      validDuration,
      filenamePatterns: normalizeFilenamePatterns(filenamePatterns),
      scope: [{
        repositoryId,
        refName: normalizePolicyBranch(branch, branchMatchKind),
        matchKind: normalizeMatchKind(branchMatchKind),
      }],
    },
  };

  if (existing) {
    payload.id = existing.id;
    payload.revision = existing.revision;
  }
  return payload;
}

export function buildBranchPolicyChangeSummary(existing, payload) {
  const before = summarizeBuildValidationPolicy(existing);
  const after = summarizeBuildValidationPolicy(payload);
  const comparableFields = [
    "enabled",
    "blocking",
    "buildDefinitionId",
    "displayName",
    "manualQueueOnly",
    "queueOnSourceUpdateOnly",
    "validDuration",
    "filenamePatterns",
    "repositoryId",
    "branch",
    "branchMatchKind",
  ];
  const changedFields = before
    ? comparableFields.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    : comparableFields;

  return {
    action: existing ? (changedFields.length ? "update" : "none") : "create",
    changedFields,
    before,
    after,
  };
}

async function resolveRepository(selector, authAlias) {
  const data = await tfsGet("/git/repositories", {}, { authAlias });
  const normalized = String(selector).toLowerCase();
  const repository = (data.value ?? []).find(
    item => String(item.id).toLowerCase() === normalized
      || item.name?.toLowerCase() === normalized,
  );
  if (!repository) throw new Error(`Repositório '${selector}' não encontrado no projeto configurado.`);
  return repository;
}

async function requireExactBranchRef(repositoryId, branch, authAlias) {
  const data = await tfsGet(
    `/git/repositories/${repositoryId}/refs`,
    {
      filter: branch.replace(/^refs\//, ""),
      "$top": 1000,
      "api-version": "7.0",
    },
    { authAlias },
  );
  const exact = (data.value ?? []).find(ref => String(ref.name ?? "") === branch);
  if (!exact) {
    throw new Error(
      `A branch '${branch}' não foi encontrada no repositório com essa capitalização. `
      + "Confirme a ref exata antes de configurar a policy.",
    );
  }
  return exact;
}

async function resolveBuildDefinition({ id, name, authAlias }) {
  let definition;
  if (id) {
    definition = await tfsGet(`/build/definitions/${id}`, {}, { authAlias });
  } else {
    const data = await tfsGet("/build/definitions", { name, "$top": 100 }, { authAlias });
    const matches = (data.value ?? []).filter(
      item => item.name?.toLowerCase() === name.toLowerCase(),
    );
    if (!matches.length) throw new Error(`Pipeline '${name}' não encontrada.`);
    if (matches.length > 1) {
      throw new Error(
        `Mais de uma pipeline chamada '${name}' foi encontrada. Use build_definition_id.`,
      );
    }
    definition = await tfsGet(`/build/definitions/${matches[0].id}`, {}, { authAlias });
  }

  if (id && name && definition.name?.toLowerCase() !== name.toLowerCase()) {
    throw new Error(
      `build_definition_id ${id} pertence a '${definition.name}', não a '${name}'.`,
    );
  }
  return definition;
}

function validateBuildDefinition(
  definition,
  repository,
  allowCrossRepository,
  { requireEnabled = true } = {},
) {
  const queueStatus = String(definition.queueStatus ?? "").toLowerCase();
  if (requireEnabled && queueStatus !== "enabled") {
    const reportedStatus = definition.queueStatus ?? "não informado";
    throw new Error(
      `A pipeline '${definition.name}' não pode validar PRs porque queueStatus é '${reportedStatus}', não 'enabled'.`,
    );
  }

  const definitionRepository = definition.repository ?? {};
  const definitionRepositoryId = String(definitionRepository.id ?? "");
  const sameRepository = Boolean(definitionRepositoryId)
    && definitionRepositoryId.toLowerCase() === String(repository.id).toLowerCase();
  const crossRepository = !sameRepository;
  if (crossRepository && !allowCrossRepository) {
    const source = definitionRepository.name || definitionRepositoryId || "não identificado";
    throw new Error(
      `A pipeline '${definition.name}' usa o repositório '${source}', diferente de '${repository.name}'. `
      + "Use allow_cross_repository:true somente após validar explicitamente esse desenho.",
    );
  }

  return {
    queueStatus,
    crossRepository,
    repositoryId: definitionRepositoryId || null,
    repositoryName: definitionRepository.name ?? null,
    repositoryType: definitionRepository.type ?? null,
  };
}

function definitionSnapshot(definition, context) {
  return {
    id: Number(definition.id),
    revision: Number(definition.revision),
    name: String(definition.name ?? ""),
    queueStatus: context.queueStatus,
    repositoryId: String(context.repositoryId ?? "").toLowerCase(),
    repositoryName: String(context.repositoryName ?? ""),
    repositoryType: String(context.repositoryType ?? "").toLowerCase(),
  };
}

function assertBuildDefinitionUnchanged(initialDefinition, initialContext, freshDefinition, freshContext) {
  const before = definitionSnapshot(initialDefinition, initialContext);
  const after = definitionSnapshot(freshDefinition, freshContext);
  const fields = [
    "id",
    "revision",
    "name",
    "queueStatus",
    "repositoryId",
    "repositoryName",
    "repositoryType",
  ];
  const changedFields = fields.filter(field => !Object.is(before[field], after[field]));
  if (changedFields.length) {
    throw new Error(
      `A pipeline ${initialDefinition.id} mudou antes da escrita nos campos: ${changedFields.join(", ")}. `
      + "Gere uma nova prévia para validar o estado atual.",
    );
  }
}

async function findExistingPolicy({ repositoryId, branch, buildDefinitionId, authAlias }) {
  const data = await tfsGet(
    "/git/policy/configurations",
    {
      repositoryId,
      refName: branch,
      policyType: BUILD_VALIDATION_POLICY_TYPE_ID,
      "$top": POLICY_LIST_TOP,
      "api-version": "7.0",
    },
    { authAlias },
  );
  const matches = (data.value ?? []).filter(
    policy => policyMatchesIdentity(policy, repositoryId, branch, buildDefinitionId),
  );
  if (matches.length > 1) {
    const ids = matches.map(policy => policy.id).filter(Boolean).join(", ");
    throw new Error(
      `Há múltiplas Build Validation policies para o mesmo repositório, branch e pipeline (${ids}). Consolide-as antes do upsert.`,
    );
  }
  if (!matches.length) return null;

  const existing = await tfsGet(
    `/policy/configurations/${matches[0].id}`,
    { "api-version": "7.0" },
    { authAlias },
  );
  const scopes = existing.settings?.scope ?? [];
  if (scopes.length !== 1 || !scopeMatches(scopes[0], repositoryId, branch)) {
    throw new Error(
      `A policy ${existing.id} também cobre outros escopos. Separe os escopos antes do upsert para evitar alterações indiretas.`,
    );
  }
  if (existing.isEnterpriseManaged) {
    throw new Error(`A policy ${existing.id} é gerenciada corporativamente e não pode ser alterada por esta tool.`);
  }
  return existing;
}

function isAmbiguousWriteError(error) {
  return AMBIGUOUS_WRITE_STATUS.has(Number(error?.status ?? 0));
}

function assertPolicyMatchesDesired(policy, desiredPayload) {
  const drift = buildBranchPolicyChangeSummary(policy, desiredPayload).changedFields;
  if (drift.length) {
    throw new Error(
      `A policy ${policy.id} foi relida com estado diferente do solicitado nos campos: ${drift.join(", ")}. `
      + "A reconciliação foi interrompida para evitar sobrescrever uma alteração concorrente.",
    );
  }
}

async function readDesiredPolicy({
  repositoryId,
  branch,
  buildDefinitionId,
  desiredPayload,
  authAlias,
}) {
  const policy = await findExistingPolicy({
    repositoryId,
    branch,
    buildDefinitionId,
    authAlias,
  });
  if (!policy) return null;
  assertPolicyMatchesDesired(policy, desiredPayload);
  return policy;
}

function policyWebUrl(repositoryId, branch) {
  const encodedBranch = encodeURIComponent(branch);
  return buildProjectUrl(`/_settings/repositories?repo=${encodeURIComponent(repositoryId)}&refName=${encodedBranch}&view=policies`);
}

function unchangedPolicyResponse(plan, controls, existing) {
  const assessment = { willMutate: false, blockReasons: [] };
  const result = {
    policyId: existing.id,
    revision: existing.revision,
    unchanged: true,
  };
  const correlationId = auditMutationPlan({
    plan,
    assessment,
    status: "unchanged",
    result,
  });
  return {
    ...result,
    correlationId,
    dryRun: controls.dryRun,
    willMutate: false,
    mutationPlan: plan,
  };
}

export async function toolUpsertBuildValidationPolicy(args) {
  const input = UpsertBuildValidationPolicyArgs.parse(args);
  const controls = normalizeMutationControls(input);
  const context = getRequestContext();
  const authAlias = context.authAlias;
  const repository = await resolveRepository(input.repository ?? TFS_REPO, authAlias);
  const branch = normalizePolicyBranch(input.branch, input.branch_match_kind);
  const exactBranchRef = input.branch_match_kind === "exact"
    ? await requireExactBranchRef(repository.id, branch, authAlias)
    : null;
  const definition = await resolveBuildDefinition({
    id: input.build_definition_id,
    name: input.build_definition_name,
    authAlias,
  });
  const definitionContext = validateBuildDefinition(
    definition,
    repository,
    input.allow_cross_repository,
    { requireEnabled: input.enabled },
  );
  const filenamePatterns = normalizeFilenamePatterns(input.filename_patterns);
  const displayName = input.display_name ?? definition.name;
  const identity = policyIdentityKey(repository.id, branch, definition.id);

  return withPolicyIdentityLock(identity, async () => {
    const revalidateWriteDependencies = async () => {
      const freshDefinition = await resolveBuildDefinition({
        id: definition.id,
        authAlias,
      });
      const freshDefinitionContext = validateBuildDefinition(
        freshDefinition,
        repository,
        input.allow_cross_repository,
        { requireEnabled: input.enabled },
      );
      assertBuildDefinitionUnchanged(
        definition,
        definitionContext,
        freshDefinition,
        freshDefinitionContext,
      );
      if (input.branch_match_kind === "exact") {
        await requireExactBranchRef(repository.id, branch, authAlias);
      }
    };

    const existing = await findExistingPolicy({
      repositoryId: repository.id,
      branch,
      buildDefinitionId: definition.id,
      authAlias,
    });
    const makePayload = existingPolicy => buildBuildValidationPolicyPayload({
      existing: existingPolicy,
      repositoryId: repository.id,
      branch,
      branchMatchKind: input.branch_match_kind,
      buildDefinitionId: definition.id,
      displayName,
      filenamePatterns,
      enabled: input.enabled,
      blocking: input.blocking,
      manualQueueOnly: input.manual_queue_only,
      queueOnSourceUpdateOnly: input.queue_on_source_update_only,
      validDuration: input.valid_duration,
    });
    const payload = makePayload(existing);
    const changes = buildBranchPolicyChangeSummary(existing, payload);
    const hasChanges = changes.changedFields.length > 0;
    const detectedImpact = detectHighImpact(
      repository.name,
      branch,
      displayName,
      filenamePatterns,
    );
    const prefixScope = input.branch_match_kind === "prefix";
    const highImpact = detectedImpact.highImpact
      || definitionContext.crossRepository
      || prefixScope;
    const highImpactMatch = detectedImpact.match
      ?? (definitionContext.crossRepository
        ? "cross-repository"
        : (prefixScope ? "prefix-scope" : null));
    const shortBranch = branch.replace(/^refs\/heads\//, "");
    const confirmation = existing ? String(existing.id) : shortBranch;
    const plan = buildMutationPlan({
      tool: "tfs_branch_policy_upsert",
      target: {
        policyId: existing?.id ?? null,
        repository: repository.name,
        repositoryId: repository.id,
        branch,
        branchMatchKind: input.branch_match_kind,
        exactBranchVerified: Boolean(exactBranchRef),
        buildDefinitionId: definition.id,
        buildDefinitionName: definition.name,
        buildDefinitionQueueStatus: definitionContext.queueStatus,
        buildDefinitionRepositoryId: definitionContext.repositoryId,
        buildDefinitionRepositoryName: definitionContext.repositoryName,
        buildDefinitionRepositoryType: definitionContext.repositoryType,
        crossRepository: definitionContext.crossRepository,
        crossRepositoryAllowed: input.allow_cross_repository,
      },
      operation: existing
        ? (hasChanges ? "update Build Validation branch policy" : "keep Build Validation branch policy unchanged")
        : "create Build Validation branch policy",
      changes,
      controls,
      confirmationRequired: hasChanges,
      highImpact,
      highImpactMatch,
      highImpactConfirmation: confirmation,
      authAlias,
      repo: repository.name,
    });

    if (!hasChanges && existing) return unchangedPolicyResponse(plan, controls, existing);

    return executeGuardedMutation({
      plan,
      controls,
      apply: async () => {
        let persisted;
        let reconciled = false;

        if (existing) {
          const fresh = await findExistingPolicy({
            repositoryId: repository.id,
            branch,
            buildDefinitionId: definition.id,
            authAlias,
          });
          if (!fresh) {
            throw new Error(
              `A policy ${existing.id} deixou de existir antes da atualização. Gere uma nova prévia.`,
            );
          }
          if (
            String(fresh.id) !== String(existing.id)
            || Number(fresh.revision) !== Number(existing.revision)
          ) {
            throw new Error(
              `A policy ${existing.id} mudou da revisão ${existing.revision} para ${fresh.revision} antes da atualização. `
              + "Gere uma nova prévia para não sobrescrever uma alteração concorrente.",
            );
          }

          await revalidateWriteDependencies();
          const freshPayload = makePayload(fresh);
          try {
            await tfsPut(
              `/policy/configurations/${fresh.id}`,
              freshPayload,
              { "api-version": "7.0" },
              { authAlias, retry: false },
            );
          } catch (error) {
            if (error?.status === 409 || error?.status === 412) {
              const conflict = new Error(
                `O TFS recusou a atualização da policy ${fresh.id} por conflito de concorrência (${error.status}). `
                + "Gere uma nova prévia.",
              );
              conflict.status = error.status;
              conflict.cause = error;
              throw conflict;
            }
            if (!isAmbiguousWriteError(error)) throw error;
            persisted = await readDesiredPolicy({
              repositoryId: repository.id,
              branch,
              buildDefinitionId: definition.id,
              desiredPayload: freshPayload,
              authAlias,
            });
            if (!persisted) throw error;
            reconciled = true;
          }

          if (!persisted) {
            persisted = await readDesiredPolicy({
              repositoryId: repository.id,
              branch,
              buildDefinitionId: definition.id,
              desiredPayload: freshPayload,
              authAlias,
            });
            if (!persisted) {
              throw new Error(
                `O TFS respondeu à atualização da policy ${fresh.id}, mas a releitura não confirmou o estado solicitado.`,
              );
            }
          }
        } else {
          await revalidateWriteDependencies();
          try {
            await tfsPost(
              "/policy/configurations",
              payload,
              { "api-version": "7.0" },
              { authAlias },
            );
          } catch (error) {
            if (!isAmbiguousWriteError(error)) throw error;
            persisted = await readDesiredPolicy({
              repositoryId: repository.id,
              branch,
              buildDefinitionId: definition.id,
              desiredPayload: payload,
              authAlias,
            });
            if (!persisted) throw error;
            reconciled = true;
          }

          if (!persisted) {
            persisted = await readDesiredPolicy({
              repositoryId: repository.id,
              branch,
              buildDefinitionId: definition.id,
              desiredPayload: payload,
              authAlias,
            });
            if (!persisted) {
              throw new Error(
                "O TFS respondeu à criação da Build Validation policy, mas a releitura não confirmou o estado solicitado.",
              );
            }
          }
        }

        return {
          policyId: persisted.id,
          revision: persisted.revision,
          repository: repository.name,
          branch,
          buildDefinitionId: definition.id,
          buildDefinitionName: definition.name,
          created: !existing,
          updated: Boolean(existing),
          unchanged: false,
          reconciled,
          url: policyWebUrl(repository.id, branch),
        };
      },
    });
  });
}
