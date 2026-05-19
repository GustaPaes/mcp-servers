import { analyzeSmartGoal } from "../frameworks/smart-goals.js";

export function scorePdiQuality(pdi, goals, evidenceLog) {
  const pdiGoals = goals.filter((goal) => goal.pdiId === pdi.id);
  const smartScores = pdiGoals.map((goal) => analyzeSmartGoal(goal).score);
  const avgSmart = smartScores.length ? smartScores.reduce((sum, value) => sum + value, 0) / smartScores.length : 0;
  const actions = pdi.developmentAreas.flatMap((area) => area.actions);
  const actionTypes = new Set(actions.map((action) => action.type));
  const linkedEvidence = evidenceLog.evidences.filter((evidence) => evidence.linkedPdiIds.includes(pdi.id));

  let score = 0;
  if (pdi.developmentAreas.length >= 3) score += 20;
  if (pdi.checkpoints.length >= 2) score += 15;
  if (pdi.tags.length >= 2) score += 10;
  if (actionTypes.size >= 3) score += 15;
  if (linkedEvidence.length >= 2) score += 10;
  score += avgSmart * 0.3;

  const strengths = [];
  const gaps = [];
  const recommendations = [];

  if (pdi.developmentAreas.length >= 3) strengths.push("O PDI cobre multiplas frentes de desenvolvimento.");
  else gaps.push("O PDI cobre poucas frentes e pode ficar estreito demais.");

  if (avgSmart >= 70) strengths.push("As metas estao suficientemente especificas e mensuraveis.");
  else gaps.push("As metas ainda precisam ficar menos genericas e mais verificaveis.");

  if (linkedEvidence.length >= 2) strengths.push("Ja existe historico de evidencias conectando execucao ao PDI.");
  else gaps.push("Faltam evidencias registradas para sustentar progresso e reconhecimento.");

  recommendations.push("Transformar acoes amplas em entregas menores com criterio objetivo de conclusao.");
  recommendations.push("Adicionar checkpoints mensais com ajustes de escopo e riscos.");
  recommendations.push("Vincular novas entregas do ano como evidencias aos objetivos ja ativos.");

  return {
    score: Number(Math.min(100, score).toFixed(2)),
    summary: `PDI com ${pdiGoals.length} metas, ${actions.length} acoes e ${linkedEvidence.length} evidencias vinculadas.`,
    strengths,
    gaps,
    recommendations,
    smartGoals: pdiGoals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      score: analyzeSmartGoal(goal).score,
    })),
  };
}
