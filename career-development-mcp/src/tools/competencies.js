import { z } from "zod";
import { competenciesSchema } from "../models/competency.js";
import { loadCompetencies, saveCompetencies, loadProfile } from "../storage.js";
import { analyzeCompetencyGap } from "../analytics/competency-gap.js";

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function toolCompetencyAssess(args) {
  const { categories } = z.object({ categories: z.record(z.record(z.object({ level: z.number(), target: z.number(), evidence: z.string().default("") }))) }).parse(args);
  const current = competenciesSchema.parse(await loadCompetencies());
  const updated = competenciesSchema.parse({
    ...current,
    lastUpdated: nowDate(),
    assessments: [...current.assessments, { date: nowDate(), categories }],
  });
  await saveCompetencies(updated);
  return updated;
}

export async function toolCompetencyGap(args) {
  const { targetRole } = z.object({ targetRole: z.string().optional() }).parse(args);
  const [competencies, profile] = await Promise.all([loadCompetencies(), loadProfile()]);
  return analyzeCompetencyGap(competenciesSchema.parse(competencies), targetRole ?? profile.targetRole);
}

export async function toolCompetencyEvolution() {
  return competenciesSchema.parse(await loadCompetencies());
}

export async function toolCompetencyBenchmark(args) {
  return toolCompetencyGap(args);
}
