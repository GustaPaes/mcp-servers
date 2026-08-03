import { z } from "zod";
import { goalSchema, milestoneSchema } from "../models/goal.js";
import {
  dateTextSchema,
  idListSchema,
  optionalLongTextSchema,
  paginate,
  paginationSchema,
  shortTextListSchema,
  shortTextSchema,
  safeIdSchema,
} from "../models/common.js";
import { getGoal, listGoals, saveGoal, getPdi, savePdi, loadEvidenceLog, withStorageMutation } from "../storage.js";
import { analyzeSmartGoal } from "../frameworks/smart-goals.js";
import { projectGoalStatus } from "../analytics/progress-tracker.js";

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

function toSummary(goal) {
  return {
    id: goal.id,
    pdiId: goal.pdiId,
    title: goal.title,
    category: goal.category,
    weight: goal.weight,
    progress: goal.progress,
    status: goal.status,
    dueDate: goal.dueDate,
  };
}

export async function toolGoalList(args) {
  const { pdiId, status, category, offset, limit } = paginationSchema.extend({
    pdiId: safeIdSchema.optional(),
    status: shortTextSchema.optional(),
    category: shortTextSchema.optional(),
  }).strict().parse(args);
  const goals = await listGoals();
  const items = goals
    .filter((goal) => !pdiId || goal.pdiId === pdiId)
    .filter((goal) => !status || goal.status === status)
    .filter((goal) => !category || goal.category === category)
    .map(toSummary);
  return paginate(items, { offset, limit });
}

export async function toolGoalCreate(args) {
  const input = z.object({
    pdiId: safeIdSchema,
    title: shortTextSchema,
    category: z.enum(["technical", "leadership", "soft_skill", "business", "quality"]),
    weight: z.number().min(0).max(100),
    dueDate: dateTextSchema.nullable().default(null),
    linkedCompetencies: idListSchema.default([]),
    smart: z.object({
      specific: optionalLongTextSchema.default(""),
      measurable: optionalLongTextSchema.default(""),
      achievable: optionalLongTextSchema.default(""),
      relevant: optionalLongTextSchema.default(""),
      timeBound: optionalLongTextSchema.default(""),
    }).strict(),
    milestones: z.array(milestoneSchema).max(100).default([]),
    notes: shortTextListSchema.default([]),
  }).strict().parse(args);

  return withStorageMutation(async () => {
    const pdi = await getPdi(input.pdiId);
    if (!pdi) throw new Error(`PDI nao encontrado: ${input.pdiId}`);
    const timestamp = nowIso();
    const goal = goalSchema.parse({
      id: `goal-${slugify(input.title)}-${Date.now()}`,
      pdiId: input.pdiId,
      title: input.title,
      category: input.category,
      weight: input.weight,
      progress: 0,
      dueDate: input.dueDate,
      status: "not_started",
      linkedCompetencies: input.linkedCompetencies,
      evidenceIds: [],
      smart: input.smart,
      milestones: input.milestones,
      notes: input.notes,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await saveGoal(goal);
    await savePdi({ ...pdi, goals: [...new Set([...(pdi.goals ?? []), goal.id])], updatedAt: timestamp });
    return goal;
  });
}

export async function toolGoalUpdate(args) {
  const input = z.object({
    id: safeIdSchema,
    expectedRevision: z.number().int().min(1).optional(),
    title: shortTextSchema.optional(),
    progress: z.number().min(0).max(100).optional(),
    status: z.enum(["not_started", "in_progress", "completed", "blocked", "cancelled"]).optional(),
    dueDate: dateTextSchema.nullable().optional(),
    milestones: z.array(milestoneSchema).max(100).optional(),
    notes: shortTextListSchema.optional(),
    smart: z.object({
      specific: optionalLongTextSchema.default(""),
      measurable: optionalLongTextSchema.default(""),
      achievable: optionalLongTextSchema.default(""),
      relevant: optionalLongTextSchema.default(""),
      timeBound: optionalLongTextSchema.default(""),
    }).strict().optional(),
  }).strict().parse(args);

  return withStorageMutation(async () => {
    const current = await getGoal(input.id);
    if (!current) throw new Error(`Meta nao encontrada: ${input.id}`);
    const currentRevision = current.revision ?? 1;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new Error(`Conflito de revisão da meta ${input.id}: esperado ${input.expectedRevision}, atual ${currentRevision}. Recarregue o registro antes de atualizar.`);
    }
    const updated = goalSchema.parse({
      ...current,
      ...(input.title ? { title: input.title } : {}),
      ...(typeof input.progress === "number" ? { progress: input.progress } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "dueDate") ? { dueDate: input.dueDate } : {}),
      ...(input.milestones ? { milestones: input.milestones } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.smart ? { smart: input.smart } : {}),
      revision: currentRevision + 1,
      updatedAt: nowIso(),
    });
    await saveGoal(updated);
    return updated;
  });
}

export async function toolGoalAnalyze(args) {
  const { id } = z.object({ id: safeIdSchema }).strict().parse(args);
  const goal = await getGoal(id);
  if (!goal) throw new Error(`Meta nao encontrada: ${id}`);
  return {
    goal: toSummary(goal),
    ...analyzeSmartGoal(goal),
  };
}

export async function toolGoalProgress(args) {
  const { id } = z.object({ id: safeIdSchema }).strict().parse(args);
  const [goal, evidenceLog] = await Promise.all([getGoal(id), loadEvidenceLog()]);
  if (!goal) throw new Error(`Meta nao encontrada: ${id}`);
  const evidenceCount = evidenceLog.evidences.filter((evidence) => evidence.linkedGoalIds.includes(id)).length;
  return {
    goal: toSummary(goal),
    smartAnalysis: analyzeSmartGoal(goal),
    milestones: goal.milestones,
    evidenceCount,
    projectedStatus: projectGoalStatus(goal),
  };
}
