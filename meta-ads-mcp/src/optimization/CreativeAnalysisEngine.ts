import type { AccountConfig } from '../schemas/account.schema.js';
import type { AdCreativeAnalysisInput } from '../schemas/creative.schema.js';
import { PolicyRiskEngine, type PolicyFinding } from './PolicyRiskEngine.js';

export type FunnelStage = 'awareness' | 'consideration' | 'decision' | 'retention';

export interface CreativeAnalysis {
  productCategory: string;
  intent: string;
  funnelStage: FunnelStage;
  audienceProbable: string[];
  audienceToAvoid: string[];
  painsAndDesires: { pains: string[]; desires: string[] };
  objections: string[];
  recommendedObjective: string;
  recommendedCta: string;
  recommendedPlacements: string[];
  copySuggestions: string[];
  creativeSuggestions: string[];
  abTestPlan: string[];
  metricsToWatch: string[];
  optimizationPlan: { after3Days: string[]; after7Days: string[]; after14Days: string[] };
  clarityScore: number;       // 0-100
  policyFindings: PolicyFinding[];
  policyBlocked: boolean;
  /** Disclaimer: we never promise results. */
  disclaimer: string;
}

/**
 * Heuristic, rule-based creative analysis. It is *intentionally* non-LLM
 * so that the MCP server itself behaves deterministically. When wired to an
 * LLM-powered MCP client (Claude/ChatGPT/Cursor), the model will combine
 * these structured signals with its own reasoning.
 */
export class CreativeAnalysisEngine {
  constructor(private readonly policy = new PolicyRiskEngine()) {}

  analyze(input: AdCreativeAnalysisInput, account: AccountConfig): CreativeAnalysis {
    const text = [
      input.headline,
      input.primaryText,
      input.description ?? '',
      input.productOrOffer,
      input.imageDescription ?? '',
    ]
      .join('\n')
      .toLowerCase();

    const productCategory = inferCategory(text, account);
    const intent = inferIntent(text);
    const funnelStage = inferFunnelStage(text, input.cta);

    const pains = inferPains(text);
    const desires = inferDesires(text);
    const objections = inferObjections(text, input);

    const audienceProbable = buildProbableAudience(account, productCategory, intent);
    const audienceToAvoid = buildAudienceToAvoid(account);

    const recommendedObjective = mapObjectiveFromIntent(intent, account);
    const recommendedCta = mapCta(intent, input.cta);
    const recommendedPlacements = inferPlacements(account, productCategory);

    const copySuggestions = buildCopySuggestions(account, input, productCategory);
    const creativeSuggestions = buildCreativeSuggestions(productCategory, funnelStage);
    const abTestPlan = buildAbTestPlan(input, account);

    const metricsToWatch = buildMetricsToWatch(recommendedObjective);
    const optimizationPlan = buildOptimizationPlan();

    const copyPolicy = this.policy.validateCopy(
      `${input.headline}\n${input.primaryText}\n${input.description ?? ''}`,
      account,
    );

    const clarityScore = scoreClarity(input);

    return {
      productCategory,
      intent,
      funnelStage,
      audienceProbable,
      audienceToAvoid,
      painsAndDesires: { pains, desires },
      objections,
      recommendedObjective,
      recommendedCta,
      recommendedPlacements,
      copySuggestions,
      creativeSuggestions,
      abTestPlan,
      metricsToWatch,
      optimizationPlan,
      clarityScore,
      policyFindings: copyPolicy.findings,
      policyBlocked: copyPolicy.blocked,
      disclaimer:
        'These suggestions are heuristic. They do NOT guarantee results. ' +
        'Always validate with real campaign data and human review before applying.',
    };
  }
}

// ---------------- internal heuristics -------------------------------------

function inferCategory(text: string, account: AccountConfig): string {
  const map: Array<[RegExp, string]> = [
    [/vestido|dress|moda|fashion|roupa/, 'Fashion / Apparel'],
    [/saas|software|plataforma|tool|app/, 'SaaS / Software'],
    [/curso|course|treinamento|workshop/, 'Online Course'],
    [/imóvel|imovel|real estate|apart/, 'Real Estate'],
    [/credit|loan|empréstimo|financ/, 'Financial Services'],
    [/restaurante|cardápio|delivery|comida/, 'Food / Delivery'],
    [/clinic|saúde|consulta|tratamento/, 'Health Services'],
  ];
  for (const [re, label] of map) if (re.test(text)) return label;
  return account.niche;
}

