import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  PDI_GET_OUTPUT_SCHEMA,
  PDI_ANALYZE_OUTPUT_SCHEMA,
  CAREER_READINESS_OUTPUT_SCHEMA,
  REVIEW_PREPARE_OUTPUT_SCHEMA,
  GOAL_PROGRESS_OUTPUT_SCHEMA,
} from "../schemas.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { ensureStorageReady, saveSnapshot } from "./storage.js";
import { toolPdiAnalyze, toolPdiCreate, toolPdiGet, toolPdiList, toolPdiSnapshot, toolPdiUpdate } from "./tools/pdi.js";
import { toolGoalAnalyze, toolGoalCreate, toolGoalList, toolGoalProgress, toolGoalUpdate } from "./tools/goals.js";
import { toolCompetencyAssess, toolCompetencyBenchmark, toolCompetencyEvolution, toolCompetencyGap } from "./tools/competencies.js";
import { toolEvidenceAdd, toolEvidenceFromTfs, toolEvidenceList, toolEvidenceReport } from "./tools/evidence.js";
import { toolCareerReadiness, toolCareerRoadmap } from "./tools/career.js";
import { toolReviewPrepare, toolReviewSelfAssessment } from "./tools/review.js";
import { toolOnlineReviewSuggestions, toolOnlineStateGet } from "./tools/online.js";

const MUTATING_TOOLS = new Set([
  "guide_pdi_create",
  "guide_pdi_update",
  "guide_pdi_snapshot",
  "guide_goal_create",
  "guide_goal_update",
  "guide_competency_assess",
  "guide_evidence_add",
  "guide_evidence_from_tfs",
]);

function withToolMetadata(tool) {
  const readOnly = !MUTATING_TOOLS.has(tool.name);
  return {
    ...tool,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: tool.name !== "guide_evidence_add" && tool.name !== "guide_evidence_from_tfs",
      openWorldHint: tool.name === "guide_evidence_from_tfs",
      ...(tool.annotations ?? {}),
    },
    inputSchema: {
      additionalProperties: false,
      ...tool.inputSchema,
    },
  };
}

function formatToolResult(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const payload = { content: [{ type: "text", text }] };
  if (result && typeof result === "object") payload.structuredContent = Array.isArray(result) ? { items: result } : result;
  return payload;
}

