import type { AccountConfig } from '../schemas/account.schema.js';
import type { InsightsRow } from '../schemas/insights.schema.js';
import { clamp, pctChange, roundCurrency } from '../utils/money.js';
import { getEnv } from '../config/env.js';

export interface BudgetChangeRecommendation {
  objectId: string;
  currentDailyBudget: number;
  recommendedDailyBudget: number;
  changePct: number;
  changeAbs: number;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  requiresApproval: true;
  withinAccountLimits: boolean;
  withinGlobalLimits: boolean;
  supportingMetrics: Partial<InsightsRow>;
}

export interface OptimizationGoals {
  maxCpa?: number;
  minRoas?: number;
  minCtr?: number;     // %
  maxFrequency?: number;
}

export class BudgetEngine {
  recommendChange(opts: {
    account: AccountConfig;
    objectId: string;
    currentDailyBudget: number;
    metrics: InsightsRow;
    goals: OptimizationGoals;
  }): BudgetChangeRecommendation {
    const { account, currentDailyBudget, metrics, goals } = opts;
    let direction: 'up' | 'down' | 'hold' = 'hold';
    let magnitude = 0; // percentage
    const reasons: string[] = [];

    // CPA above target -> reduce
    if (goals.maxCpa != null && metrics.cpa != null && metrics.cpa > goals.maxCpa) {
      const overshoot = pctChange(goals.maxCpa, metrics.cpa);
      direction = 'down';
      magnitude = Math.max(magnitude, clamp(overshoot / 2, 5, 25));
      reasons.push(
        `CPA ${roundCurrency(metrics.cpa)} está ${overshoot.toFixed(1)}% acima da meta (${goals.maxCpa}).`,
      );
    }

    // ROAS below target -> reduce
    if (goals.minRoas != null && metrics.roas != null && metrics.roas < goals.minRoas) {
      const deficit = pctChange(metrics.roas, goals.minRoas);
      direction = 'down';
      magnitude = Math.max(magnitude, clamp(deficit / 2, 5, 25));
      reasons.push(
        `ROAS ${metrics.roas.toFixed(2)} abaixo do mínimo ${goals.minRoas}.`,
      );
    }

    // High frequency -> hold or reduce (creative fatigue, not budget per se)
    if (goals.maxFrequency != null && metrics.frequency > goals.maxFrequency) {
      reasons.push(
        `Frequência ${metrics.frequency.toFixed(2)} acima de ${goals.maxFrequency} — fadiga de criativo (refresh recomendado).`,
      );
    }

    // Strong performance -> scale up (small increments only)
    const beatingCpa =
      goals.maxCpa != null && metrics.cpa != null && metrics.cpa < goals.maxCpa * 0.85;
    const beatingRoas =
      goals.minRoas != null && metrics.roas != null && metrics.roas > goals.minRoas * 1.2;
    if (direction === 'hold' && (beatingCpa || beatingRoas) && metrics.conversions >= 20) {
      direction = 'up';
      magnitude = 15;
      reasons.push(
        'Performance acima da meta com volume estatisticamente relevante (>=20 conversões).',
      );
    }

    if (metrics.conversions < 5 && direction !== 'hold') {
      reasons.push('Volume de conversões baixo (<5): recomendação com confiança reduzida.');
    }

    const env = getEnv();
    const globalCap = env.GLOBAL_MAX_BUDGET_CHANGE_PCT;
    const accountCap = account.budgetLimits.maxBudgetChangePct;
    const effectiveCap = Math.min(globalCap, accountCap, magnitude);

    const signed = direction === 'down' ? -effectiveCap : direction === 'up' ? effectiveCap : 0;
    let recommended = roundCurrency(currentDailyBudget * (1 + signed / 100));
    // Apply absolute caps too
    const maxAbsChange = Math.min(
      account.budgetLimits.maxPerExecutionChange,
      currentDailyBudget * (account.budgetLimits.maxBudgetChangePct / 100),
    );
    if (Math.abs(recommended - currentDailyBudget) > maxAbsChange) {
      recommended = roundCurrency(
        currentDailyBudget + Math.sign(recommended - currentDailyBudget) * maxAbsChange,
      );
    }
    recommended = clamp(recommended, 1, account.budgetLimits.maxDailyBudget);

    const changeAbs = roundCurrency(recommended - currentDailyBudget);
    const changePct = currentDailyBudget > 0 ? (changeAbs / currentDailyBudget) * 100 : 0;

    const confidence: BudgetChangeRecommendation['confidence'] =
      metrics.conversions >= 30 ? 'high' : metrics.conversions >= 10 ? 'medium' : 'low';
    const risk: BudgetChangeRecommendation['risk'] =
      Math.abs(changePct) <= 10 ? 'low' : Math.abs(changePct) <= 20 ? 'medium' : 'high';

    return {
      objectId: opts.objectId,
      currentDailyBudget: roundCurrency(currentDailyBudget),
      recommendedDailyBudget: recommended,
      changePct: Number(changePct.toFixed(2)),
      changeAbs,
      rationale: reasons.join(' ') || 'Manter orçamento atual — sem sinais claros.',
      confidence,
      risk,
      requiresApproval: true,
      withinAccountLimits: recommended <= account.budgetLimits.maxDailyBudget,
      withinGlobalLimits: recommended <= env.GLOBAL_MAX_DAILY_BUDGET,
      supportingMetrics: {
        spend: metrics.spend,
        conversions: metrics.conversions,
        cpa: metrics.cpa,
        roas: metrics.roas,
        ctr: metrics.ctr,
        cpm: metrics.cpm,
        frequency: metrics.frequency,
      },
    };
  }
}
