import type { McpTool, RegisteredMcpTool, ToolPolicy } from './toolKit.js';
import { assertToolManifest } from '@gustapaes/mcp-runtime';
import {
  listAdAccountsTool,
  getAccountProfileTool,
  updateAccountProfileTool,
} from './tools/accounts.tools.js';
import {
  listCampaignsTool,
  createCampaignDraftTool,
  publishCampaignTool,
  pauseCampaignTool,
} from './tools/campaigns.tools.js';
import { listAdSetsTool, createAdSetDraftTool } from './tools/adsets.tools.js';
import {
  createAdCreativeDraftTool,
  analyzeAdCreativeTool,
  predictBestAudienceForAdTool,
} from './tools/creatives.tools.js';
import {
  getCampaignInsightsTool,
  getAdSetInsightsTool,
  generatePerformanceReportTool,
  compareAdsTool,
  findWastedSpendTool,
} from './tools/insights.tools.js';
import {
  analyzeCampaignPerformanceTool,
  recommendCampaignOptimizationsTool,
  recommendAudienceStrategyTool,
  generateTargetingSuggestionsTool,
  adjustBudgetRecommendationTool,
  applyBudgetChangeTool,
  recommendAbTestsTool,
} from './tools/optimization.tools.js';
import { validateMetaPolicyRiskTool } from './tools/policy.tools.js';
import { searchTargetingIdsTool } from './tools/targeting.tools.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: McpTool<any, unknown>[] = [
  // accounts
  listAdAccountsTool,
  getAccountProfileTool,
  updateAccountProfileTool,
  // campaigns
  listCampaignsTool,
  createCampaignDraftTool,
  publishCampaignTool,
  pauseCampaignTool,
  // ad sets
  listAdSetsTool,
  createAdSetDraftTool,
  // creatives
  createAdCreativeDraftTool,
  analyzeAdCreativeTool,
  predictBestAudienceForAdTool,
  // insights
  getCampaignInsightsTool,
  getAdSetInsightsTool,
  generatePerformanceReportTool,
  compareAdsTool,
  findWastedSpendTool,
  // optimization
  analyzeCampaignPerformanceTool,
  recommendCampaignOptimizationsTool,
  recommendAudienceStrategyTool,
  generateTargetingSuggestionsTool,
  adjustBudgetRecommendationTool,
  applyBudgetChangeTool,
  recommendAbTestsTool,
  // policy
  validateMetaPolicyRiskTool,
  // targeting
  searchTargetingIdsTool,
];

/**
 * Explicit policy manifest. Adding or removing a tool without classifying it
 * makes startup and contract tests fail closed.
 */
export const TOOL_POLICIES: Readonly<Record<string, ToolPolicy>> = Object.freeze({
  list_ad_accounts: { risk: 'READ', idempotent: true, openWorld: false },
  get_account_profile: { risk: 'READ', idempotent: true, openWorld: false },
  update_account_profile: { risk: 'LOCAL_STATE', idempotent: true, openWorld: false },
  list_campaigns: { risk: 'READ', idempotent: true, openWorld: true },
  create_campaign_draft: { risk: 'LOCAL_STATE', idempotent: false, openWorld: false },
  publish_campaign: { risk: 'REMOTE_WRITE', idempotent: false, openWorld: true },
  pause_campaign: { risk: 'REMOTE_WRITE', idempotent: true, openWorld: true },
  list_ad_sets: { risk: 'READ', idempotent: true, openWorld: true },
  create_ad_set_draft: { risk: 'LOCAL_STATE', idempotent: false, openWorld: false },
  create_ad_creative_draft: { risk: 'LOCAL_STATE', idempotent: false, openWorld: false },
  analyze_ad_creative: { risk: 'READ', idempotent: true, openWorld: false },
  predict_best_audience_for_ad: { risk: 'READ', idempotent: true, openWorld: false },
  get_campaign_insights: { risk: 'READ', idempotent: true, openWorld: true },
  get_ad_set_insights: { risk: 'READ', idempotent: true, openWorld: true },
  generate_performance_report: { risk: 'READ', idempotent: true, openWorld: true },
  compare_ads: { risk: 'READ', idempotent: true, openWorld: true },
  find_wasted_spend: { risk: 'READ', idempotent: true, openWorld: true },
  analyze_campaign_performance: { risk: 'READ', idempotent: true, openWorld: false },
  recommend_campaign_optimizations: { risk: 'READ', idempotent: true, openWorld: false },
  recommend_audience_strategy: { risk: 'READ', idempotent: true, openWorld: false },
  generate_targeting_suggestions: { risk: 'READ', idempotent: true, openWorld: false },
  adjust_budget_recommendation: { risk: 'READ', idempotent: true, openWorld: false },
  apply_budget_change: { risk: 'REMOTE_WRITE', idempotent: true, openWorld: true },
  recommend_ab_tests: { risk: 'READ', idempotent: true, openWorld: false },
  validate_meta_policy_risk: { risk: 'READ', idempotent: true, openWorld: false },
  search_targeting_ids: { risk: 'READ', idempotent: true, openWorld: true },
});

assertToolManifest({
  definitions: TOOLS,
  handlers: Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.handler])),
  policies: TOOL_POLICIES,
  label: 'meta-ads-mcp',
});

export const ALL_TOOLS: RegisteredMcpTool[] = TOOLS.map((tool) => ({
  ...tool,
  policy: TOOL_POLICIES[tool.name]!,
}));