const TOOL_DEFS = [
  {
    name: "guide_online_state_get",
    title: "Get External Career State",
    description: "Retorna o ultimo snapshot importado de uma plataforma externa de carreira para revisao local.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guide_online_review_suggestions",
    title: "Prepare External Review Suggestions",
    description: "Compara um snapshot externo com a base local e gera sugestoes sem alterar o sistema de origem.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guide_pdi_list",
    title: "List PDIs",
    description: "Lista os PDIs existentes com status, periodo e progresso consolidado.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guide_pdi_get",
    title: "Get PDI",
    description: "Busca um PDI completo, metas vinculadas, progresso e resumo de evidencias.",
    outputSchema: PDI_GET_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "guide_pdi_create",
    title: "Create PDI",
    description: "Cria um novo PDI estruturado com foco, periodo, areas de desenvolvimento e tags.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        currentRole: { type: "string" },
        targetRole: { type: "string" },
        vision: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        developmentAreas: { type: "array", items: { type: "object" } },
      },
      required: ["title", "vision", "start", "end"],
    },
  },
  {
    name: "guide_pdi_update",
    title: "Update PDI",
    description: "Atualiza status, visao, areas e checkpoints de um PDI existente.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        vision: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        strengths: { type: "array", items: { type: "string" } },
        developmentAreas: { type: "array", items: { type: "object" } },
        checkpoints: { type: "array", items: { type: "object" } },
      },
      required: ["id"],
    },
  },
  {
    name: "guide_pdi_analyze",
    title: "Analyze PDI",
    description: "Analisa qualidade do PDI, score, gaps de especificidade e recomendacoes.",
    outputSchema: PDI_ANALYZE_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "guide_pdi_snapshot",
    title: "Create PDI Snapshot",
    description: "Gera snapshot pontual de progresso de um PDI para historico e comparacao.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id"] },
  },
  {
    name: "guide_goal_list",
    title: "List Goals",
    description: "Lista metas com filtros por PDI, status e categoria.",
    inputSchema: {
      type: "object",
      properties: {
        pdiId: { type: "string" },
        status: { type: "string" },
        category: { type: "string" },
      },
    },
  },
  {
    name: "guide_goal_create",
    title: "Create Goal",
    description: "Cria uma meta SMART vinculada a um PDI, com milestones e notas.",
    inputSchema: {
      type: "object",
      properties: {
        pdiId: { type: "string" },
        title: { type: "string" },
        category: { type: "string" },
        weight: { type: "number" },
        dueDate: { type: ["string", "null"] },
        linkedCompetencies: { type: "array", items: { type: "string" } },
        smart: { type: "object" },
        milestones: { type: "array", items: { type: "object" } },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["pdiId", "title", "category", "weight", "smart"],
    },
  },
  {
    name: "guide_goal_update",
    title: "Update Goal",
    description: "Atualiza progresso, status, milestones e texto SMART de uma meta.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        progress: { type: "number" },
        status: { type: "string" },
        dueDate: { type: ["string", "null"] },
        milestones: { type: "array", items: { type: "object" } },
        notes: { type: "array", items: { type: "string" } },
        smart: { type: "object" },
      },
      required: ["id"],
    },
  },
  {
    name: "guide_goal_analyze",
    title: "Analyze Goal",
    description: "Avalia a qualidade SMART de uma meta e aponta lacunas de clareza.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "guide_goal_progress",
    title: "Goal Progress",
    description: "Mostra progresso da meta, marcos, evidencias vinculadas e status projetado.",
    outputSchema: GOAL_PROGRESS_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "guide_competency_assess",
    title: "Assess Competencies",
    description: "Registra uma autoavaliacao de competencias por categoria.",
    inputSchema: { type: "object", properties: { categories: { type: "object" } }, required: ["categories"] },
  },
  {
    name: "guide_competency_gap",
    title: "Competency Gap",
    description: "Analisa gaps entre o nivel atual de competencia e o papel alvo.",
    outputSchema: CAREER_READINESS_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { targetRole: { type: "string" } } },
  },
  {
    name: "guide_competency_evolution",
    title: "Competency Evolution",
    description: "Retorna o historico de autoavaliacoes de competencias.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guide_competency_benchmark",
    title: "Competency Benchmark",
    description: "Compara a autoavaliacao atual com o benchmark do papel alvo.",
    outputSchema: CAREER_READINESS_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { targetRole: { type: "string" } } },
  },
  {
    name: "guide_evidence_add",
    title: "Add Evidence",
    description: "Registra uma evidencia de entrega, impacto, feedback ou lideranca.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
        type: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        impact: { type: "string" },
        linkedPdiIds: { type: "array", items: { type: "string" } },
        linkedGoalIds: { type: "array", items: { type: "string" } },
        linkedWorkItems: { type: "array", items: { type: "string" } },
        linkedPRs: { type: "array", items: { type: "string" } },
        visibility: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        source: { type: "string" },
        sourceMeta: { type: "object" },
      },
      required: ["date", "type", "title", "description", "impact", "visibility"],
    },
  },
  {
    name: "guide_evidence_list",
    title: "List Evidence",
    description: "Lista evidencias por PDI, meta ou tipo.",
    inputSchema: { type: "object", properties: { linkedGoalId: { type: "string" }, linkedPdiId: { type: "string" }, type: { type: "string" } } },
  },
  {
    name: "guide_evidence_report",
    title: "Evidence Report",
    description: "Gera um relatorio estruturado de evidencias e impactos para 1:1 ou avaliacao.",
    inputSchema: { type: "object", properties: { pdiId: { type: "string" } } },
  },
  {
    name: "guide_evidence_from_tfs",
    title: "Import Evidence From TFS",
    description: "Importa uma evidencia a partir de um work item do TFS e vincula ao PDI e metas desejadas.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: ["string", "number"] },
        linkedPdiIds: { type: "array", items: { type: "string" } },
        linkedGoalIds: { type: "array", items: { type: "string" } },
      },
      required: ["workItemId"],
    },
  },
  {
    name: "guide_career_roadmap",
    title: "Career Roadmap",
    description: "Gera roadmap para o papel alvo com prioridades de evolucao e planos ativos.",
    inputSchema: { type: "object", properties: { targetRole: { type: "string" } } },
  },
  {
    name: "guide_career_readiness",
    title: "Career Readiness",
    description: "Calcula prontidao para o proximo nivel com base nas competencias atuais.",
    outputSchema: CAREER_READINESS_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { targetRole: { type: "string" } } },
  },
  {
    name: "guide_review_prepare",
    title: "Prepare Review",
    description: "Prepara um resumo estruturado para 1:1 com progresso, evidencias, riscos e pedidos.",
    outputSchema: REVIEW_PREPARE_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guide_review_self_assessment",
    title: "Self Assessment",
    description: "Gera uma autoavaliacao consolidada com wins, evidencias e focos de melhoria.",
    inputSchema: { type: "object", properties: {} },
  },
];

