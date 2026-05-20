/**
 * Tools de Targeting Search — substitui IDs placeholder por dados reais da Meta.
 *
 * Cobre o endpoint /search da Marketing API:
 *   - adinterest          (interesses)
 *   - adinterestsuggestion (sugestões baseadas em sementes)
 *   - adlocale            (idiomas)
 *   - adgeolocation       (países/regiões/cidades/zips)
 *
 * Nenhuma destas tools muta nada. São READ por natureza, mas exigem token de
 * uma conta válida (qualquer conta cadastrada serve, pois o endpoint usa o
 * token a nível de usuário/sistema).
 */
import { z } from 'zod';
import { defineTool, ok, fail } from '../toolKit.js';
import { checkCapability } from '../../security/permissions.js';

const TargetingTypeSchema = z.enum([
  'adinterest',
  'adinterestsuggestion',
  'adlocale',
  'adgeolocation',
  'adeducationschool',
  'adeducationmajor',
  'adworkemployer',
  'adworkposition',
]);

export const searchTargetingIdsTool = defineTool({
  name: 'search_targeting_ids',
  description:
    'Busca IDs reais de targeting na Meta Marketing API (interesses, idiomas, geolocalização, etc). ' +
    'Use ANTES de criar drafts para substituir placeholders por IDs válidos. ' +
    'Não muta nada. Não promete resultado: tamanho de audiência é estimado pela Meta.',
  inputSchema: z
    .object({
      accountId: z
        .string()
        .describe('ID interno de qualquer conta cadastrada — usado só para autenticar a chamada.'),
      type: TargetingTypeSchema,
      q: z
        .string()
        .min(1)
        .optional()
        .describe('Termo de busca. Obrigatório exceto para adinterestsuggestion (usa seeds).'),
      seeds: z
        .array(z.string())
        .optional()
        .describe('Lista de interesses-semente (apenas para type=adinterestsuggestion).'),
      locale: z.string().default('pt_BR'),
      limit: z.number().int().min(1).max(100).default(25),
    })
    .strict()
    .refine(
      (v) => (v.type === 'adinterestsuggestion' ? Array.isArray(v.seeds) && v.seeds.length > 0 : !!v.q),
      { message: 'q é obrigatório (ou seeds quando type=adinterestsuggestion).' },
    ),
  async handler(input, ctx) {
    try {
      const account = ctx.accounts.get(input.accountId);
      const cap = checkCapability(account, 'read');
      if (!cap.allowed) return fail(cap.reason ?? 'capability denied');

      // adinterestsuggestion usa interest_list em vez de q.
      // Para manter um único helper no client, codificamos os seeds em q (CSV) e
      // o client repassa. A Meta aceita interest_list[]=... ; fazemos via raw.
      const query =
        input.type === 'adinterestsuggestion'
          ? (input.seeds ?? []).join(',')
          : input.q;

      const result = await ctx.meta.searchTargeting(input.accountId, {
        type: input.type,
        q: query,
        locale: input.locale,
        limit: input.limit,
      });

      const hits = (result.data ?? []).map((h) => ({
        id: h.id ?? h.key ?? null,
        key: h.key ?? null,
        name: h.name ?? null,
        type: h.type ?? input.type,
        path: h.path ?? null,
        audienceSize: h.audience_size ?? null,
        audienceSizeLower: h.audience_size_lower_bound ?? null,
        audienceSizeUpper: h.audience_size_upper_bound ?? null,
        countryCode: h.country_code ?? null,
        countryName: h.country_name ?? null,
        region: h.region ?? null,
        regionId: h.region_id ?? null,
        supportsRegion: h.supports_region ?? null,
        supportsCity: h.supports_city ?? null,
      }));

      ctx.audit.record({
        accountId: input.accountId,
        action: 'targeting.search',
        tool: 'search_targeting_ids',
        meta: { type: input.type, q: input.q, locale: input.locale, count: hits.length },
      });

      return ok(
        { type: input.type, locale: input.locale, count: hits.length, hits },
        {
          warnings: [
            'Tamanhos de audiência são estimativas da Meta e variam ao longo do tempo.',
            'Confirme a relevância de cada ID antes de usar em adset.targeting.',
          ],
        },
      );
    } catch (e) {
      return fail((e as Error).message);
    }
  },
});
