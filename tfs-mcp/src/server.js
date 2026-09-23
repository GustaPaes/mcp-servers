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
  BRANCH_POLICY_UPSERT_OUTPUT_SCHEMA,
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
  toolCreatePR,
  toolUpdatePR,
  toolAddPRComment,
  toolResolvePRThread,
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
import { toolQueuePipeline, toolUpsertYamlPipeline } from "./tools/pipeline.js";
import { toolUpsertBuildValidationPolicy, toolListPolicies, toolUpsertStatusPolicy, toolToggleBuildValidationPolicy } from "./tools/branch-policy.js";
import { toolSavedQueriesList, toolTfsDoctor } from "./tools/doctor.js";
import { toolListCollections, toolListProjects } from "./tools/collections.js";
import { runWithRequestContext } from "./request-context.js";
import { MutationControlsSchema } from "./safety.js";

const SensitiveMutationControlsSchema = {
  ...MutationControlsSchema,
  dry_run: {
    type: "boolean",
    default: true,
    description: "Defaults to true. Set false only after reviewing the returned mutation plan.",
  },
};
import { redactSensitiveValue } from "@gustapaes/mcp-runtime";
import { TFS_URL } from "./config.js";
import { assertTrustedTfsUrl } from "./tfs-client.js";
import { annotationsForRisk, assertToolManifest } from "@gustapaes/mcp-runtime";
import { TOOL_POLICY } from "./tool-policy.js";
import {
  applyContractLimits,
  boundToolResult,
  GENERIC_OBJECT_OUTPUT_SCHEMA,
  validateToolArguments,
} from "./tool-contract.js";

// ─── Tool metadata helpers ─────────────────────────────────────────────────

function withToolMetadata(tool) {
  const policy = TOOL_POLICY[tool.name];
  const inputProperties = {
    ...(tool.inputSchema?.properties ?? {}),
    auth_alias: {
      type: "string",
      description: "Alias do PAT TFS configurado no .env (ex: joao, maria)",
    },
    collection: { type: "string", minLength: 1, description: "Collection da instalação TFS para esta chamada." },
    project: { type: "string", minLength: 1, description: "Projeto dentro da collection selecionada." },
  };
  return {
    ...tool,
    outputSchema: tool.outputSchema ?? GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: {
      ...annotationsForRisk(policy.risk, policy),
      ...(tool.annotations ?? {}),
      ...annotationsForRisk(policy.risk, policy),
    },
    inputSchema: applyContractLimits({
      additionalProperties: false,
      ...tool.inputSchema,
      properties: inputProperties,
    }),
  };
}

function formatToolResult(result) {
  const bounded = boundToolResult(result);
  const text = JSON.stringify(bounded, null, 2);
  const payload = { content: [{ type: "text", text }] };
  payload.structuredContent = bounded;
  return payload;
}

