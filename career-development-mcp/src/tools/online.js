import { listPdis, listGoals, loadEvidenceLog, loadOnlineState, saveApprovedChanges } from "../storage.js";
import { computePdiProgress } from "../analytics/progress-tracker.js";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchLocalPdi(card, pdis) {
  const cardTitle = normalizeText(card.title);
  return pdis.find((pdi) => normalizeText(pdi.title) === cardTitle) ?? null;
}

export async function toolOnlineStateGet() {
  const onlineState = await loadOnlineState();
  if (!onlineState) {
    return {
      available: false,
      message: "Nenhum snapshot online capturado ainda. Execute npm run career-platform:capture.",
    };
  }
  return {
    available: true,
    capturedAt: onlineState.capturedAt,
    url: onlineState.url,
    pageTitle: onlineState.pageTitle,
    visiblePlanCards: onlineState.visiblePlanCards ?? [],
    apiResponses: (onlineState.apiResponses ?? []).map((item) => ({
      url: item.url,
      status: item.status,
      contentType: item.contentType,
      detectedKeys: item.detectedKeys,
    })),
  };
}

export async function toolOnlineReviewSuggestions() {
  const [onlineState, pdis, goals, evidenceLog] = await Promise.all([
    loadOnlineState(),
    listPdis(),
    listGoals(),
    loadEvidenceLog(),
  ]);
  if (!onlineState) {
    throw new Error("Nenhum snapshot online capturado ainda. Execute npm run career-platform:capture.");
  }

  const suggestions = (onlineState.visiblePlanCards ?? []).map((card) => {
    const localPdi = matchLocalPdi(card, pdis);
    if (!localPdi) {
      return {
        onlineTitle: card.title,
        matchStatus: "unmatched",
        suggestions: ["Criar mapeamento manual para este plano online antes de sugerir alteracoes."],
      };
    }

    const localGoals = goals.filter((goal) => goal.pdiId === localPdi.id);
    const linkedEvidence = evidenceLog.evidences.filter((evidence) => evidence.linkedPdiIds.includes(localPdi.id));
    const progress = computePdiProgress(localPdi, goals);
    const suggestions = [];

    if (localGoals.some((goal) => goal.progress === 0 && /melhoria|aptd?idao|seguranca/i.test(goal.title))) {
      suggestions.push("Reescrever metas amplas em entregas menores com criterio de pronto verificavel.");
    }
    if (linkedEvidence.length > 0) {
      suggestions.push(`Vincular evidencias existentes como ${linkedEvidence.map((item) => item.title).join(", ")} ao texto visivel do plano.`);
    }
    if (progress.overall !== Number(card.progressPct ?? 0)) {
      suggestions.push(`Revisar divergencia de progresso: online ${card.progressPct ?? 0}% vs base local ${progress.overall}%.`);
    }
    if (/seguranca/i.test(localPdi.title)) {
      suggestions.push("Marcar como concluida a acao ligada ao gate de PR com base na US 12345, se ainda nao estiver refletido no sistema online.");
    }
    if (/hard skills/i.test(localPdi.title)) {
      suggestions.push("Detalhar acoes de hard skills em tarefas concluidas por entrega, evitando descricoes genericas.");
    }
    if (/lideranca/i.test(localPdi.title)) {
      suggestions.push("Explicitar lideranca tecnica por impacto transversal, e nao apenas por intencao de crescimento.");
    }

    return {
      onlineTitle: card.title,
      localPdiId: localPdi.id,
      matchStatus: "matched",
      currentOnlineSummary: card,
      localProgress: progress,
      suggestions,
    };
  });

  const generated = {
    generatedAt: new Date().toISOString(),
    sourceCaptureAt: onlineState.capturedAt,
    suggestions,
  };
  await saveApprovedChanges({ generatedAt: generated.generatedAt, sourceCaptureAt: generated.sourceCaptureAt, changes: suggestions });
  return generated;
}
