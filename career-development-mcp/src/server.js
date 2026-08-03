import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_RISK, annotationsForRisk, assertToolManifest } from "@gustapaes/mcp-runtime";
import {
  PDI_GET_OUTPUT_SCHEMA,
  PDI_ANALYZE_OUTPUT_SCHEMA,
  CAREER_READINESS_OUTPUT_SCHEMA,
  REVIEW_PREPARE_OUTPUT_SCHEMA,
  GOAL_PROGRESS_OUTPUT_SCHEMA,
  DEVELOPMENT_AREA_SCHEMA,
  DOCTOR_OUTPUT_SCHEMA,
  EVIDENCE_LIST_OUTPUT_SCHEMA,
  GOAL_LIST_OUTPUT_SCHEMA,
  PDI_LIST_OUTPUT_SCHEMA,
  SNAPSHOT_VALIDATE_OUTPUT_SCHEMA,
} from "../schemas.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { ensureStorageReady, saveSnapshot, withStorageMutation } from "./storage.js";
import { toolPdiAnalyze, toolPdiCreate, toolPdiGet, toolPdiList, toolPdiSnapshot, toolPdiUpdate } from "./tools/pdi.js";
import { toolGoalAnalyze, toolGoalCreate, toolGoalList, toolGoalProgress, toolGoalUpdate } from "./tools/goals.js";
import { toolCompetencyAssess, toolCompetencyBenchmark, toolCompetencyEvolution, toolCompetencyGap } from "./tools/competencies.js";
import { toolEvidenceAdd, toolEvidenceFromTfs, toolEvidenceList, toolEvidenceReport } from "./tools/evidence.js";
import { toolCareerReadiness, toolCareerRoadmap } from "./tools/career.js";
import { toolReviewPrepare, toolReviewSelfAssessment } from "./tools/review.js";
import { toolOnlineReviewSuggestions, toolOnlineStateGet } from "./tools/online.js";
import { toolSnapshotImport, toolSnapshotValidate } from "./tools/snapshots.js";
import { toolDailyBrief } from "./tools/daily.js";
import { toolCareerDoctor } from "./tools/doctor.js";

export { TOOL_RISK };

const TOOL_POLICIES = Object.freeze({
  guide_doctor: { risk: TOOL_RISK.READ, idempotent: true },
  guide_daily_brief: { risk: TOOL_RISK.READ, idempotent: true },
  guide_snapshot_validate: { risk: TOOL_RISK.READ, idempotent: true },
  guide_snapshot_import: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_online_state_get: { risk: TOOL_RISK.READ, idempotent: true },
  guide_online_review_suggestions: { risk: TOOL_RISK.READ, idempotent: true },
  guide_pdi_list: { risk: TOOL_RISK.READ, idempotent: true },
  guide_pdi_get: { risk: TOOL_RISK.READ, idempotent: true },
  guide_pdi_create: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_pdi_update: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_pdi_analyze: { risk: TOOL_RISK.READ, idempotent: true },
  guide_pdi_snapshot: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_goal_list: { risk: TOOL_RISK.READ, idempotent: true },
  guide_goal_create: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_goal_update: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_goal_analyze: { risk: TOOL_RISK.READ, idempotent: true },
  guide_goal_progress: { risk: TOOL_RISK.READ, idempotent: true },
  guide_competency_assess: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_competency_gap: { risk: TOOL_RISK.READ, idempotent: true },
  guide_competency_evolution: { risk: TOOL_RISK.READ, idempotent: true },
  guide_competency_benchmark: { risk: TOOL_RISK.READ, idempotent: true },
  guide_evidence_add: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  guide_evidence_list: { risk: TOOL_RISK.READ, idempotent: true },
  guide_evidence_report: { risk: TOOL_RISK.READ, idempotent: true },
  guide_evidence_from_tfs: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false, openWorld: true },
  guide_career_roadmap: { risk: TOOL_RISK.READ, idempotent: true },
  guide_career_readiness: { risk: TOOL_RISK.READ, idempotent: true },
  guide_review_prepare: { risk: TOOL_RISK.READ, idempotent: true },
  guide_review_self_assessment: { risk: TOOL_RISK.READ, idempotent: true },
});

function withToolMetadata(tool) {
  const policy = TOOL_POLICIES[tool.name];
  if (!policy) throw new Error(`Classificação de risco ausente para ${tool.name}.`);
  return {
    ...tool,
    annotations: {
      ...annotationsForRisk(policy.risk, {
        idempotent: policy.idempotent,
        openWorld: policy.openWorld,
      }),
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

const CHECKPOINT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: "string", minLength: 1, maxLength: 64 },
    status: { type: "string", enum: ["scheduled", "completed"] },
    notes: { type: "string", maxLength: 8000 },
    adjustments: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
  },
  required: ["date", "status"],
};

