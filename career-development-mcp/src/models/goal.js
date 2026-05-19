import { z } from "zod";

export const milestoneSchema = z.object({
  title: z.string().min(1),
  dueDate: z.string().nullable().default(null),
  completed: z.boolean().default(false),
});

export const goalSchema = z.object({
  id: z.string().min(1),
  pdiId: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(["technical", "leadership", "soft_skill", "business", "quality"]),
  weight: z.number().min(0).max(100),
  progress: z.number().min(0).max(100),
  dueDate: z.string().nullable().default(null),
  status: z.enum(["not_started", "in_progress", "completed", "blocked", "cancelled"]),
  linkedCompetencies: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  smart: z.object({
    specific: z.string().default(""),
    measurable: z.string().default(""),
    achievable: z.string().default(""),
    relevant: z.string().default(""),
    timeBound: z.string().default(""),
  }),
  milestones: z.array(milestoneSchema).default([]),
  notes: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
