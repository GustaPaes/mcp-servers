/**
 * specialists.js — Deterministic specialist routing for TFS workflows.
 *
 * This is intentionally rule-based. The MCP does not pretend to be a human
 * specialist; it applies explicit rubrics so activity writing, refinement,
 * PR review and pipeline readiness consistently include the right viewpoints.
 */
import { detectCriticalFileAreas, summarizeFileChanges } from "./analytics.js";

function textBlob(...values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(" ")
    .toLowerCase();
}

function filePaths(files = [], affectedLocations = []) {
  return [
    ...files.map((file) => file?.path ?? file).filter(Boolean),
    ...affectedLocations,
  ].map((path) => String(path));
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

const SPECIALISTS = {
  business_analyst: {
    name: "Business Analyst / Product Owner",
    area: "business",
    purpose: "Garantir objetivo, valor, persona, escopo e linguagem de negócio.",
  },
  tech_lead: {
    name: "Tech Lead",
    area: "technical",
    purpose: "Garantir desenho técnico, fatiamento, riscos e aderência arquitetural.",
  },
  qa: {
    name: "QA / Test Specialist",
    area: "quality",
    purpose: "Garantir critérios verificáveis, cenários de teste, regressão e evidências.",
  },
  devops: {
    name: "Azure DevOps / Pipeline Specialist",
    area: "devops",
    purpose: "Garantir build, release, variáveis, gates, rollback e observabilidade da pipeline.",
  },
  security: {
    name: "Security Specialist",
    area: "security",
    purpose: "Garantir tratamento de segredos, autenticação, autorização, TLS e exposição segura.",
  },
  backend: {
    name: "Backend Specialist",
    area: "backend",
    purpose: "Garantir APIs, regras de negócio, integração, erros, logs e contratos server-side.",
  },
  frontend: {
    name: "Frontend / UX Specialist",
    area: "frontend",
    purpose: "Garantir fluxo de tela, acessibilidade, estados de UI, responsividade e UX.",
  },
  database: {
    name: "Database / Persistence Specialist",
    area: "database",
    purpose: "Garantir modelagem, migrations, consultas, índices, transação, cache e rollback de dados.",
  },
  architecture: {
    name: "Architecture / Integration Specialist",
    area: "architecture",
    purpose: "Garantir fronteiras, contratos, compatibilidade, dependências e impacto sistêmico.",
  },
  observability: {
    name: "Observability / Support Specialist",
    area: "observability",
    purpose: "Garantir logs, métricas, traces, alertas, runbook e diagnóstico pós-release.",
  },
};

function matchAreas(context) {
  const paths = filePaths(context.changedFiles, context.affectedLocations);
  const blob = textBlob(
    context.title,
    context.workItemType,
    context.description,
    context.acceptanceCriteria,
    context.technicalDependencies,
    context.technicalAcceptanceCriteria,
    context.tags,
    context.areaPath,
    context.focus,
    paths
  );
  const pathBlob = paths.join(" ").toLowerCase();
  const areas = new Set(["business", "technical", "quality"]);

  if (/(pipeline|release|build|deploy|yaml|yml|azure-pipelines|dockerfile|helm|k8s|kubernetes|infra|ambiente)/i.test(blob + " " + pathBlob)) {
    areas.add("devops");
  }
  if (/(auth|token|secret|password|senha|certificate|certificado|tls|ssl|permission|permiss|rbac|security|seguran)/i.test(blob + " " + pathBlob)) {
    areas.add("security");
  }
  if (/(\.cs\b|controller|service|api|endpoint|worker|consumer|rabbit|queue|broker|mensageria)/i.test(pathBlob + " " + blob)) {
    areas.add("backend");
  }
  if (/(\.tsx?\b|\.jsx?\b|\.html\b|\.css\b|\.scss\b|client\/|frontend|tela|modal|bot[aã]o|ux|visual)/i.test(pathBlob + " " + blob)) {
    areas.add("frontend");
  }
  if (/(sql|migration|migracao|database|banco|repository|dao|redis|mongo|cache|índice|indice)/i.test(pathBlob + " " + blob)) {
    areas.add("database");
  }
  if (/(contrato|contract|soap|xml|integra|compatib|arquitet|dependenc|breaking|api e regra)/i.test(pathBlob + " " + blob)) {
    areas.add("architecture");
  }
  if (/(log|metric|trace|telemetry|monitor|alert|appinsights|observab|suporte|diagn[oó]stico|rollback)/i.test(pathBlob + " " + blob)) {
    areas.add("observability");
  }

  const critical = detectCriticalFileAreas(paths.map((path) => ({ path })));
  const focus = new Set(context.focus ?? []);
  if (focus.has("pipeline") || focus.has("release")) areas.add("devops");
  if (focus.has("security")) areas.add("security");
  if (focus.has("architecture")) areas.add("architecture");
  if (critical.areas.includes("seguranca")) areas.add("security");
  if (critical.areas.includes("persistencia")) areas.add("database");
  if (critical.areas.includes("api e regra de negocio")) areas.add("backend");
  if (critical.areas.includes("contratos legados") || critical.areas.includes("mensageria")) areas.add("architecture");
  if (critical.areas.includes("configuracao")) areas.add("devops");

  return { areas: [...areas], critical };
}

function selectSpecialists(areas) {
  const selected = new Set(["business_analyst", "tech_lead", "qa"]);
  if (areas.includes("devops")) selected.add("devops");
  if (areas.includes("security")) selected.add("security");
  if (areas.includes("backend")) selected.add("backend");
  if (areas.includes("frontend")) selected.add("frontend");
  if (areas.includes("database")) selected.add("database");
  if (areas.includes("architecture")) selected.add("architecture");
  if (areas.includes("observability")) selected.add("observability");
  return [...selected].map((id) => ({ id, ...SPECIALISTS[id] }));
}

function buildRecommendations({ specialists, context, critical, fileSummary }) {
  const ids = new Set(specialists.map((s) => s.id));
  const businessWriting = [
    "Explicitar persona, necessidade, resultado esperado e limite de escopo.",
    "Separar valor de negócio de detalhes técnicos; detalhes técnicos ficam nos critérios técnicos.",
  ];
  const technicalWriting = [
    "Descrever abordagem, dependências, contratos afetados, estratégia de erro e rollback.",
    "Listar locais afetados com granularidade suficiente para revisão e teste.",
  ];
  const qaChecklist = [
    "Transformar cada critério em cenário verificável, incluindo sucesso, erro e regressão.",
    "Definir evidências esperadas: prints, logs, massa de dados, payloads ou execução de pipeline.",
  ];
  const pipelineRecommendations = [];
  const risks = [];
  const suggestedTechnicalCriteria = [
    "Deve registrar logs suficientes para diagnosticar falhas sem expor dados sensíveis.",
    "Deve prever rollback ou mitigação caso a alteração impacte produção/homologação.",
  ];
  const suggestedBusinessCriteria = [
    "Deve deixar claro para o usuário/área de negócio quando a funcionalidade foi concluída com sucesso.",
  ];

  if (ids.has("devops")) {
    pipelineRecommendations.push(
      "Validar se build, testes, variáveis, secrets, gates e artefatos da pipeline cobrem a alteração.",
      "Documentar plano de deploy e rollback, incluindo branch alvo e ambiente."
    );
    suggestedTechnicalCriteria.push("Deve validar a pipeline de build/release antes do merge ou deploy.");
  }
  if (ids.has("security")) {
    risks.push("Mudança com sinais de segurança: revisar segredos, permissões, autenticação, TLS e dados sensíveis.");
    suggestedTechnicalCriteria.push("Deve garantir que nenhum segredo, token ou dado sensível seja exposto em código, logs ou configuração.");
  }
  if (ids.has("database")) {
    risks.push("Mudança com persistência/cache: revisar compatibilidade de dados, migrations, índices, transações e rollback.");
    suggestedTechnicalCriteria.push("Deve validar impacto em dados existentes e plano de rollback/migração.");
  }
  if (ids.has("frontend")) {
    suggestedBusinessCriteria.push("Deve validar estados visuais principais, mensagens de erro e comportamento responsivo quando aplicável.");
    suggestedTechnicalCriteria.push("Deve cobrir estados de loading, erro, vazio e sucesso na interface.");
  }
  if (ids.has("backend")) {
    suggestedTechnicalCriteria.push("Deve validar contratos de API, tratamento de exceções e compatibilidade com consumidores.");
  }
  if (ids.has("architecture")) {
    risks.push("Mudança com integração/arquitetura: revisar contratos, compatibilidade retroativa e dependências externas.");
    suggestedTechnicalCriteria.push("Deve preservar compatibilidade de contratos ou documentar versionamento/migração.");
  }
  if (ids.has("observability")) {
    suggestedTechnicalCriteria.push("Deve definir logs, métricas, alertas ou consulta de diagnóstico para operação pós-release.");
  }

  if (fileSummary.total >= 30) risks.push(`Alteração ampla (${fileSummary.total} arquivo(s)); considerar fatiamento ou revisão por áreas.`);
  if (fileSummary.tests === 0 && (ids.has("backend") || ids.has("frontend") || ids.has("database"))) {
    risks.push("Não há sinal de arquivos de teste nos caminhos analisados; revisar cobertura de regressão.");
  }
  if (critical.criticalFiles.length) {
    risks.push(`Arquivos críticos detectados: ${critical.criticalFiles.slice(0, 5).join(", ")}.`);
  }

  return {
    businessWriting,
    technicalWriting,
    qaChecklist,
    pipelineRecommendations,
    risks: uniq(risks),
    suggestedBusinessCriteria: uniq(suggestedBusinessCriteria),
    suggestedTechnicalCriteria: uniq(suggestedTechnicalCriteria),
    recommendedNextActions: uniq([
      "Revisar a escrita com os especialistas listados antes de criar/atualizar o work item.",
      ids.has("devops") ? "Validar pipeline/release antes de aprovar o PR." : "",
      ids.has("security") ? "Executar revisão de segurança explícita antes de publicar." : "",
      "Confirmar critérios de aceite com QA antes de mover para desenvolvimento ou homologação.",
    ]),
  };
}

export function buildSpecialistReview(context = {}) {
  const changedFiles = context.changedFiles ?? [];
  const affectedLocations = context.affectedLocations ?? context.affected_locations ?? [];
  const { areas, critical } = matchAreas({
    ...context,
    changedFiles,
    affectedLocations,
  });
  const specialists = selectSpecialists(areas);
  const fileSummary = summarizeFileChanges(filePaths(changedFiles, affectedLocations).map((path) => ({ path })));
  const recommendations = buildRecommendations({ specialists, context, critical, fileSummary });

  return {
    detectedAreas: areas,
    specialistsUsed: specialists.map((specialist) => ({
      id: specialist.id,
      name: specialist.name,
      area: specialist.area,
      purpose: specialist.purpose,
      reason: `Selecionado por sinais em ${areas.join(", ")}.`,
    })),
    signals: {
      fileSummary,
      criticalAreas: critical,
    },
    ...recommendations,
  };
}

export function enrichActivityInputWithSpecialists(input = {}) {
  const review = buildSpecialistReview(input);
  return {
    review,
    businessAcceptanceCriteria: uniq([
      ...(input.businessAcceptanceCriteria ?? []),
      ...review.suggestedBusinessCriteria,
    ]),
    technicalAcceptanceCriteria: uniq([
      ...(input.technicalAcceptanceCriteria ?? []),
      ...review.suggestedTechnicalCriteria,
    ]),
  };
}