function inferIntent(text: string): string {
  if (/compre|buy|shop|loja|checkout|carrinho|cart/.test(text)) return 'purchase';
  if (/cadastre|sign up|subscribe|inscreva|registr/.test(text)) return 'signup';
  if (/saiba mais|learn more|conheça|descubra|discover/.test(text)) return 'awareness';
  if (/fale|contact|whatsapp|message|orçamento|quote/.test(text)) return 'lead';
  if (/baix|download|install/.test(text)) return 'download';
  return 'engagement';
}

function inferFunnelStage(text: string, cta: string): FunnelStage {
  if (/compre|buy|checkout|shop_now/i.test(cta) || /comprar|buy now/.test(text)) return 'decision';
  if (/learn_more|saiba mais|descubra/i.test(cta)) return 'consideration';
  if (/sign_up|cadastre|subscribe/i.test(cta)) return 'consideration';
  if (/contact_us|message|fale conosco/i.test(cta)) return 'decision';
  return 'awareness';
}

function inferPains(text: string): string[] {
  const candidates: Array<[RegExp, string]> = [
    [/falta de tempo|sem tempo/, 'Falta de tempo'],
    [/caro|expens/, 'Percepção de preço alto'],
    [/difícil|complicado|hard|complicated/, 'Processo complexo'],
    [/qualidade ruim|low quality/, 'Qualidade insatisfatória de alternativas'],
  ];
  return candidates.filter(([re]) => re.test(text)).map(([, l]) => l);
}

function inferDesires(text: string): string[] {
  const candidates: Array<[RegExp, string]> = [
    [/elegan|sofistic|premium|exclusiv/, 'Sentir-se elegante / exclusivo'],
    [/rápid|fast|agil/, 'Resolver rapidamente'],
    [/econom|barato|desconto|discount|frete grátis/, 'Economizar / obter valor'],
    [/seguro|protege|safe/, 'Sentir segurança'],
    [/produtiv|productiv/, 'Ganhar produtividade'],
  ];
  return candidates.filter(([re]) => re.test(text)).map(([, l]) => l);
}

function inferObjections(text: string, input: AdCreativeAnalysisInput): string[] {
  const out: string[] = [];
  if (!/garanti|guarantee|devolução|refund/.test(text)) out.push('Risco percebido na compra');
  if (!/frete|shipping|entrega/.test(text)) out.push('Dúvida sobre prazo/custo de entrega');
  if (!/parcel|installment/.test(text)) out.push('Dúvida sobre forma de pagamento');
  if (!input.landingPageUrl) out.push('Página de destino não informada para análise');
  return out;
}

function buildProbableAudience(
  account: AccountConfig,
  category: string,
  intent: string,
): string[] {
  const out = [
    `${account.persona.summary}`,
    `Interesses base: ${account.persona.interestsKeywords.slice(0, 8).join(', ')}`,
    `Categoria: ${category}`,
    intent === 'purchase'
      ? 'Pessoas com sinais de intenção de compra recentes (engaged shoppers)'
      : 'Pessoas com interesses correlatos na categoria',
  ];
  return out;
}

function buildAudienceToAvoid(account: AccountConfig): string[] {
  const out = [
    'Atributos protegidos (raça, religião, orientação sexual, saúde, política) — bloqueados por política',
    'Menores de 18 anos, salvo aprovação explícita',
  ];
  if (account.audienceRestrictions.excludeRecentBuyersDays > 0) {
    out.push(
      `Compradores nos últimos ${account.audienceRestrictions.excludeRecentBuyersDays} dias (exclusão configurada)`,
    );
  }
  if (account.audienceRestrictions.blockedInterests.length) {
    out.push(`Interesses bloqueados: ${account.audienceRestrictions.blockedInterests.join(', ')}`);
  }
  return out;
}

function mapObjectiveFromIntent(intent: string, account: AccountConfig): string {
  switch (intent) {
    case 'purchase':
      return 'OUTCOME_SALES';
    case 'lead':
    case 'signup':
      return 'OUTCOME_LEADS';
    case 'download':
      return 'OUTCOME_APP_PROMOTION';
    case 'awareness':
      return 'OUTCOME_AWARENESS';
    case 'engagement':
      return 'OUTCOME_ENGAGEMENT';
    default:
      return account.primaryObjective;
  }
}

