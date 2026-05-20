import type { AccountRegistry } from '../config/accounts.js';
import type { MetaAdsClient } from '../meta/MetaAdsClient.js';
import type { Storage } from '../storage/interfaces.js';
import { AuditLog } from '../security/auditLog.js';
import { OptimizationEngine } from '../optimization/OptimizationEngine.js';
import { CreativeAnalysisEngine } from '../optimization/CreativeAnalysisEngine.js';
import { AudienceStrategyEngine } from '../optimization/AudienceStrategyEngine.js';
import { PolicyRiskEngine } from '../optimization/PolicyRiskEngine.js';
import { BudgetEngine } from '../optimization/BudgetEngine.js';

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
