import { z } from "zod";
import {
  dateTextSchema,
  idListSchema,
  longTextSchema,
  optionalLongTextSchema,
  shortTextListSchema,
  shortTextSchema,
} from "./common.js";

export const actionSchema = z.object({
  id: shortTextSchema,
  title: shortTextSchema,
  description: longTextSchema,
  type: z.enum(["on_the_job", "training", "mentoring", "self_study", "community"]),
  dueDate: dateTextSchema.nullable().default(null),
  status: z.enum(["not_started", "in_progress", "completed", "blocked", "cancelled"]),
  linkedGoalIds: idListSchema.default([]),
  notes: shortTextListSchema.default([]),
}).strict();

export const developmentAreaSchema = z.object({
  id: shortTextSchema,
  area: shortTextSchema,
  category: z.enum(["technical", "leadership", "quality", "business", "delivery"]),
  currentLevel: z.number().min(1).max(5),
  targetLevel: z.number().min(1).max(5),
  rationale: longTextSchema,
  actions: z.array(actionSchema).max(100).default([]),
}).strict();

export const checkpointSchema = z.object({
  date: dateTextSchema,
  status: z.enum(["scheduled", "completed"]),
  notes: optionalLongTextSchema.default(""),
  adjustments: shortTextListSchema.default([]),
}).strict();

export const pdiSchema = z.object({
  id: shortTextSchema,
  title: shortTextSchema,
  status: z.enum(["draft", "active", "review", "completed", "archived"]),
  currentRole: shortTextSchema,
  targetRole: shortTextSchema,
  vision: longTextSchema,
  strengths: shortTextListSchema.default([]),
  tags: shortTextListSchema.default([]),
  goals: idListSchema.default([]),
  period: z.object({
    start: dateTextSchema,
    end: dateTextSchema,
  }).strict(),
  developmentAreas: z.array(developmentAreaSchema).max(100).default([]),
  checkpoints: z.array(checkpointSchema).max(100).default([]),
  revision: z.number().int().min(1).default(1),
  createdAt: dateTextSchema,
  updatedAt: dateTextSchema,
}).strict();
