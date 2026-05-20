import { z } from 'zod';

/**
 * Persona / audience profile of an ad account. Intentionally avoids any
 * special-category attributes (race, religion, sexual orientation, health,
 * political views). Such fields are not accepted and will be rejected by Zod.
 */
export const PersonaSchema = z
  .object({
    summary: z.string().min(10).max(2000),
    ageRange: z
      .tuple([z.number().int().min(13).max(75), z.number().int().min(13).max(75)])
      .refine(([a, b]) => a <= b, 'ageRange[0] must be <= ageRange[1]'),
    interestsKeywords: z.array(z.string().min(2).max(60)).max(50).default([]),
  })
  .strict();

export const BudgetLimitsSchema = z
  .object({
    maxDailyBudget: z.number().positive().finite(),
    maxMonthlyBudget: z.number().positive().finite(),
    /** Maximum % a single execution may change a budget by. */
    maxBudgetChangePct: z.number().min(1).max(100),
    /** Maximum absolute change (account currency) a single execution may apply. */
    maxPerExecutionChange: z.number().positive().finite(),
  })
  .strict();

export const AudienceRestrictionsSchema = z
  .object({
    excludeRecentBuyersDays: z.number().int().min(0).max(365).default(0),
    blockedInterests: z.array(z.string().min(2).max(60)).max(200).default([]),
  })
  .strict();

export const AccountModeSchema = z.enum(['read-only', 'dry-run', 'write-enabled']);
export type AccountMode = z.infer<typeof AccountModeSchema>;

export const MetaObjectiveSchema = z.enum([
  'OUTCOME_AWARENESS',
  'OUTCOME_TRAFFIC',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_LEADS',
  'OUTCOME_APP_PROMOTION',
  'OUTCOME_SALES',
]);
export type MetaObjective = z.infer<typeof MetaObjectiveSchema>;

export const AccountConfigSchema = z
  .object({
    id: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-_]+$/i, 'id must be a slug'),
    name: z.string().min(2).max(200),
    /** Meta Ad Account ID, format act_<digits>. */
    adAccountId: z.string().regex(/^act_\d+$/, 'adAccountId must look like act_123...'),
    businessManagerId: z.string().regex(/^\d+$/).optional(),
    /** Name of the env var that holds the OAuth access token. NEVER the token itself. */
    tokenEnvVar: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]+$/, 'tokenEnvVar must be SHOUTING_SNAKE_CASE'),
    currency: z.string().length(3),
    timezone: z.string().min(3),
    country: z.string().length(2),
    niche: z.string().min(2).max(200),
    primaryObjective: MetaObjectiveSchema,
    persona: PersonaSchema,
    audienceRestrictions: AudienceRestrictionsSchema.default({
      excludeRecentBuyersDays: 0,
      blockedInterests: [],
    }),
    productsServices: z.array(z.string().min(2).max(200)).min(1).max(50),
    tone: z.string().min(2).max(300),
    budgetLimits: BudgetLimitsSchema,
    priorityConversionEvents: z.array(z.string().min(1).max(60)).default([]),
    pixelId: z.string().regex(/^\d+$/).optional(),
    capi: z
      .object({
        enabled: z.boolean(),
        datasetId: z.string().regex(/^\d+$/).optional(),
      })
      .strict()
      .optional(),
    facebookPageId: z.string().regex(/^\d+$/).optional(),
    instagramAccountId: z.string().regex(/^\d+$/).optional(),
    mode: AccountModeSchema.default('dry-run'),
    internalPolicies: z
      .object({
        forbiddenWords: z.array(z.string().min(2).max(80)).max(200).default([]),
        requireDisclaimerForOffers: z.boolean().default(false),
      })
      .strict()
      .default({ forbiddenWords: [], requireDisclaimerForOffers: false }),
  })
  .strict();

export type AccountConfig = z.infer<typeof AccountConfigSchema>;

export const AccountsFileSchema = z
  .object({
    $schema: z.string().optional(),
    accounts: z.array(AccountConfigSchema).min(1),
  })
  .strict();

export type AccountsFile = z.infer<typeof AccountsFileSchema>;
