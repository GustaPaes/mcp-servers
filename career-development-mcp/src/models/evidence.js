import { z } from "zod";
import { dateTextSchema, idListSchema, longTextSchema, shortTextListSchema, shortTextSchema } from "./common.js";

export const evidenceSchema = z.object({
  id: shortTextSchema,
  date: dateTextSchema,
  type: z.enum(["delivery", "feedback", "certification", "presentation", "mentoring", "code_review", "leadership", "quality"]),
  title: shortTextSchema,
  description: longTextSchema,
  impact: longTextSchema,
  linkedPdiIds: idListSchema.default([]),
  linkedGoalIds: idListSchema.default([]),
  linkedWorkItems: idListSchema.default([]),
  linkedPRs: idListSchema.default([]),
  visibility: z.enum(["self", "team", "org"]),
  tags: shortTextListSchema.default([]),
  source: z.enum(["manual", "tfs"]),
  sourceMeta: z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 16_384, "sourceMeta excede 16 KiB").default({}),
  createdAt: dateTextSchema,
}).strict();

export const evidenceLogSchema = z.object({
  evidences: z.array(evidenceSchema).max(10_000).default([]),
}).strict();