const MILESTONE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 512 },
    dueDate: { type: ["string", "null"], maxLength: 64 },
    completed: { type: "boolean" },
  },
  required: ["title"],
};

const SMART_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    specific: { type: "string", maxLength: 8000 },
    measurable: { type: "string", maxLength: 8000 },
    achievable: { type: "string", maxLength: 8000 },
    relevant: { type: "string", maxLength: 8000 },
    timeBound: { type: "string", maxLength: 8000 },
  },
};

const EXTERNAL_SNAPSHOT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 },
    capturedAt: { type: "string", minLength: 1, maxLength: 512 },
    url: { type: "string" },
    pageTitle: { type: "string", maxLength: 512 },
    visiblePlanCards: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceId: { type: ["string", "number"] },
          title: { type: "string", minLength: 1, maxLength: 512 },
          status: { type: "string", maxLength: 512 },
          progressPct: { type: "number", minimum: 0, maximum: 100 },
          period: { type: "string", maxLength: 512 },
          summary: { type: "string", maxLength: 8000 },
        },
        required: ["title"],
      },
    },
    apiResponses: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          status: { type: "number" },
          contentType: { type: "string", maxLength: 512 },
          detectedKeys: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
        },
        required: ["url", "status"],
      },
    },
  },
  required: ["schemaVersion", "capturedAt"],
};

