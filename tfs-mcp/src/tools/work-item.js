/**
 * tools/work-item.js — Ferramentas de work item: leitura, análise, query,
 * criação (NOVO) e atualização.
 */
import { z } from "zod";
import { tfsGet, tfsPost, tfsJsonPatch } from "../tfs-client.js";
import {
  TFS_PROJECT,
  TFS_URL,
  TFS_COLLECTION,
  TFS_WORK_ITEM_PROFILE_FIELDS,
  TFS_ISSUE_ANALYSIS_FIELD,
  TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD,
  getConfiguredWorkItemProfile,
} from "../config.js";
import {
  validateCustomFields,
  validateFieldReferenceName,
} from "../work-item-profile.js";
import { buildActivityTemplate, parseBusinessDescription } from "../activity-template.js";
import { enrichActivityInputWithSpecialists } from "../specialists.js";
import { getRequestContext } from "../request-context.js";
import {
  buildMutationPlan,
  detectHighImpact,
  executeGuardedMutation,
  normalizeMutationControls,
} from "../safety.js";
import {
  formatWorkItem,
  normalizeWorkItemId,
  escapeWiql,
  normalizeState,
  asArray,
  autoDecodeRichText,
  getWorkItemRichTextContent,
} from "../formatters.js";
import {
  calculateDescriptionQuality,
  extractMissingWorkItemElements,
  isUserStoryFormat,
  hasGivenWhenThenFormat,
  hasAcceptanceCriteria,
  isActiveState,
} from "../analytics.js";

// ─── Zod schemas ───────────────────────────────────────────────────────────

const zId = z.union([z.number(), z.string()]);

const QueryArgs = z.object({
  preset: z.enum(["sprint", "my_tasks", "active_pbis", "bugs", "user_stories", "active_tasks"]).optional(),
  wiql: z.string().optional(),
  search: z.string().optional(),
  ids: z.string().optional(),
  state: z.string().optional(),
  work_item_type: z.string().optional(),
  assigned_to: z.string().optional(),
  area_path: z.string().optional(),
  iteration_path: z.string().optional(),
  top: z.number().int().min(1).max(200).default(30),
});

const UpdateArgs = z.object({
  id: z.number().int().positive(),
  state: z.string().optional(),
  assigned_to: z.string().optional(),
  comment: z.string().optional(),
  title: z.string().optional(),
  story_points: z.number().positive().optional(),
  description: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  business_acceptance_criteria: z.string().optional(),
  custom_fields: z.record(z.unknown()).optional(),
  remove_fields: z.array(z.string().min(1)).optional(),
  dry_run: z.boolean().default(true),
  confirm: z.boolean().optional(),
  reason: z.string().optional(),
  requestedBy: z.string().optional(),
  requested_by: z.string().optional(),
  confirm_high_impact: z.string().optional(),
});

const IssueAnalysisArgs = z.object({
  id: z.number().int().positive(),
  development_analysis: z.string().trim().min(1),
  correction_and_impacts: z.string().optional(),
  dry_run: z.boolean().default(true),
  confirm: z.boolean().optional(),
  reason: z.string().optional(),
  requestedBy: z.string().optional(),
  requested_by: z.string().optional(),
  confirm_high_impact: z.string().optional(),
});

export const ISSUE_ANALYSIS_FIELDS = Object.freeze({
  developmentAnalysis: TFS_ISSUE_ANALYSIS_FIELD,
  correctionAndImpacts: TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD,
});

export function buildIssueAnalysisPatch(
  { developmentAnalysis, correctionAndImpacts },
  fields = ISSUE_ANALYSIS_FIELDS
) {
  const analysis = String(developmentAnalysis ?? "").trim();
  if (!analysis) throw new Error("development_analysis é obrigatório para registrar a análise da issue.");
  if (!fields.developmentAnalysis)
    throw new Error("Configure TFS_ISSUE_ANALYSIS_FIELD para usar a atualização de análise de Issue.");

  const ops = [
    {
      op: "add",
      path: `/fields/${fields.developmentAnalysis}`,
      value: autoDecodeRichText(analysis),
    },
  ];

  if (correctionAndImpacts !== undefined) {
    if (!fields.correctionAndImpacts)
      throw new Error(
        "Configure TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD para preencher correction_and_impacts."
      );
    ops.push({
      op: "add",
      path: `/fields/${fields.correctionAndImpacts}`,
      value: autoDecodeRichText(correctionAndImpacts),
    });
  }

  return ops;
}

