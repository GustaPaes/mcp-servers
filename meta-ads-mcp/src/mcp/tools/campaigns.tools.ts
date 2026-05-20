import { z } from 'zod';
import { defineTool, ok, fail } from '../toolKit.js';
import { CampaignDraftSchema } from '../../schemas/campaign.schema.js';
import { checkCapability, checkMutationConfirmation } from '../../security/permissions.js';
import { randomUUID } from 'node:crypto';
import { getEnv } from '../../config/env.js';

export const listCampaignsTool = defineTool({
  name: 'list_campaigns',
  description:
    'Lista campanhas da conta com status, objetivo, orçamento e datas. Não exige confirmação (read-only).',
  inputSchema: z
    .object({ accountId: z.string(), limit: z.number().int().min(1).max(200).default(50) })
    .strict(),
  async handler(input, ctx) {
    ctx.audit.record({ action: 'tool.invoked', tool: 'list_campaigns', accountId: input.accountId });
    try {
      const res = await ctx.meta.listCampaigns(input.accountId, { limit: input.limit });
      return ok({ count: res.data.length, campaigns: res.data, next: res.paging?.cursors?.after });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const createCampaignDraftTool = defineTool({
  name: 'create_campaign_draft',
  description:
    'Cria um RASCUNHO LOCAL de campanha. Nada é enviado à Meta. Use publish_campaign para publicar com confirmação humana.',
  inputSchema: CampaignDraftSchema,
  async handler(input, ctx) {
    try {
      ctx.accounts.get(input.accountId); // existence check
      const state = await ctx.storage.read();
      const draft = {
        id: `cdraft_${randomUUID()}`,
        accountId: input.accountId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: input,
      };
      state.campaignDrafts.push(draft);
      await ctx.storage.write(state);
      ctx.audit.record({
        action: 'tool.invoked',
        tool: 'create_campaign_draft',
        accountId: input.accountId,
        result: { draftId: draft.id },
      });
      return ok({ draft, note: 'Rascunho local. Não publicado.' });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

const PublishInput = z
  .object({
    accountId: z.string(),
    draftId: z.string(),
    confirm: z.boolean(),
    reason: z.string().min(5),
    requestedBy: z.string().min(2),
    dryRun: z.boolean().default(true),
  })
  .strict();

export const publishCampaignTool = defineTool({
  name: 'publish_campaign',
  description:
    'Publica um rascunho de campanha na Meta. Exige confirm=true, reason, requestedBy e dryRun=false. Cria sempre com status PAUSED por segurança.',
  mutating: true,
  inputSchema: PublishInput,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const cap = checkCapability(account, 'mutate.create');
      if (!cap.allowed) return fail(cap.reason ?? 'capability denied');

      const state = await ctx.storage.read();
      const draft = state.campaignDrafts.find(
        (d) => d.id === input.draftId && d.accountId === input.accountId,
      );
      if (!draft) return fail(`Draft ${input.draftId} not found for account ${input.accountId}`);

      const confirmation = checkMutationConfirmation(input);
      const plan = {
        accountId: input.accountId,
        draftId: draft.id,
        payload: draft.data,
        forcedStatus: 'PAUSED' as const,
        note: 'Por segurança, toda campanha publicada via MCP nasce PAUSED. Ative manualmente após revisão humana.',
      };

      if (!confirmation.willMutate) {
        ctx.audit.record({
          action: 'mutation.dryrun',
          tool: 'publish_campaign',
          accountId: input.accountId,
          reason: input.reason,
          requestedBy: input.requestedBy,
          result: plan,
          meta: { blockReason: confirmation.reason },
        });
        return ok({ dryRun: true, plan, blockReason: confirmation.reason });
      }

      const env = getEnv();
      if (draft.data.dailyBudget && draft.data.dailyBudget > env.GLOBAL_MAX_DAILY_BUDGET) {
        return fail(
          `dailyBudget ${draft.data.dailyBudget} exceeds GLOBAL_MAX_DAILY_BUDGET ${env.GLOBAL_MAX_DAILY_BUDGET}`,
        );
      }

      const created = await ctx.meta.createCampaign(input.accountId, {
        name: draft.data.name,
        objective: draft.data.objective,
        status: 'PAUSED',
        special_ad_categories: draft.data.specialAdCategories,
        daily_budget: draft.data.dailyBudget,
        lifetime_budget: draft.data.lifetimeBudget,
      });
      ctx.audit.record({
        action: 'mutation.applied',
        tool: 'publish_campaign',
        accountId: input.accountId,
        reason: input.reason,
        requestedBy: input.requestedBy,
        before: draft.data,
        after: { campaignId: created.id, status: 'PAUSED' },
      });
      return ok({ campaignId: created.id, status: 'PAUSED', plan });
    } catch (e) {
      ctx.audit.record({
        action: 'mutation.failed',
        tool: 'publish_campaign',
        accountId: input.accountId,
        reason: input.reason,
        requestedBy: input.requestedBy,
        error: (e as Error).message,
      });
      return fail((e as Error).message);
    }
  },
});

const PauseInput = z
  .object({
    accountId: z.string(),
    campaignId: z.string(),
    confirm: z.boolean(),
    reason: z.string().min(5),
    requestedBy: z.string().min(2),
    dryRun: z.boolean().default(true),
  })
  .strict();

export const pauseCampaignTool = defineTool({
  name: 'pause_campaign',
  description: 'Pausa uma campanha na Meta. Exige confirmação humana explícita.',
  mutating: true,
  inputSchema: PauseInput,
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const cap = checkCapability(account, 'mutate.status');
      if (!cap.allowed) return fail(cap.reason ?? 'capability denied');

      const confirmation = checkMutationConfirmation(input);
      const plan = { campaignId: input.campaignId, newStatus: 'PAUSED' as const };

      if (!confirmation.willMutate) {
        ctx.audit.record({
          action: 'mutation.dryrun',
          tool: 'pause_campaign',
          accountId: input.accountId,
          reason: input.reason,
          requestedBy: input.requestedBy,
          result: plan,
          meta: { blockReason: confirmation.reason },
        });
        return ok({ dryRun: true, plan, blockReason: confirmation.reason });
      }

      const res = await ctx.meta.updateCampaignStatus(input.accountId, input.campaignId, 'PAUSED');
      ctx.audit.record({
        action: 'mutation.applied',
        tool: 'pause_campaign',
        accountId: input.accountId,
        reason: input.reason,
        requestedBy: input.requestedBy,
        before: { campaignId: input.campaignId, status: 'ACTIVE' },
        after: { campaignId: input.campaignId, status: 'PAUSED' },
      });
      return ok({ paused: true, response: res });
    } catch (e) {
      ctx.audit.record({
        action: 'mutation.failed',
        tool: 'pause_campaign',
        accountId: input.accountId,
        reason: input.reason,
        requestedBy: input.requestedBy,
        error: (e as Error).message,
      });
      return fail((e as Error).message);
    }
  },
});
