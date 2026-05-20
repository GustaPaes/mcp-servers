import { z } from 'zod';

export const DatePresetSchema = z.enum([
  'today',
  'yesterday',
  'last_3d',
  'last_7d',
  'last_14d',
  'last_28d',
  'last_30d',
  'last_90d',
  'this_month',
  'last_month',
  'this_quarter',
  'maximum',
]);

export const InsightsLevelSchema = z.enum(['account', 'campaign', 'adset', 'ad']);

export const InsightsRequestSchema = z
  .object({
    accountId: z.string(),
    level: InsightsLevelSchema.default('campaign'),
    objectId: z.string().optional(),
    datePreset: DatePresetSchema.default('last_7d'),
    /** Optional custom range. Used only when datePreset is omitted/ignored. */
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    breakdowns: z
      .array(z.enum(['age', 'gender', 'country', 'region', 'platform_position', 'device_platform']))
      .max(3)
      .optional(),
  })
  .strict();

export type InsightsRequest = z.infer<typeof InsightsRequestSchema>;

export const InsightsRowSchema = z
  .object({
    objectId: z.string().optional(),
    name: z.string().optional(),
    spend: z.number().nonnegative().default(0),
    impressions: z.number().nonnegative().default(0),
    reach: z.number().nonnegative().default(0),
    clicks: z.number().nonnegative().default(0),
    ctr: z.number().nonnegative().default(0),
    cpc: z.number().nonnegative().default(0),
    cpm: z.number().nonnegative().default(0),
    frequency: z.number().nonnegative().default(0),
    conversions: z.number().nonnegative().default(0),
    cpa: z.number().nonnegative().optional(),
    roas: z.number().nonnegative().optional(),
    revenue: z.number().nonnegative().optional(),
    dateStart: z.string().optional(),
    dateStop: z.string().optional(),
    breakdowns: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type InsightsRow = z.infer<typeof InsightsRowSchema>;
