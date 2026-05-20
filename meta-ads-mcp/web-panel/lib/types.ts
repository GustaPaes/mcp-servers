export interface ToolEnvelope<T> {
  ok: boolean;
  data?: T;
  warnings?: string[];
  errors?: string[];
  meta?: Record<string, unknown>;
}

export interface AdAccountSummary {
  id: string;
  name: string;
  adAccountId: string;
  currency: string;
  timezone: string;
  country: string;
  niche: string;
  primaryObjective: string;
  configuredMode: 'read-only' | 'dry-run' | 'write-enabled';
  effectiveMode: 'read-only' | 'dry-run' | 'write-enabled';
  hasToken: boolean;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time?: string;
  updated_time?: string;
}

export interface InsightRow {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  date_start?: string;
  date_stop?: string;
  actions?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
  [key: string]: unknown;
}

export interface AuditEntry {
  ts: string;
  action: string;
  accountId?: string;
  tool?: string;
  requestedBy?: string;
  reason?: string;
  error?: string;
  meta?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  result?: unknown;
}
