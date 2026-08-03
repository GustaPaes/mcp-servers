/**
 * tools/pipeline.js — Publicação e execução segura de pipelines YAML.
 */
import { z } from "zod";
import { TFS_COLLECTION, TFS_PROJECT, TFS_REPO, TFS_URL } from "../config.js";
import { getRequestContext } from "../request-context.js";
import {
  buildMutationPlan,
  detectHighImpact,
  executeGuardedMutation,
  normalizeMutationControls,
} from "../safety.js";
import { tfsGet, tfsPost, tfsPut } from "../tfs-client.js";

const MAX_PIPELINE_VARIABLES = 100;
const MAX_TEMPLATE_PARAMETERS_BYTES = 64 * 1024;
const CiTriggerMode = z.enum(["preserve", "yaml", "disabled"]);
const CI_TRIGGER_TYPES = new Set([
  "continuousIntegration",
  "batchedContinuousIntegration",
]);
const PipelineVariableValue = z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
]);

const MutationInput = {
  dry_run: z.boolean().default(true),
  confirm: z.boolean().optional(),
  reason: z.string().optional(),
  requestedBy: z.string().optional(),
  requested_by: z.string().optional(),
  confirm_high_impact: z.string().optional(),
};

const UpsertPipelineArgs = z.object({
  name: z.string().trim().min(1),
  yaml_path: z.string().trim().min(1),
  repository: z.string().trim().min(1).optional(),
  default_branch: z.string().trim().min(1).optional(),
  pool_name: z.string().trim().min(1).optional(),
  ci_trigger_mode: CiTriggerMode.default("preserve"),
  folder: z.string().trim().min(1).default("\\"),
  variables: z.record(PipelineVariableValue)
    .refine(value => Object.keys(value).length <= MAX_PIPELINE_VARIABLES, {
      message: `Informe no máximo ${MAX_PIPELINE_VARIABLES} variáveis`,
    })
    .default({}),
  ...MutationInput,
});

const QueuePipelineArgs = z.object({
  definition_id: z.number().int().positive().optional(),
  definition_name: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1).optional(),
  template_parameters: z.record(z.unknown())
    .refine(value => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_TEMPLATE_PARAMETERS_BYTES, {
      message: `template_parameters deve ter no máximo ${MAX_TEMPLATE_PARAMETERS_BYTES} bytes`,
    })
    .default({}),
  variables: z.record(PipelineVariableValue)
    .refine(value => Object.keys(value).length <= MAX_PIPELINE_VARIABLES, {
      message: `Informe no máximo ${MAX_PIPELINE_VARIABLES} variáveis`,
    })
    .default({}),
  ...MutationInput,
}).refine(value => value.definition_id || value.definition_name, {
  message: "Informe definition_id ou definition_name",
});

function normalizeBranch(branch) {
  return branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
}

function normalizeYamlPath(yamlPath) {
  const normalized = yamlPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (!normalized || segments.some(segment => segment === "." || segment === "..")) {
    throw new Error("yaml_path deve apontar para um arquivo dentro do repositório.");
  }
  if (!/\.ya?ml$/i.test(normalized)) {
    throw new Error("yaml_path deve terminar em .yml ou .yaml.");
  }
  return normalized;
}

function normalizeVariables(variables) {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value: String(value), isSecret: false }]),
  );
}

function applyCiTriggerMode(payload, mode) {
  if (mode === "preserve") return;

  const nonCiTriggers = (payload.triggers ?? []).filter(
    trigger => !CI_TRIGGER_TYPES.has(trigger.triggerType),
  );

  if (mode === "disabled") {
    payload.triggers = nonCiTriggers;
    return;
  }

  if (mode === "yaml") {
    payload.triggers = [
      ...nonCiTriggers,
      {
        branchFilters: [],
        pathFilters: [],
        settingsSourceType: 2,
        batchChanges: false,
        maxConcurrentBuildsPerBranch: 1,
        triggerType: "continuousIntegration",
      },
    ];
    return;
  }

  throw new Error(`Modo de gatilho CI não suportado: ${mode}`);
}

export function buildYamlDefinitionPayload({
  existing,
  name,
  yamlPath,
  repository,
  defaultBranch,
  queue,
  folder,
  variables,
  ciTriggerMode = "preserve",
}) {
  const payload = {
    ...(existing ?? {}),
    name,
    path: folder,
    type: "build",
    queueStatus: "enabled",
    queue: {
      id: queue.id,
      name: queue.name,
      pool: queue.pool ? { id: queue.pool.id, name: queue.pool.name } : undefined,
    },
    process: {
      type: 2,
      yamlFilename: normalizeYamlPath(yamlPath),
    },
    repository: {
      ...(existing?.repository ?? {}),
      id: repository.id,
      name: repository.name,
      type: repository.type ?? "TfsGit",
      defaultBranch: normalizeBranch(defaultBranch),
      clean: "true",
      checkoutSubmodules: false,
    },
    variables: {
      ...(existing?.variables ?? {}),
      ...normalizeVariables(variables),
    },
  };

  delete payload._links;
  delete payload.url;
  delete payload.uri;
  applyCiTriggerMode(payload, ciTriggerMode);
  return payload;
}

