import { existsSync, readFileSync } from 'node:fs';
import type { McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuditEntry } from '../security/auditLog.js';
import { getEnv } from '../config/env.js';
import { redactSecrets } from '../utils/logger.js';
import type { ToolContext } from './context.js';

interface AuditFilter {
  accountId?: string;
  tool?: string;
  action?: string;
  limit?: number;
}

export function readAuditEntries(path: string, filter: AuditFilter = {}): unknown[] {
  if (!existsSync(path)) return [];
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .reverse();

  const entries: AuditEntry[] = [];
  for (const line of lines) {
    if (entries.length >= limit) break;
    try {
      const parsed = JSON.parse(line) as AuditEntry;
      if (filter.accountId && parsed.accountId !== filter.accountId) continue;
      if (filter.tool && parsed.tool !== filter.tool) continue;
      if (filter.action && parsed.action !== filter.action) continue;
      entries.push(parsed);
    } catch {
      // Ignore malformed historical lines. The audit writer emits valid JSONL.
    }
  }

  return redactSecrets(entries) as unknown[];
}

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function accountSummary(ctx: ToolContext) {
  return ctx.accounts.list().map((account) => ({
    id: account.id,
    name: account.name,
    adAccountId: account.adAccountId,
    businessManagerId: account.businessManagerId,
    currency: account.currency,
    timezone: account.timezone,
    country: account.country,
    niche: account.niche,
    primaryObjective: account.primaryObjective,
    mode: account.mode,
    budgetLimits: account.budgetLimits,
    priorityConversionEvents: account.priorityConversionEvents,
  }));
}

export function registerResources(server: McpServer, ctx: ToolContext): void {
  const env = getEnv();

  server.registerResource(
    'accounts-config-summary',
    'meta-ads://accounts/config-summary',
    {
      title: 'Meta Ads account configuration summary',
      description: 'Configured accounts without tokenEnvVar values or secrets.',
      mimeType: 'application/json',
    },
    async (uri) =>
      jsonResource(uri, {
        count: ctx.accounts.list().length,
        accounts: accountSummary(ctx),
      }),
  );

  server.registerResource(
    'audit-recent',
    'meta-ads://audit/recent',
    {
      title: 'Recent audit entries',
      description: 'Most recent 100 audit entries, newest first, with secrets redacted.',
      mimeType: 'application/json',
    },
    async (uri) =>
      jsonResource(uri, {
        path: env.AUDIT_LOG_PATH,
        entries: readAuditEntries(env.AUDIT_LOG_PATH, { limit: 100 }),
      }),
  );

  server.registerResource(
    'audit-by-account',
    new ResourceTemplate('meta-ads://audit/account/{accountId}', {
      list: async () => ({
        resources: ctx.accounts.list().map((account) => ({
          uri: `meta-ads://audit/account/${encodeURIComponent(account.id)}`,
          name: `audit-${account.id}`,
          title: `Audit entries for ${account.name}`,
          mimeType: 'application/json',
        })),
      }),
      complete: {
        accountId: (value) =>
          ctx.accounts
            .list()
            .map((account) => account.id)
            .filter((id) => id.startsWith(value)),
      },
    }),
    {
      title: 'Audit entries by account',
      description: 'Most recent 200 audit entries for one configured account.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const accountId = String(variables.accountId);
      return jsonResource(uri, {
        accountId,
        path: env.AUDIT_LOG_PATH,
        entries: readAuditEntries(env.AUDIT_LOG_PATH, { accountId, limit: 200 }),
      });
    },
  );

  server.registerResource(
    'drafts-all',
    'meta-ads://drafts/all',
    {
      title: 'All local drafts',
      description: 'Campaign, ad set and creative drafts from the configured storage backend.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const state = await ctx.storage.read();
      return jsonResource(uri, {
        counts: {
          campaigns: state.campaignDrafts.length,
          adSets: state.adSetDrafts.length,
          creatives: state.creativeDrafts.length,
        },
        state: redactSecrets(state),
      });
    },
  );

  server.registerResource(
    'drafts-by-account',
    new ResourceTemplate('meta-ads://drafts/account/{accountId}', {
      list: async () => ({
        resources: ctx.accounts.list().map((account) => ({
          uri: `meta-ads://drafts/account/${encodeURIComponent(account.id)}`,
          name: `drafts-${account.id}`,
          title: `Drafts for ${account.name}`,
          mimeType: 'application/json',
        })),
      }),
      complete: {
        accountId: (value) =>
          ctx.accounts
            .list()
            .map((account) => account.id)
            .filter((id) => id.startsWith(value)),
      },
    }),
    {
      title: 'Drafts by account',
      description: 'Campaign, ad set and creative drafts filtered by account.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const accountId = String(variables.accountId);
      const state = await ctx.storage.read();
      const filtered = {
        campaignDrafts: state.campaignDrafts.filter((d) => d.accountId === accountId),
        adSetDrafts: state.adSetDrafts.filter((d) => d.accountId === accountId),
        creativeDrafts: state.creativeDrafts.filter((d) => d.accountId === accountId),
      };
      return jsonResource(uri, {
        accountId,
        revision: state.revision,
        counts: {
          campaigns: filtered.campaignDrafts.length,
          adSets: filtered.adSetDrafts.length,
          creatives: filtered.creativeDrafts.length,
        },
        state: redactSecrets(filtered),
      });
    },
  );
}
