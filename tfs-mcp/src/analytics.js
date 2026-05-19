/**
 * analytics.js — Lógica de negócio: signals de sprint, risk scoring,
 * WIP analysis, quality scoring, handoff routing.
 * Funções puras. Sem network, sem side effects.
 */

// ─── Work Item Quality ─────────────────────────────────────────────────────

export function isUserStoryFormat(title, description) {
  const combined = `${title} ${description}`;
  return [
    /como\s+(?:um|uma|o|a)?\s*\w+/i,
    /(quero|desejo|preciso|gostaria)/i,
    /para\s+(?:que|poder|conseguir)/i,
  ].every((p) => p.test(combined));
}

export function hasGivenWhenThenFormat(text) {
  const lower = String(text ?? "").toLowerCase();
  return ["given", "when", "then", "dado", "quando", "entao", "entao:", "então"].some((t) =>
    lower.includes(t)
  );
}

export function hasAcceptanceCriteria(description, acceptanceCriteria) {
  const combined = `${description} ${acceptanceCriteria}`.toLowerCase();
  return ["criterio", "critério", "criteria", "aceite", "acceptance"].some((t) =>
    combined.includes(t)
  );
}

export function calculateDescriptionQuality({ title, description, type, acceptanceCriteria }) {
  let score = 0;
  if (description.length > 200) score += 30;
  else if (description.length > 100) score += 20;
  else if (description.length > 50) score += 10;
  if (type === "User Story" && isUserStoryFormat(title, description)) score += 30;
  if (hasGivenWhenThenFormat(`${description} ${acceptanceCriteria}`)) score += 20;
  if (hasAcceptanceCriteria(description, acceptanceCriteria)) score += 20;
  return Math.min(score, 100);
}

export function extractMissingWorkItemElements({ title, description, type, acceptanceCriteria }) {
  const missing = [];
  const combined = `${title} ${description}`.toLowerCase();
  if (type === "User Story") {
    if (!/como\s+(?:um|uma|o|a)?\s*\w+/i.test(combined))
      missing.push("Papel do usuario (Como...)");
    if (!/(quero|desejo|preciso|gostaria)/i.test(combined))
      missing.push("Funcionalidade desejada (Quero...)");
    if (!/para\s+(?:que|poder|conseguir)/i.test(combined))
      missing.push("Objetivo/valor (Para...)");
  }
  if (!hasGivenWhenThenFormat(`${description} ${acceptanceCriteria}`))
    missing.push("Cenarios de teste (Given/When/Then)");
  if (!hasAcceptanceCriteria(description, acceptanceCriteria))
    missing.push("Criterios de aceite");
  return missing;
}

// ─── Sprint / Release signals ──────────────────────────────────────────────

export function buildReleaseSignals(items = []) {
  const signals = {
    total: items.length,
    byState: {},
    byType: {},
    unassigned: 0,
    withStoryPoints: 0,
    donePoints: 0,
    totalPoints: 0,
  };

  for (const item of items) {
    signals.byState[item.state] = (signals.byState[item.state] ?? 0) + 1;
    signals.byType[item.type] = (signals.byType[item.type] ?? 0) + 1;
    if (!item.assignedTo || item.assignedTo === "Unassigned") signals.unassigned += 1;
    if (typeof item.storyPoints === "number") {
      signals.withStoryPoints += 1;
      signals.totalPoints += item.storyPoints;
      if (isCompletedState(item.state)) signals.donePoints += item.storyPoints;
    }
  }

  signals.completionPct =
    signals.totalPoints > 0
      ? Math.round((signals.donePoints / signals.totalPoints) * 100)
      : 0;

  return signals;
}

export function normalizeWorkflowState(state) {
  return String(state ?? "").trim().toLowerCase();
}

export function isCompletedState(state) {
  return ["done", "closed", "resolved", "fechado"].includes(normalizeWorkflowState(state));
}

export function isActiveState(state) {
  return !isCompletedState(state) && normalizeWorkflowState(state) !== "removed";
}

