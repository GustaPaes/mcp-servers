import type { AccountConfig } from '../schemas/account.schema.js';
import type { TargetingSpec } from '../schemas/adset.schema.js';
import { PolicyRiskEngine } from './PolicyRiskEngine.js';

export interface AudienceStrategy {
  recommendedApproach: 'advantage_plus' | 'broad_interest' | 'lookalike' | 'custom_audience' | 'hybrid';
  rationale: string;
  initialTargeting: TargetingSpec;
  exclusions: TargetingSpec;
  notes: string[];
  policyBlocked: boolean;
  policyFindings: ReturnType<PolicyRiskEngine['validateTargeting']>['findings'];
}

export class AudienceStrategyEngine {
  constructor(private readonly policy = new PolicyRiskEngine()) {}

  recommend(
    account: AccountConfig,
    opts: {
      category?: string;
      hasHistoricalConversions?: boolean;
      hasCustomAudiences?: boolean;
      hasLookalikeAudiences?: boolean;
    } = {},
  ): AudienceStrategy {
    const notes: string[] = [];

    let approach: AudienceStrategy['recommendedApproach'];
    if (opts.hasHistoricalConversions && opts.hasLookalikeAudiences) {
      approach = 'lookalike';
      notes.push('Histórico de conversões + LAL disponível: priorizar Lookalike 1-3%.');
    } else if (opts.hasHistoricalConversions) {
      approach = 'advantage_plus';
      notes.push('Histórico de conversões existe: Advantage+ Audience tende a performar bem.');
    } else if (opts.hasCustomAudiences) {
      approach = 'custom_audience';
      notes.push('Sem histórico mas com Custom Audience: começar por audiências de 1st party.');
    } else {
      approach = 'broad_interest';
      notes.push('Sem histórico e sem audiências: público amplo com 3-5 interesses curados.');
    }

    const initialTargeting: TargetingSpec = {
      geoLocations: { countries: [account.country] },
      ageMin: Math.max(account.persona.ageRange[0], 18),
      ageMax: Math.min(account.persona.ageRange[1], 65),
      interests: account.persona.interestsKeywords.slice(0, 5).map((name, i) => ({
        // ids are illustrative; real ids must be resolved via Targeting Search API
        id: String(6000000000000 + i),
        name,
      })),
      advantageAudience: approach === 'advantage_plus',
      publisherPlatforms: ['facebook', 'instagram'],
    };

    const exclusions: TargetingSpec = {};
    if (account.audienceRestrictions.excludeRecentBuyersDays > 0) {
      notes.push(
        `Excluir compradores nos últimos ${account.audienceRestrictions.excludeRecentBuyersDays} dias (custom audience).`,
      );
    }

    const policyReport = this.policy.validateTargeting(initialTargeting, account);

    return {
      recommendedApproach: approach,
      rationale:
        approach === 'advantage_plus'
          ? 'O algoritmo da Meta tem dados de conversão suficientes para expandir além dos interesses curados.'
          : approach === 'lookalike'
            ? 'Lookalike é o sinal mais forte quando há base de conversões + audiência seed.'
            : approach === 'custom_audience'
              ? 'Audiências 1st party costumam ter maior taxa de conversão que público frio.'
              : 'Sem dados suficientes, começar amplo permite ao algoritmo aprender mais rápido.',
      initialTargeting,
      exclusions,
      notes,
      policyBlocked: policyReport.blocked,
      policyFindings: policyReport.findings,
    };
  }
}
