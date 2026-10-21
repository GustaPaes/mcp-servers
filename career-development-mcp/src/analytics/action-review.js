import { z } from "zod";
import { redactSensitiveValue } from "@gustapaes/mcp-runtime";

export const evidenceLink = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      redactSensitiveValue(value) === value
    );
  }, "Evidence links must use HTTPS without credentials.");
const text = z.string().trim().min(1).max(8000);
export const actionReviewInput = z
  .object({
    actionTitle: z.string().trim().min(1).max(512),
    actionDescription: text,
    criteria: z
      .array(
        z
          .object({
            criterion: z.string().trim().min(1).max(1000),
            result: z.enum(["evidenced", "partial", "missing"]),
            evidence: z
              .array(
                z
                  .object({
                    url: evidenceLink,
                    contribution: text,
                    outcome: text,
                  })
                  .strict(),
              )
              .max(20),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export function assessAction(args) {
  const input = actionReviewInput.parse(args);
  const gaps = input.criteria
    .filter((c) => c.result !== "evidenced" || !c.evidence.length)
    .map((c) => c.criterion);
  const lines = [
    `Ação: ${input.actionTitle}`,
    "",
    ...input.criteria.flatMap((c) => [
      `Critério: ${c.criterion} — ${c.result === "evidenced" && c.evidence.length ? "sustentado pelas evidências informadas" : c.result === "missing" ? "ainda sem comprovação" : "parcial"}`,
      ...c.evidence.flatMap((e) => [
        `O que fiz: ${e.contribution}`,
        `Resultado: ${e.outcome}`,
        `Evidência: ${e.url}`,
      ]),
      "",
    ]),
    gaps.length
      ? `Pendências para concluir: ${gaps.join("; ")}.`
      : "Os critérios avaliados estão sustentados pelas evidências informadas. Proponho concluir esta ação após revisão do registro.",
  ];
  return {
    data: {
      recommendation: gaps.length ? "keep_open" : "ready_for_review",
      gaps,
      suggestedComment: redactSensitiveValue(lines.join("\n")),
    },
    warnings: [
      "As evidências e a lista de critérios foram fornecidas pelo solicitante. Confira sua integridade e o escopo completo da ação; os links não foram consultados por esta ferramenta. A conclusão da ação de desenvolvimento é independente do fechamento do item de produto.",
    ],
  };
}

export function analyzeRemotePlan(detail) {
  const gaps = [];
  if (!detail.plan.description.trim())
    gaps.push(
      "O plano precisa descrever a necessidade de desenvolvimento e o resultado esperado.",
    );
  if (!detail.plan.endDate) gaps.push("O plano precisa de prazo.");
  const actions = detail.actions.map((action) => {
    const issues = [];
    if (!action.description.trim())
      issues.push("Descrever como executar e comprovar a ação.");
    if (!action.dueDate) issues.push("Definir prazo da ação.");
    if (
      !/\d|evid[eê]ncia|crit[eé]rio|valid|medir|registro|conclu|demonstr|aprov|curso|certific/i.test(
        action.description,
      )
    )
      issues.push("Explicitar critério de conclusão verificável.");
    return {
      actionId: action.id,
      title: action.title,
      status: action.status,
      issues,
    };
  });
  const completed = actions.filter((a) => a.status === "COMPLETED").length;
  return {
    data: {
      planId: detail.plan.id,
      title: detail.plan.title,
      capturedAt: detail.capturedAt,
      completed,
      total: actions.length,
      progress: actions.length
        ? Math.round((completed / actions.length) * 100)
        : 0,
      issues: gaps,
      actions,
    },
    warnings: [
      "A análise considera a fonte remota atual. Estado COMPLETED e quantidade de entregas não comprovam impacto, economia ou aprendizagem por si sós. Use guide_action_assess para revisar critérios e preparar comentários com evidências.",
    ],
  };
}