// ─── Tool definitions ──────────────────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: "tfs_list_collections",
    title: "List Project Collections",
    description: "Lista collections visíveis para o PAT na instalação. Se a descoberta não for permitida, retorna somente a lista local configurada com aviso explícito.",
    inputSchema: { type: "object", properties: {
      top: { type: "integer", minimum: 1, maximum: 100, default: 100 },
      cursor: { type: "string", maxLength: 512 },
    } },
  },
  {
    name: "tfs_list_projects",
    title: "List Projects",
    description: "Lista projetos visíveis na collection selecionada, com paginação.",
    inputSchema: { type: "object", properties: {
      top: { type: "integer", minimum: 1, maximum: 100, default: 100 },
      cursor: { type: "string", maxLength: 512 },
    } },
  },
  {
    name: "tfs_doctor",
    title: "TFS MCP Doctor",
    description: "Valida configuração, autenticação, repositórios, perfis e consultas salvas sem expor PATs. A conectividade é opcional.",
    inputSchema: {
      type: "object",
      properties: {
        check_connectivity: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "tfs_saved_queries",
    title: "List Saved Queries",
    description: "Lista os nomes das consultas WIQL configuradas localmente em TFS_MCP_CONFIG_FILE.",
    inputSchema: { type: "object", properties: {} },
  },
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
      "Busca detalhes completos de um work item pelo ID. Retorna titulo, estado, descricao, criterios de aceite, story points, iteracao e hierarquia; opcionalmente inclui o mapa bruto de campos.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"], description: "ID ou URL do work item" },
        include_fields: {
          type: "boolean",
          default: false,
          description: "Inclui todos os campos retornados pelo TFS, indexados por reference name.",
        },
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
        business_acceptance_criteria: {
          type: "string",
          description:
            "HTML rico para criterios de aceite de negocio exibidos no campo padrao Acceptance Criteria. Se omitido, extrai o bloco de criterios de negocio da description.",
        },
        assigned_to: { type: "string", description: "Nome ou email do responsavel" },
        area_path: { type: "string", description: "Area path (default: area do projeto)" },
        iteration_path: { type: "string", description: "Iteration path (default: iteracao atual)" },
        story_points: { type: "number", description: "Story points / esforco" },
        priority: { type: "number", enum: [1, 2, 3, 4], description: "Prioridade: 1 (alta) a 4 (baixa)" },
        parent_id: { type: "number", description: "ID do work item pai para criar hierarquia" },
        tags: { type: "string", description: "Tags separadas por ponto-e-virgula" },
        custom_fields: {
          type: "object",
          description:
            "Campos adicionais indexados pelo reference name. Defaults específicos do processo devem ser configurados em TFS_WORK_ITEM_PROFILES_JSON.",
          additionalProperties: true,
        },
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
    name: "tfs_create_pr",
    title: "Create Pull Request",
    description:
      "Cria Pull Request com titulo e descricao padronizados em portugues e vincula work_item_ids como ArtifactLinks reais, com reconciliacao idempotente e resultado por item.",
    inputSchema: {
      type: "object",
      properties: {
        source_branch: { type: "string", description: "Branch de origem, sem refs/heads/." },
        target_branch: { type: "string", description: "Branch de destino, sem refs/heads/." },
        repo: { type: "string" },
        titulo: { type: "string", description: "Titulo obrigatoriamente em portugues." },
        resumo: { type: "string", description: "Resumo em portugues do objetivo e impacto da mudanca." },
        alteracoes: { type: "array", items: { type: "string" } },
        validacoes: { type: "array", items: { type: "string" } },
        work_item_ids: {
          type: "array",
          items: { type: ["number", "string"] },
          description: "IDs vinculados ao PR como ArtifactLinks reais; duplicatas sao ignoradas.",
        },
        ...MutationControlsSchema,
      },
      required: ["source_branch", "target_branch", "titulo", "resumo"],
    },
  },
  {
    name: "tfs_update_pr",
    title: "Update Pull Request",
    description:
      "Atualiza titulo e descricao de um Pull Request ativo e adiciona work_item_ids como ArtifactLinks reais sem duplicar vinculos existentes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"] },
        repo: { type: "string" },
        titulo: { type: "string", description: "Titulo obrigatoriamente em portugues." },
        resumo: { type: "string", description: "Resumo em portugues do objetivo e impacto da mudanca." },
        alteracoes: { type: "array", items: { type: "string" } },
        validacoes: { type: "array", items: { type: "string" } },
        work_item_ids: {
          type: "array",
          items: { type: ["number", "string"] },
          description: "IDs adicionados ao PR como ArtifactLinks reais; vinculos existentes nao sao duplicados nem removidos.",
        },
        ...MutationControlsSchema,
      },
      required: ["id", "titulo", "resumo"],
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
      "Prepara uma revisao de PR com especialistas automaticos por arquivos alterados e area afetada. Pipelines sao associadas somente por repositorio e identidade do PR ou SHA, nunca apenas pela branch alvo.",
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
    description: "Detalhes completos de um PR: metadata, reviewers, work items vinculados, threads com comentarios e arquivos da iteracao mais recente.",
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
    name: "tfs_pipeline_upsert",
    title: "Create or Update YAML Pipeline",
    description: "Cria ou atualiza uma definição de pipeline YAML de forma genérica, com controle explícito do override de CI, dry-run, confirmação e auditoria. Não aceita segredos como variáveis.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        yaml_path: { type: "string", description: "Caminho do YAML relativo à raiz do repositório" },
        repository: { type: "string", description: "Nome ou ID; usa o repositório padrão quando omitido" },
        default_branch: {
          type: "string",
          description: "Branch da definição; quando omitido, usa o padrão do repositório",
        },
        pool_name: { type: "string", description: "Nome da fila/pool padrão da definição" },
        ci_trigger_mode: {
          type: "string",
          enum: ["preserve", "yaml", "disabled"],
          default: "preserve",
          description: "Controle do CI da definição: preserve mantém a configuração atual; yaml usa o trigger declarado no YAML; disabled desabilita somente o CI e preserva outros tipos de gatilho",
        },
        folder: { type: "string", default: "\\" },
        variables: {
          type: "object",
          description: "Variáveis enviadas como não secretas; não informe credenciais ou tokens",
          maxProperties: 100,
          additionalProperties: { type: ["string", "number", "boolean"], maxLength: 4000 },
        },
        ...SensitiveMutationControlsSchema,
      },
      required: ["name", "yaml_path"],
    },
  },
  {
    name: "tfs_pipeline_queue",
    title: "Queue Pipeline Run",
    description: "Enfileira diretamente uma execução existente por ID ou nome, branch e parâmetros YAML, com auditoria e dry-run opcional. Não exige confirmação porque não altera a definição.",
    inputSchema: {
      type: "object",
      properties: {
        definition_id: { type: "number" },
        definition_name: { type: "string" },
        branch: {
          type: "string",
          description: "Branch da execução; quando omitido, usa o padrão da definição",
        },
        template_parameters: {
          type: "object",
          description: "Parâmetros YAML não secretos, limitados a 64 KiB",
          additionalProperties: true,
        },
        variables: {
          type: "object",
          description: "Variáveis enviadas como não secretas; não informe credenciais ou tokens",
          maxProperties: 100,
          additionalProperties: { type: ["string", "number", "boolean"], maxLength: 4000 },
        },
        dry_run: {
          type: "boolean",
          default: false,
          description: "Quando true, retorna somente a prévia. Por padrão, enfileira a execução e registra a auditoria.",
        },
      },
    },
  },
  {
    name: "tfs_branch_policy_upsert",
    title: "Create or Update Build Validation Branch Policy",
    description: "Cria ou atualiza uma Build Validation policy por repositório, branch e pipeline. Serializa a identidade no processo, relê o estado persistido, falha diante de ambiguidades e exige dry-run, confirmação, auditoria e confirmação adicional para alvos de alto impacto.",
    outputSchema: BRANCH_POLICY_UPSERT_OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", minLength: 1, description: "Nome ou ID; usa o repositório padrão quando omitido" },
        branch: { type: "string", minLength: 1, description: "Branch protegida, com ou sem o prefixo refs/heads/" },
        branch_match_kind: {
          type: "string",
          enum: ["exact", "prefix"],
          default: "exact",
          description: "Correspondência exata ou por prefixo para o escopo da branch",
        },
        build_definition_id: { type: "integer", minimum: 1, description: "ID da pipeline de validação" },
        build_definition_name: { type: "string", minLength: 1, description: "Nome exato da pipeline, quando o ID não for informado" },
        allow_cross_repository: {
          type: "boolean",
          default: false,
          description: "Permite explicitamente uma pipeline ligada a outro repositório; o plano marca essa exceção como alto impacto",
        },
        display_name: { type: "string", minLength: 1, maxLength: 256, description: "Nome exibido na policy; usa o nome da pipeline quando omitido" },
        filename_patterns: {
          type: "array",
          maxItems: 100,
          items: { type: "string", maxLength: 512 },
          default: [],
          description: "Filtros de caminho da policy. Informe um padrão por item; vazio aplica a policy a todos os arquivos.",
        },
        enabled: { type: "boolean", default: true },
        blocking: { type: "boolean", default: true },
        manual_queue_only: { type: "boolean", default: false },
        queue_on_source_update_only: { type: "boolean", default: false },
        valid_duration: {
          type: "integer",
          minimum: 0,
          maximum: 525600,
          default: 0,
          description: "Validade em minutos; deve ser zero quando queue_on_source_update_only for false",
        },
        ...SensitiveMutationControlsSchema,
      },
      required: ["branch"],
      anyOf: [
        { required: ["build_definition_id"] },
        { required: ["build_definition_name"] },
      ],
    },
  },
  {
    name: "tfs_policy_list",
    title: "List Branch Policies",
    description: "Lista policies por repositório, branch, tipo, definição e correspondência de escopo sem alterar o TFS.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string" },
        branch: { type: "string" },
        policy_type: { type: "string", enum: ["build", "status", "all"], default: "all" },
        build_definition_id: { type: "integer", minimum: 1 },
        branch_match_kind: { type: "string", enum: ["exact", "prefix"] },
      },
    },
  },
  {
    name: "tfs_status_policy_upsert",
    title: "Create or Update Status Policy",
    description: "Cria ou atualiza uma Status Policy com escopo explícito, revisão concorrente e confirmação de alto impacto.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string" },
        branch: { type: "string", minLength: 1 },
        branch_match_kind: { type: "string", enum: ["exact", "prefix"], default: "exact" },
        status_name: { type: "string", minLength: 1 },
        status_genre: { type: "string", minLength: 1 },
        enabled: { type: "boolean", default: true },
        blocking: { type: "boolean", default: true },
        invalidate_on_source_update: { type: "boolean", default: true },
        apply_by_default: { type: "boolean", default: true },
        authorized_identity_id: { type: "string", minLength: 1 },
        ...SensitiveMutationControlsSchema,
      },
      required: ["branch", "status_name", "status_genre"],
    },
  },
  {
    name: "tfs_build_validation_toggle",
    title: "Enable or Disable Build Validation",
    description: "Habilita ou desabilita uma Build Validation por ID, relendo a revisão antes da escrita e permitindo rollback seguro.",
    inputSchema: {
      type: "object",
      properties: {
        policy_id: { type: "integer", minimum: 1 },
        enabled: { type: "boolean" },
        ...SensitiveMutationControlsSchema,
      },
      required: ["policy_id", "enabled"],
    },
  },
  {
    name: "tfs_wiki",
    title: "Wiki Explorer",
    description:
      "Lista todas as wikis, busca paginas recursivamente, le conteudo por caminho e enumera arvores de paginas aninhadas.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "search", "read", "tree"], description: "Operacao. Quando omitida, e inferida por search/path." },
        search: { type: "string", description: "Busca recursiva no caminho das paginas" },
        wiki: { type: "string", description: "Nome ou ID da wiki; quando omitido, consulta todas" },
        path: { type: "string", description: "Caminho exato para read ou raiz para tree" },
        url: { type: "string", description: "URL de uma pagina da Wiki; action=read resolve o caminho aninhado automaticamente" },
        include_content: { type: "boolean", description: "Inclui conteudo completo em search/tree; read sempre inclui", default: false },
        skip: { type: "number", description: "Deslocamento para paginar search/tree", default: 0, minimum: 0 },
        top: { type: "number", default: 50, maximum: 1000 },
      },
    },
  },
  {
    name: "tfs_update_work_item",
    title: "Update Work Item",
    description:
      "Atualiza um work item: muda estado, reatribui, adiciona comentario/historico, altera titulo, story points, descricao ou criterios de aceite. " +
      "Os campos description e acceptance_criteria aceitam HTML rico - o servidor decodifica entidades automaticamente caso o cliente MCP envie a string HTML-encoded (&lt;b&gt;...). " +
      "Campos específicos do processo podem ser enviados por reference name em custom_fields ou removidos por remove_fields.",
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
        business_acceptance_criteria: {
          type: "string",
          description:
            "HTML rico para criterios de negocio exibidos no campo padrao Acceptance Criteria.",
        },
        saved_query: {
          type: "string",
          description: "Nome de uma consulta WIQL configurada localmente. Use tfs_saved_queries para listar.",
        },
        story_points: { type: "number" },
        custom_fields: {
          type: "object",
          description: "Campos adicionais indexados pelo reference name.",
          additionalProperties: true,
        },
        remove_fields: {
          type: "array",
          description: "Reference names dos campos que devem ser removidos.",
          items: { type: "string" },
        },
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
    name: "tfs_resolve_pr_thread",
    title: "Resolve Pull Request Thread",
    description: "Marca uma thread de review do Pull Request como corrigida.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["number", "string"] },
        repo: { type: "string" },
        thread_id: { type: "number" },
        ...MutationControlsSchema,
      },
      required: ["id", "thread_id"],
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
        dry_run: { type: "boolean", default: false },
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
  tfs_doctor: (args) => toolTfsDoctor(args),
  tfs_list_collections: (args) => toolListCollections(args),
  tfs_list_projects: (args) => toolListProjects(args),
  tfs_saved_queries: () => toolSavedQueriesList(),
  tfs_analyze_work_item: (args) => toolAnalyzeWorkItem(args),
  tfs_work_item_context: (args) => toolWorkItemContext(args),
  tfs_specialist_review: (args) => toolSpecialistReview(args),
  tfs_prepare_refinement: (args) => toolPrepareRefinement(args),
  tfs_work_item: (args) => toolWorkItem(args),
  tfs_work_item_create: (args) => toolCreateWorkItem(args),
  tfs_generate_activity_template: (args) => toolGenerateActivityTemplate(args),
  tfs_generate_activity_template_from_items: (args) => toolGenerateActivityTemplateFromItems(args),
  tfs_query_work_items: (args) => toolQueryWorkItems(args),
  tfs_create_pr: (args) => toolCreatePR(args),
  tfs_update_pr: (args) => toolUpdatePR(args),
  tfs_list_prs: (args) => toolListPRs(args),
  tfs_prepare_pr_review: (args) => toolPreparePRReview(args),
  tfs_release_readiness: (args) => toolReleaseReadiness(args),
  tfs_team_focus_report: (args) => toolTeamFocusReport(args),
  tfs_work_item_handoff: (args) => toolWorkItemHandoff(args),
  tfs_delivery_risk_report: (args) => toolDeliveryRiskReport(args),
  tfs_get_pr: (args) => toolGetPR(args),
  tfs_review_pr: (args) => toolReviewPR(args),
  tfs_pipeline_status: (args) => toolPipelineStatus(args),
  tfs_pipeline_upsert: (args) => toolUpsertYamlPipeline(args),
  tfs_pipeline_queue: (args) => toolQueuePipeline(args),
  tfs_branch_policy_upsert: (args) => toolUpsertBuildValidationPolicy(args),
  tfs_policy_list: (args) => toolListPolicies(args),
  tfs_status_policy_upsert: (args) => toolUpsertStatusPolicy(args),
  tfs_build_validation_toggle: (args) => toolToggleBuildValidationPolicy(args),
  tfs_wiki: (args) => toolWiki(args),
  tfs_update_work_item: (args) => toolUpdateWorkItem(args),
  tfs_update_issue_analysis: (args) => toolUpdateIssueAnalysis(args),
  tfs_add_pr_comment: (args) => toolAddPRComment(args),
  tfs_resolve_pr_thread: (args) => toolResolvePRThread(args),
  tfs_comment_review_findings: (args) => toolCommentReviewFindings(args),
  tfs_sprint_info: (args) => toolSprintInfo(args),
  tfs_list_repos: (args) => toolListRepos(args),
  tfs_build_artifact_inventory: (args) => toolBuildArtifactInventory(args),
  tfs_compare_build_artifacts: (args) => toolCompareBuildArtifacts(args),
};

