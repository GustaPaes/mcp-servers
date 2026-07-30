import type { AccountRegistry } from '../config/accounts.js';
import type { MetaAdsClient } from '../meta/MetaAdsClient.js';
import type { Storage } from '../storage/interfaces.js';
import type { AuditLog } from '../security/auditLog.js';
import type { OptimizationEngine } from '../optimization/OptimizationEngine.js';
import type { CreativeAnalysisEngine } from '../optimization/CreativeAnalysisEngine.js';
import type { AudienceStrategyEngine } from '../optimization/AudienceStrategyEngine.js';
import type { PolicyRiskEngine } from '../optimization/PolicyRiskEngine.js';
import type { BudgetEngine } from '../optimization/BudgetEngine.js';

export interface ToolContext {
  accounts: AccountRegistry;
  meta: MetaAdsClient;
  storage: Storage;
  audit: AuditLog;
  engines: {
    optimization: OptimizationEngine;
    creative: CreativeAnalysisEngine;
    audience: AudienceStrategyEngine;
    policy: PolicyRiskEngine;
    budget: BudgetEngine;
  };
}
