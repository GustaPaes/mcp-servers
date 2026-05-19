import { z } from "zod";
import { pdiSchema } from "../models/pdi.js";
import { profileSchema } from "../models/profile.js";
import { loadProfile, listPdis, savePdi, listGoals, loadEvidenceLog } from "../storage.js";
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

export async function toolPdiList() {
  const [pdis, goals] = await Promise.all([listPdis(), listGoals()]);
  return pdis.map((pdi) => ({
    id: pdi.id,
    title: pdi.title,
    status: pdi.status,
    currentRole: pdi.currentRole,
    targetRole: pdi.targetRole,
    progress: computePdiProgress(pdi, goals).overall,
    period: pdi.period,
    tags: pdi.tags,
  }));
}

export async function toolPdiGet(args) {
  const { id } = z.object({ id: z.string().min(1) }).parse(args);
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
  const { id } = z.object({ id: z.string().min(1) }).parse(args);
  const [pdis, goals, evidenceLog] = await Promise.all([listPdis(), listGoals(), loadEvidenceLog()]);
  const pdi = pdis.find((item) => item.id === id);
  if (!pdi) throw new Error(`PDI nao encontrado: ${id}`);
  return scorePdiQuality(pdi, goals, evidenceLog);
}

export async function toolPdiCreate(args) {
  const input = z.object({
    title: z.string().min(1),
    currentRole: z.string().optional(),
    targetRole: z.string().optional(),
    vision: z.string().min(1),
    start: z.string(),
    end: z.string(),
    strengths: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    developmentAreas: z.array(z.any()).default([]),
  }).parse(args);

  const profile = profileSchema.parse(await loadProfile());
  const id = `pdi-${slugify(input.title)}-${input.start}`;
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
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await savePdi(pdi);
  return pdi;
}

export async function toolPdiUpdate(args) {
  const input = z.object({
    id: z.string().min(1),
    status: z.enum(["draft", "active", "review", "completed", "archived"]).optional(),
    vision: z.string().optional(),
    tags: z.array(z.string()).optional(),
    strengths: z.array(z.string()).optional(),
    developmentAreas: z.array(z.any()).optional(),
    checkpoints: z.array(z.any()).optional(),
  }).parse(args);

  const current = await toolPdiGet({ id: input.id });
  const updated = pdiSchema.parse({
    ...current.pdi,
    ...(input.status ? { status: input.status } : {}),
    ...(input.vision ? { vision: input.vision } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.strengths ? { strengths: input.strengths } : {}),
    ...(input.developmentAreas ? { developmentAreas: input.developmentAreas } : {}),
    ...(input.checkpoints ? { checkpoints: input.checkpoints } : {}),
    updatedAt: nowIso(),
  });
  await savePdi(updated);
  return updated;
}

export async function toolPdiSnapshot(args) {
  const { id, label = "manual" } = z.object({ id: z.string().min(1), label: z.string().default("manual") }).parse(args);
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
