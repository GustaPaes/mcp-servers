/** Re-usable Meta Marketing API DTO types. Kept intentionally minimal. */

export interface MetaCampaignDTO {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  effective_status?: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  special_ad_categories?: string[];
  created_time?: string;
  updated_time?: string;
}

export interface MetaAdSetDTO {
  id: string;
  campaign_id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  targeting?: unknown;
}

export interface MetaInsightsDTO {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
  // breakdowns appear as top-level keys (age, gender, etc.).
  [key: string]: unknown;
}

export interface MetaPagingCursors {
  before?: string;
  after?: string;
}

export interface MetaListResponse<T> {
  data: T[];
  paging?: { cursors?: MetaPagingCursors; next?: string; previous?: string };
}

/**
 * Resultado de /search?type=adinterest|adlocale|adgeolocation|...
 * Os campos variam por tipo; deixamos um superset opcional.
 */
export interface MetaTargetingSearchHit {
  id?: string;
  key?: string;
  name?: string;
  audience_size?: number;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  path?: string[];
  topic?: string;
  description?: string;
  type?: string;
  country_code?: string;
  country_name?: string;
  region?: string;
  region_id?: string;
  supports_region?: boolean;
  supports_city?: boolean;
}