assertToolManifest({ definitions: TOOL_DEFS, handlers: TOOL_HANDLERS, policies: TOOL_POLICY, label: "TFS MCP" });
export const PUBLISHED_TOOL_DEFS = TOOL_DEFS.map(withToolMetadata);

// ─── Server factory ────────────────────────────────────────────────────────

export function buildMcpServer() {
  const server = new Server(
    { name: "tfs-mcp", version: "2.1.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        "TFS/Azure DevOps Server workflows. Routine requested operations, such as creating or editing pull requests, comments and work-item fields, execute directly; use dry_run:true when a preview is useful. Pipeline-definition and branch-policy edits remain preview-first. High-impact targets and destructive changes require a reviewed plan plus explicit confirmation. Never invent confirm_high_impact values or expose PATs/private payloads.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: PUBLISHED_TOOL_DEFS,
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
        collection: typeof args?.collection === "string" ? args.collection : "",
        project: typeof args?.project === "string" ? args.project : "",
      };
      const definition = PUBLISHED_TOOL_DEFS.find((tool) => tool.name === name);
      validateToolArguments(definition.inputSchema, args ?? {});
      for (const value of [args?.url, args?.id]) {
        if (typeof value !== "string" || !/^https?:\/\//i.test(value)) continue;
        const url = assertTrustedTfsUrl(value);
        const rootPath = new URL(TFS_URL).pathname.replace(/\/+$/, "");
        const relative = url.pathname.slice(rootPath.length).split("/").filter(Boolean);
        if (relative.length < 2) throw new Error("URL TFS deve identificar collection e projeto.");
        const [urlCollection, urlProject] = relative.map(decodeURIComponent);
        if (context.collection && context.collection.toLowerCase() !== urlCollection.toLowerCase()) {
          throw new Error("A collection da URL difere da collection selecionada.");
        }
        if (context.project && context.project.toLowerCase() !== urlProject.toLowerCase()) {
          throw new Error("O projeto da URL difere do projeto selecionado.");
        }
        context.collection ||= urlCollection;
        context.project ||= urlProject;
      }
      const { auth_alias: _authAlias, collection: _collection, project: _project, ...toolArgs } = args ?? {};
      const result = await runWithRequestContext(context, () => handler(toolArgs));
      return formatToolResult(result);
    } catch (err) {
      const safeMessage = String(redactSensitiveValue(err?.message ?? String(err)))
        .replaceAll(TFS_URL, "<tfs-endpoint>");
      return {
        content: [{ type: "text", text: `Erro: ${safeMessage}` }],
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
