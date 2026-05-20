import { describe, it, expect } from 'vitest';
import { AccountConfigSchema, AccountsFileSchema } from '../src/schemas/account.schema.js';

describe('AccountConfigSchema', () => {
  const valid = {
    id: 'acme',
    name: 'ACME',
    adAccountId: 'act_123',
    tokenEnvVar: 'META_TOKEN_ACME',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    country: 'BR',
    niche: 'fashion',
    primaryObjective: 'OUTCOME_SALES',
    persona: { summary: 'mulheres 25-45 interessadas em moda', ageRange: [25, 45], interestsKeywords: ['moda'] },
    productsServices: ['vestidos'],
    tone: 'elegante',
    budgetLimits: {
      maxDailyBudget: 100, maxMonthlyBudget: 3000, maxBudgetChangePct: 20, maxPerExecutionChange: 50,
    },
  };

  it('accepts valid config', () => {
    expect(() => AccountConfigSchema.parse(valid)).not.toThrow();
  });

  it('rejects tokenEnvVar in lowercase', () => {
    expect(() => AccountConfigSchema.parse({ ...valid, tokenEnvVar: 'meta_token_acme' })).toThrow();
  });

  it('rejects adAccountId without act_ prefix', () => {
    expect(() => AccountConfigSchema.parse({ ...valid, adAccountId: '123' })).toThrow();
  });

  it('rejects inverted age range', () => {
    expect(() =>
      AccountConfigSchema.parse({ ...valid, persona: { ...valid.persona, ageRange: [50, 30] } }),
    ).toThrow();
  });

  it('AccountsFileSchema requires at least one account', () => {
    expect(() => AccountsFileSchema.parse({ accounts: [] })).toThrow();
  });
});
