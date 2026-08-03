import { z } from 'zod';
import { defineTool, ok, fail } from '../toolKit.js';
import { AdSetDraftSchema } from '../../schemas/adset.schema.js';
import { randomUUID } from 'node:crypto';

export const listAdSetsTool = defineTool({
  name: 'list_ad_sets',
  description: 'Lista conjuntos de anúncios da conta (opcional: filtrar por campanha).',
  inputSchema: z
    .object({
      accountId: z.string(),
      campaignId: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const res = await ctx.meta.listAdSets(input.accountId, {
        campaignId: input.campaignId,
        limit: input.limit,
      });
      return ok({ count: res.data.length, adSets: res.data, next: res.paging?.cursors?.after });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const createAdSetDraftTool = defineTool({
  name: 'create_ad_set_draft',
  mutating: true,
  description:
    'Cria um RASCUNHO LOCAL de conjunto de anúncios, validando público contra políticas de segmentação.',
  inputSchema: AdSetDraftSchema,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const policy = ctx.engines.policy.validateTargeting(input.targeting, account);
      if (policy.blocked) {
        ctx.audit.record({
          action: 'tool.rejected',
          tool: 'create_ad_set_draft',
          accountId: input.accountId,
          reason: 'targeting violates policy',
          meta: { findings: policy.findings },
        });
        return fail('Targeting blocked by policy', { errors: policy.findings.map((f) => f.message) });
      }
      const draft = {
        id: `adraft_${randomUUID()}`,
        accountId: input.accountId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: input,
      };
      await ctx.storage.update((state) => {
        state.adSetDrafts.push(draft);
      });
      return ok(
        { draft, policyFindings: policy.findings, note: 'Rascunho local, não publicado.' },
        { warnings: policy.findings.filter((f) => f.level !== 'low').map((f) => f.message) },
      );
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});
