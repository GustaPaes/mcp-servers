import { request } from 'undici';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { maskToken } from '../security/secrets.js';
import type { AccountRegistry } from '../config/accounts.js';
import { MetaApiError, type MetaApiErrorPayload } from './MetaApiError.js';
import type {
  MetaAdSetDTO,
  MetaCampaignDTO,
  MetaInsightsDTO,
  MetaListResponse,
  MetaTargetingSearchHit,
} from './types.js';

export interface ListInsightsParams {
  level: 'account' | 'campaign' | 'adset' | 'ad';
  objectId?: string;
  datePreset?: string;
  since?: string;
  until?: string;
  breakdowns?: string[];
  fields?: string[];
}

type HttpMethod = 'GET' | 'POST' | 'DELETE';

interface RawRequestOptions {
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

/**
 * Centralized client to the Meta Graph (Marketing) API.
 *
 * Responsibilities:
 *   - Inject the correct token from AccountRegistry per call.
 *   - Apply timeout, exponential backoff and Meta-specific retry rules.
 *   - Never log tokens (uses maskToken / redacted logger).
 *   - Normalize errors into MetaApiError.
 *   - Provide higher-level helpers for the most used endpoints.
 *
 * It does NOT contain business logic — that lives in optimization/ and tools/.
 */
export class MetaAdsClient {
  constructor(private readonly accounts: AccountRegistry) {}

  private baseUrl(): string {
    const env = getEnv();
    return `${env.META_GRAPH_API_BASE_URL}/${env.META_GRAPH_API_VERSION}`;
  }

