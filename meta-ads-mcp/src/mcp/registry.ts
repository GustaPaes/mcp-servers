import type { McpTool } from './toolKit.js';
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
export const ALL_TOOLS: McpTool<any, unknown>[] = [
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
