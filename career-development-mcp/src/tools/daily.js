import { z } from "zod";
import { listGoals, listPdis, loadEvidenceLog, loadOnlineState } from "../storage.js";
import { computePdiProgress } from "../analytics/progress-tracker.js";

function daysBetween(from, to) {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

export async function toolDailyBrief(args) {
  const { dueWithinDays } = z.object({
    dueWithinDays: z.number().int().min(1).max(90).default(14),
  }).strict().parse(args);
  const [pdis, goals, evidenceLog, onlineState] = await Promise.all([
    listPdis(),
    listGoals(),
    loadEvidenceLog(),
    loadOnlineState(),
  ]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activePdis = pdis.filter((pdi) => ["active", "review"].includes(pdi.status));
  const activeGoals = goals.filter((goal) => !["completed", "cancelled"].includes(goal.status));
  const datedGoals = activeGoals
    .filter((goal) => goal.dueDate)
    .map((goal) => ({ ...goal, daysUntilDue: daysBetween(today, new Date(`${goal.dueDate}T00:00:00`)) }));
  const evidenceDates = evidenceLog.evidences
    .map((evidence) => evidence.date)
    .filter(Boolean)
    .sort();

  return {
    generatedAt: new Date().toISOString(),
    activePdis: activePdis.map((pdi) => ({
      id: pdi.id,
      title: pdi.title,
      status: pdi.status,
      progress: computePdiProgress(pdi, goals).overall,
    })),
    priorities: {
      overdueGoals: datedGoals
        .filter((goal) => goal.daysUntilDue < 0)
        .map(({ id, title, dueDate, daysUntilDue }) => ({ id, title, dueDate, daysUntilDue })),
      dueSoon: datedGoals
        .filter((goal) => goal.daysUntilDue >= 0 && goal.daysUntilDue <= dueWithinDays)
        .map(({ id, title, dueDate, daysUntilDue }) => ({ id, title, dueDate, daysUntilDue })),
      blockedGoals: activeGoals
        .filter((goal) => goal.status === "blocked")
        .map(({ id, title, dueDate }) => ({ id, title, dueDate })),
      pdisWithoutEvidence: activePdis
        .filter((pdi) => !evidenceLog.evidences.some((evidence) => evidence.linkedPdiIds.includes(pdi.id)))
        .map(({ id, title }) => ({ id, title })),
    },
    evidence: {
      total: evidenceLog.evidences.length,
      latestDate: evidenceDates.at(-1) ?? null,
    },
    externalSnapshot: onlineState
      ? { available: true, capturedAt: onlineState.capturedAt, importedAt: onlineState.importedAt ?? null }
      : { available: false },
  };
}
