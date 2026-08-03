import { listPdis, listGoals, loadEvidenceLog, loadProfile, loadCompetencies } from "../storage.js";
import { computePdiProgress } from "../analytics/progress-tracker.js";
import { analyzeCompetencyGap } from "../analytics/competency-gap.js";
import { buildRecognitionNarrative } from "../analytics/recognition-builder.js";

function pickActivePdi(pdis) {
  return pdis.find((pdi) => pdi.status === "active") ?? pdis.find((pdi) => pdi.status === "review") ?? pdis[0] ?? null;
}

export async function toolReviewPrepare() {
  const [pdis, goals, evidenceLog, profile, competencies] = await Promise.all([
    listPdis(),
    listGoals(),
    loadEvidenceLog(),
    loadProfile(),
    loadCompetencies(),
  ]);
  const activePdi = pickActivePdi(pdis);
  if (!activePdi) throw new Error("Nenhum PDI encontrado para preparar review.");
  const progress = computePdiProgress(activePdi, goals);
  const linkedEvidence = evidenceLog.evidences.filter((evidence) => evidence.linkedPdiIds.includes(activePdi.id));
  const evidenceHighlights = linkedEvidence.slice(-5).reverse().map((evidence) => `${evidence.title}: ${evidence.impact}`);
  const gap = analyzeCompetencyGap(competencies, activePdi.targetRole);
  const wins = linkedEvidence.slice(-3).reverse().map((evidence) => evidence.title);
  const risks = [
    ...(progress.overdueActions > 0 ? [`${progress.overdueActions} acao(oes) vencidas no plano.`] : []),
    ...gap.priorities.slice(0, 2),
  ];
  const asks = [
    "Validar com a liderança quais evidências demonstram melhor a maturidade esperada para o papel-alvo.",
    "Alinhar tempo e suporte necessários para executar as próximas ações prioritárias do plano.",
  ];

  return {
    summary: buildRecognitionNarrative({ profile, pdi: activePdi, progress, evidenceHighlights, gaps: gap.priorities.slice(0, 3) }),
    activePdi: {
      id: activePdi.id,
      title: activePdi.title,
      status: activePdi.status,
      currentRole: activePdi.currentRole,
      targetRole: activePdi.targetRole,
      progress: progress.overall,
      period: activePdi.period,
      tags: activePdi.tags,
    },
    wins,
    evidenceHighlights,
    risks,
    asks,
  };
}

export async function toolReviewSelfAssessment() {
  const review = await toolReviewPrepare();
  return {
    generatedAt: new Date().toISOString(),
    narrative: review.summary,
    wins: review.wins,
    evidenceHighlights: review.evidenceHighlights,
    improvementFocus: review.risks,
  };
}
