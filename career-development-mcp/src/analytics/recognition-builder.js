export function buildRecognitionNarrative({ profile, pdi, progress, evidenceHighlights, gaps }) {
  return [
    `${profile.name} esta conduzindo um plano ativo com foco em ${pdi.targetRole}, conectando entregas reais do time com evolucao de carreira.`,
    `O progresso atual do plano esta em ${progress.overall}%, com destaque para entregas que aumentaram qualidade, seguranca e reducao de custo operacional.`,
    evidenceHighlights.length ? `Evidencias recentes: ${evidenceHighlights.join("; ")}.` : "Ainda faltam evidencias recentes consolidadas.",
    gaps.length ? `Os principais gaps restantes sao: ${gaps.join("; ")}.` : "Nao ha gaps criticos identificados para o proximo checkpoint.",
  ].join(" ");
}
