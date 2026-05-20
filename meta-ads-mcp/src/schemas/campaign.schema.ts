import { z } from 'zod';
import { MetaObjectiveSchema } from './account.schema.js';

export const CampaignStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED']);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const SpecialAdCategorySchema = z.enum([
  'NONE',
  'EMPLOYMENT',
  'HOUSING',
  'CREDIT',
  'ISSUES_ELECTIONS_POLITICS',
  'ONLINE_GAMBLING_AND_GAMING',
]);

export const CampaignSchema = z
  .object({
    id: z.string(),
    name: z.string().min(2).max(400),
    status: CampaignStatusSchema,
    objective: MetaObjectiveSchema,
    dailyBudget: z.number().nonnegative().optional(),
    lifetimeBudget: z.number().nonnegative().optional(),
    specialAdCategories: z.array(SpecialAdCategorySchema).default(['NONE']),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();

export type Campaign = z.infer<typeof CampaignSchema>;

export const CampaignDraftSchema = z
  .object({
    accountId: z.string(),
    name: z.string().min(2).max(400),
    objective: MetaObjectiveSchema,
    dailyBudget: z.number().positive().optional(),
    lifetimeBudget: z.number().positive().optional(),
    specialAdCategories: z.array(SpecialAdCategorySchema).default(['NONE']),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine((d) => !!d.dailyBudget || !!d.lifetimeBudget, {
    message: 'Provide either dailyBudget or lifetimeBudget',
  });

export type CampaignDraft = z.infer<typeof CampaignDraftSchema>;
