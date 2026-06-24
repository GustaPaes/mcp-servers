import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

async function seedFixtureData(dataDir) {
  const timestamp = nowIso();
  const pdiId = "pdi-ci-validation-2026";
  const goalId = "goal-ci-validation-2026";

  await Promise.all([
    fs.mkdir(path.join(dataDir, "pdis"), { recursive: true }),
    fs.mkdir(path.join(dataDir, "goals"), { recursive: true }),
    fs.mkdir(path.join(dataDir, "online"), { recursive: true }),
    fs.mkdir(path.join(dataDir, "snapshots"), { recursive: true }),
  ]);

  const profile = {
    name: "CI Validator",
    currentRole: "Analista Desenvolvedor Pleno",
    targetRole: "Analista Desenvolvedor Senior",
    context: "Fixture minima para validar o surface do MCP em CI.",
    strengths: ["ownership", "delivery"],
    focusAreas: ["architecture", "communication"],
    managerAgreements: ["evidenciar impacto tecnico com regularidade"],
    updatedAt: timestamp,
  };

  const competencies = {
    lastUpdated: timestamp,
    assessments: [
      {
        date: timestamp,
        categories: {
          technical: {
            architecture: { level: 3, target: 4, evidence: "Conduz componentes de media complexidade." },
          },
          leadership: {
            communication: { level: 3, target: 4, evidence: "Conduz alinhamentos tecnicos de rotina." },
          },
        },
      },
    ],
  };

  const pdi = {
    id: pdiId,
    title: "PDI de validacao da CI",
    status: "active",
    currentRole: profile.currentRole,
    targetRole: profile.targetRole,
    vision: "Evoluir para senior com mais consistencia em arquitetura e influencia tecnica.",
    strengths: profile.strengths,
    tags: ["ci", "validation"],
    goals: [goalId],
    period: { start: "2026-01-01", end: "2026-12-31" },
    developmentAreas: [
      {
        id: "arch-growth",
        area: "Arquitetura",
        category: "technical",
        currentLevel: 3,
        targetLevel: 4,
        rationale: "Aumentar autonomia em decisoes estruturais.",
        actions: [
          {
            id: "arch-study",
            title: "Estudar padroes de modularizacao",
            description: "Consolidar repertorio para decompor servicos e contratos.",
            type: "self_study",
            dueDate: "2026-08-01",
            status: "in_progress",
            linkedGoalIds: [goalId],
            notes: ["Revisar decisoes recentes do backend."],
          },
        ],
      },
    ],
    checkpoints: [
      { date: "2026-06-30", status: "scheduled", notes: "Checkpoint semestral.", adjustments: [] },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const goal = {
    id: goalId,
    pdiId,
    title: "Conduzir uma melhoria arquitetural ponta a ponta",
    category: "technical",
    weight: 60,
    progress: 40,
    dueDate: "2026-09-30",
    status: "in_progress",
    linkedCompetencies: ["technical.architecture"],
    evidenceIds: ["evidence-ci-validation-2026"],
    smart: {
      specific: "Conduzir uma melhoria arquitetural ponta a ponta.",
      measurable: "Entregar proposta, execucao e evidencias da melhoria.",
      achievable: "Usar um servico do time com escopo controlado.",
      relevant: "Aumenta prontidao para o papel senior.",
      timeBound: "Concluir ate o fim do terceiro trimestre de 2026.",
    },
    milestones: [
      { title: "Definir proposta", dueDate: "2026-07-15", completed: true },
      { title: "Executar rollout", dueDate: "2026-09-15", completed: false },
    ],
    notes: ["Documentar trade-offs e impacto operacional."],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const evidenceLog = {
    evidences: [
      {
        id: "evidence-ci-validation-2026",
        date: "2026-06-01",
        type: "delivery",
        title: "Entrega de melhoria arquitetural",
        description: "Implementacao de um ajuste estrutural com rollout controlado.",
        impact: "Reduziu atrito operacional e melhorou clareza de ownership.",
        linkedPdiIds: [pdiId],
        linkedGoalIds: [goalId],
        linkedWorkItems: [],
        linkedPRs: ["PR-123"],
        visibility: "team",
        tags: ["architecture"],
        source: "manual",
        sourceMeta: {},
        createdAt: timestamp,
      },
    ],
  };

  await Promise.all([
    fs.writeFile(path.join(dataDir, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(dataDir, "competencies.json"), `${JSON.stringify(competencies, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(dataDir, "evidence-log.json"), `${JSON.stringify(evidenceLog, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(dataDir, "pdis", `${pdiId}.json`), `${JSON.stringify(pdi, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(dataDir, "goals", `${goalId}.json`), `${JSON.stringify(goal, null, 2)}\n`, "utf8"),
  ]);
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "career-development-mcp-ci-"));
  await seedFixtureData(dataDir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...process.env,
      CAREER_MCP_DATA_DIR: dataDir,
    },
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }

  const client = new Client({ name: "career-development-mcp-validator", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const requiredTools = [
      "guide_pdi_get",
      "guide_pdi_analyze",
      "guide_goal_progress",
      "guide_career_readiness",
      "guide_review_prepare",
    ];

    const available = new Set(tools.tools.map((tool) => tool.name));
    for (const toolName of requiredTools) {
      if (!available.has(toolName)) throw new Error(`Tool obrigatoria ausente: ${toolName}`);
    }

    const pdis = await client.callTool({ name: "guide_pdi_list", arguments: {} });
    const firstPdi = pdis.structuredContent?.items?.[0] ?? pdis.structuredContent?.[0];
    if (!firstPdi?.id) throw new Error("Nenhum PDI inicial encontrado para validacao.");

    const pdiDetail = await client.callTool({ name: "guide_pdi_get", arguments: { id: firstPdi.id } });
    const pdiAnalysis = await client.callTool({ name: "guide_pdi_analyze", arguments: { id: firstPdi.id } });
    const goalList = await client.callTool({ name: "guide_goal_list", arguments: { pdiId: firstPdi.id } });
    const firstGoal = goalList.structuredContent?.items?.[0] ?? goalList.structuredContent?.[0];
    const goalProgress = firstGoal?.id
      ? await client.callTool({ name: "guide_goal_progress", arguments: { id: firstGoal.id } })
      : null;
    const readiness = await client.callTool({ name: "guide_career_readiness", arguments: {} });
    const review = await client.callTool({ name: "guide_review_prepare", arguments: {} });

    console.log(JSON.stringify({
      toolCount: tools.tools.length,
      sampledPdi: firstPdi.id,
      hasPdiStructured: Boolean(pdiDetail.structuredContent),
      hasAnalysisStructured: Boolean(pdiAnalysis.structuredContent),
      hasGoalStructured: Boolean(goalProgress?.structuredContent),
      hasReadinessStructured: Boolean(readiness.structuredContent),
      hasReviewStructured: Boolean(review.structuredContent),
    }, null, 2));
  } finally {
    try {
      await client.close();
    } catch {}
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
