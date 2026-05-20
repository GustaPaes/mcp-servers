import type { AccountConfig } from '../schemas/account.schema.js';
import type { InsightsRow } from '../schemas/insights.schema.js';
import { BudgetEngine, type OptimizationGoals } from './BudgetEngine.js';

export type RecImpact = 'low' | 'medium' | 'high';
export type RecConfidence = 'low' | 'medium' | 'high';
export type RecRisk = 'low' | 'medium' | 'high';

export interface Recommendation {
  id: string;
  title: string;
  category:
    | 'budget'
    | 'creative'
    | 'audience'
    | 'placement'
    | 'objective'
    | 'event'
    | 'pause'
    | 'scale';
  recommendation: string;
  reason: string;
  impact: RecImpact;
  confidence: RecConfidence;
  risk: RecRisk;
  requiresApproval: boolean;
  easeOfExecution: 'easy' | 'medium' | 'hard';
  supportingMetrics: Partial<InsightsRow>;
}

export interface AnalyzeInput {
  account: AccountConfig;
  campaignId: string;
  campaignName?: string;
  currentDailyBudget?: number;
  metrics: InsightsRow;
  goals: OptimizationGoals;
  inLearningPhase?: boolean;
}

let counter = 0;
const newId = () => `rec_${Date.now()}_${++counter}`;

export class OptimizationEngine {
  constructor(private readonly budget = new BudgetEngine()) {}

  analyze(input: AnalyzeInput): Recommendation[] {
    const { account, metrics, goals, inLearningPhase, currentDailyBudget } = input;
    const recs: Recommendation[] = [];

    // 1. Learning phase guard — avoid abrupt changes.
    if (inLearningPhase) {
      recs.push({
        id: newId(),
        title: 'Aguardar fim da fase de aprendizado',
        category: 'budget',
        recommendation:
          'Não fazer alterações estruturais (orçamento, público, otimização) até o ad set sair de "Learning".',
        reason:
          'Mudanças durante o aprendizado reiniciam o ciclo e podem aumentar CPA temporariamente.',
        impact: 'medium',
        confidence: 'high',
        risk: 'low',
        requiresApproval: false,
        easeOfExecution: 'easy',
        supportingMetrics: { conversions: metrics.conversions, spend: metrics.spend },
      });
    }

    // 2. Insufficient data guard — never recommend killing too early.
    if (metrics.conversions < 5 && metrics.spend < 50) {
      recs.push({
        id: newId(),
        title: 'Dados insuficientes para decisão de corte',
        category: 'budget',
        recommendation:
          'Aguardar mais dados antes de pausar/cortar. Mínimo recomendado: 50 cliques ou 5 conversões.',
        reason: 'Volume estatístico baixo gera falsos negativos.',
        impact: 'medium',
        confidence: 'high',
        risk: 'low',
        requiresApproval: false,
        easeOfExecution: 'easy',
        supportingMetrics: { conversions: metrics.conversions, spend: metrics.spend, clicks: metrics.clicks },
      });
      return recs;
    }

    // 3. CPA / ROAS budget recommendation
    if (currentDailyBudget) {
      const b = this.budget.recommendChange({
        account,
        objectId: input.campaignId,
        currentDailyBudget,
        metrics,
        goals,
      });
      if (b.changeAbs !== 0) {
        recs.push({
          id: newId(),
          title: `Ajustar orçamento diário em ${b.changePct.toFixed(1)}%`,
          category: b.changePct < 0 ? 'budget' : 'scale',
          recommendation: `Alterar orçamento diário de ${b.currentDailyBudget} para ${b.recommendedDailyBudget} (${b.changeAbs >= 0 ? '+' : ''}${b.changeAbs}).`,
          reason: b.rationale,
          impact: Math.abs(b.changePct) >= 15 ? 'high' : 'medium',
          confidence: b.confidence,
          risk: b.risk,
          requiresApproval: true,
          easeOfExecution: 'easy',
          supportingMetrics: b.supportingMetrics,
        });
      }
    }

    // 4. Frequency / creative fatigue
    if (goals.maxFrequency != null && metrics.frequency > goals.maxFrequency) {
      recs.push({
        id: newId(),
        title: 'Refrescar criativos (fadiga detectada)',
        category: 'creative',
        recommendation:
          'Substituir criativos com frequência acima do limite por novas variações; manter público.',
        reason: `Frequency ${metrics.frequency.toFixed(2)} > ${goals.maxFrequency}.`,
        impact: 'high',
        confidence: 'medium',
        risk: 'low',
        requiresApproval: false,
        easeOfExecution: 'medium',
        supportingMetrics: { frequency: metrics.frequency, ctr: metrics.ctr },
      });
    }

    // 5. High CTR but low conversion -> landing page / offer mismatch
    if (
      goals.minCtr != null &&
      metrics.ctr * 100 >= goals.minCtr &&
      metrics.conversions > 0 &&
      goals.maxCpa != null &&
      metrics.cpa != null &&
      metrics.cpa > goals.maxCpa * 1.2
    ) {
      recs.push({
        id: newId(),
        title: 'CTR bom, conversão fraca — investigar funil pós-clique',
        category: 'event',
        recommendation:
          'Auditar landing page (carregamento, clareza da oferta, formulário). Considerar evento de conversão alternativo.',
        reason: 'Diferença entre interesse no anúncio e conversão indica problema fora do anúncio.',
        impact: 'high',
        confidence: 'medium',
        risk: 'low',
        requiresApproval: false,
        easeOfExecution: 'medium',
        supportingMetrics: { ctr: metrics.ctr, cpa: metrics.cpa, conversions: metrics.conversions },
      });
    }

    // 6. Low delivery
    if (metrics.impressions < 1000 && metrics.spend > 0) {
      recs.push({
        id: newId(),
        title: 'Baixa entrega — revisar público e orçamento',
        category: 'audience',
        recommendation:
          'Ampliar público (Advantage+ ou remover restrições) ou aumentar orçamento mínimo do ad set.',
        reason: 'Volume de impressões muito baixo impede o algoritmo de aprender.',
        impact: 'medium',
        confidence: 'medium',
        risk: 'low',
        requiresApproval: true,
        easeOfExecution: 'medium',
        supportingMetrics: { impressions: metrics.impressions, reach: metrics.reach },
      });
    }

    return recs;
  }
}
