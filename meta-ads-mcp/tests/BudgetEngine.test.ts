import { describe, it, expect } from 'vitest';
import { BudgetEngine } from '../src/optimization/BudgetEngine.js';
import type { AccountConfig } from '../src/schemas/account.schema.js';

const account: AccountConfig = {
  id: 'a', name: 'a', adAccountId: 'act_1', tokenEnvVar: 'T', currency: 'USD',
  timezone: 'UTC', country: 'US', niche: 'saas', primaryObjective: 'OUTCOME_LEADS',
  persona: { summary: 'x', ageRange: [25, 50], interestsKeywords: [] },
  audienceRestrictions: { excludeRecentBuyersDays: 0, blockedInterests: [] },
  productsServices: ['p'], tone: 't',
  budgetLimits: { maxDailyBudget: 500, maxMonthlyBudget: 10000, maxBudgetChangePct: 25, maxPerExecutionChange: 100 },
  priorityConversionEvents: [], mode: 'dry-run',
  internalPolicies: { forbiddenWords: [], requireDisclaimerForOffers: false },
};

describe('BudgetEngine', () => {
  const engine = new BudgetEngine();

  it('reduces budget when CPA exceeds target', () => {
    const rec = engine.recommendChange({
      account,
      objectId: 'as_1',
      currentDailyBudget: 100,
      metrics: { spend: 700, impressions: 10000, reach: 8000, clicks: 200, ctr: 0.02, cpc: 3.5, cpm: 70, frequency: 1.2, conversions: 10, cpa: 70 },
      goals: { maxCpa: 50 },
    });
    expect(rec.changeAbs).toBeLessThan(0);
    expect(rec.requiresApproval).toBe(true);
  });

  it('never recommends budget above account.maxDailyBudget', () => {
    const rec = engine.recommendChange({
      account,
      objectId: 'as_1',
      currentDailyBudget: 480,
      metrics: { spend: 1000, impressions: 50000, reach: 30000, clicks: 1000, ctr: 0.02, cpc: 1, cpm: 20, frequency: 1.1, conversions: 50, cpa: 20, roas: 5 },
      goals: { maxCpa: 30, minRoas: 3 },
    });
    expect(rec.recommendedDailyBudget).toBeLessThanOrEqual(account.budgetLimits.maxDailyBudget);
  });

  it('returns low confidence with few conversions', () => {
    const rec = engine.recommendChange({
      account,
      objectId: 'as_1',
      currentDailyBudget: 50,
      metrics: { spend: 100, impressions: 2000, reach: 1500, clicks: 30, ctr: 0.015, cpc: 3.3, cpm: 50, frequency: 1, conversions: 1, cpa: 100 },
      goals: { maxCpa: 40 },
    });
    expect(rec.confidence).toBe('low');
  });
});
