import { z } from 'zod';

export const CallToActionTypeSchema = z.enum([
  'SHOP_NOW',
  'LEARN_MORE',
  'SIGN_UP',
  'SUBSCRIBE',
  'CONTACT_US',
  'GET_QUOTE',
  'APPLY_NOW',
  'DOWNLOAD',
  'BOOK_TRAVEL',
  'GET_OFFER',
  'SEND_MESSAGE',
  'WATCH_MORE',
  'INSTALL_APP',
  'PLAY_GAME',
]);

export const CreativeMediaSchema = z
  .object({
    type: z.enum(['image', 'video', 'carousel', 'collection']),
    /** Public URL or asset hash. We never upload binaries through MCP. */
    url: z.string().url().optional(),
    /** Hash already uploaded to Meta. */
    hash: z.string().optional(),
    /** Manual description / alt text for the asset (used by AI when image cannot be processed). */
    description: z.string().max(2000).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export const AdCreativeDraftSchema = z
  .object({
    accountId: z.string(),
    name: z.string().min(2).max(400),
    headline: z.string().min(2).max(120),
    primaryText: z.string().min(2).max(2000),
    description: z.string().max(300).optional(),
    cta: CallToActionTypeSchema,
    landingPageUrl: z.string().url(),
    media: CreativeMediaSchema,
    productOrOffer: z.string().min(2).max(400),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type AdCreativeDraft = z.infer<typeof AdCreativeDraftSchema>;

/**
 * Input for analyze_ad_creative / predict_best_audience_for_ad. The image is
 * always optional — `imageDescription` is the fallback used by the engine.
 */
export const AdCreativeAnalysisInputSchema = z
  .object({
    accountId: z.string(),
    headline: z.string().min(2).max(120),
    primaryText: z.string().min(2).max(2000),
    description: z.string().max(300).optional(),
    cta: CallToActionTypeSchema,
    landingPageUrl: z.string().url().optional(),
    productOrOffer: z.string().min(2).max(400),
    imageDescription: z.string().max(2000).optional(),
    imageUrl: z.string().url().optional(),
    historicalMetrics: z
      .object({
        impressions: z.number().nonnegative().optional(),
        clicks: z.number().nonnegative().optional(),
        ctr: z.number().nonnegative().optional(),
        cpc: z.number().nonnegative().optional(),
        cpm: z.number().nonnegative().optional(),
        conversions: z.number().nonnegative().optional(),
        cpa: z.number().nonnegative().optional(),
        roas: z.number().nonnegative().optional(),
        frequency: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .strict();

export type AdCreativeAnalysisInput = z.infer<typeof AdCreativeAnalysisInputSchema>;