export function identifyReleaseRisks(items = [], linkedPRs = []) {
  const risks = [];
  const openItems = items.filter((i) => !isCompletedState(i.state));
  const bugs = items.filter((i) => /bug/i.test(i.type));
  const noEstimate = items.filter(
    (i) => i.storyPoints == null && /User Story|Product Backlog Item/i.test(i.type)
  );

  if (openItems.length > 0)
    risks.push(`${openItems.length} item(ns) ainda nao concluidos na iteracao analisada`);
  if (bugs.some((i) => !isCompletedState(i.state)))
    risks.push("Existem bugs ainda abertos para a entrega");
  if (noEstimate.length > 0)
    risks.push(`${noEstimate.length} item(ns) relevantes sem story points`);
  if (linkedPRs.some((pr) => pr.status === "active"))
    risks.push("Existem PRs ativos ainda nao concluidos para a entrega");

  return risks;
}

// ─── WIP / Owner analysis ──────────────────────────────────────────────────

export function rankOwnerLoad(items = []) {
  const byOwner = new Map();

  for (const item of items) {
    const owner = item.assignedTo || "Unassigned";
    if (!byOwner.has(owner))
      byOwner.set(owner, { owner, total: 0, active: 0, done: 0, bugs: 0, storyPoints: 0 });
    const e = byOwner.get(owner);
    e.total += 1;
    if (isCompletedState(item.state)) e.done += 1;
    else e.active += 1;
    if (/bug/i.test(item.type)) e.bugs += 1;
    if (typeof item.storyPoints === "number") e.storyPoints += item.storyPoints;
  }

  return [...byOwner.values()].sort((a, b) => b.active - a.active || b.total - a.total);
}

// ─── Handoff routing ──────────────────────────────────────────────────────

export function inferWorkItemStage(item) {
  const state = normalizeWorkflowState(item?.state);
  const type = String(item?.type ?? "").toLowerCase();

  if (["new", "to do", "proposed"].includes(state)) return "discovery";
  if (["approved", "committed", "ready", "refined"].includes(state)) return "ready_for_dev";
  if (["active", "in progress", "doing"].includes(state))
    return /bug|task/.test(type) ? "development" : "delivery";
  if (["resolved", "code review", "qa", "test", "testing", "homologacao"].includes(state))
    return "validation";
  if (isCompletedState(state)) return "done";
  return "triage";
}

