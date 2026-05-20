import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyRiskEngine } from '../src/optimization/PolicyRiskEngine.js';
import type { AccountConfig } from '../src/schemas/account.schema.js';

const baseAccount: AccountConfig = {
  id: 'test',
  name: 'Test',
  adAccountId: 'act_123',
  tokenEnvVar: 'TEST_TOKEN',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  country: 'BR',
  niche: 'fashion',
  primaryObjective: 'OUTCOME_SALES',
  persona: { summary: 'mulheres 25-45', ageRange: [25, 45], interestsKeywords: ['moda'] },
  audienceRestrictions: { excludeRecentBuyersDays: 0, blockedInterests: [] },
  productsServices: ['vestidos'],
  tone: 'elegante',
  budgetLimits: {
    maxDailyBudget: 100,
    maxMonthlyBudget: 3000,
    maxBudgetChangePct: 20,
    maxPerExecutionChange: 50,
  },
  priorityConversionEvents: ['Purchase'],
  mode: 'dry-run',
  internalPolicies: { forbiddenWords: ['garantia de resultado'], requireDisclaimerForOffers: false },
};

describe('PolicyRiskEngine', () => {
  let engine: PolicyRiskEngine;
  beforeEach(() => {
    engine = new PolicyRiskEngine();
  });

  it('blocks targeting on protected attributes', () => {
    const r = engine.validateTargeting(
      { interests: [{ id: '1', name: 'Religion: catholic' }] },
      baseAccount,
    );
    expect(r.blocked).toBe(true);
    expect(r.findings[0]?.code).toBe('TARGETING_PROTECTED_ATTRIBUTE');
  });

  it('flags missing geo as medium risk', () => {
    const r = engine.validateTargeting({ interests: [{ id: '1', name: 'fashion' }] }, baseAccount);
    expect(r.blocked).toBe(false);
    expect(r.findings.some((f) => f.code === 'TARGETING_NO_GEO')).toBe(true);
  });

  it('detects forbidden words in copy', () => {
    const r = engine.validateCopy('Garantia de resultado em 7 dias!', baseAccount);
    expect(r.findings.some((f) => f.code === 'COPY_FORBIDDEN_WORD')).toBe(true);
  });

  it('detects credit special category hint', () => {
    const r = engine.validateCopy('Solicite seu empréstimo agora', baseAccount);
    expect(r.findings.some((f) => f.code === 'COPY_SPECIAL_AD_CATEGORY_HINT')).toBe(true);
  });
});
