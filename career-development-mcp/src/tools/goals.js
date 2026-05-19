import { z } from "zod";
import { goalSchema } from "../models/goal.js";
import { getGoal, listGoals, saveGoal, getPdi, savePdi, loadEvidenceLog } from "../storage.js";
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
  const { pdiId, status, category } = z.object({
    pdiId: z.string().optional(),
    status: z.string().optional(),
    category: z.string().optional(),
  }).parse(args);
  const goals = await listGoals();
  return goals
    .filter((goal) => !pdiId || goal.pdiId === pdiId)
    .filter((goal) => !status || goal.status === status)
    .filter((goal) => !category || goal.category === category)
    .map(toSummary);
}

export async function toolGoalCreate(args) {
  const input = z.object({
    pdiId: z.string().min(1),
    title: z.string().min(1),
    category: z.enum(["technical", "leadership", "soft_skill", "business", "quality"]),
    weight: z.number().min(0).max(100),
    dueDate: z.string().nullable().default(null),
    linkedCompetencies: z.array(z.string()).default([]),
    smart: z.object({
      specific: z.string().default(""),
      measurable: z.string().default(""),
      achievable: z.string().default(""),
      relevant: z.string().default(""),
      timeBound: z.string().default(""),
    }),
    milestones: z.array(z.any()).default([]),
    notes: z.array(z.string()).default([]),
  }).parse(args);

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
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await saveGoal(goal);
  await savePdi({ ...pdi, goals: [...new Set([...(pdi.goals ?? []), goal.id])], updatedAt: timestamp });
  return goal;
}

export async function toolGoalUpdate(args) {
  const input = z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    status: z.enum(["not_started", "in_progress", "completed", "blocked", "cancelled"]).optional(),
    dueDate: z.string().nullable().optional(),
    milestones: z.array(z.any()).optional(),
    notes: z.array(z.string()).optional(),
    smart: z.object({
      specific: z.string().default(""),
      measurable: z.string().default(""),
      achievable: z.string().default(""),
      relevant: z.string().default(""),
      timeBound: z.string().default(""),
    }).optional(),
  }).parse(args);

  const current = await getGoal(input.id);
  if (!current) throw new Error(`Meta nao encontrada: ${input.id}`);
  const updated = goalSchema.parse({
    ...current,
    ...(input.title ? { title: input.title } : {}),
    ...(typeof input.progress === "number" ? { progress: input.progress } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "dueDate") ? { dueDate: input.dueDate } : {}),
    ...(input.milestones ? { milestones: input.milestones } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.smart ? { smart: input.smart } : {}),
    updatedAt: nowIso(),
  });
  await saveGoal(updated);
  return updated;
}

export async function toolGoalAnalyze(args) {
  const { id } = z.object({ id: z.string().min(1) }).parse(args);
  const goal = await getGoal(id);
  if (!goal) throw new Error(`Meta nao encontrada: ${id}`);
  return {
    goal: toSummary(goal),
    ...analyzeSmartGoal(goal),
  };
}

export async function toolGoalProgress(args) {
  const { id } = z.object({ id: z.string().min(1) }).parse(args);
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
