import { z } from "zod";

export const actionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["on_the_job", "training", "mentoring", "self_study", "community"]),
  dueDate: z.string().nullable().default(null),
  status: z.enum(["not_started", "in_progress", "completed", "blocked", "cancelled"]),
  linkedGoalIds: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export const developmentAreaSchema = z.object({
  id: z.string().min(1),
  area: z.string().min(1),
  category: z.enum(["technical", "leadership", "quality", "business", "delivery"]),
  currentLevel: z.number().min(1).max(5),
  targetLevel: z.number().min(1).max(5),
  rationale: z.string().min(1),
  actions: z.array(actionSchema).default([]),
});

export const checkpointSchema = z.object({
  date: z.string(),
  status: z.enum(["scheduled", "completed"]),
  notes: z.string().default(""),
  adjustments: z.array(z.string()).default([]),
});

export const pdiSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["draft", "active", "review", "completed", "archived"]),
  currentRole: z.string().min(1),
  targetRole: z.string().min(1),
  vision: z.string().min(1),
  strengths: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  period: z.object({
    start: z.string(),
    end: z.string(),
  }),
  developmentAreas: z.array(developmentAreaSchema).default([]),
  checkpoints: z.array(checkpointSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
