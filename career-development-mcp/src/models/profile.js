import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().min(1),
  currentRole: z.string().min(1),
  targetRole: z.string().min(1),
  context: z.string().default(""),
  strengths: z.array(z.string()).default([]),
  focusAreas: z.array(z.string()).default([]),
  managerAgreements: z.array(z.string()).default([]),
  updatedAt: z.string(),
});
