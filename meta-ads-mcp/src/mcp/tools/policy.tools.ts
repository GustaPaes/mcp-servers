import { z } from 'zod';
import { defineTool, ok, fail } from '../toolKit.js';
import { TargetingSpecSchema } from '../../schemas/adset.schema.js';

export const validateMetaPolicyRiskTool = defineTool({
  name: 'validate_meta_policy_risk',
  description:
    'Analisa copy + targeting contra políticas da Meta e regras internas. Sinaliza categorias especiais, segmentação proibida e promessas exageradas.',
  inputSchema: z
    .object({
      accountId: z.string(),
      copy: z.string().min(2).max(8000).optional(),
      targeting: TargetingSpecSchema.optional(),
    })
    .strict()
    .refine((d) => d.copy || d.targeting, { message: 'Provide copy and/or targeting' }),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const copyReport = input.copy
        ? ctx.engines.policy.validateCopy(input.copy, account)
        : { findings: [], blocked: false };
      const targetingReport = input.targeting
        ? ctx.engines.policy.validateTargeting(input.targeting, account)
        : { findings: [], blocked: false };
      const blocked = copyReport.blocked || targetingReport.blocked;
      return ok({
        blocked,
        copy: copyReport,
        targeting: targetingReport,
        verdict: blocked
          ? 'BLOQUEAR: ajustes obrigatórios antes de prosseguir.'
          : copyReport.findings.length + targetingReport.findings.length > 0
            ? 'AJUSTAR: há recomendações de melhoria.'
            : 'OK: sem violações detectadas (validação heurística, não substitui análise oficial da Meta).',
      });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});
