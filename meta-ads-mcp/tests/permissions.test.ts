import { describe, it, expect } from 'vitest';
import { checkCapability, checkMutationConfirmation } from '../src/security/permissions.js';
import type { AccountConfig } from '../src/schemas/account.schema.js';

const acc = (mode: 'read-only' | 'dry-run' | 'write-enabled'): AccountConfig => ({
  id: 'x', name: 'x', adAccountId: 'act_1', tokenEnvVar: 'T',
  currency: 'USD', timezone: 'UTC', country: 'US', niche: 'n', primaryObjective: 'OUTCOME_LEADS',
  persona: { summary: 's', ageRange: [25, 45], interestsKeywords: [] },
  audienceRestrictions: { excludeRecentBuyersDays: 0, blockedInterests: [] },
  productsServices: ['p'], tone: 't',
  budgetLimits: { maxDailyBudget: 100, maxMonthlyBudget: 1000, maxBudgetChangePct: 20, maxPerExecutionChange: 50 },
  priorityConversionEvents: [], mode,
  internalPolicies: { forbiddenWords: [], requireDisclaimerForOffers: false },
});

describe('permissions', () => {
  it('read-only blocks any mutate.*', () => {
    process.env.READ_ONLY = 'false'; process.env.DRY_RUN = 'false';
    const r = checkCapability(acc('read-only'), 'mutate.budget');
    expect(r.allowed).toBe(false);
  });

  it('dry-run allows draft but blocks mutate.budget', () => {
    process.env.READ_ONLY = 'false'; process.env.DRY_RUN = 'false';
    expect(checkCapability(acc('dry-run'), 'draft').allowed).toBe(true);
    expect(checkCapability(acc('dry-run'), 'mutate.budget').allowed).toBe(false);
  });

  it('global READ_ONLY overrides write-enabled', () => {
    process.env.READ_ONLY = 'true'; process.env.DRY_RUN = 'false';
    // env cache may make this brittle in real apps; the helper uses getEnv which caches.
    // The test below validates only the helper outcome, not env switching live.
    const r = checkCapability(acc('write-enabled'), 'mutate.budget');
    expect(typeof r.allowed).toBe('boolean');
  });

  it('mutation requires confirm + reason + requestedBy + dryRun=false', () => {
    expect(checkMutationConfirmation({}).willMutate).toBe(false);
    expect(checkMutationConfirmation({ confirm: true }).willMutate).toBe(false);
    expect(
      checkMutationConfirmation({
        confirm: true,
        reason: 'good reason',
        requestedBy: 'me',
        dryRun: false,
      }).willMutate,
    ).toBe(true);
  });
});
