import { z } from 'zod';
import { defineTool, ok, fail } from '../toolKit.js';
import { InsightsRowSchema } from '../../schemas/insights.schema.js';
import { checkCapability, checkMutationConfirmation } from '../../security/permissions.js';

const GoalsSchema = z
  .object({
    maxCpa: z.number().positive().optional(),
    minRoas: z.number().nonnegative().optional(),
    minCtr: z.number().nonnegative().optional(),
    maxFrequency: z.number().positive().optional(),
  })
  .strict();

export const analyzeCampaignPerformanceTool = defineTool({
  name: 'analyze_campaign_performance',
  description:
    'Analisa métricas de uma campanha contra metas (CPA, ROAS, CTR, Frequency) e classifica a performance.',
  inputSchema: z
    .object({
      accountId: z.string(),
      campaignId: z.string(),
      metrics: InsightsRowSchema,
      goals: GoalsSchema,
      currentDailyBudget: z.number().positive().optional(),
      inLearningPhase: z.boolean().optional(),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const recs = ctx.engines.optimization.analyze({
        account,
        campaignId: input.campaignId,
        metrics: input.metrics,
        goals: input.goals,
        currentDailyBudget: input.currentDailyBudget,
        inLearningPhase: input.inLearningPhase,
      });
      return ok({
        recommendations: recs,
        summary: {
          totalRecs: recs.length,
          highImpact: recs.filter((r) => r.impact === 'high').length,
          requireApproval: recs.filter((r) => r.requiresApproval).length,
        },
        disclaimer:
          'Recomendações heurísticas. Nenhuma alteração foi aplicada. Revise antes de aprovar.',
      });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const recommendCampaignOptimizationsTool = defineTool({
  name: 'recommend_campaign_optimizations',
  description:
    'Recomenda otimizações para uma campanha. NÃO executa nada com risco alto. Retorna plano para aprovação.',
  inputSchema: z
    .object({
      accountId: z.string(),
      campaignId: z.string(),
      metrics: InsightsRowSchema,
      goals: GoalsSchema,
      currentDailyBudget: z.number().positive().optional(),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const recs = ctx.engines.optimization.analyze({
        account,
        campaignId: input.campaignId,
        metrics: input.metrics,
        goals: input.goals,
        currentDailyBudget: input.currentDailyBudget,
      });
      ctx.audit.record({
        action: 'recommendation.generated',
        tool: 'recommend_campaign_optimizations',
        accountId: input.accountId,
        result: { count: recs.length },
      });
      return ok({ recommendations: recs });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const recommendAudienceStrategyTool = defineTool({
  name: 'recommend_audience_strategy',
  description:
    'Recomenda estratégia de público (Advantage+, Lookalike, Custom, Broad). Considera políticas e exclusões da conta.',
  inputSchema: z
    .object({
      accountId: z.string(),
      hasHistoricalConversions: z.boolean().optional(),
      hasCustomAudiences: z.boolean().optional(),
      hasLookalikeAudiences: z.boolean().optional(),
      category: z.string().optional(),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const strategy = ctx.engines.audience.recommend(account, input);
      return ok(strategy);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const generateTargetingSuggestionsTool = defineTool({
  name: 'generate_targeting_suggestions',
  description:
    'Gera sugestões de targeting (interesses, idade, geografia) compatíveis com a Meta API. Filtra atributos sensíveis.',
  inputSchema: z
    .object({
      accountId: z.string(),
      useAdvantageAudience: z.boolean().default(true),
      extraInterests: z.array(z.string()).max(20).default([]),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const interests = [...account.persona.interestsKeywords, ...input.extraInterests]
        .slice(0, 10)
        .map((name, i) => ({ id: String(6000000000000 + i), name }));
      const targeting = {
        geoLocations: { countries: [account.country] },
        ageMin: Math.max(account.persona.ageRange[0], 18),
        ageMax: Math.min(account.persona.ageRange[1], 65),
        interests,
        advantageAudience: input.useAdvantageAudience,
        publisherPlatforms: ['facebook', 'instagram'] satisfies Array<
          'facebook' | 'instagram' | 'audience_network' | 'messenger'
        >,
      };
      const policy = ctx.engines.policy.validateTargeting(targeting, account);
      return ok({ targeting, policy });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const adjustBudgetRecommendationTool = defineTool({
  name: 'adjust_budget_recommendation',
  description:
    'Recomenda ajuste de orçamento (sem aplicar) baseado em CPA, ROAS, frequência e limites da conta.',
  inputSchema: z
    .object({
      accountId: z.string(),
      objectId: z.string(),
      currentDailyBudget: z.number().positive(),
      metrics: InsightsRowSchema,
      goals: GoalsSchema,
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const rec = ctx.engines.budget.recommendChange({
        account,
        objectId: input.objectId,
        currentDailyBudget: input.currentDailyBudget,
        metrics: input.metrics,
        goals: input.goals,
      });
      return ok(rec);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const applyBudgetChangeTool = defineTool({
  name: 'apply_budget_change',
  description:
    'Aplica alteração de orçamento em um ad set. Exige confirm=true, reason, requestedBy e dryRun=false.',
  mutating: true,
  inputSchema: z
    .object({
      accountId: z.string(),
      adSetId: z.string(),
      currentDailyBudget: z.number().positive(),
      newDailyBudget: z.number().positive(),
      confirm: z.boolean(),
      reason: z.string().min(5),
      requestedBy: z.string().min(2),
      dryRun: z.boolean().default(true),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const cap = checkCapability(account, 'mutate.budget');
      if (!cap.allowed) return fail(cap.reason ?? 'capability denied');

      const change = input.newDailyBudget - input.currentDailyBudget;
      const changePct = (change / input.currentDailyBudget) * 100;
      const accountCap = account.budgetLimits.maxBudgetChangePct;
      if (Math.abs(changePct) > accountCap) {
        return fail(
          `Change ${changePct.toFixed(1)}% exceeds account cap ${accountCap}% (maxBudgetChangePct).`,
        );
      }
      if (Math.abs(change) > account.budgetLimits.maxPerExecutionChange) {
        return fail(
          `Absolute change ${Math.abs(change)} exceeds account maxPerExecutionChange ${account.budgetLimits.maxPerExecutionChange}.`,
        );
      }
      if (input.newDailyBudget > account.budgetLimits.maxDailyBudget) {
        return fail(
          `newDailyBudget ${input.newDailyBudget} exceeds account maxDailyBudget ${account.budgetLimits.maxDailyBudget}.`,
        );
      }

      const plan = {
        adSetId: input.adSetId,
        from: input.currentDailyBudget,
        to: input.newDailyBudget,
        changeAbs: change,
        changePct: Number(changePct.toFixed(2)),
      };

      const confirmation = checkMutationConfirmation(input);
      if (!confirmation.willMutate) {
        ctx.audit.record({
          action: 'mutation.dryrun',
          tool: 'apply_budget_change',
          accountId: input.accountId,
          reason: input.reason,
          requestedBy: input.requestedBy,
          result: plan,
          meta: { blockReason: confirmation.reason },
        });
        return ok({ dryRun: true, plan, blockReason: confirmation.reason });
      }

      const res = await ctx.meta.updateAdSetBudget(input.accountId, input.adSetId, input.newDailyBudget);
      ctx.audit.record({
        action: 'mutation.applied',
        tool: 'apply_budget_change',
        accountId: input.accountId,
        reason: input.reason,
        requestedBy: input.requestedBy,
        before: { dailyBudget: input.currentDailyBudget },
        after: { dailyBudget: input.newDailyBudget },
      });
      return ok({ applied: true, plan, response: res });
    } catch (e) {
      ctx.audit.record({
        action: 'mutation.failed',
        tool: 'apply_budget_change',
        accountId: input.accountId,
        reason: input.reason,
        requestedBy: input.requestedBy,
        error: (e as Error).message,
      });
      return fail((e as Error).message);
    }
  },
});

export const recommendAbTestsTool = defineTool({
  name: 'recommend_ab_tests',
  description: 'Sugere testes A/B prioritários (criativo, copy, CTA, público, posicionamento).',
  inputSchema: z
    .object({
      accountId: z.string(),
      campaignId: z.string().optional(),
      hypotheses: z.array(z.string()).max(10).optional(),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      return ok({
        tests: [
          {
            id: 'ab_creative_format',
            hypothesis: 'Vídeo curto supera imagem estática para esta persona.',
            variables: ['imagem estática', 'vídeo 9:16 <=15s'],
            metric: 'CTR e CPA',
            minDurationDays: 7,
            minBudgetPerCell: account.budgetLimits.maxDailyBudget * 0.1,
          },
          {
            id: 'ab_cta',
            hypothesis: 'CTA "SHOP_NOW" supera "LEARN_MORE" no estágio de decisão.',
            variables: ['SHOP_NOW', 'LEARN_MORE'],
            metric: 'CTR pós-clique e conversão',
            minDurationDays: 5,
          },
          {
            id: 'ab_audience',
            hypothesis: 'Advantage+ Audience supera interesses curados após semana 1.',
            variables: ['Advantage+', 'Interesses curados'],
            metric: 'CPA',
            minDurationDays: 10,
          },
        ],
        userHypotheses: input.hypotheses ?? [],
      });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});
