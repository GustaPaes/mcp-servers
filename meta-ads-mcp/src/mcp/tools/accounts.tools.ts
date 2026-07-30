import { z } from 'zod';
import { defineTool, ok, fail } from '../toolKit.js';
import { AccountConfigSchema } from '../../schemas/account.schema.js';
import { effectiveMode } from '../../security/permissions.js';

export const listAdAccountsTool = defineTool({
  name: 'list_ad_accounts',
  description:
    'Lista todas as contas de anúncio configuradas no servidor. Retorna apenas dados não sensíveis (jamais tokens).',
  inputSchema: z.object({}).strict(),
  async handler(_input, ctx) {
    ctx.audit.record({ action: 'tool.invoked', tool: 'list_ad_accounts' });
    const accounts = ctx.accounts.list().map((a) => ({
      id: a.id,
      name: a.name,
      adAccountId: a.adAccountId,
      currency: a.currency,
      timezone: a.timezone,
      country: a.country,
      niche: a.niche,
      primaryObjective: a.primaryObjective,
      configuredMode: a.mode,
      effectiveMode: effectiveMode(a),
      hasToken: !!process.env[a.tokenEnvVar],
    }));
    return ok({ count: accounts.length, accounts });
  },
});

export const getAccountProfileTool = defineTool({
  name: 'get_account_profile',
  description:
    'Retorna o perfil estratégico da conta: nicho, persona, objetivos, restrições, limites de orçamento e eventos prioritários.',
  inputSchema: z.object({ accountId: z.string() }).strict(),
  async handler(input, ctx) {
    ctx.audit.record({ action: 'tool.invoked', tool: 'get_account_profile', accountId: input.accountId });
    try {
      const a = ctx.accounts.get(input.accountId);
      const { tokenEnvVar: _t, ...safe } = a;
      return ok({ ...safe, effectiveMode: effectiveMode(a) });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});

export const updateAccountProfileTool = defineTool({
  name: 'update_account_profile',
  mutating: true,
  description:
    'Atualiza configurações estratégicas da conta (persona, restrições, limites, tom). Não altera credenciais. Validação Zod estrita.',
  inputSchema: z
    .object({
      accountId: z.string(),
      patch: AccountConfigSchema.partial().omit({ id: true, tokenEnvVar: true, adAccountId: true }),
      reason: z.string().min(5),
      requestedBy: z.string().min(2),
    })
    .strict(),
  async handler(input, ctx) {
    try {
      const current = ctx.accounts.get(input.accountId);
      const merged = AccountConfigSchema.parse({ ...current, ...input.patch });
      ctx.accounts.upsert(merged);
      ctx.audit.record({
        action: 'config.updated',
        accountId: input.accountId,
        tool: 'update_account_profile',
        reason: input.reason,
        requestedBy: input.requestedBy,
        before: { ...current, tokenEnvVar: '[REDACTED]' },
        after: { ...merged, tokenEnvVar: '[REDACTED]' },
      });
      return ok({ updated: true, account: { ...merged, tokenEnvVar: undefined } });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});
