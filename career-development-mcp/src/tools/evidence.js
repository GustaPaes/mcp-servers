import { z } from "zod";
import { evidenceLogSchema, evidenceSchema } from "../models/evidence.js";
import { loadEvidenceLog, saveEvidenceLog, listPdis, listGoals, saveGoal, withStorageMutation } from "../storage.js";
import { importEvidenceFromWorkItem } from "../integrations/tfs-bridge.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeEvidence(log) {
  return evidenceLogSchema.parse(log);
}

export async function toolEvidenceAdd(args) {
  const input = z.object({
    date: z.string(),
    type: z.enum(["delivery", "feedback", "certification", "presentation", "mentoring", "code_review", "leadership", "quality"]),
    title: z.string().min(1),
    description: z.string().min(1),
    impact: z.string().min(1),
    linkedPdiIds: z.array(z.string()).default([]),
    linkedGoalIds: z.array(z.string()).default([]),
    linkedWorkItems: z.array(z.string()).default([]),
    linkedPRs: z.array(z.string()).default([]),
    visibility: z.enum(["self", "team", "org"]),
    tags: z.array(z.string()).default([]),
    source: z.enum(["manual", "tfs"]).default("manual"),
    sourceMeta: z.record(z.unknown()).default({}),
  }).parse(args);

  return withStorageMutation(async () => {
    const current = normalizeEvidence(await loadEvidenceLog());
    const evidence = evidenceSchema.parse({
      id: `ev-${Date.now()}`,
      ...input,
      createdAt: nowIso(),
    });
    const updated = { evidences: [...current.evidences, evidence] };
    await saveEvidenceLog(updated);

    const goals = await listGoals();
    await Promise.all(
      goals
        .filter((goal) => evidence.linkedGoalIds.includes(goal.id))
        .map((goal) => saveGoal({
          ...goal,
          evidenceIds: [...new Set([...(goal.evidenceIds ?? []), evidence.id])],
          updatedAt: nowIso(),
        }))
    );

    return evidence;
  });
}

export async function toolEvidenceList(args) {
  const { linkedGoalId, linkedPdiId, type } = z.object({
    linkedGoalId: z.string().optional(),
    linkedPdiId: z.string().optional(),
    type: z.string().optional(),
  }).parse(args);
  const log = normalizeEvidence(await loadEvidenceLog());
  return log.evidences
    .filter((evidence) => !linkedGoalId || evidence.linkedGoalIds.includes(linkedGoalId))
    .filter((evidence) => !linkedPdiId || evidence.linkedPdiIds.includes(linkedPdiId))
    .filter((evidence) => !type || evidence.type === type)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export async function toolEvidenceReport(args) {
  const { pdiId } = z.object({ pdiId: z.string().optional() }).parse(args);
  const [log, pdis, goals] = await Promise.all([loadEvidenceLog(), listPdis(), listGoals()]);
  const evidences = normalizeEvidence(log).evidences.filter((evidence) => !pdiId || evidence.linkedPdiIds.includes(pdiId));
  return {
    total: evidences.length,
    items: evidences.map((evidence) => ({
      id: evidence.id,
      date: evidence.date,
      title: evidence.title,
      impact: evidence.impact,
      linkedPdis: pdis.filter((pdi) => evidence.linkedPdiIds.includes(pdi.id)).map((pdi) => pdi.title),
      linkedGoals: goals.filter((goal) => evidence.linkedGoalIds.includes(goal.id)).map((goal) => goal.title),
      linkedWorkItems: evidence.linkedWorkItems,
    })),
  };
}

export async function toolEvidenceFromTfs(args) {
  const {
    workItemId,
    linkedPdiIds = [],
    linkedGoalIds = [],
    type,
    visibility,
    impact,
    tags,
    dryRun,
  } = z.object({
    workItemId: z.union([z.string(), z.number()]),
    linkedPdiIds: z.array(z.string()).default([]),
    linkedGoalIds: z.array(z.string()).default([]),
    type: z.enum(["delivery", "feedback", "certification", "presentation", "mentoring", "code_review", "leadership", "quality"]).default("delivery"),
    visibility: z.enum(["self", "team", "org"]).default("self"),
    impact: z.string().min(1).default("Evidencia importada de um work item para conectar uma entrega real ao desenvolvimento profissional."),
    tags: z.array(z.string()).default(["tfs"]),
    dryRun: z.boolean().default(true),
  }).parse(args);
  const imported = await importEvidenceFromWorkItem(workItemId);
  const existing = normalizeEvidence(await loadEvidenceLog()).evidences.find(
    (item) => item.source === "tfs" && item.linkedWorkItems.includes(String(imported.workItemId))
  );
  if (existing) return { imported: false, duplicate: true, evidence: existing };
  const proposed = {
    date: new Date().toISOString().slice(0, 10),
    type,
    title: imported.title,
    description: imported.summary,
    impact,
    linkedPdiIds,
    linkedGoalIds,
    linkedWorkItems: [String(imported.workItemId)],
    linkedPRs: imported.prIds,
    visibility,
    tags: [...new Set([...tags, "tfs"])],
    source: "tfs",
    sourceMeta: { importedSummary: imported.summary },
  };
  if (dryRun) return { imported: false, dryRun: true, proposed };
  return toolEvidenceAdd({
    ...proposed,
  });
}
