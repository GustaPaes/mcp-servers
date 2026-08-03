import { z } from "zod";
import { competenciesSchema } from "../models/competency.js";
import { loadCompetencies, saveCompetencies, loadProfile, withStorageMutation } from "../storage.js";
import { analyzeCompetencyGap } from "../analytics/competency-gap.js";
import { optionalLongTextSchema, paginate, paginationSchema, shortTextSchema } from "../models/common.js";

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function toolCompetencyAssess(args) {
  const { categories } = z.object({
    categories: z.record(z.record(z.object({
      level: z.number().min(1).max(5),
      target: z.number().min(1).max(5),
      evidence: optionalLongTextSchema.default(""),
    }).strict())),
  }).strict().parse(args);
  return withStorageMutation(async () => {
    const current = competenciesSchema.parse(await loadCompetencies());
    const updated = competenciesSchema.parse({
      ...current,
      lastUpdated: nowDate(),
      assessments: [...current.assessments, { date: nowDate(), categories }],
    });
    await saveCompetencies(updated);
    return updated;
  });
}

export async function toolCompetencyGap(args) {
  const { targetRole } = z.object({ targetRole: shortTextSchema.optional() }).strict().parse(args);
  const [competencies, profile] = await Promise.all([loadCompetencies(), loadProfile()]);
  return analyzeCompetencyGap(competenciesSchema.parse(competencies), targetRole ?? profile.targetRole);
}

export async function toolCompetencyEvolution(args = {}) {
  const pagination = paginationSchema.parse(args);
  const competencies = competenciesSchema.parse(await loadCompetencies());
  return {
    lastUpdated: competencies.lastUpdated,
    ...paginate(competencies.assessments, pagination),
  };
}

export async function toolCompetencyBenchmark(args) {
  return toolCompetencyGap(args);
}
