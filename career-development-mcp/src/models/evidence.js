import { z } from "zod";

export const evidenceSchema = z.object({
  id: z.string().min(1),
  date: z.string(),
  type: z.enum(["delivery", "feedback", "certification", "presentation", "mentoring", "code_review", "leadership", "quality"]),
  title: z.string().min(1),
  description: z.string().min(1),
  impact: z.string().min(1),
  linkedPdiIds: z.array(z.string()).default([]),
  linkedGoalIds: z.array(z.string()).default([]),
  linkedWorkItems: z.array(z.string()).default([]),
  linkedPRs: z.array(z.string()).default([]),
  visibility: z.enum(["self", "team", "org"]),
  tags: z.array(z.string()).default([]),
  source: z.enum(["manual", "tfs"]),
  sourceMeta: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});

export const evidenceLogSchema = z.object({
  evidences: z.array(evidenceSchema).default([]),
});
