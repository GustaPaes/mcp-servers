import { defineTool, ok, fail } from '../toolKit.js';
import {
  AdCreativeDraftSchema,
  AdCreativeAnalysisInputSchema,
} from '../../schemas/creative.schema.js';
import { randomUUID } from 'node:crypto';

export const createAdCreativeDraftTool = defineTool({
  name: 'create_ad_creative_draft',
  mutating: true,
  description:
    'Cria rascunho local de criativo (copy, título, CTA, mídia/descrição). Não envia à Meta. Inclui análise heurística.',
  inputSchema: AdCreativeDraftSchema,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const state = await ctx.storage.read();
      const draft = {
        id: `crdraft_${randomUUID()}`,
        accountId: input.accountId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: input,
      };
      state.creativeDrafts.push(draft);
      await ctx.storage.write(state);

      const analysis = ctx.engines.creative.analyze(
        {
          accountId: input.accountId,
          headline: input.headline,
          primaryText: input.primaryText,
          description: input.description,
          cta: input.cta,
          landingPageUrl: input.landingPageUrl,
          productOrOffer: input.productOrOffer,
          imageDescription: input.media.description,
          imageUrl: input.media.url,
        },
        account,
      );

      return ok({ draft, analysis });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const analyzeAdCreativeTool = defineTool({
  name: 'analyze_ad_creative',
  description:
    'Analisa um criativo (copy, headline, CTA, descrição de imagem ou alt text) e retorna: público provável, riscos de política, sugestões de melhoria e plano A/B.',
  inputSchema: AdCreativeAnalysisInputSchema,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const analysis = ctx.engines.creative.analyze(input, account);
      ctx.audit.record({
        action: 'recommendation.generated',
        tool: 'analyze_ad_creative',
        accountId: input.accountId,
        result: {
          clarityScore: analysis.clarityScore,
          policyBlocked: analysis.policyBlocked,
        },
      });
      return ok(analysis);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const predictBestAudienceForAdTool = defineTool({
  name: 'predict_best_audience_for_ad',
  description:
    'Combina conteúdo do anúncio e perfil da conta para recomendar públicos com maior chance de performar. Respeita exclusões e políticas.',
  inputSchema: AdCreativeAnalysisInputSchema,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const creative = ctx.engines.creative.analyze(input, account);
      const strategy = ctx.engines.audience.recommend(account, {
        category: creative.productCategory,
        hasHistoricalConversions: (input.historicalMetrics?.conversions ?? 0) > 0,
      });
      return ok({
        productCategory: creative.productCategory,
        funnelStage: creative.funnelStage,
        audienceProbable: creative.audienceProbable,
        audienceToAvoid: creative.audienceToAvoid,
        recommendedApproach: strategy.recommendedApproach,
        rationale: strategy.rationale,
        initialTargeting: strategy.initialTargeting,
        notes: strategy.notes,
        policyBlocked: strategy.policyBlocked,
        policyFindings: strategy.policyFindings,
        disclaimer: creative.disclaimer,
      });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});