const CreateArgs = z.object({
  work_item_type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  business_acceptance_criteria: z.string().optional(),
  assigned_to: z.string().optional(),
  area_path: z.string().optional(),
  iteration_path: z.string().optional(),
  story_points: z.number().positive().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  parent_id: z.number().int().positive().optional(),
  tags: z.string().optional(),
  custom_fields: z.record(z.unknown()).optional(),
  dry_run: z.boolean().default(true),
  confirm: z.boolean().optional(),
  reason: z.string().optional(),
  requestedBy: z.string().optional(),
  requested_by: z.string().optional(),
  confirm_high_impact: z.string().optional(),
});

const TemplateArgs = z.object({
  title: z.string().optional(),
  work_item_type: z.string().optional(),
  actor: z.string().optional(),
  intent: z.string().optional(),
  outcome: z.string().optional(),
  business_acceptance_criteria: z.array(z.string()).optional(),
  visual_definitions: z.string().optional(),
  technical_dependencies: z.string().optional(),
  technical_acceptance_criteria: z.array(z.string()).optional(),
  affected_locations: z.array(z.string()).optional(),
  estimated_changed_lines: z.number().int().min(0).optional(),
  detail_level: z.enum(["auto", "specific", "summary"]).default("auto"),
});

const TemplateFromItemsArgs = z.object({
  ids: z.array(z.union([z.number(), z.string()])).min(1),
  include_wiki: z.boolean().default(false),
  wiki_search: z.string().optional(),
  technical_dependencies: z.string().optional(),
  technical_acceptance_criteria: z.array(z.string()).optional(),
  affected_locations: z.array(z.string()).optional(),
  estimated_changed_lines: z.number().int().min(0).optional(),
  detail_level: z.enum(["auto", "specific", "summary"]).default("auto"),
});

// ─── Constants ─────────────────────────────────────────────────────────────

export const WI_FIELDS = [...new Set([
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.AssignedTo",
  "System.IterationPath",
  "System.AreaPath",
  "System.Tags",
  "System.Description",
  "Microsoft.VSTS.Common.AcceptanceCriteria",
  "Microsoft.VSTS.Scheduling.StoryPoints",
  "Microsoft.VSTS.Common.Priority",
  ...TFS_WORK_ITEM_PROFILE_FIELDS,
])].join(",");

function extractBusinessAcceptanceCriteria(description = "") {
  const content = autoDecodeRichText(description);
  const match = content.match(
    /<b>\s*Critérios de Aceite de Negócio\s*:<\/b>\s*(?:<br\s*\/?\s*>)?\s*(<ul>[\s\S]*?<\/ul>)/i
  );
  return match
    ? `<div><b>Critérios de Aceite de Negócio:</b></div><div>${match[1]}</div>`
    : "";
}

function extractUsNumber(title = "") {
  const match = String(title).match(/US[-\s]*(\d+)/i);
  return match ? String(Number(match[1])).padStart(3, "0") : "";
}

function buildWikiUsSearchVariants(title = "") {
  const usNumber = extractUsNumber(title);
  const normalizedTitle = String(title).replace(/[:]/g, " ").replace(/\s+/g, " ").trim();
  return [
    usNumber ? `US ${usNumber}` : "",
    usNumber ? `US-${Number(usNumber)}` : "",
    normalizedTitle,
  ].filter(Boolean);
}

function summarizePatchOps(ops) {
  return ops.map((op) => {
    const field = op.path.replace("/fields/", "");
    if (field === "/relations/-" || op.path === "/relations/-") {
      return { op: op.op, path: op.path, relation: op.value?.rel ?? "relation" };
    }
    const value = op.value;
    if (typeof value === "string") {
      return {
        op: op.op,
        field,
        valuePreview: value.length > 120 ? `${value.slice(0, 120)}...[truncated:${value.length}]` : value,
      };
    }
    return { op: op.op, field, value };
  });
}

