import { z } from "zod";
import { dateTextSchema, optionalLongTextSchema } from "./common.js";

export const competencyItemSchema = z.object({
  level: z.number().min(1).max(5),
  target: z.number().min(1).max(5),
  evidence: optionalLongTextSchema.default(""),
}).strict();

export const competencyAssessmentSchema = z.object({
  date: dateTextSchema,
  categories: z.record(z.record(competencyItemSchema)),
}).strict();

export const competenciesSchema = z.object({
  lastUpdated: dateTextSchema.nullable().default(null),
  assessments: z.array(competencyAssessmentSchema).max(1_000).default([]),
}).strict();
