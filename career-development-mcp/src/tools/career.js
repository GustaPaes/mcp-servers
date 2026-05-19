import { z } from "zod";
import { loadProfile, loadCompetencies, listPdis, listGoals } from "../storage.js";
import { analyzeCompetencyGap } from "../analytics/competency-gap.js";
import { computePdiProgress } from "../analytics/progress-tracker.js";
import { getCareerRole } from "../frameworks/career-ladder.js";

export async function toolCareerReadiness(args) {
  const { targetRole } = z.object({ targetRole: z.string().optional() }).parse(args);
  const [profile, competencies] = await Promise.all([loadProfile(), loadCompetencies()]);
  const gap = analyzeCompetencyGap(competencies, targetRole ?? profile.targetRole);
  return {
    currentRole: profile.currentRole,
    targetRole: targetRole ?? profile.targetRole,
    readinessScore: gap.readinessScore,
    matchedCompetencies: gap.matchedCompetencies,
    missingCompetencies: gap.missingCompetencies,
    priorities: gap.priorities,
  };
}

export async function toolCareerRoadmap(args) {
  const { targetRole } = z.object({ targetRole: z.string().optional() }).parse(args);
  const [profile, competencies, pdis, goals] = await Promise.all([loadProfile(), loadCompetencies(), listPdis(), listGoals()]);
  const desiredRole = targetRole ?? profile.targetRole;
  const gap = analyzeCompetencyGap(competencies, desiredRole);
  const activePdis = pdis.filter((pdi) => pdi.status === "active" || pdi.status === "review");
  return {
    currentRole: profile.currentRole,
    targetRole: desiredRole,
    expectations: getCareerRole(desiredRole).expectations,
    readinessScore: gap.readinessScore,
    nextSteps: gap.priorities.slice(0, 5),
    activePlans: activePdis.map((pdi) => ({ id: pdi.id, title: pdi.title, progress: computePdiProgress(pdi, goals).overall })),
  };
}