function setFieldOperation(ops, field, value, op = "add") {
  const referenceName = validateFieldReferenceName(field);
  const path = `/fields/${referenceName}`;
  const operation = {
    op,
    path,
    ...(op === "remove" ? {} : { value }),
  };
  const existingIndex = ops.findIndex((item) => item.path === path);
  if (existingIndex >= 0) ops[existingIndex] = operation;
  else ops.push(operation);
}

function appendConfiguredFields(ops, fields, context) {
  for (const [field, rawValue] of Object.entries(validateCustomFields(fields, context))) {
    const value =
      typeof rawValue === "string" ? autoDecodeRichText(rawValue) : rawValue;
    setFieldOperation(ops, field, value);
  }
}

async function fetchWorkItemFieldMap(id) {
  const workItem = await fetchWorkItemById(id, "all");
  const content = getWorkItemRichTextContent(workItem);
  return {
    workItem,
    businessField: content.businessField,
    technicalField: content.technicalField,
  };
}

export const QUERY_PRESETS = {
  sprint: `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${TFS_PROJECT}'
    AND [System.IterationPath] = @CurrentIteration
    AND [System.State] <> 'Removed'
    ORDER BY [System.WorkItemType],[System.State]`,

  my_tasks: `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${TFS_PROJECT}'
    AND [System.IterationPath] = @CurrentIteration
    AND [System.AssignedTo] = @Me
    AND [System.State] <> 'Removed'
    ORDER BY [System.State]`,

  active_pbis: `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${TFS_PROJECT}'
    AND [System.WorkItemType] = 'Product Backlog Item'
    AND [System.State] NOT IN ('Closed','Removed','Done')
    ORDER BY [Microsoft.VSTS.Common.Priority],[System.ChangedDate] DESC`,

  bugs: `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${TFS_PROJECT}'
    AND [System.WorkItemType] = 'Bug'
    AND [System.State] NOT IN ('Closed','Removed')
    ORDER BY [Microsoft.VSTS.Common.Priority],[System.ChangedDate] DESC`,

  user_stories: `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${TFS_PROJECT}'
    AND [System.WorkItemType] = 'User Story'
    AND [System.State] <> 'Removed'
    ORDER BY [System.ChangedDate] DESC`,

  active_tasks: `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${TFS_PROJECT}'
    AND [System.WorkItemType] = 'Sprint Task'
    AND [System.State] NOT IN ('Closed','Removed','Done')
    ORDER BY [System.ChangedDate] DESC`,
};

// ─── Fetchers ──────────────────────────────────────────────────────────────

export async function fetchWorkItemById(id, expand = "all") {
  return tfsGet(`/wit/workitems/${normalizeWorkItemId(id)}`, { "$expand": expand });
}

export async function fetchWorkItemsBatch(ids, { includeRelations = false } = {}) {
  const normalized = asArray(ids).map(normalizeWorkItemId);
  if (!normalized.length) return [];
  if (includeRelations) {
    return Promise.all(normalized.map((id) => fetchWorkItemById(id, "all")));
  }
  const data = await tfsGet("/wit/workitems", {
    ids: normalized.join(","),
    fields: WI_FIELDS,
  });
  return data.value ?? [];
}

export function extractArtifactLinks(workItem) {
  return (workItem.relations ?? []).filter((r) => r.rel === "ArtifactLink");
}