function mapCta(intent: string, current: string): string {
  if (intent === 'purchase') return 'SHOP_NOW';
  if (intent === 'lead') return 'CONTACT_US';
  if (intent === 'signup') return 'SIGN_UP';
  if (intent === 'download') return 'DOWNLOAD';
  return current;
}

function inferPlacements(account: AccountConfig, category: string): string[] {
  const baseline = ['facebook:feed', 'instagram:feed', 'instagram:reels', 'facebook:stories'];
  if (/fashion|food|real estate/i.test(category)) {
    baseline.push('instagram:explore');
  }
  if (account.facebookPageId) baseline.push('facebook:marketplace');
  return baseline;
}

function buildCopySuggestions(
  account: AccountConfig,
  input: AdCreativeAnalysisInput,
  _category: string,
): string[] {
  return [
    `Versão A (benefício direto): destaque o principal benefício do "${input.productOrOffer}" na primeira linha.`,
    `Versão B (prova social): inclua um indicador objetivo (ex: "+10 mil clientes") — só se for verdadeiro.`,
    `Versão C (objeção-resposta): aborde uma objeção (ex: frete, prazo, garantia) sem prometer resultado.`,
    `Tom de comunicação alvo: "${account.tone}".`,
  ];
}

function buildCreativeSuggestions(category: string, stage: FunnelStage): string[] {
  const out = ['Testar imagem estática vs. vídeo curto (<=15s) vs. carrossel.'];
  if (stage === 'awareness') out.push('Vídeo curto contando a história/contexto do produto.');
  if (stage === 'decision') out.push('Imagem clara do produto com preço/oferta visível.');
  if (/fashion/i.test(category)) out.push('UGC (cliente usando o produto) com legenda autêntica.');
  return out;
}

function buildAbTestPlan(input: AdCreativeAnalysisInput, _account: AccountConfig): string[] {
  return [
    'Teste 1 — Criativo: imagem A vs. imagem B (mesma copy, mesmo público).',
    'Teste 2 — CTA: ' + input.cta + ' vs. CTA alternativo recomendado.',
    'Teste 3 — Público: interesse curado vs. Advantage+ Audience.',
    'Teste 4 — Hook: primeira linha do primaryText (3 variantes).',
  ];
}

function buildMetricsToWatch(objective: string): string[] {
  const base = ['CTR', 'CPM', 'Frequency'];
  if (objective === 'OUTCOME_SALES') base.push('CPA (Purchase)', 'ROAS', 'Add-to-Cart rate');
  if (objective === 'OUTCOME_LEADS') base.push('Cost per Lead', 'Lead Quality (CRM)');
  if (objective === 'OUTCOME_AWARENESS') base.push('Reach', 'CPM');
  return base;
}

function buildOptimizationPlan(): CreativeAnalysis['optimizationPlan'] {
  return {
    after3Days: [
      'Validar entrega básica (impressões >= mínimo para sair do learning).',
      'Não tomar decisões drásticas (campanha ainda em aprendizado).',
      'Pausar criativos com CTR 50%+ abaixo da média e zero conversão.',
    ],
    after7Days: [
      'Avaliar CPA / ROAS vs. metas do account profile.',
      'Realocar verba (até maxBudgetChangePct) entre ad sets vencedores.',
      'Refrescar criativos com frequência > 3.0 e CTR em queda.',
    ],
    after14Days: [
      'Decidir corte vs. escala. Escala em incrementos pequenos (<= 20%).',
      'Lançar 1-2 novos criativos como hedge contra fadiga.',
      'Revisar exclusões (compradores recentes, lookalikes saturados).',
    ],
  };
}

function scoreClarity(input: AdCreativeAnalysisInput): number {
  let score = 50;
  if (input.headline.length >= 20 && input.headline.length <= 80) score += 10;
  if (/[.!?]/.test(input.primaryText)) score += 5;
  if (input.primaryText.length >= 80 && input.primaryText.length <= 600) score += 10;
  if (input.cta) score += 5;
  if (input.landingPageUrl) score += 10;
  if (input.imageDescription && input.imageDescription.length > 20) score += 10;
  return Math.min(100, score);
}
