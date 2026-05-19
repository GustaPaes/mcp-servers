import { getTargetMatrix } from "../frameworks/competency-matrix.js";

export function analyzeCompetencyGap(competencies, targetRole) {
  const latest = competencies.assessments.at(-1) ?? { categories: {} };
  const target = getTargetMatrix(targetRole);
  const matchedCompetencies = [];
  const missingCompetencies = [];
  const priorities = [];
  let total = 0;
  let achieved = 0;

  for (const [category, items] of Object.entries(target)) {
    const actualItems = latest.categories?.[category] ?? {};
    for (const [key, targetLevel] of Object.entries(items)) {
      total += 1;
      const currentLevel = actualItems?.[key]?.level ?? 0;
      if (currentLevel >= targetLevel) {
        achieved += 1;
        matchedCompetencies.push(`${category}.${key}`);
      } else {
        const gap = targetLevel - currentLevel;
        missingCompetencies.push(`${category}.${key}`);
        priorities.push(`${category}.${key}: elevar de ${currentLevel} para ${targetLevel} (gap ${gap})`);
      }
    }
  }

  return {
    readinessScore: total ? Number(((achieved / total) * 100).toFixed(2)) : 0,
    matchedCompetencies,
    missingCompetencies,
    priorities,
    latestAssessment: latest,
    target,
  };
}
