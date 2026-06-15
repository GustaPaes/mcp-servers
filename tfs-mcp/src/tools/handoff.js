/**
 * tools/handoff.js — Ferramentas de handoff: passagem de bastão e refinamento de work items.
 */
import { z } from "zod";
import { tfsGet } from "../tfs-client.js";
import { formatWorkItem, normalizeWorkItemId } from "../formatters.js";
import { buildSpecialistReview } from "../specialists.js";
import {
  calculateDescriptionQuality,
  isUserStoryFormat,
  hasGivenWhenThenFormat,
  hasAcceptanceCriteria,
  extractMissingWorkItemElements,
  inferWorkItemStage,
  buildBusinessContext,
  buildRoleChecklist,
  buildSuggestedHandoffComment,
  classifyRelatedItems,
  isActiveState,
} from "../analytics.js";
import {
  fetchWorkItemById,
  loadRelatedItems,
  extractPullRequestRefs,
  toolAnalyzeWorkItem,
} from "./work-item.js";
import { loadLinkedPullRequestsByItem } from "./pull-request.js";
import { findWikiMatches } from "./infra.js";

// ─── Refinement helpers ────────────────────────────────────────────────────

function estimateRefinementReadiness(workItem, relatedItems) {
  const f = workItem.fields ?? {};
  const description = f["example.DefinicoesDeNegocio"] ?? f["System.Description"] ?? "";
  const acceptanceCriteria = f["example.DefinicoesTecnicas"] ?? f["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? "";
  const title = f["System.Title"] ?? "";
  const type = f["System.WorkItemType"] ?? "";

  const qualityScore = calculateDescriptionQuality({
    title,
    description,
    type,
    acceptanceCriteria,
  });

  const hasParent = relatedItems.some((r) =>
    ["System.LinkTypes.Hierarchy-Reverse"].includes(r.linkType)
  );

  const blockedDeps = relatedItems.filter(
    (r) =>
      r.linkType === "System.LinkTypes.Dependency-Forward" &&
      !["Done", "Closed", "Resolved"].includes(r.state)
  );

  let score = qualityScore;
  if (hasParent) score += 10;
  if (!blockedDeps.length) score += 10;

  return {
    score: Math.min(score, 100),
    qualityScore,
    hasParent,
    blockedDeps: blockedDeps.length,
    readyForSprint: score >= 70,
  };
}

function buildRefinementQuestions(workItem, relatedItems) {
  const f = workItem.fields ?? {};
  const type = f["System.WorkItemType"] ?? "";
  const description = f["System.Description"] ?? "";
  const acceptanceCriteria = f["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? "";

  const questions = ["O escopo desta entrega está claro para todos do time?", "Há dependências externas que podem bloquear?"];

  if (!isUserStoryFormat(f["System.Title"] ?? "", description))
    questions.push("Quem é o usuário/persona que se beneficia desta feature?");
  if (!hasGivenWhenThenFormat(description + " " + acceptanceCriteria))
    questions.push("Quais são os cenários de teste (Given/When/Then)?");
  if (!hasAcceptanceCriteria(description, acceptanceCriteria))
    questions.push("Quais são os critérios de aceite mensuráveis?");
  if (relatedItems.length === 0)
    questions.push("Este item tem dependências com outros work items?");

  return questions;
}

function buildDefinitionOfReady() {
  return [
    "Descrição clara com contexto e objetivo",
    "Critérios de aceite definidos e verificáveis",
    "Estimativa de story points concluída pelo time",
    "Dependências técnicas identificadas e documentadas",
    "Aprovada pelo Product Owner",
    "Sem bloqueadores no início da sprint",
  ];
}

function buildRefinementRecommendation(readiness, missingElements, questions) {
  if (readiness.score >= 80) {
    return "✅ Item está pronto para a sprint. Continue com o planejamento.";
  }
  if (readiness.score >= 50) {
    const missing = missingElements.slice(0, 3).join(", ");
    return `⚠️ Item precisa de refinamento antes da sprint. Faltam: ${missing || "detalhes técnicos"}. Recomendado: 1 sessão de refinamento de 30min.`;
  }
  return `❌ Item NÃO está pronto. Score: ${readiness.score}/100. Sugira ao PO completar: ${missingElements.join(", ") || "descrição e critérios de aceite"}.`;
}

// ─── toolWorkItemHandoff ───────────────────────────────────────────────────

export async function toolWorkItemHandoff(args) {
  const {
    id,
    target_role = "developer",
    include_wiki = true,
    wiki_search,
    include_pull_requests = true,
    include_related = true,
  } = z
    .object({
      id: z.union([z.number(), z.string()]),
      target_role: z
        .enum(["developer", "qa", "product_owner", "scrum_master", "tech_lead"])
        .default("developer"),
      include_wiki: z.boolean().default(true),
      wiki_search: z.string().optional(),
      include_pull_requests: z.boolean().default(true),
      include_related: z.boolean().default(true),
    })
    .parse(args);

  const wid = normalizeWorkItemId(id);
  const workItem = await fetchWorkItemById(wid, "all");
  const relatedItems = include_related ? await loadRelatedItems(workItem) : [];
  const linkedPRs = include_pull_requests ? await loadLinkedPullRequestsByItem(workItem, 5) : [];
  const wikiMatches = include_wiki
    ? await findWikiMatches(wiki_search ?? workItem.fields?.["System.Title"] ?? "", 5)
    : [];

  const f = workItem.fields ?? {};
  const description = f["example.DefinicoesDeNegocio"] ?? f["System.Description"] ?? "";
  const acceptanceCriteria = f["example.DefinicoesTecnicas"] ?? f["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? "";
  const formatted = formatWorkItem(workItem);

  const stage = inferWorkItemStage(formatted);
  const bizContext = buildBusinessContext(formatted);
  // buildRoleChecklist returns { po, dev, qa, support }
  const allRoleChecklists = buildRoleChecklist({ workItem: formatted, relatedItems, linkedPullRequests: linkedPRs });
  const classified = classifyRelatedItems(relatedItems);
  const risks = [];
  if (classified.openItems.length > 0)
    risks.push(`${classified.openItems.length} dependência(s) ainda em aberto`);
  if (linkedPRs.some((pr) => pr.status === "active"))
    risks.push("PRs vinculados ainda ativos — aguardar merge antes do handoff");

  const suggestedComment = buildSuggestedHandoffComment({
    workItem: formatted,
    destination: target_role,
    risks,
    questions: [],
  });

  const readinessScore = calculateDescriptionQuality({
    title: formatted.title,
    description,
    type: formatted.type,
    acceptanceCriteria,
  });
  const specialistReview = buildSpecialistReview({
    title: formatted.title,
    workItemType: formatted.type,
    description,
    acceptanceCriteria,
    tags: formatted.tags,
    areaPath: formatted.area,
    affectedLocations: wikiMatches.map((match) => match.url).filter(Boolean),
  });

  return {
    workItem: formatted,
    handoff: {
      currentStage: stage,
      recommendedOwnerRole: target_role,
      destination: target_role,
      readinessScore,
    },
    summary: {
      objective: formatted.title,
      acceptanceCriteria: acceptanceCriteria || "(não preenchido)",
      businessContext: bizContext,
    },
    dependencies: {
      openItems: classified.openItems,
      linkedPullRequests: linkedPRs,
      wikiMatches,
    },
    risks,
    openQuestions: [],
    checklistByRole: allRoleChecklists,
    specialistReview,
    suggestedComment,
  };
}

// ─── toolPrepareRefinement ─────────────────────────────────────────────────

export async function toolPrepareRefinement(args) {
  const {
    id,
    include_wiki = true,
    wiki_search,
  } = z
    .object({
      id: z.union([z.number(), z.string()]),
      include_wiki: z.boolean().default(true),
      wiki_search: z.string().optional(),
    })
    .parse(args);

  const wid = normalizeWorkItemId(id);
  const workItem = await fetchWorkItemById(wid, "all");
  const relatedItems = await loadRelatedItems(workItem);
  const wikiMatches = include_wiki
    ? await findWikiMatches(wiki_search ?? workItem.fields?.["System.Title"] ?? "", 5)
    : [];

  const f = workItem.fields ?? {};
  const description = f["System.Description"] ?? "";
  const acceptanceCriteria = f["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? "";
  const title = f["System.Title"] ?? "";
  const type = f["System.WorkItemType"] ?? "";

  const readiness = estimateRefinementReadiness(workItem, relatedItems);
  const missingElements = extractMissingWorkItemElements({ title, description, type, acceptanceCriteria });
  const questions = buildRefinementQuestions(workItem, relatedItems);
  const dor = buildDefinitionOfReady();
  const recommendation = buildRefinementRecommendation(readiness, missingElements, questions);
  const specialistReview = buildSpecialistReview({
    title,
    workItemType: type,
    description,
    acceptanceCriteria,
    tags: f["System.Tags"] ?? "",
    areaPath: f["System.AreaPath"] ?? "",
  });

  return {
    workItem: formatWorkItem(workItem),
    readiness,
    missingElements,
    questions,
    definitionOfReady: dor,
    recommendation,
    specialistReview,
    wikiReferences: wikiMatches,
    relatedItems: classifyRelatedItems(relatedItems),
  };
}
