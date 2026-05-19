import { z } from "zod";

export const competencyItemSchema = z.object({
  level: z.number().min(1).max(5),
  target: z.number().min(1).max(5),
  evidence: z.string().default(""),
});

export const competencyAssessmentSchema = z.object({
  date: z.string(),
  categories: z.record(z.record(competencyItemSchema)),
});

export const competenciesSchema = z.object({
  lastUpdated: z.string().nullable().default(null),
  assessments: z.array(competencyAssessmentSchema).default([]),
});
