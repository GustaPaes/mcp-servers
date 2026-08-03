import { z } from "zod";
import { dateTextSchema, optionalLongTextSchema, shortTextListSchema, shortTextSchema } from "./common.js";

export const profileSchema = z.object({
  name: shortTextSchema,
  currentRole: shortTextSchema,
  targetRole: shortTextSchema,
  context: optionalLongTextSchema.default(""),
  strengths: shortTextListSchema.default([]),
  focusAreas: shortTextListSchema.default([]),
  managerAgreements: shortTextListSchema.default([]),
  updatedAt: dateTextSchema,
}).strict();
