import { z } from "zod";
import { checkpointSchema, developmentAreaSchema, pdiSchema } from "../models/pdi.js";
import { profileSchema } from "../models/profile.js";
import {
  dateTextSchema,
  idListSchema,
  longTextSchema,
  paginate,
  paginationSchema,
  shortTextListSchema,
  shortTextSchema,
  safeIdSchema,
} from "../models/common.js";
import { getPdi, loadProfile, listPdis, savePdi, listGoals, loadEvidenceLog, withStorageMutation } from "../storage.js";
import { computePdiProgress } from "../analytics/progress-tracker.js";
import { scorePdiQuality } from "../analytics/pdi-scoring.js";

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function toolPdiList(args = {}) {
  const pagination = paginationSchema.parse(args);
  const [pdis, goals] = await Promise.all([listPdis(), listGoals()]);
  const items = pdis.map((pdi) => ({
    id: pdi.id,
    title: pdi.title,
    status: pdi.status,
    currentRole: pdi.currentRole,
    targetRole: pdi.targetRole,
    progress: computePdiProgress(pdi, goals).overall,
    period: pdi.period,
    tags: pdi.tags,
  }));
  return paginate(items, pagination);
}

export async function toolPdiGet(args) {
  const { id } = z.object({ id: safeIdSchema }).strict().parse(args);
  const [pdis, goals, evidenceLog] = await Promise.all([listPdis(), listGoals(), loadEvidenceLog()]);
  const pdi = pdis.find((item) => item.id === id);
  if (!pdi) throw new Error(`PDI nao encontrado: ${id}`);
  const pdiGoals = goals.filter((goal) => goal.pdiId === id);
  const progress = computePdiProgress(pdi, goals);
  const linkedEvidence = evidenceLog.evidences.filter((evidence) => evidence.linkedPdiIds.includes(id));
  return {
    pdi,
    progress,
    goals: pdiGoals.map((goal) => ({
      id: goal.id,
      pdiId: goal.pdiId,
      title: goal.title,
      category: goal.category,
      weight: goal.weight,
      progress: goal.progress,
      status: goal.status,
      dueDate: goal.dueDate,
    })),
    evidenceSummary: {
      linkedCount: linkedEvidence.length,
      lastEvidenceAt: linkedEvidence.map((evidence) => evidence.date).sort().at(-1) ?? null,
    },
  };
}

export async function toolPdiAnalyze(args) {
  const { id } = z.object({ id: safeIdSchema }).strict().parse(args);
  const [pdis, goals, evidenceLog] = await Promise.all([listPdis(), listGoals(), loadEvidenceLog()]);
  const pdi = pdis.find((item) => item.id === id);
  if (!pdi) throw new Error(`PDI nao encontrado: ${id}`);
  return scorePdiQuality(pdi, goals, evidenceLog);
}

export async function toolPdiCreate(args) {
  const input = z.object({
    title: shortTextSchema,
    currentRole: shortTextSchema.optional(),
    targetRole: shortTextSchema.optional(),
    vision: longTextSchema,
    start: dateTextSchema,
    end: dateTextSchema,
    strengths: shortTextListSchema.default([]),
    tags: shortTextListSchema.default([]),
    developmentAreas: z.array(developmentAreaSchema).max(100).default([]),
  }).strict().parse(args);

  return withStorageMutation(async () => {
    const profile = profileSchema.parse(await loadProfile());
    const baseId = `pdi-${slugify(input.title)}-${input.start}`;
    const id = (await getPdi(baseId)) ? `${baseId}-${Date.now()}` : baseId;
    const timestamp = nowIso();
    const pdi = pdiSchema.parse({
      id,
      title: input.title,
      status: "draft",
      currentRole: input.currentRole ?? profile.currentRole,
      targetRole: input.targetRole ?? profile.targetRole,
      vision: input.vision,
      strengths: input.strengths,
      tags: input.tags,
      goals: [],
      period: { start: input.start, end: input.end },
      developmentAreas: input.developmentAreas,
      checkpoints: [],
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await savePdi(pdi);
    return pdi;
  });
}

export async function toolPdiUpdate(args) {
  const input = z.object({
    id: safeIdSchema,
    expectedRevision: z.number().int().min(1).optional(),
    status: z.enum(["draft", "active", "review", "completed", "archived"]).optional(),
    vision: longTextSchema.optional(),
    tags: shortTextListSchema.optional(),
    strengths: shortTextListSchema.optional(),
    developmentAreas: z.array(developmentAreaSchema).max(100).optional(),
    checkpoints: z.array(checkpointSchema).max(100).optional(),
  }).strict().parse(args);

  return withStorageMutation(async () => {
    const current = await toolPdiGet({ id: input.id });
    const currentRevision = current.pdi.revision ?? 1;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new Error(`Conflito de revisão do PDI ${input.id}: esperado ${input.expectedRevision}, atual ${currentRevision}. Recarregue o registro antes de atualizar.`);
    }
    const updated = pdiSchema.parse({
      ...current.pdi,
      ...(input.status ? { status: input.status } : {}),
      ...(input.vision ? { vision: input.vision } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.strengths ? { strengths: input.strengths } : {}),
      ...(input.developmentAreas ? { developmentAreas: input.developmentAreas } : {}),
      ...(input.checkpoints ? { checkpoints: input.checkpoints } : {}),
      revision: currentRevision + 1,
      updatedAt: nowIso(),
    });
    await savePdi(updated);
    return updated;
  });
}

export async function toolPdiSnapshot(args) {
  const { id, label = "manual" } = z.object({ id: safeIdSchema, label: shortTextSchema.default("manual") }).strict().parse(args);
  const detail = await toolPdiGet({ id });
  return {
    id: `${id}-${new Date().toISOString().slice(0, 10)}-${slugify(label)}`,
    pdiId: id,
    label,
    capturedAt: nowIso(),
    progress: detail.progress,
    goals: detail.goals,
  };
}
