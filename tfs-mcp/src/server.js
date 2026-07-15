/**
 * server.js — MCP Server: registra todas as tools e expõe startStdio().
 * Padrão 2026: annotations readOnlyHint/destructiveHint, outputSchema nas premium tools.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  PREPARE_PR_REVIEW_OUTPUT_SCHEMA,
  RELEASE_READINESS_OUTPUT_SCHEMA,
  TEAM_FOCUS_REPORT_OUTPUT_SCHEMA,
  WORK_ITEM_HANDOFF_OUTPUT_SCHEMA,
  DELIVERY_RISK_OUTPUT_SCHEMA,
} from "../schemas.js";

import {
  toolWorkItem,
  toolAnalyzeWorkItem,
  toolWorkItemContext,
  toolQueryWorkItems,
  toolUpdateWorkItem,
  toolUpdateIssueAnalysis,
  toolCreateWorkItem,
  toolGenerateActivityTemplate,
  toolGenerateActivityTemplateFromItems,
} from "./tools/work-item.js";

import {
  toolListPRs,
  toolGetPR,
  toolReviewPR,
  toolAddPRComment,
  toolCommentReviewFindings,
  toolPreparePRReview,
} from "./tools/pull-request.js";

import {
  toolWorkItemHandoff,
  toolPrepareRefinement,
} from "./tools/handoff.js";

import {
  toolSprintInfo,
  toolReleaseReadiness,
  toolTeamFocusReport,
  toolDeliveryRiskReport,
} from "./tools/sprint.js";

import {
  toolWiki,
  toolPipelineStatus,
  toolListRepos,
  toolBuildArtifactInventory,
  toolCompareBuildArtifacts,
} from "./tools/infra.js";
import { toolSpecialistReview } from "./tools/specialist.js";
import { runWithRequestContext } from "./request-context.js";
import { MutationControlsSchema } from "./safety.js";

// ─── Tool metadata helpers ─────────────────────────────────────────────────

const MUTATING_TOOLS = new Set([
  "tfs_update_work_item",
  "tfs_update_issue_analysis",
  "tfs_add_pr_comment",
  "tfs_comment_review_findings",
  "tfs_work_item_create",
]);
const NON_IDEMPOTENT_TOOLS = new Set([
  "tfs_add_pr_comment",
  "tfs_comment_review_findings",
  "tfs_work_item_create",
]);

function withToolMetadata(tool) {
  const readOnly = !MUTATING_TOOLS.has(tool.name);
  const idempotent = !NON_IDEMPOTENT_TOOLS.has(tool.name);
  const inputProperties = {
    ...(tool.inputSchema?.properties ?? {}),
    auth_alias: {
      type: "string",
      description: "Alias do PAT TFS configurado no .env (ex: joao, maria)",
    },
  };
  return {
    ...tool,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: idempotent,
      openWorldHint: true,
      ...(tool.annotations ?? {}),
    },
    inputSchema: {
      additionalProperties: false,
      ...tool.inputSchema,
      properties: inputProperties,
    },
  };
}

function formatToolResult(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const payload = { content: [{ type: "text", text }] };
  if (result && typeof result === "object") {
    payload.structuredContent = Array.isArray(result) ? { items: result } : result;
  }
  return payload;
}

// ─── Tool definitions ──────────────────────────────────────────────────────

const TOOL_DEFS = [
  {
    name: "tfs_analyze_work_item",
    title: "Analyze Work Item",
    description:
      "Analisa a qualidade de um work item do TFS: score 0-100, formato user story, Given/When/Then, criterios faltantes, checklist de refinamento e itens relacionados.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"], description: "ID ou URL do work item" },
        include_related: { type: "boolean", default: true },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_work_item_context",
    title: "Work Item Context",
    description:
      "Contexto completo de um work item: analise de qualidade, PRs vinculados por ArtifactLink, paginas de wiki relacionadas, artefatos e itens dependentes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"], description: "ID ou URL do work item" },
        include_related: { type: "boolean", default: true },
        include_pull_requests: { type: "boolean", default: true },
        include_wiki: { type: "boolean", default: true },
        wiki_search: { type: "string", description: "Termo de busca na wiki (opcional; usa titulo do item se omitido)" },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_specialist_review",
    title: "Specialist Review",
    description:
      "Seleciona especialistas por contexto (negócio, técnico, QA, DevOps, segurança, frontend, backend, banco, arquitetura e observabilidade) e gera recomendações para escrita, refinamento, PR, pipeline e critérios de aceite.",
    inputSchema: {
      type: "object",
      properties: {
        work_item_id: { type: ["number", "string"], description: "ID ou URL do work item para usar como contexto" },
        pr_id: { type: ["number", "string"], description: "ID ou URL do PR para usar diff/branch como contexto" },
        repo: { type: "string" },
        title: { type: "string" },
        work_item_type: { type: "string" },
        description: { type: "string" },
        acceptance_criteria: { type: "string" },
        technical_dependencies: { type: "string" },
        technical_acceptance_criteria: { type: "array", items: { type: "string" } },
        affected_locations: { type: "array", items: { type: "string" } },
        tags: { type: "string" },
        area_path: { type: "string" },
        focus: {
          type: "array",
          items: {
            type: "string",
            enum: ["business_writing", "technical_writing", "qa", "pipeline", "security", "architecture", "release"],
          },
        },
      },
    },
  },
  {
    name: "tfs_prepare_refinement",
    title: "Prepare Refinement",
    description:
      "Prepara um refinamento de alta qualidade com roteamento automatico de especialistas por area: readiness score, gaps, perguntas para PO/time, definition of ready, dependencias, PRs relacionados e proximas acoes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"], description: "ID ou URL do work item" },
        include_wiki: { type: "boolean", default: true },
        wiki_search: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_work_item",
    title: "Get Work Item",
    description:
      "Busca detalhes completos de um work item pelo ID. Retorna titulo, estado, descricao, criterios de aceite, story points, iteracao e hierarquia.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"], description: "ID ou URL do work item" },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_work_item_create",
    title: "Create Work Item",
    description:
      "Cria um novo work item no TFS/Azure DevOps. Suporta User Story, Bug, Sprint Task, Product Backlog Item, Feature e qualquer tipo configurado. Permite vincular a um item pai. " +
      "Os campos description e acceptance_criteria aceitam HTML rico - o servidor decodifica entidades automaticamente caso o cliente MCP envie HTML-encoded. " +
      "Padrao recomendado para Azure DevOps Server com campos ricos customizados: cada bloco em <div>...</div>, listas em <div><ul><li>...</li></ul></div>, linhas em branco como <div><br></div>.",
    inputSchema: {
      type: "object",
      properties: {
        work_item_type: { type: "string", description: "Tipo do work item (ex: User Story, Bug, Sprint Task, Feature)" },
        title: { type: "string", description: "Titulo do work item" },
        description: {
          type: "string",
          description:
            "HTML rico para descricao/negocio. Aceita HTML cru ou HTML-encoded - o servidor decodifica automaticamente.",
        },
        acceptance_criteria: {
          type: "string",
          description:
            "HTML rico para criterios de aceite/tecnica. Mesmo padrao de description.",
        },
        assigned_to: { type: "string", description: "Nome ou email do responsavel" },
        area_path: { type: "string", description: "Area path (default: area do projeto)" },
        iteration_path: { type: "string", description: "Iteration path (default: iteracao atual)" },
        story_points: { type: "number", description: "Story points / esforco" },
        priority: { type: "number", enum: [1, 2, 3, 4], description: "Prioridade: 1 (alta) a 4 (baixa)" },
        parent_id: { type: "number", description: "ID do work item pai para criar hierarquia" },
        tags: { type: "string", description: "Tags separadas por ponto-e-virgula" },
        ...MutationControlsSchema,
      },
      required: ["work_item_type", "title"],
    },
  },
  {
    name: "tfs_generate_activity_template",
    title: "Generate Activity Template",
    description:
      "Gera a escrita padronizada de negócio e técnica para US, ST, PBI e afins, aplicando automaticamente especialistas de negocio, tecnico, QA, pipeline, seguranca e areas afetadas. Segue o template com blocos em negrito e critérios iniciados por Deve.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        work_item_type: { type: "string" },
        actor: { type: "string" },
        intent: { type: "string" },
        outcome: { type: "string" },
        business_acceptance_criteria: { type: "array", items: { type: "string" } },
        visual_definitions: { type: "string" },
        technical_dependencies: { type: "string" },
        technical_acceptance_criteria: { type: "array", items: { type: "string" } },
        affected_locations: { type: "array", items: { type: "string" } },
        estimated_changed_lines: { type: "number" },
        detail_level: { type: "string", enum: ["auto", "specific", "summary"], default: "auto" },
      },
    },
  },
  {
    name: "tfs_generate_activity_template_from_items",
    title: "Generate Activity Template From Items",
    description:
      "Gera descrições padronizadas em massa a partir de um ou mais work items do TFS, reutilizando o texto de negócio existente, aceitando apoio opcional da wiki e aplicando automaticamente especialistas por area de atuação.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: ["number", "string"] } },
        include_wiki: { type: "boolean", default: false },
        wiki_search: { type: "string" },
        technical_dependencies: { type: "string" },
        technical_acceptance_criteria: { type: "array", items: { type: "string" } },
        affected_locations: { type: "array", items: { type: "string" } },
        estimated_changed_lines: { type: "number" },
        detail_level: { type: "string", enum: ["auto", "specific", "summary"], default: "auto" },
      },
      required: ["ids"],
    },
  },
  {
    name: "tfs_query_work_items",
    title: "Query Work Items",
    description:
      "Consulta work items usando presets, filtros estruturados ou WIQL livre. Presets: sprint, my_tasks, active_pbis, bugs, user_stories, active_tasks.",
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["sprint", "my_tasks", "active_pbis", "bugs", "user_stories", "active_tasks"],
        },
        wiql: { type: "string" },
        search: { type: "string", description: "Busca por titulo" },
        ids: { type: "string", description: "IDs separados por virgula" },
        state: { type: "string" },
        work_item_type: { type: "string" },
        assigned_to: { type: "string" },
        area_path: { type: "string" },
        iteration_path: { type: "string" },
        top: { type: "number", default: 30 },
      },
    },
  },
  {
    name: "tfs_list_prs",
    title: "List Pull Requests",
    description: "Lista Pull Requests com filtros de status, criador e branch alvo.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "completed", "abandoned", "all"], default: "active" },
        top: { type: "number", default: 20 },
        repo: { type: "string" },
        created_by: { type: "string" },
        target_branch: { type: "string" },
      },
    },
  },
  {
    name: "tfs_prepare_pr_review",
    title: "Prepare Pull Request Review",
    description:
      "Prepara uma revisao de PR com especialistas automaticos por arquivos alterados e area afetada: work items vinculados, riscos, checklist, sinais de qualidade e review automatico.",
    outputSchema: PREPARE_PR_REVIEW_OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"], description: "ID do PR" },
        repo: { type: "string" },
        include_code_review: { type: "boolean", default: true },
        include_pipeline: { type: "boolean", default: true },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_release_readiness",
    title: "Release Readiness",
    description:
      "Consolida prontidao de entrega por sprint/iteracao com especialistas automaticos de pipeline, release, QA, seguranca e arquitetura: sinais, riscos, blockers, PRs vinculados, pipeline e acoes recomendadas.",
    outputSchema: RELEASE_READINESS_OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", default: "master" },
        pipeline_name: { type: "string" },
        include_pull_requests: { type: "boolean", default: true },
        include_pipeline: { type: "boolean", default: true },
        top: { type: "number", default: 100 },
      },
    },
  },
  {
    name: "tfs_team_focus_report",
    title: "Team Focus Report",
    description:
      "Mostra WIP, distribuicao por responsavel, gargalos, itens sem dono e recomendacoes de foco do time.",
    outputSchema: TEAM_FOCUS_REPORT_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { top: { type: "number", default: 150 } } },
  },
  {
    name: "tfs_work_item_handoff",
    title: "Work Item Handoff",
    description:
      "Prepara um handoff operacional do work item entre PO, dev, QA e suporte com roteamento automatico de especialistas, resumo, dependencias, riscos, checklist por papel e comentario sugerido.",
    outputSchema: WORK_ITEM_HANDOFF_OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"] },
        target_role: {
          type: "string",
          enum: ["developer", "qa", "product_owner", "scrum_master", "tech_lead"],
          default: "developer",
        },
        include_wiki: { type: "boolean", default: true },
        wiki_search: { type: "string" },
        include_pull_requests: { type: "boolean", default: true },
        include_related: { type: "boolean", default: true },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_delivery_risk_report",
    title: "Delivery Risk Report",
    description:
      "Consolida risco executivo da entrega com especialistas automaticos de pipeline, release, arquitetura, QA e seguranca, cruzando release readiness, foco do time, PRs e pipelines em um score de risco com acoes recomendadas.",
    outputSchema: DELIVERY_RISK_OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        include_pipelines: { type: "boolean", default: true },
        include_pull_requests: { type: "boolean", default: true },
        branch: { type: "string", default: "master" },
        top: { type: "number", default: 100 },
      },
    },
  },
  {
    name: "tfs_get_pr",
    title: "Get Pull Request",
    description: "Detalhes completos de um PR: metadata, reviewers, threads de comentarios e arquivos.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"] },
        repo: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_review_pr",
    title: "Review Pull Request",
    description:
      "Code review automatico de um PR com especialistas por arquivos alterados, seguindo padroes do projeto e boas praticas modernas. Avalia metadata do PR, tamanho, rastreabilidade, frontend/backend, seguranca, async, sync-over-async, Redis sem TTL, TLS bypass, testes e maintainability. Retorna score 0-10.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"] },
        repo: { type: "string" },
        include_diff: { type: "boolean", default: true },
        include_threads: { type: "boolean", default: true },
        run_pattern_checks: { type: "boolean", default: true },
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_pipeline_status",
    title: "Pipeline Status",
    description: "Verifica status das ultimas execucoes de pipelines Azure DevOps e inclui recomendações automaticas de especialista de pipeline/release.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Filtrar por nome (parcial)" },
        branch: { type: "string", default: "master" },
        top: { type: "number", default: 3 },
      },
    },
  },
  {
    name: "tfs_wiki",
    title: "Wiki Explorer",
    description:
      "Acessa wikis do projeto configurado. Busca paginas por palavra-chave.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Buscar paginas cujo caminho contem o texto" },
        top: { type: "number", default: 10 },
      },
      required: ["search"],
    },
  },
  {
    name: "tfs_update_work_item",
    title: "Update Work Item",
    description:
      "Atualiza um work item: muda estado, reatribui, adiciona comentario/historico, altera titulo, story points, descricao ou criterios de aceite. " +
      "Os campos description e acceptance_criteria aceitam HTML rico - o servidor decodifica entidades automaticamente caso o cliente MCP envie a string HTML-encoded (&lt;b&gt;...). " +
      "Padrao recomendado para templates com campos ricos customizados (como example.DefinicoesDeNegocio / example.DefinicoesTecnicas): cada bloco em <div>...</div>, listas em <div><ul><li>...</li></ul></div>, linhas em branco como <div><br></div>, espacos apos <b> usar &nbsp;. Tags <br> soltas sao colapsadas pelo renderer.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        state: { type: "string" },
        assigned_to: { type: "string" },
        comment: { type: "string" },
        title: { type: "string" },
        description: {
          type: "string",
          description:
            "HTML rico para o campo de negocio. Pode vir como HTML cru (<div>...) ou HTML-encoded (&lt;div&gt;...) - o servidor decodifica automaticamente.",
        },
        acceptance_criteria: {
          type: "string",
          description:
            "HTML rico para o campo tecnico. Mesmo padrao de description.",
        },
        story_points: { type: "number" },
        ...MutationControlsSchema,
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_update_issue_analysis",
    title: "Update Issue Analysis",
    description:
      "Registra a análise de desenvolvimento de uma Issue no campo configurado por TFS_ISSUE_ANALYSIS_FIELD, com padrão de linguagem voltado ao negócio. O campo de análise é obrigatório; correction_and_impacts é opcional e exige TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD. A tool só aceita work items do tipo Issue.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "ID da Issue" },
        development_analysis: {
          type: "string",
          description:
            "Obrigatório. Texto/HTML rico com contexto, motivo confirmado, impacto para o usuário/negócio e limitações da evidência. Evite detalhes de implementação desnecessários.",
        },
        correction_and_impacts: {
          type: "string",
          description:
            "Opcional. Texto/HTML rico com correção técnica proposta ou aplicada, impactos, validação e pendências. Requer TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD; quando omitido, o campo existente não é alterado.",
        },
        ...MutationControlsSchema,
      },
      required: ["id", "development_analysis"],
    },
  },
  {
    name: "tfs_add_pr_comment",
    title: "Add Pull Request Comment",
    description:
      "Posta um comentario em um Pull Request. Pode ser comentario geral ou vinculado a arquivo/linha.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"] },
        comment: { type: "string" },
        repo: { type: "string" },
        file_path: { type: "string" },
        line: { type: "number" },
        ...MutationControlsSchema,
      },
      required: ["id", "comment"],
    },
  },
  {
    name: "tfs_comment_review_findings",
    title: "Comment Review Findings",
    description:
      "Transforma findings relevantes do code review em comentarios no PR, com arquivo, linha, orientacao de correcao e deduplicacao.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"] },
        repo: { type: "string" },
        dry_run: { type: "boolean", default: true },
        include_pr_hygiene: { type: "boolean", default: true },
        max_comments: { type: "number", default: 6 },
        confirm: MutationControlsSchema.confirm,
        reason: MutationControlsSchema.reason,
        requestedBy: MutationControlsSchema.requestedBy,
        requested_by: MutationControlsSchema.requested_by,
        confirm_high_impact: MutationControlsSchema.confirm_high_impact,
      },
      required: ["id"],
    },
  },
  {
    name: "tfs_sprint_info",
    title: "Sprint Info",
    description:
      "Informacoes do sprint atual: work items, metricas de conclusao (story points done vs total), distribuicao por tipo.",
    inputSchema: {
      type: "object",
      properties: {
        iteration_path: { type: "string" },
      },
    },
  },
  {
    name: "tfs_list_repos",
    title: "List Repositories",
    description: "Lista todos os repositorios do projeto configurado com branch default e URL.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tfs_build_artifact_inventory",
    title: "Build Artifact Inventory",
    description: "Lista os artefatos de um build e, para artefatos do tipo Container, retorna o inventário de arquivos para comparação estrutural.",
    inputSchema: {
      type: "object",
      properties: {
        build_id: { type: ["number", "string"] },
        artifact_name: { type: "string", description: "Opcional: nome exato do artefato para filtrar" },
      },
      required: ["build_id"],
    },
  },
  {
    name: "tfs_compare_build_artifacts",
    title: "Compare Build Artifacts",
    description: "Compara inventário de artefatos entre dois builds para identificar arquivos adicionados/removidos e diferenças de volume.",
    inputSchema: {
      type: "object",
      properties: {
        old_build_id: { type: ["number", "string"] },
        new_build_id: { type: ["number", "string"] },
        artifact_name: { type: "string", description: "Opcional: nome exato do artefato para comparar" },
      },
      required: ["old_build_id", "new_build_id"],
    },
  },
];

export function getToolCount() {
  return TOOL_DEFS.length;
}

// ─── Dispatch table ────────────────────────────────────────────────────────

const TOOL_HANDLERS = {
  tfs_analyze_work_item: (args) => toolAnalyzeWorkItem(args),
  tfs_work_item_context: (args) => toolWorkItemContext(args),
  tfs_specialist_review: (args) => toolSpecialistReview(args),
  tfs_prepare_refinement: (args) => toolPrepareRefinement(args),
  tfs_work_item: (args) => toolWorkItem(args),
  tfs_work_item_create: (args) => toolCreateWorkItem(args),
  tfs_generate_activity_template: (args) => toolGenerateActivityTemplate(args),
  tfs_generate_activity_template_from_items: (args) => toolGenerateActivityTemplateFromItems(args),
  tfs_query_work_items: (args) => toolQueryWorkItems(args),
  tfs_list_prs: (args) => toolListPRs(args),
  tfs_prepare_pr_review: (args) => toolPreparePRReview(args),
  tfs_release_readiness: (args) => toolReleaseReadiness(args),
  tfs_team_focus_report: (args) => toolTeamFocusReport(args),
  tfs_work_item_handoff: (args) => toolWorkItemHandoff(args),
  tfs_delivery_risk_report: (args) => toolDeliveryRiskReport(args),
  tfs_get_pr: (args) => toolGetPR(args),
  tfs_review_pr: (args) => toolReviewPR(args),
  tfs_pipeline_status: (args) => toolPipelineStatus(args),
  tfs_wiki: (args) => toolWiki(args),
  tfs_update_work_item: (args) => toolUpdateWorkItem(args),
  tfs_update_issue_analysis: (args) => toolUpdateIssueAnalysis(args),
  tfs_add_pr_comment: (args) => toolAddPRComment(args),
  tfs_comment_review_findings: (args) => toolCommentReviewFindings(args),
  tfs_sprint_info: (args) => toolSprintInfo(args),
  tfs_list_repos: (args) => toolListRepos(args),
  tfs_build_artifact_inventory: (args) => toolBuildArtifactInventory(args),
  tfs_compare_build_artifacts: (args) => toolCompareBuildArtifacts(args),
};

// ─── Server factory ────────────────────────────────────────────────────────

export function buildMcpServer() {
  const server = new Server(
    { name: "tfs-mcp", version: "2.0.0" },
    { capabilities: { tools: { listChanged: false } } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.map(withToolMetadata),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `Tool desconhecida: ${name}` }],
        isError: true,
      };
    }
    try {
      const context = {
        authAlias: typeof args?.auth_alias === "string" ? args.auth_alias : "",
        repo: typeof args?.repo === "string" ? args.repo : "",
      };
      const result = await runWithRequestContext(context, () => handler(args ?? {}));
      return formatToolResult(result);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Erro: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Entry point (stdio) ───────────────────────────────────────────────────

export async function startStdio() {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