const TOOL_DEFS = [
  {
    name: "guide_doctor",
    title: "Career MCP Doctor",
    description: "Valida armazenamento local, raízes de importação e disponibilidade da integração opcional com TFS sem expor caminhos privados.",
    outputSchema: DOCTOR_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guide_daily_brief",
    title: "Career Daily Brief",
    description: "Consolida PDIs ativos, metas vencidas ou proximas, bloqueios, lacunas de evidencia e estado do ultimo snapshot externo.",
    inputSchema: {
      type: "object",
      properties: {
        dueWithinDays: { type: "number", minimum: 1, maximum: 90, default: 14 },
      },
    },
  },
  {
    name: "guide_snapshot_validate",
    title: "Validate External Career Snapshot",
    description: "Valida um snapshot neutro e sanitizado sem persistir dados. O arquivo deve estar dentro de CAREER_MCP_IMPORT_ROOTS.",
    outputSchema: SNAPSHOT_VALIDATE_OUTPUT_SCHEMA,
    annotations: { openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, maxLength: 4096 },
        snapshot: EXTERNAL_SNAPSHOT_INPUT_SCHEMA,
      },
    },
  },
  {
    name: "guide_snapshot_import",
    title: "Import External Career Snapshot",
    description: "Importa e persiste um snapshot sanitizado de uma plataforma externa usando o schema publico versionado.",
    annotations: { openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, maxLength: 4096 },
        snapshot: EXTERNAL_SNAPSHOT_INPUT_SCHEMA,
        dryRun: { type: "boolean", default: true },
        expectedRevision: { type: "number", minimum: 0 },
      },
    },
  },
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
    outputSchema: PDI_LIST_OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "number", minimum: 0, maximum: 100000, default: 0 },
        limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
      },
    },
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
        title: { type: "string", minLength: 1, maxLength: 512 },
        currentRole: { type: "string", minLength: 1, maxLength: 512 },
        targetRole: { type: "string", minLength: 1, maxLength: 512 },
        vision: { type: "string", minLength: 1, maxLength: 8000 },
        start: { type: "string", minLength: 1, maxLength: 64 },
        end: { type: "string", minLength: 1, maxLength: 64 },
        strengths: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
        tags: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
        developmentAreas: { type: "array", maxItems: 100, items: DEVELOPMENT_AREA_SCHEMA },
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
        expectedRevision: { type: "number", minimum: 1 },
        status: { type: "string" },
        vision: { type: "string" },
        tags: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
        strengths: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
        developmentAreas: { type: "array", maxItems: 100, items: DEVELOPMENT_AREA_SCHEMA },
        checkpoints: { type: "array", maxItems: 100, items: CHECKPOINT_INPUT_SCHEMA },
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
    outputSchema: GOAL_LIST_OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      properties: {
        pdiId: { type: "string" },
        status: { type: "string" },
        category: { type: "string" },
        offset: { type: "number", minimum: 0, maximum: 100000, default: 0 },
        limit: { type: "number", minimum: 1, maximum: 100, default: 50 },
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
        linkedCompetencies: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 128 } },
        smart: SMART_INPUT_SCHEMA,
        milestones: { type: "array", maxItems: 100, items: MILESTONE_INPUT_SCHEMA },
        notes: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
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
        expectedRevision: { type: "number", minimum: 1 },
        title: { type: "string" },
        progress: { type: "number" },
        status: { type: "string" },
        dueDate: { type: ["string", "null"] },
        milestones: { type: "array", maxItems: 100, items: MILESTONE_INPUT_SCHEMA },
        notes: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 512 } },
        smart: SMART_INPUT_SCHEMA,
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
    inputSchema: { type: "object", properties: { offset: { type: "number", minimum: 0, maximum: 100000, default: 0 }, limit: { type: "number", minimum: 1, maximum: 100, default: 50 } } },
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
    outputSchema: EVIDENCE_LIST_OUTPUT_SCHEMA,
    inputSchema: { type: "object", properties: { linkedGoalId: { type: "string" }, linkedPdiId: { type: "string" }, type: { type: "string" }, offset: { type: "number", minimum: 0, maximum: 100000, default: 0 }, limit: { type: "number", minimum: 1, maximum: 100, default: 50 } } },
  },
  {
    name: "guide_evidence_report",
    title: "Evidence Report",
    description: "Gera um relatorio estruturado de evidencias e impactos para 1:1 ou avaliacao.",
    inputSchema: { type: "object", properties: { pdiId: { type: "string" }, offset: { type: "number", minimum: 0, maximum: 100000, default: 0 }, limit: { type: "number", minimum: 1, maximum: 100, default: 50 } } },
  },
  {
    name: "guide_evidence_from_tfs",
    title: "Import Evidence From TFS",
    description: "Importa uma evidencia a partir de um work item do TFS e vincula ao PDI e metas desejadas.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: { type: ["string", "number"], maxLength: 15 },
        linkedPdiIds: { type: "array", items: { type: "string" } },
        linkedGoalIds: { type: "array", items: { type: "string" } },
        type: { type: "string" },
        visibility: { type: "string" },
        impact: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        dryRun: { type: "boolean", default: true },
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
  guide_doctor: () => toolCareerDoctor(),
  guide_daily_brief: (args) => toolDailyBrief(args),
  guide_snapshot_validate: (args) => toolSnapshotValidate(args),
  guide_snapshot_import: (args) => toolSnapshotImport(args),
  guide_online_state_get: () => toolOnlineStateGet(),
  guide_online_review_suggestions: () => toolOnlineReviewSuggestions(),
  guide_pdi_list: (args) => toolPdiList(args),
  guide_pdi_get: (args) => toolPdiGet(args),
  guide_pdi_create: (args) => toolPdiCreate(args),
  guide_pdi_update: (args) => toolPdiUpdate(args),
  guide_pdi_analyze: (args) => toolPdiAnalyze(args),
  guide_pdi_snapshot: async (args) => {
    return withStorageMutation(async () => {
      const snapshot = await toolPdiSnapshot(args);
      await saveSnapshot(snapshot);
      return snapshot;
    });
  },
  guide_goal_list: (args) => toolGoalList(args),
  guide_goal_create: (args) => toolGoalCreate(args),
  guide_goal_update: (args) => toolGoalUpdate(args),
  guide_goal_analyze: (args) => toolGoalAnalyze(args),
  guide_goal_progress: (args) => toolGoalProgress(args),
  guide_competency_assess: (args) => toolCompetencyAssess(args),
  guide_competency_gap: (args) => toolCompetencyGap(args),
  guide_competency_evolution: (args) => toolCompetencyEvolution(args),
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

assertToolManifest({
  definitions: TOOL_DEFS,
  handlers: TOOL_HANDLERS,
  policies: TOOL_POLICIES,
  label: SERVER_NAME,
});

export const TOOL_MANIFEST = Object.freeze(TOOL_DEFS.map((definition) => Object.freeze({
  name: definition.name,
  definition: withToolMetadata(definition),
  handler: TOOL_HANDLERS[definition.name],
  policy: Object.freeze({ ...TOOL_POLICIES[definition.name] }),
})));
const TOOL_BY_NAME = new Map(TOOL_MANIFEST.map((entry) => [entry.name, entry]));

export const TOTAL_TOOLS = TOOL_MANIFEST.length;

export function buildMcpServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        "Local-first career development MCP for PDIs, goals, competencies and evidence. Treat all stored career/review data as private. Read tools may run directly. Before writes that affect a real review or promotion packet, show the proposed record and obtain explicit approval. External snapshots are analyzed locally and are never mutated by this server.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_MANIFEST.map((entry) => entry.definition) }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const entry = TOOL_BY_NAME.get(name);
    if (!entry) {
      return { content: [{ type: "text", text: `Tool desconhecida: ${name}` }], isError: true };
    }
    try {
      const result = await entry.handler(args ?? {});
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
