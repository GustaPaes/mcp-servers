import { z } from 'zod';

/**
 * Targeting spec — intentionally minimal and SAFE.
 *
 * We deliberately do NOT expose targeting by protected/sensitive attributes:
 *   race, religion, sexual orientation, health, political affiliation,
 *   union membership, ethnicity, etc.
 *
 * Anything that could be used to discriminate is filtered out by
 * `validateSafeTargeting` in optimization/PolicyRiskEngine.ts.
 */
export const TargetingSpecSchema = z
  .object({
    geoLocations: z
      .object({
        countries: z.array(z.string().length(2)).optional(),
        cities: z
          .array(
            z.object({
              key: z.string(),
              radius: z.number().int().min(1).max(80).optional(),
              distanceUnit: z.enum(['mile', 'kilometer']).optional(),
            }),
          )
          .optional(),
        regions: z.array(z.object({ key: z.string() })).optional(),
      })
      .partial()
      .optional(),
    ageMin: z.number().int().min(13).max(75).optional(),
    ageMax: z.number().int().min(13).max(75).optional(),
    /** Interests by Meta interest_id and name (validated against blocked list). */
    interests: z
      .array(z.object({ id: z.string().regex(/^\d+$/), name: z.string() }))
      .max(100)
      .optional(),
    /** Behaviors by Meta behavior_id and name. */
    behaviors: z
      .array(z.object({ id: z.string().regex(/^\d+$/), name: z.string() }))
      .max(50)
      .optional(),
    customAudiences: z.array(z.object({ id: z.string() })).max(50).optional(),
    excludedCustomAudiences: z.array(z.object({ id: z.string() })).max(50).optional(),
    /** When true, request Advantage+ Audience expansion. */
    advantageAudience: z.boolean().optional(),
    publisherPlatforms: z
      .array(z.enum(['facebook', 'instagram', 'audience_network', 'messenger']))
      .optional(),
    facebookPositions: z.array(z.string()).optional(),
    instagramPositions: z.array(z.string()).optional(),
  })
  .strict();

export type TargetingSpec = z.infer<typeof TargetingSpecSchema>;

export const AdSetBillingEventSchema = z.enum(['IMPRESSIONS', 'LINK_CLICKS', 'THRUPLAY']);
export const AdSetOptimizationGoalSchema = z.enum([
  'REACH',
  'IMPRESSIONS',
  'LINK_CLICKS',
  'LANDING_PAGE_VIEWS',
  'OFFSITE_CONVERSIONS',
  'VALUE',
  'LEAD_GENERATION',
  'QUALITY_LEAD',
  'THRUPLAY',
]);

export const AdSetSchema = z
  .object({
    id: z.string(),
    campaignId: z.string(),
    name: z.string().min(2).max(400),
    status: z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED']),
    dailyBudget: z.number().nonnegative().optional(),
    lifetimeBudget: z.number().nonnegative().optional(),
    optimizationGoal: AdSetOptimizationGoalSchema,
    billingEvent: AdSetBillingEventSchema,
    targeting: TargetingSpecSchema.optional(),
  })
  .strict();

export type AdSet = z.infer<typeof AdSetSchema>;

export const AdSetDraftSchema = z
  .object({
    accountId: z.string(),
    campaignId: z.string().optional(),
    campaignDraftId: z.string().optional(),
    name: z.string().min(2).max(400),
    dailyBudget: z.number().positive().optional(),
    lifetimeBudget: z.number().positive().optional(),
    optimizationGoal: AdSetOptimizationGoalSchema,
    billingEvent: AdSetBillingEventSchema,
    targeting: TargetingSpecSchema,
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine((d) => !!d.campaignId || !!d.campaignDraftId, {
    message: 'Provide campaignId or campaignDraftId',
  });

export type AdSetDraft = z.infer<typeof AdSetDraftSchema>;