async function resolveRepository(selector, authAlias) {
  const data = await tfsGet("/git/repositories", {}, { authAlias });
  const normalized = String(selector).toLowerCase();
  const repository = (data.value ?? []).find(
    item => String(item.id).toLowerCase() === normalized || item.name?.toLowerCase() === normalized,
  );
  if (!repository) throw new Error(`Repositório '${selector}' não encontrado no projeto configurado.`);
  return repository;
}

async function resolveQueue(poolName, authAlias) {
  const data = await tfsGet("/distributedtask/queues", {}, { authAlias });
  const queues = data.value ?? [];
  const queue = poolName
    ? queues.find(item => item.name?.toLowerCase() === poolName.toLowerCase())
    : queues.find(item => item.pool?.isHosted === false) ?? queues[0];
  if (!queue) throw new Error(poolName ? `Pool/fila '${poolName}' não encontrado.` : "Nenhuma fila de agente encontrada.");
  return queue;
}

async function findDefinitionByName(name, authAlias) {
  const data = await tfsGet("/build/definitions", { name, "$top": 100 }, { authAlias });
  return (data.value ?? []).find(item => item.name?.toLowerCase() === name.toLowerCase()) ?? null;
}

async function resolveDefinition({ definitionId, definitionName, authAlias }) {
  if (definitionId) return tfsGet(`/build/definitions/${definitionId}`, {}, { authAlias });
  const definition = await findDefinitionByName(definitionName, authAlias);
  if (!definition) throw new Error(`Pipeline '${definitionName}' não encontrada.`);
  return tfsGet(`/build/definitions/${definition.id}`, {}, { authAlias });
}

function pipelineWebUrl(definitionId) {
  return `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_build?definitionId=${definitionId}`;
}

export async function toolUpsertYamlPipeline(args) {
  const input = UpsertPipelineArgs.parse(args);
  const controls = normalizeMutationControls(input);
  const context = getRequestContext();
  const authAlias = context.authAlias;
  const repository = await resolveRepository(input.repository ?? TFS_REPO, authAlias);
  const queue = await resolveQueue(input.pool_name, authAlias);
  const existingSummary = await findDefinitionByName(input.name, authAlias);
  const existing = existingSummary
    ? await tfsGet(`/build/definitions/${existingSummary.id}`, {}, { authAlias })
    : null;
  const defaultBranch = normalizeBranch(
    input.default_branch ?? repository.defaultBranch ?? "refs/heads/main",
  );
  const payload = buildYamlDefinitionPayload({
    existing,
    name: input.name,
    yamlPath: input.yaml_path,
    repository,
    defaultBranch,
    queue,
    folder: input.folder,
    variables: input.variables,
    ciTriggerMode: input.ci_trigger_mode,
  });
  const impact = detectHighImpact(input.name, input.yaml_path, defaultBranch, input.folder);
  const confirmation = existing ? String(existing.id) : input.name;
  const plan = buildMutationPlan({
    tool: "tfs_pipeline_upsert",
    target: {
      definitionId: existing?.id ?? null,
      name: input.name,
      repository: repository.name,
      defaultBranch,
    },
    operation: existing ? "update YAML pipeline definition" : "create YAML pipeline definition",
    changes: {
      yamlPath: normalizeYamlPath(input.yaml_path),
      pool: queue.name,
      folder: input.folder,
      ciTriggerMode: input.ci_trigger_mode,
      nonSecretVariables: Object.keys(input.variables),
    },
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: confirmation,
    authAlias,
    repo: repository.name,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const result = existing
        ? await tfsPut(`/build/definitions/${existing.id}`, payload, {}, { authAlias })
        : await tfsPost("/build/definitions", payload, {}, { authAlias });
      return {
        definitionId: result.id,
        name: result.name,
        revision: result.revision,
        yamlPath: result.process?.yamlFilename ?? normalizeYamlPath(input.yaml_path),
        ciTriggerMode: input.ci_trigger_mode,
        url: pipelineWebUrl(result.id),
        created: !existing,
      };
    },
  });
}

export async function toolQueuePipeline(args) {
  const input = QueuePipelineArgs.parse(args);
  const controls = normalizeMutationControls(input);
  const context = getRequestContext();
  const authAlias = context.authAlias;
  const definition = await resolveDefinition({
    definitionId: input.definition_id,
    definitionName: input.definition_name,
    authAlias,
  });
  const branch = normalizeBranch(
    input.branch ?? definition.repository?.defaultBranch ?? "refs/heads/main",
  );
  const impact = detectHighImpact(definition.name, branch);
  const plan = buildMutationPlan({
    tool: "tfs_pipeline_queue",
    target: { definitionId: definition.id, name: definition.name, branch },
    operation: "queue pipeline run",
    changes: {
      templateParameterNames: Object.keys(input.template_parameters),
      nonSecretVariables: Object.keys(input.variables),
    },
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: String(definition.id),
    authAlias,
    repo: definition.repository?.name,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const result = await tfsPost(
        "/build/builds",
        {
          definition: { id: definition.id },
          sourceBranch: branch,
          templateParameters: input.template_parameters,
          parameters: JSON.stringify(input.template_parameters),
          variables: normalizeVariables(input.variables),
        },
        {},
        { authAlias },
      );
      return {
        buildId: result.id,
        buildNumber: result.buildNumber,
        status: result.status,
        definitionId: definition.id,
        definitionName: definition.name,
        branch: result.sourceBranch ?? branch,
        url: result._links?.web?.href ?? `${pipelineWebUrl(definition.id)}&buildId=${result.id}`,
      };
    },
  });
}