export function buildBusinessContext(item) {
  return [
    item.type ? `Tipo: ${item.type}.` : null,
    item.area ? `Area: ${item.area}.` : null,
    item.iteration ? `Iteracao: ${item.iteration}.` : null,
    item.storyPoints != null
      ? `Story points: ${item.storyPoints}.`
      : "Sem story points definidos.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildRoleChecklist({ workItem, relatedItems, linkedPullRequests }) {
  const hasLinkedPrs = (linkedPullRequests ?? []).length > 0;
  const openDependencies = (relatedItems ?? []).filter((i) => isActiveState(i.state));

  return {
    po: [
      "Confirmar objetivo de negocio e valor esperado para o item",
      workItem.acceptanceCriteria?.trim()
        ? "Validar se os criterios de aceite continuam corretos"
        : "Preencher criterios de aceite objetivos",
      openDependencies.length
        ? `Alinhar ${openDependencies.length} dependencia(s) ainda em aberto`
        : "Registrar dependencias ou impactos externos relevantes",
    ],
    dev: [
      "Revisar descricao funcional, dependencias e riscos tecnicos",
      hasLinkedPrs
        ? "Validar continuidade com PRs ja vinculados"
        : "Criar plano tecnico, branch e PR quando iniciar a implementacao",
      "Confirmar cenarios de erro, observabilidade e rollback",
    ],
    qa: [
      workItem.acceptanceCriteria?.trim()
        ? "Derivar cenarios de teste a partir dos criterios de aceite"
        : "Bloquear planejamento de testes ate existirem criterios de aceite claros",
      "Mapear cobertura funcional, regressiva e integracoes impactadas",
      "Alinhar massa de dados e evidencias esperadas para homologacao",
    ],
    support: [
      "Entender impacto operacional, monitoracao e sinais de incidente",
      "Preparar roteiro de validacao pos-release e canais de escalacao",
      "Revisar dependencia de contratos legados, filas e processos manuais se houver",
    ],
  };
}

export function buildSuggestedHandoffComment({ workItem, destination, risks, questions }) {
  const lines = [
    `Handoff sugerido para ${destination}:`,
    `- Work item #${workItem.id} - ${workItem.title}`,
    workItem.acceptanceCriteria?.trim()
      ? "- Criterios de aceite registrados e prontos para validacao."
      : "- Necessario complementar criterios de aceite antes da execucao completa.",
  ];
  if (risks.length) lines.push(`- Riscos principais: ${risks.slice(0, 3).join("; ")}.`);
  if (questions.length) lines.push(`- Pendencias: ${questions.slice(0, 3).join("; ")}.`);
  return lines.join("\n");
}

// ─── Pipeline / file signals ───────────────────────────────────────────────

export function toPipelineArray(pipeline) {
  if (!pipeline) return [];
  if (Array.isArray(pipeline)) return pipeline;
  if (Array.isArray(pipeline.results)) return pipeline.results;
  if (Array.isArray(pipeline.value)) return pipeline.value;
  return [];
}

export function summarizePipelineHealth(pipelines = []) {
  const summary = { failures: 0, warnings: 0 };
  for (const p of pipelines) {
    const result = String(p?.lastRun?.result ?? "").toLowerCase();
    const state = String(p?.lastRun?.state ?? "").toLowerCase();
    if (["failed", "canceled", "cancelled"].includes(result)) summary.failures += 1;
    else if (
      ["inprogress", "unknown"].includes(state) ||
      ["partiallySucceeded", "warning"].includes(result)
    )
      summary.warnings += 1;
  }
  return summary;
}

export function scoreDeliveryRisk({ signals, risks }) {
  let score = 0;
  score += Math.min(35, signals.openItems * 2);
  score += Math.min(15, signals.openBugs * 4);
  score += Math.min(10, signals.unestimatedItems * 2);
  score += Math.min(10, signals.activePullRequests * 2);
  score += Math.min(10, signals.bottlenecks * 3);
  score += Math.min(10, signals.unassignedItems * 2);
  score += Math.min(20, signals.pipelineFailures * 8 + signals.pipelineWarnings * 3);
  score += Math.min(10, Math.max(0, 70 - signals.completionPct) / 5);
  score += Math.min(10, risks.length * 2);

  const deliveryRiskScore = Math.min(100, Math.round(score));
  const readinessScore = Math.max(0, 100 - deliveryRiskScore);
  const status =
    deliveryRiskScore >= 70 ? "high_risk" : deliveryRiskScore >= 40 ? "attention" : "on_track";

  return { deliveryRiskScore, readinessScore, status };
}

export function summarizeFileChanges(files = []) {
  const s = { total: files.length, cs: 0, tests: 0, configs: 0, docs: 0 };
  for (const file of files) {
    const p = file.path ?? "";
    if (/\.cs$/i.test(p)) s.cs += 1;
    if (/(test|spec)\./i.test(p) || /Tests?\//i.test(p)) s.tests += 1;
    if (/\.(json|config|xml|yml|yaml)$/i.test(p)) s.configs += 1;
    if (/\.(md|txt)$/i.test(p)) s.docs += 1;
  }
  return s;
}

export function detectCriticalFileAreas(files = []) {
  const areas = new Set();
  const criticalFiles = [];
  for (const file of files) {
    const p = file.path ?? "";
    if (!p) continue;
    if (/soap|xml|txt/i.test(p)) areas.add("contratos legados");
    if (/consumer|rabbit|queue|broker/i.test(p)) areas.add("mensageria");
    if (/repository|dao|sql|mongo|redis/i.test(p)) areas.add("persistencia");
    if (/controller|api|service/i.test(p)) areas.add("api e regra de negocio");
    if (/config|appsettings|web\.config|json|ya?ml|xml/i.test(p)) areas.add("configuracao");
    if (/certificate|tls|security|auth|token|signature/i.test(p)) areas.add("seguranca");
    if (/soap|consumer|rabbit|queue|repository|dao|redis|mongo|config|web\.config|security|auth|token|certificate|tls/i.test(p))
      criticalFiles.push(p);
  }
  return { areas: [...areas], criticalFiles: criticalFiles.slice(0, 30) };
}

// ─── Refinement helpers ────────────────────────────────────────────────────

export function classifyRelatedItems(relatedItems = []) {
  const buckets = { parents: [], children: [], related: [], dependencies: [], openItems: [] };
  for (const item of relatedItems) {
    if (item.linkType === "System.LinkTypes.Hierarchy-Reverse") buckets.parents.push(item);
    else if (item.linkType === "System.LinkTypes.Hierarchy-Forward") buckets.children.push(item);
    else if (item.linkType?.startsWith("System.LinkTypes.Dependency")) buckets.dependencies.push(item);
    else buckets.related.push(item);
    if (isActiveState(item.state)) buckets.openItems.push(item);
  }
  return buckets;
}