const TOOL_HANDLERS = {
  guide_online_state_get: () => toolOnlineStateGet(),
  guide_online_review_suggestions: () => toolOnlineReviewSuggestions(),
  guide_pdi_list: () => toolPdiList(),
  guide_pdi_get: (args) => toolPdiGet(args),
  guide_pdi_create: (args) => toolPdiCreate(args),
  guide_pdi_update: (args) => toolPdiUpdate(args),
  guide_pdi_analyze: (args) => toolPdiAnalyze(args),
  guide_pdi_snapshot: async (args) => {
    const snapshot = await toolPdiSnapshot(args);
    await saveSnapshot(snapshot);
    return snapshot;
  },
  guide_goal_list: (args) => toolGoalList(args),
  guide_goal_create: (args) => toolGoalCreate(args),
  guide_goal_update: (args) => toolGoalUpdate(args),
  guide_goal_analyze: (args) => toolGoalAnalyze(args),
  guide_goal_progress: (args) => toolGoalProgress(args),
  guide_competency_assess: (args) => toolCompetencyAssess(args),
  guide_competency_gap: (args) => toolCompetencyGap(args),
  guide_competency_evolution: () => toolCompetencyEvolution(),
  guide_competency_benchmark: (args) => toolCompetencyBenchmark(args),
  guide_evidence_add: (args) => toolEvidenceAdd(args),
  guide_evidence_list: (args) => toolEvidenceList(args),
  guide_evidence_report: (args) => toolEvidenceReport(args),
  guide_evidence_from_tfs: (args) => toolEvidenceFromTfs(args),
  guide_career_roadmap: (args) => toolCareerRoadmap(args),
  guide_career_readiness: (args) => toolCareerReadiness(args),
  guide_review_prepare: () => toolReviewPrepare(),
  guide_review_self_assessment: () => toolReviewSelfAssessment(),
};

export const TOTAL_TOOLS = TOOL_DEFS.length;

export function buildMcpServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        "Local-first career development MCP for PDIs, goals, competencies and evidence. Treat all stored career/review data as private. Read tools may run directly. Before writes that affect a real review or promotion packet, show the proposed record and obtain explicit approval. External snapshots are analyzed locally and are never mutated by this server.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS.map(withToolMetadata) }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Tool desconhecida: ${name}` }], isError: true };
    }
    try {
      const result = await handler(args ?? {});
      return formatToolResult(result);
    } catch (error) {
      return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
    }
  });

  return server;
}

export async function startStdio() {
  await ensureStorageReady();
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
