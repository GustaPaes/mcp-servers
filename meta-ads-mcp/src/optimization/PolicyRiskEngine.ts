import type { AccountConfig } from '../schemas/account.schema.js';
import type { TargetingSpec } from '../schemas/adset.schema.js';

/**
 * Categories of attributes that are forbidden for ad targeting, per Meta's
 * non-discrimination policy and general data-protection rules (LGPD/GDPR).
 * The lists below are NOT exhaustive — they exist to block obvious mistakes
 * by the AI caller. Meta's API also rejects many of these server-side.
 */
const FORBIDDEN_TARGETING_KEYWORDS: string[] = [
  // protected attributes
  'race', 'racial', 'ethnicity', 'religion', 'religious', 'church', 'mosque', 'synagogue',
  'sexual orientation', 'gay', 'lesbian', 'lgbt', 'bisexual',
  'political', 'communist', 'liberal', 'conservative', 'party',
  'health', 'disease', 'cancer', 'depression', 'pregnant', 'pregnancy', 'mental health',
  'union member', 'syndicalist',
  // sensitive personal life
  'dating', 'divorce', 'orphan', 'addiction', 'rehab',
];

const SPECIAL_AD_CATEGORY_HINTS: Record<string, string[]> = {
  EMPLOYMENT: ['job', 'hiring', 'recruit', 'vaga', 'emprego'],
  HOUSING: ['real estate', 'imóvel', 'aluguel', 'rent', 'mortgage'],
  CREDIT: ['credit', 'loan', 'empréstimo', 'cartão de crédito', 'financiamento'],
  ISSUES_ELECTIONS_POLITICS: ['election', 'campaign', 'candidate', 'partido', 'voto'],
};

export type RiskLevel = 'low' | 'medium' | 'high' | 'blocking';

export interface PolicyFinding {
  level: RiskLevel;
  code: string;
  message: string;
  recommendation?: string;
}

export interface PolicyReport {
  findings: PolicyFinding[];
  blocked: boolean;
}

export class PolicyRiskEngine {
  /** Validate targeting against forbidden segmentation. */
  validateTargeting(targeting: TargetingSpec, account: AccountConfig): PolicyReport {
    const findings: PolicyFinding[] = [];
    const interests = [
      ...(targeting.interests ?? []).map((i) => i.name.toLowerCase()),
      ...(targeting.behaviors ?? []).map((b) => b.name.toLowerCase()),
    ];

    for (const name of interests) {
      if (FORBIDDEN_TARGETING_KEYWORDS.some((kw) => name.includes(kw))) {
        findings.push({
          level: 'blocking',
          code: 'TARGETING_PROTECTED_ATTRIBUTE',
          message: `Targeting "${name}" looks related to a protected/sensitive attribute and is not allowed.`,
          recommendation: 'Remove this interest and use behavior/intent signals instead.',
        });
      }
      if (account.audienceRestrictions.blockedInterests.some((bi) => name.includes(bi.toLowerCase()))) {
        findings.push({
          level: 'blocking',
          code: 'TARGETING_ACCOUNT_BLOCKLIST',
          message: `Interest "${name}" is in the account-level block list.`,
        });
      }
    }

    if ((targeting.ageMin ?? 18) < 18 || (targeting.ageMax ?? 18) < 18) {
      findings.push({
        level: 'high',
        code: 'TARGETING_MINORS',
        message: 'Targeting users under 18 requires special review and is restricted by Meta.',
        recommendation: 'Set ageMin >= 18 unless the product is explicitly approved for minors.',
      });
    }

    if (!targeting.geoLocations?.countries?.length) {
      findings.push({
        level: 'medium',
        code: 'TARGETING_NO_GEO',
        message: 'No geo locations defined; ad may run globally and waste budget.',
        recommendation: `Restrict to "${account.country}" or relevant regions.`,
      });
    }

    return { findings, blocked: findings.some((f) => f.level === 'blocking') };
  }

  /** Validate copy/headline against forbidden words and special ad category triggers. */
  validateCopy(text: string, account: AccountConfig): PolicyReport {
    const findings: PolicyFinding[] = [];
    const lower = text.toLowerCase();

    for (const word of account.internalPolicies.forbiddenWords) {
      if (lower.includes(word.toLowerCase())) {
        findings.push({
          level: 'high',
          code: 'COPY_FORBIDDEN_WORD',
          message: `Copy contains forbidden phrase "${word}" per account policies.`,
          recommendation: 'Rewrite removing the phrase or replace with compliant wording.',
        });
      }
    }

    // Exaggerated-promise heuristics
    const exaggerated = [
      'garantia 100%', '100% guaranteed', 'milagre', 'miracle',
      'enriqueça', 'get rich quick', 'cure', 'cura',
    ];
    for (const phrase of exaggerated) {
      if (lower.includes(phrase)) {
        findings.push({
          level: 'medium',
          code: 'COPY_EXAGGERATED_PROMISE',
          message: `Copy contains exaggerated promise: "${phrase}".`,
          recommendation: 'Avoid promising guaranteed results; use realistic phrasing.',
        });
      }
    }

    for (const [cat, hints] of Object.entries(SPECIAL_AD_CATEGORY_HINTS)) {
      if (hints.some((h) => lower.includes(h))) {
        findings.push({
          level: 'medium',
          code: 'COPY_SPECIAL_AD_CATEGORY_HINT',
          message: `Copy suggests "${cat}" — Meta requires declaring a special ad category.`,
          recommendation: `Set specialAdCategories to include "${cat}".`,
        });
      }
    }

    if (lower.includes('clique aqui') || lower.includes('click here')) {
      findings.push({
        level: 'low',
        code: 'COPY_GENERIC_CTA',
        message: 'CTA is generic; consider a more specific call to action.',
      });
    }

    return { findings, blocked: findings.some((f) => f.level === 'blocking') };
  }
}
