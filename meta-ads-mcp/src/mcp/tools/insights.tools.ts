import { z } from 'zod';
import { defineTool, ok, fail } from '../toolKit.js';
import { InsightsRequestSchema, type InsightsRow } from '../../schemas/insights.schema.js';
import type { MetaInsightsDTO } from '../../meta/types.js';

function toInsightsRow(d: MetaInsightsDTO, account: { priorityConversionEvents: string[] }): InsightsRow {
  const num = (v: unknown) => (v == null ? 0 : Number(v));
  const purchaseRoas = d.purchase_roas?.[0]?.value;
  // Find a "conversion" action consistent with account priority events.
  const targetEvent =
    account.priorityConversionEvents.find((ev) =>
      d.actions?.some((a) => a.action_type.toLowerCase().includes(ev.toLowerCase())),
    ) ?? account.priorityConversionEvents[0];
  const conversionsRaw =
    d.actions?.find((a) =>
      targetEvent ? a.action_type.toLowerCase().includes(targetEvent.toLowerCase()) : false,
    )?.value ?? '0';
  const conversions = Number(conversionsRaw);
  const cpaRaw =
    d.cost_per_action_type?.find((c) =>
      targetEvent ? c.action_type.toLowerCase().includes(targetEvent.toLowerCase()) : false,
    )?.value;
  return {
    spend: num(d.spend),
    impressions: num(d.impressions),
    reach: num(d.reach),
    clicks: num(d.clicks),
    ctr: num(d.ctr),
    cpc: num(d.cpc),
    cpm: num(d.cpm),
    frequency: num(d.frequency),
    conversions,
    cpa: cpaRaw != null ? Number(cpaRaw) : undefined,
    roas: purchaseRoas != null ? Number(purchaseRoas) : undefined,
    revenue:
      d.action_values?.find((v) =>
        targetEvent ? v.action_type.toLowerCase().includes(targetEvent.toLowerCase()) : false,
      )?.value != null
        ? Number(
            d.action_values?.find((v) =>
              targetEvent ? v.action_type.toLowerCase().includes(targetEvent.toLowerCase()) : false,
            )?.value,
          )
        : undefined,
    dateStart: d.date_start,
    dateStop: d.date_stop,
  };
}

export const getCampaignInsightsTool = defineTool({
  name: 'get_campaign_insights',
  description:
    'Busca métricas (spend, impressions, reach, clicks, CTR, CPC, CPM, conversions, CPA, ROAS, frequency) de campanha/adset/ad.',
  inputSchema: InsightsRequestSchema,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const res = await ctx.meta.getInsights(input.accountId, {
        level: input.level,
        objectId: input.objectId,
        datePreset: input.datePreset,
        since: input.since,
        until: input.until,
        breakdowns: input.breakdowns,
      });
      const rows = res.data.map((d) => toInsightsRow(d, account));
      return ok({ count: rows.length, rows });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const getAdSetInsightsTool = defineTool({
  name: 'get_ad_set_insights',
  description: 'Métricas detalhadas por conjunto de anúncios, com possibilidade de breakdowns.',
  inputSchema: InsightsRequestSchema.extend({ level: z.literal('adset').default('adset') }),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const res = await ctx.meta.getInsights(input.accountId, {
        level: 'adset',
        objectId: input.objectId,
        datePreset: input.datePreset,
        since: input.since,
        until: input.until,
        breakdowns: input.breakdowns,
      });
      const rows = res.data.map((d) => toInsightsRow(d, account));
      return ok({ count: rows.length, rows });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const generatePerformanceReportTool = defineTool({
  name: 'generate_performance_report',
  description: 'Relatório resumido (account/campaign/adset) com totais e KPIs principais.',
  inputSchema: InsightsRequestSchema,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const res = await ctx.meta.getInsights(input.accountId, input);
      const rows = res.data.map((d) => toInsightsRow(d, account));
      const totals = rows.reduce(
        (acc, r) => {
          acc.spend += r.spend;
          acc.impressions += r.impressions;
          acc.clicks += r.clicks;
          acc.conversions += r.conversions;
          acc.revenue += r.revenue ?? 0;
          return acc;
        },
        { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
      );
      const ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
      const cpc = totals.clicks ? totals.spend / totals.clicks : 0;
      const cpa = totals.conversions ? totals.spend / totals.conversions : undefined;
      const roas = totals.spend ? totals.revenue / totals.spend : undefined;
      return ok({
        period: { datePreset: input.datePreset, since: input.since, until: input.until },
        totals: {
          ...totals,
          ctrPct: Number(ctr.toFixed(2)),
          cpc: Number(cpc.toFixed(2)),
          cpa: cpa != null ? Number(cpa.toFixed(2)) : undefined,
          roas: roas != null ? Number(roas.toFixed(2)) : undefined,
        },
        rows,
      });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const compareAdsTool = defineTool({
  name: 'compare_ads',
  description:
    'Compara N anúncios (ids) e ranqueia por uma métrica (default: CPA crescente, depois ROAS decrescente).',
  inputSchema: z
    .object({
      accountId: z.string(),
      adIds: z.array(z.string()).min(2).max(20),
      datePreset: z.string().default('last_14d'),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const results: Array<{ adId: string; metrics: InsightsRow }> = [];
      for (const id of input.adIds) {
        const res = await ctx.meta.getInsights(input.accountId, {
          level: 'ad',
          objectId: id,
          datePreset: input.datePreset,
        });
        const row = res.data[0] ? toInsightsRow(res.data[0], account) : ({} as InsightsRow);
        results.push({ adId: id, metrics: row });
      }
      const ranked = [...results].sort((a, b) => {
        const ca = a.metrics.cpa ?? Number.POSITIVE_INFINITY;
        const cb = b.metrics.cpa ?? Number.POSITIVE_INFINITY;
        if (ca !== cb) return ca - cb;
        return (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0);
      });
      return ok({ ranked });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const findWastedSpendTool = defineTool({
  name: 'find_wasted_spend',
  description:
    'Identifica anúncios/adsets com gasto sem conversão, CTR muito baixo ou frequência alta — flagrando potencial desperdício.',
  inputSchema: z
    .object({
      accountId: z.string(),
      datePreset: z.string().default('last_14d'),
      minSpendForFlag: z.number().nonnegative().default(20),
      ctrFloorPct: z.number().min(0).max(100).default(0.5),
      maxFrequency: z.number().positive().default(4),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const res = await ctx.meta.getInsights(input.accountId, {
        level: 'adset',
        datePreset: input.datePreset,
      });
      const flags: Array<{ adsetId?: string; spend: number; reasons: string[] }> = [];
      for (const d of res.data) {
        const row = toInsightsRow(d, account);
        const reasons: string[] = [];
        if (row.spend >= input.minSpendForFlag && row.conversions === 0)
          reasons.push('Spend acima do mínimo sem conversões');
        if (row.ctr * 100 < input.ctrFloorPct && row.impressions > 1000)
          reasons.push(`CTR ${(row.ctr * 100).toFixed(2)}% abaixo do mínimo ${input.ctrFloorPct}%`);
        if (row.frequency > input.maxFrequency)
          reasons.push(`Frequência ${row.frequency.toFixed(2)} acima de ${input.maxFrequency}`);
        if (reasons.length) flags.push({ adsetId: row.objectId, spend: row.spend, reasons });
      }
      return ok({ count: flags.length, flags });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});