export function extractPullRequestRefs(workItem) {
  return extractArtifactLinks(workItem)
    .filter((r) => /PullRequestId\//i.test(r.url ?? ""))
    .map((r) => {
      // parse: ...%2FprojectId%2Frepo%2FPullRequestId%2F123
      const m = r.url?.match(/PullRequestId\/([^/]+)%2[fF]([^/]+)%2[fF](\d+)/i);
      const numericMatch = r.url?.match(/_git\/([^/?#]+)\/pullrequest\/(\d+)/i);
      const simpleMatch = r.url?.match(/(\d+)$/);
      if (m) {
        return { id: Number(m[3]), repo: decodeURIComponent(m[2]), artifactUrl: r.url, name: r.attributes?.name ?? "Pull Request" };
      }
      if (numericMatch) {
        return { id: Number(numericMatch[2]), repo: numericMatch[1], artifactUrl: r.url, name: r.attributes?.name ?? "Pull Request" };
      }
      if (simpleMatch) {
        return { id: Number(simpleMatch[1]), repo: null, artifactUrl: r.url, name: r.attributes?.name ?? "Pull Request" };
      }
      return null;
    })
    .filter(Boolean);
}

export async function loadRelatedItems(workItem) {
  const RELATION_TYPES = new Set([
    "System.LinkTypes.Hierarchy-Forward",
    "System.LinkTypes.Hierarchy-Reverse",
    "System.LinkTypes.Related",
    "System.LinkTypes.Dependency-Forward",
    "System.LinkTypes.Dependency-Reverse",
  ]);

  const relationIds = (workItem.relations ?? [])
    .filter((r) => RELATION_TYPES.has(r.rel))
    .map((r) => {
      const m = r.url?.match(/\/(\d+)$/);
      return m?.[1] ? { id: Number(m[1]), linkType: r.rel } : null;
    })
    .filter(Boolean);

  if (!relationIds.length) return [];

  const uniqueIds = [...new Set(relationIds.map((i) => i.id))];
  const relatedItems = await fetchWorkItemsBatch(uniqueIds, { includeRelations: true });
  const linkMap = new Map(relationIds.map((i) => [i.id, i.linkType]));

  return relatedItems.map((item) => ({
    id: item.id,
    title: item.fields?.["System.Title"] ?? "",
    type: item.fields?.["System.WorkItemType"] ?? "",
    state: item.fields?.["System.State"] ?? "",
    assignedTo: item.fields?.["System.AssignedTo"]?.displayName ?? "Unassigned",
    linkType: linkMap.get(item.id) ?? null,
    url:
      item._links?.html?.href ??
      `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_workitems/edit/${item.id}`,
  }));
}

function buildChecklist({ description, acceptanceCriteria, relatedItems }) {
  const checklist = [
    "Verificar se todos os criterios de aceite estao claros",
    "Confirmar se ha dependencias tecnicas nao documentadas",
    "Validar estimativa com a complexidade real",
  ];
  const blockedItems = relatedItems.filter((i) => !["Done", "Closed", "Resolved"].includes(i.state));
  if (blockedItems.length)
    checklist.push(`Verificar status de ${blockedItems.length} item(ns) relacionado(s) ainda em andamento`);
  if (!hasGivenWhenThenFormat(`${description} ${acceptanceCriteria}`))
    checklist.push("Definir cenarios de teste (Given/When/Then)");
  if (!hasAcceptanceCriteria(description, acceptanceCriteria))
    checklist.push("Documentar criterios de aceite detalhados");
  return checklist;
}

// ─── Tools ────────────────────────────────────────────────────────────────

export async function toolWorkItem(args) {
  const { id, include_fields } = z
    .object({
      id: zId,
      include_fields: z.boolean().default(false),
    })
    .parse(args);
  const wi = await fetchWorkItemById(id, "all");
  const formatted = formatWorkItem(wi);
  return include_fields ? { ...formatted, fields: wi.fields ?? {} } : formatted;
}

export async function toolAnalyzeWorkItem(args) {
  const { id, include_related = true } = z
    .object({ id: zId, include_related: z.boolean().default(true) })
    .parse(args);

  const workItem = await fetchWorkItemById(id, "all");
  const formatted = formatWorkItem(workItem);
  const relatedItems = include_related ? await loadRelatedItems(workItem) : [];

  return {
    id: formatted.id,
    title: formatted.title,
    type: formatted.type,
    state: formatted.state,
    url: formatted.url,
    area: formatted.area,
    iteration: formatted.iteration,
    assignedTo: formatted.assignedTo,
    qualityScore: calculateDescriptionQuality({
      title: formatted.title,
      description: formatted.description,
      type: formatted.type,
      acceptanceCriteria: formatted.acceptanceCriteria,
    }),
    isUserStoryFormat: isUserStoryFormat(formatted.title, formatted.description),
    hasGivenWhenThen: hasGivenWhenThenFormat(`${formatted.description} ${formatted.acceptanceCriteria}`),
    hasAcceptanceCriteria: hasAcceptanceCriteria(formatted.description, formatted.acceptanceCriteria),
    missingElements: extractMissingWorkItemElements({
      title: formatted.title,
      description: formatted.description,
      type: formatted.type,
      acceptanceCriteria: formatted.acceptanceCriteria,
    }),
    checklist: buildChecklist({
      description: formatted.description,
      acceptanceCriteria: formatted.acceptanceCriteria,
      relatedItems,
    }),
    relatedItems,
    description: formatted.description,
    acceptanceCriteria: formatted.acceptanceCriteria,
  };
}

export async function toolWorkItemContext(args) {
  const {
    id,
    include_related = true,
    include_pull_requests = true,
    include_wiki = true,
    wiki_search,
  } = z
    .object({
      id: zId,
      include_related: z.boolean().default(true),
      include_pull_requests: z.boolean().default(true),
      include_wiki: z.boolean().default(true),
      wiki_search: z.string().optional(),
    })
    .parse(args);

  const { loadLinkedPullRequestsByItem } = await import("./pull-request.js");
  const { findWikiMatches } = await import("./infra.js");

  const workItem = await fetchWorkItemById(id, "all");
  const formatted = formatWorkItem(workItem);
  const analysis = await toolAnalyzeWorkItem({ id, include_related });
  const linkedPullRequests = include_pull_requests
    ? await loadLinkedPullRequestsByItem(workItem, 10)
    : [];
  const wikiMatches = include_wiki ? await findWikiMatches(wiki_search ?? formatted.title, 10) : [];

  return {
    workItem: formatted,
    analysis,
    linkedPullRequests,
    wikiMatches,
    artifacts: extractArtifactLinks(workItem).map((r) => ({
      name: r.attributes?.name ?? r.rel,
      url: r.url,
    })),
  };
}

export async function toolQueryWorkItems(args) {
  const parsed = QueryArgs.parse(args);
  const { preset, wiql, search, ids, state, work_item_type, assigned_to, area_path, iteration_path, top } = parsed;

  // Direct IDs batch
  if (ids) {
    const directItems = await fetchWorkItemsBatch(
      ids.split(",").map((s) => s.trim()).filter(Boolean)
    );
    return directItems.map(formatWorkItem);
  }

  let query = wiql;
  if (!query) {
    if (preset && QUERY_PRESETS[preset]) {
      query = QUERY_PRESETS[preset];
    } else {
      const filters = [
        `[System.TeamProject] = '${escapeWiql(TFS_PROJECT)}'`,
        `[System.State] <> 'Removed'`,
      ];
      if (search) filters.push(`[System.Title] CONTAINS '${escapeWiql(search)}'`);
      if (state) filters.push(`[System.State] = '${escapeWiql(normalizeState(state))}'`);
      if (work_item_type) filters.push(`[System.WorkItemType] = '${escapeWiql(work_item_type)}'`);
      if (assigned_to) filters.push(`[System.AssignedTo] CONTAINS '${escapeWiql(assigned_to)}'`);
      if (area_path) filters.push(`[System.AreaPath] UNDER '${escapeWiql(area_path)}'`);
      if (iteration_path)
        filters.push(`[System.IterationPath] UNDER '${escapeWiql(iteration_path)}'`);
      query = `SELECT [System.Id] FROM WorkItems WHERE ${filters.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;
    }
  }

  if (!query)
    throw new Error(
      `Preset desconhecido: ${preset}. Disponíveis: ${Object.keys(QUERY_PRESETS).join(", ")}`
    );

  const wiqlResult = await tfsPost("/wit/wiql", { query }, { "$top": top });
  const itemRefs =
    wiqlResult.workItems ??
    wiqlResult.workItemRelations?.map((r) => r.target).filter(Boolean) ??
    [];
  if (!itemRefs.length) return [];

  const batch = itemRefs
    .slice(0, top)
    .map((r) => r.id)
    .join(",");
  const data = await tfsGet("/wit/workitems", { ids: batch, fields: WI_FIELDS });
  return (data.value ?? []).map(formatWorkItem);
}

export async function toolUpdateWorkItem(args) {
  const parsed = UpdateArgs.parse(args);
  const {
    id,
    state,
    assigned_to,
    comment,
    title,
    story_points,
    description,
    acceptance_criteria,
    business_acceptance_criteria,
    custom_fields,
    remove_fields,
  } = parsed;
  const { workItem, businessField, technicalField } = await fetchWorkItemFieldMap(id);
  const ops = [];
  if (state) setFieldOperation(ops, "System.State", state);
  if (assigned_to) setFieldOperation(ops, "System.AssignedTo", assigned_to);
  if (title) setFieldOperation(ops, "System.Title", title);
  if (description !== undefined) {
    const value = autoDecodeRichText(description);
    setFieldOperation(ops, "System.Description", value);
    if (businessField !== "System.Description")
      setFieldOperation(ops, businessField, value);
  }
  if (acceptance_criteria !== undefined)
    setFieldOperation(
      ops,
      technicalField,
      autoDecodeRichText(acceptance_criteria)
    );
  if (business_acceptance_criteria !== undefined)
    setFieldOperation(
      ops,
      "Microsoft.VSTS.Common.AcceptanceCriteria",
      autoDecodeRichText(business_acceptance_criteria)
    );
  if (story_points)
    setFieldOperation(ops, "Microsoft.VSTS.Scheduling.StoryPoints", story_points);
  if (comment) setFieldOperation(ops, "System.History", comment);

  appendConfiguredFields(ops, custom_fields, "custom_fields");
  for (const field of remove_fields ?? []) {
    setFieldOperation(
      ops,
      validateFieldReferenceName(field, `remove_fields.${field}`),
      undefined,
      "remove"
    );
  }

  if (!ops.length)
    throw new Error(
      "Nenhum campo para atualizar. Forneça um campo padrão, custom_fields ou remove_fields."
    );

  const formatted = formatWorkItem(workItem);
  const controls = normalizeMutationControls(parsed);
  const impact = detectHighImpact(
    formatted.title,
    formatted.area,
    formatted.iteration,
    formatted.tags,
    state,
    title,
    assigned_to,
    ops.map((op) => op.value)
  );
  const context = getRequestContext();
  const plan = buildMutationPlan({
    tool: "tfs_update_work_item",
    target: {
      id,
      title: formatted.title,
      state: formatted.state,
      area: formatted.area,
      iteration: formatted.iteration,
      url: formatted.url,
    },
    operation: "update work item fields",
    changes: summarizePatchOps(ops),
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: String(id),
    authAlias: context.authAlias,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const wi = await tfsJsonPatch("PATCH", `/wit/workitems/${id}`, ops);
      const f = wi.fields ?? {};
      return {
        id: wi.id,
        title: f["System.Title"],
        state: f["System.State"],
        assignedTo: f["System.AssignedTo"]?.displayName,
        updated: ops.map((o) => o.path.replace("/fields/", "")),
        url: wi._links?.html?.href,
      };
    },
  });
}

export async function toolUpdateIssueAnalysis(args) {
  const parsed = IssueAnalysisArgs.parse(args);
  const { id, development_analysis, correction_and_impacts } = parsed;
  const { workItem } = await fetchWorkItemFieldMap(id);
  const workItemType = String(workItem.fields?.["System.WorkItemType"] ?? "").trim();

  if (workItemType.toLowerCase() !== "issue")
    throw new Error(`O item ${id} é do tipo '${workItemType || "desconhecido"}'. Esta tool aceita somente Issue.`);

  const ops = buildIssueAnalysisPatch({
    developmentAnalysis: development_analysis,
    correctionAndImpacts: correction_and_impacts,
  });
  const formatted = formatWorkItem(workItem);
  const controls = normalizeMutationControls(parsed);
  const impact = detectHighImpact(
    formatted.title,
    formatted.area,
    formatted.iteration,
    formatted.tags,
    ops.map((op) => op.value)
  );
  const context = getRequestContext();
  const plan = buildMutationPlan({
    tool: "tfs_update_issue_analysis",
    target: {
      id,
      title: formatted.title,
      state: formatted.state,
      area: formatted.area,
      iteration: formatted.iteration,
      url: formatted.url,
    },
    operation: "update issue development analysis",
    changes: summarizePatchOps(ops),
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: String(id),
    authAlias: context.authAlias,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const wi = await tfsJsonPatch("PATCH", `/wit/workitems/${id}`, ops);
      return {
        id: wi.id,
        title: wi.fields?.["System.Title"],
        state: wi.fields?.["System.State"],
        updated: ops.map((op) => op.path.replace("/fields/", "")),
        url: wi._links?.html?.href,
      };
    },
  });
}

export async function toolGenerateActivityTemplate(args) {
  const parsed = TemplateArgs.parse(args ?? {});
  const specialist = enrichActivityInputWithSpecialists({
    title: parsed.title,
    workItemType: parsed.work_item_type,
    businessAcceptanceCriteria: parsed.business_acceptance_criteria,
    technicalDependencies: parsed.technical_dependencies,
    technicalAcceptanceCriteria: parsed.technical_acceptance_criteria,
    affectedLocations: parsed.affected_locations,
    estimatedChangedLines: parsed.estimated_changed_lines,
  });
  const template = buildActivityTemplate({
    title: parsed.title,
    workItemType: parsed.work_item_type,
    actor: parsed.actor,
    intent: parsed.intent,
    outcome: parsed.outcome,
    businessAcceptanceCriteria: specialist.businessAcceptanceCriteria,
    visualDefinitions: parsed.visual_definitions,
    technicalDependencies: parsed.technical_dependencies,
    technicalAcceptanceCriteria: specialist.technicalAcceptanceCriteria,
    affectedLocations: parsed.affected_locations,
    estimatedChangedLines: parsed.estimated_changed_lines,
    detailLevel: parsed.detail_level,
  });
  return {
    ...template,
    specialistReview: specialist.review,
  };
}

export async function toolGenerateActivityTemplateFromItems(args) {
  const parsed = TemplateFromItemsArgs.parse(args ?? {});
  const items = await fetchWorkItemsBatch(parsed.ids, { includeRelations: true });
  const { findWikiMatchesDeep, getWikiPageWithChildren } = await import("./infra.js");

  const generated = await Promise.all(
    items.map(async (item) => {
      const title = item.fields?.["System.Title"] ?? "";
      const businessSource = getWorkItemRichTextContent(item).description;
      const business = parseBusinessDescription(businessSource, title);
      const wikiMatches = parsed.include_wiki
        ? await findWikiMatchesDeep(parsed.wiki_search ?? title, 10).catch(() => [])
        : [];
      const wikiChildren = parsed.include_wiki
        ? await getWikiPageWithChildren("/Analises/CNPJ e CPF em texto/Atividades", 100).catch(() => [])
        : [];
      const wikiUsVariants = buildWikiUsSearchVariants(title);
      const matchedWikiChildren = wikiChildren.filter((page) =>
        wikiUsVariants.some((variant) => page.path?.toLowerCase().includes(variant.toLowerCase()))
      );

      const baseTechnicalCriteria = [
        ...(parsed.technical_acceptance_criteria ?? []),
        ...(wikiMatches.length
          ? [`Deve considerar como apoio técnico os artefatos/documentações relacionados encontrados na wiki para detalhar a implementação.`]
          : []),
        ...(matchedWikiChildren.length
          ? [`Deve alinhar a implementação com o detalhamento técnico correspondente da wiki, adaptando a escrita sem copiar literalmente o conteúdo.`]
          : []),
      ];

      const affectedLocations = [
        ...(parsed.affected_locations ?? []),
        ...wikiMatches.map((match) => match.url).slice(0, 3),
        ...matchedWikiChildren.map((page) => page.url).slice(0, 2),
      ];
      const specialist = enrichActivityInputWithSpecialists({
        title,
        workItemType: item.fields?.["System.WorkItemType"] ?? "",
        description: businessSource,
        businessAcceptanceCriteria: business.businessAcceptanceCriteria,
        technicalDependencies: parsed.technical_dependencies,
        technicalAcceptanceCriteria: baseTechnicalCriteria,
        affectedLocations,
        estimatedChangedLines: parsed.estimated_changed_lines,
        tags: item.fields?.["System.Tags"] ?? "",
        areaPath: item.fields?.["System.AreaPath"] ?? "",
      });

      return {
        id: item.id,
        title,
        workItemType: item.fields?.["System.WorkItemType"] ?? "",
        template: buildActivityTemplate({
          title,
          workItemType: item.fields?.["System.WorkItemType"] ?? "",
          actor: business.actor,
          intent: business.intent,
          outcome: business.outcome,
          businessAcceptanceCriteria: specialist.businessAcceptanceCriteria,
          visualDefinitions: business.visualDefinitions,
          technicalDependencies: parsed.technical_dependencies,
          technicalAcceptanceCriteria: specialist.technicalAcceptanceCriteria,
          affectedLocations,
          estimatedChangedLines: parsed.estimated_changed_lines,
          detailLevel: parsed.detail_level,
        }),
        specialistReview: specialist.review,
        wikiMatches,
        wikiChildren: matchedWikiChildren,
      };
    })
  );

  return {
    total: generated.length,
    items: generated,
  };
}

/**
 * tfs_work_item_create — Cria um novo work item no TFS.
 * Usa a API json-patch+json onde o tipo vai na URL: /wit/workitems/$User%20Story
 */
export async function toolCreateWorkItem(args) {
  const {
    work_item_type,
    title,
    description,
    acceptance_criteria,
    business_acceptance_criteria,
    assigned_to,
    area_path,
    iteration_path,
    story_points,
    priority,
    parent_id,
    tags,
    custom_fields,
  } = CreateArgs.parse(args);

  const profile = getConfiguredWorkItemProfile(work_item_type);
  const businessField = profile.businessField ?? "System.Description";
  const technicalField =
    profile.technicalField ?? "Microsoft.VSTS.Common.AcceptanceCriteria";
  const ops = [];

  appendConfiguredFields(
    ops,
    profile.defaults,
    `defaults do perfil '${work_item_type}'`
  );
  setFieldOperation(ops, "System.Title", title);
  if (description !== undefined) {
    const value = autoDecodeRichText(description);
    setFieldOperation(ops, "System.Description", value);
    if (businessField !== "System.Description")
      setFieldOperation(ops, businessField, value);
  }
  if (acceptance_criteria !== undefined)
    setFieldOperation(
      ops,
      technicalField,
      autoDecodeRichText(acceptance_criteria)
    );
  const businessAcceptance = business_acceptance_criteria !== undefined
    ? autoDecodeRichText(business_acceptance_criteria)
    : extractBusinessAcceptanceCriteria(description);
  if (businessAcceptance)
    setFieldOperation(
      ops,
      "Microsoft.VSTS.Common.AcceptanceCriteria",
      businessAcceptance
    );
  if (assigned_to)
    setFieldOperation(ops, "System.AssignedTo", assigned_to);
  if (area_path) setFieldOperation(ops, "System.AreaPath", area_path);
  if (iteration_path)
    setFieldOperation(ops, "System.IterationPath", iteration_path);
  if (story_points)
    setFieldOperation(ops, "Microsoft.VSTS.Scheduling.StoryPoints", story_points);
  if (priority)
    setFieldOperation(ops, "Microsoft.VSTS.Common.Priority", priority);
  if (tags) setFieldOperation(ops, "System.Tags", tags);

  appendConfiguredFields(ops, custom_fields, "custom_fields");

  if (parent_id) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_apis/wit/workitems/${parent_id}`,
        attributes: { comment: "Parent link set on creation" },
      },
    });
  }

  const controls = normalizeMutationControls(args);
  const impact = detectHighImpact(work_item_type, title, area_path, iteration_path, tags);
  const context = getRequestContext();
  const plan = buildMutationPlan({
    tool: "tfs_work_item_create",
    target: {
      workItemType: work_item_type,
      title,
      areaPath: area_path ?? null,
      iterationPath: iteration_path ?? null,
      parentId: parent_id ?? null,
    },
    operation: "create work item",
    changes: summarizePatchOps(ops),
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: title,
    authAlias: context.authAlias,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const typeEncoded = encodeURIComponent(work_item_type);
      const wi = await tfsJsonPatch("POST", `/wit/workitems/$${typeEncoded}`, ops);
      const f = wi.fields ?? {};
      return {
        id: wi.id,
        type: f["System.WorkItemType"],
        title: f["System.Title"],
        state: f["System.State"],
        assignedTo: f["System.AssignedTo"]?.displayName ?? "Unassigned",
        iteration: f["System.IterationPath"],
        area: f["System.AreaPath"],
        url: wi._links?.html?.href ?? `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_workitems/edit/${wi.id}`,
        created: true,
      };
    },
  });
}