  private async raw<T>(
    accountId: string,
    path: string,
    opts: RawRequestOptions = {},
  ): Promise<T> {
    const env = getEnv();
    const log = getLogger();
    const token = this.accounts.getToken(accountId);
    const method: HttpMethod = opts.method ?? 'GET';
    const url = new URL(this.baseUrl() + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    log.debug(
      {
        accountId,
        method,
        endpoint: path,
        tokenMasked: maskToken(token),
        query: opts.query,
      },
      'meta.request',
    );

    return withRetry<T>(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), env.HTTP_TIMEOUT_MS);
        try {
          const res = await request(url, {
            method,
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
              'user-agent': 'meta-ads-mcp/0.1 (+https://example.invalid)',
            },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal,
          });

          const text = await res.body.text();
          const parsed = text ? (safeJson(text) as unknown) : undefined;

          if (res.statusCode >= 200 && res.statusCode < 300) {
            return (parsed ?? {}) as T;
          }

          const payload: MetaApiErrorPayload =
            (parsed as { error?: MetaApiErrorPayload })?.error ?? {
              message: `HTTP ${res.statusCode}`,
            };
          throw new MetaApiError({ httpStatus: res.statusCode, payload, endpoint: path });
        } finally {
          clearTimeout(timer);
        }
      },
      {
        maxRetries: env.HTTP_MAX_RETRIES,
        baseDelayMs: env.HTTP_RETRY_BASE_DELAY_MS,
        shouldRetry: (err) => {
          if (err instanceof MetaApiError && err.isRetriable()) return { retry: true };
          // network/abort errors
          if (err instanceof Error && /abort|network|ECONN|ETIMEDOUT/i.test(err.message)) {
            return { retry: true };
          }
          return { retry: false };
        },
        onRetry: (err, attempt, delayMs) => {
          log.warn(
            {
              attempt,
              delayMs,
              accountId,
              endpoint: path,
              err: err instanceof Error ? err.message : String(err),
            },
            'meta.retry',
          );
        },
      },
    );
  }

  // -------------------- high-level helpers -------------------------------

  async getAccountInfo(accountId: string): Promise<{
    id: string;
    name: string;
    currency: string;
    timezone_name: string;
    account_status: number;
    amount_spent?: string;
  }> {
    const acc = this.accounts.get(accountId);
    return this.raw(accountId, `/${acc.adAccountId}`, {
      query: { fields: 'id,name,currency,timezone_name,account_status,amount_spent' },
    });
  }

  async listCampaigns(
    accountId: string,
    opts: { limit?: number; after?: string } = {},
  ): Promise<MetaListResponse<MetaCampaignDTO>> {
    const acc = this.accounts.get(accountId);
    return this.raw(accountId, `/${acc.adAccountId}/campaigns`, {
      query: {
        fields:
          'id,name,status,effective_status,objective,daily_budget,lifetime_budget,special_ad_categories,created_time,updated_time',
        limit: opts.limit ?? 50,
        after: opts.after,
      },
    });
  }

  async listAdSets(
    accountId: string,
    opts: { campaignId?: string; limit?: number; after?: string } = {},
  ): Promise<MetaListResponse<MetaAdSetDTO>> {
    const acc = this.accounts.get(accountId);
    const parent = opts.campaignId ? `/${opts.campaignId}` : `/${acc.adAccountId}`;
    return this.raw(accountId, `${parent}/adsets`, {
      query: {
        fields:
          'id,campaign_id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting',
        limit: opts.limit ?? 50,
        after: opts.after,
      },
    });
  }

  async getInsights(
    accountId: string,
    params: ListInsightsParams,
  ): Promise<MetaListResponse<MetaInsightsDTO>> {
    const acc = this.accounts.get(accountId);
    const target =
      params.level === 'account' || !params.objectId ? acc.adAccountId : params.objectId;
    const fields = params.fields ?? [
      'spend',
      'impressions',
      'reach',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'frequency',
      'actions',
      'action_values',
      'cost_per_action_type',
      'purchase_roas',
      'date_start',
      'date_stop',
    ];
    const query: Record<string, string | number | undefined> = {
      level: params.level,
      fields: fields.join(','),
      date_preset: params.since && params.until ? undefined : params.datePreset ?? 'last_7d',
      time_range:
        params.since && params.until
          ? JSON.stringify({ since: params.since, until: params.until })
          : undefined,
      breakdowns: params.breakdowns?.length ? params.breakdowns.join(',') : undefined,
      limit: 500,
    };
    return this.raw(accountId, `/${target}/insights`, { query });
  }

  // -------------------- mutating helpers ---------------------------------
  // These are LOW-LEVEL. Higher layers MUST verify permissions and confirmations
  // BEFORE calling these methods.

  async updateCampaignStatus(
    accountId: string,
    campaignId: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<{ success: boolean }> {
    return this.raw(accountId, `/${campaignId}`, { method: 'POST', body: { status } });
  }

  async updateAdSetBudget(
    accountId: string,
    adSetId: string,
    /** Daily budget in major currency units. */
    dailyBudget: number,
  ): Promise<{ success: boolean }> {
    // Meta wants amounts in MINOR units (cents) for daily_budget.
    const minor = Math.round(dailyBudget * 100);
    return this.raw(accountId, `/${adSetId}`, {
      method: 'POST',
      body: { daily_budget: String(minor) },
    });
  }

  async createCampaign(
    accountId: string,
    payload: {
      name: string;
      objective: string;
      status: 'PAUSED' | 'ACTIVE';
      special_ad_categories: string[];
      daily_budget?: number;
      lifetime_budget?: number;
    },
  ): Promise<{ id: string }> {
    const acc = this.accounts.get(accountId);
    const body: Record<string, unknown> = {
      name: payload.name,
      objective: payload.objective,
      status: payload.status,
      special_ad_categories: payload.special_ad_categories,
    };
    if (payload.daily_budget != null) body.daily_budget = Math.round(payload.daily_budget * 100);
    if (payload.lifetime_budget != null)
      body.lifetime_budget = Math.round(payload.lifetime_budget * 100);
    return this.raw(accountId, `/${acc.adAccountId}/campaigns`, { method: 'POST', body });
  }

  // -------------------- targeting search ---------------------------------
  // Endpoint: GET /search?type=adinterest|adlocale|adgeolocation&q=...
  // Docs: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search/
  async searchTargeting(
    accountId: string,
    params: {
      type:
        | 'adinterest'
        | 'adinterestsuggestion'
        | 'adinterestvalid'
        | 'adlocale'
        | 'adgeolocation'
        | 'adeducationschool'
        | 'adeducationmajor'
        | 'adworkemployer'
        | 'adworkposition';
      q?: string;
      locale?: string;
      limit?: number;
    },
  ): Promise<MetaListResponse<MetaTargetingSearchHit>> {
    return this.raw(accountId, `/search`, {
      query: {
        type: params.type,
        q: params.q,
        locale: params.locale ?? 'pt_BR',
        limit: params.limit ?? 25,
      },
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
