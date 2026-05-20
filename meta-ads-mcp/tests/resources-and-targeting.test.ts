import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountRegistry } from '../src/config/accounts.js';
import { readAuditEntries } from '../src/mcp/resources.js';
import { searchTargetingIdsTool } from '../src/mcp/tools/targeting.tools.js';
import type { ToolContext } from '../src/mcp/context.js';
import type { AccountConfig } from '../src/schemas/account.schema.js';
import { MemoryStorage } from '../src/storage/memoryStorage.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'meta-ads-mcp-'));
  tempDirs.push(dir);
  return join(dir, name);
}

const account: AccountConfig = {
  id: 'acme',
  name: 'ACME',
  adAccountId: 'act_123',
  tokenEnvVar: 'META_TOKEN_ACME',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  country: 'BR',
  niche: 'fashion',
  primaryObjective: 'OUTCOME_SALES',
  persona: {
    summary: 'Adultos interessados em moda e varejo online',
    ageRange: [25, 45],
    interestsKeywords: ['moda'],
  },
  audienceRestrictions: { excludeRecentBuyersDays: 0, blockedInterests: [] },
  productsServices: ['vestidos'],
  tone: 'elegante',
  budgetLimits: {
    maxDailyBudget: 100,
    maxMonthlyBudget: 3000,
    maxBudgetChangePct: 20,
    maxPerExecutionChange: 50,
  },
  priorityConversionEvents: ['purchase'],
  mode: 'read-only',
  internalPolicies: { forbiddenWords: [], requireDisclaimerForOffers: false },
};

describe('MCP resources helpers', () => {
  it('reads recent audit entries with account filter and secret redaction', () => {
    const file = tempFile('audit.log');
    appendFileSync(
      file,
      [
        JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', action: 'tool.rejected', accountId: 'other', error: 'Bearer EAAOTHER' }),
        JSON.stringify({ ts: '2026-01-02T00:00:00.000Z', action: 'targeting.search', accountId: 'acme', meta: { token: 'Bearer EAASECRET' } }),
      ].join('\n') + '\n',
      'utf8',
    );

    const entries = readAuditEntries(file, { accountId: 'acme', limit: 10 });

    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).toContain('[REDACTED]');
    expect(JSON.stringify(entries)).not.toContain('EAASECRET');
    expect(JSON.stringify(entries)).not.toContain('EAAOTHER');
  });
});

describe('search_targeting_ids tool', () => {
  it('normalizes Meta targeting search hits', async () => {
    const searchTargeting = vi.fn().mockResolvedValue({
      data: [
        {
          id: '6003139266461',
          name: 'Fashion accessories',
          audience_size_lower_bound: 1000000,
          audience_size_upper_bound: 5000000,
          path: ['Interests', 'Shopping and fashion'],
        },
      ],
    });
    const ctx = {
      accounts: new AccountRegistry([account]),
      meta: { searchTargeting },
      storage: new MemoryStorage(),
      audit: { record: vi.fn() },
      engines: {},
    } as unknown as ToolContext;

    const input = searchTargetingIdsTool.inputSchema.parse({
      accountId: 'acme',
      type: 'adinterest',
      q: 'fashion',
    });
    const result = await searchTargetingIdsTool.handler(input, ctx);

    expect(result.ok).toBe(true);
    expect(searchTargeting).toHaveBeenCalledWith('acme', {
      type: 'adinterest',
      q: 'fashion',
      locale: 'pt_BR',
      limit: 25,
    });
    expect(result.data?.hits[0]).toMatchObject({
      id: '6003139266461',
      name: 'Fashion accessories',
      type: 'adinterest',
      audienceSizeLower: 1000000,
      audienceSizeUpper: 5000000,
    });
  });

  it('requires q unless adinterestsuggestion seeds are provided', () => {
    expect(() =>
      searchTargetingIdsTool.inputSchema.parse({ accountId: 'acme', type: 'adinterest' }),
    ).toThrow();
    expect(() =>
      searchTargetingIdsTool.inputSchema.parse({
        accountId: 'acme',
        type: 'adinterestsuggestion',
        seeds: ['moda'],
      }),
    ).not.toThrow();
  });
});
