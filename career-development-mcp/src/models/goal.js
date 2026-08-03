import { z } from "zod";
import {
  dateTextSchema,
  idListSchema,
  optionalLongTextSchema,
  shortTextListSchema,
  shortTextSchema,
} from "./common.js";

export const milestoneSchema = z.object({
  title: shortTextSchema,
  dueDate: dateTextSchema.nullable().default(null),
  completed: z.boolean().default(false),
}).strict();

export const goalSchema = z.object({
  id: shortTextSchema,
  pdiId: shortTextSchema,
  title: shortTextSchema,
  category: z.enum(["technical", "leadership", "soft_skill", "business", "quality"]),
  weight: z.number().min(0).max(100),
  progress: z.number().min(0).max(100),
  dueDate: dateTextSchema.nullable().default(null),
  status: z.enum(["not_started", "in_progress", "completed", "blocked", "cancelled"]),
  linkedCompetencies: idListSchema.default([]),
  evidenceIds: idListSchema.default([]),
  smart: z.object({
    specific: optionalLongTextSchema.default(""),
    measurable: optionalLongTextSchema.default(""),
    achievable: optionalLongTextSchema.default(""),
    relevant: optionalLongTextSchema.default(""),
    timeBound: optionalLongTextSchema.default(""),
  }).strict(),
  milestones: z.array(milestoneSchema).max(100).default([]),
  notes: shortTextListSchema.default([]),
  revision: z.number().int().min(1).default(1),
  createdAt: dateTextSchema,
  updatedAt: dateTextSchema,
}).strict();
