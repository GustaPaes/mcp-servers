import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveInsideAny } from "@gustapaes/mcp-runtime";
import { CAREER_MCP_IMPORT_MAX_BYTES, CAREER_MCP_IMPORT_ROOTS } from "../config.js";
import { loadOnlineState, saveOnlineState, saveSnapshot, withStorageMutation } from "../storage.js";
import { INPUT_LIMITS, optionalLongTextSchema, optionalShortTextSchema, shortTextSchema } from "../models/common.js";

const visiblePlanCardSchema = z.object({
  sourceId: z.union([z.string(), z.number()]).optional(),
  title: shortTextSchema,
  status: optionalShortTextSchema.optional(),
  progressPct: z.number().min(0).max(100).optional(),
  period: optionalShortTextSchema.optional(),
  summary: optionalLongTextSchema.optional(),
}).strict();

const apiResponseMetadataSchema = z.object({
  url: z.string().url(),
  status: z.number().int().min(100).max(599),
  contentType: optionalShortTextSchema.optional(),
  detectedKeys: z.array(shortTextSchema).max(INPUT_LIMITS.collection).default([]),
}).strict();

export const externalCareerSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: shortTextSchema,
  url: z.string().url().optional(),
  pageTitle: optionalShortTextSchema.optional(),
  visiblePlanCards: z.array(visiblePlanCardSchema).max(INPUT_LIMITS.collection).default([]),
  apiResponses: z.array(apiResponseMetadataSchema).max(INPUT_LIMITS.collection).default([]),
}).strict();

async function resolveImportPath(requestedPath) {
  const filePath = resolveInsideAny(CAREER_MCP_IMPORT_ROOTS, requestedPath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("O caminho de snapshot deve apontar para um arquivo regular.");
  if (stat.size > CAREER_MCP_IMPORT_MAX_BYTES) {
    throw new Error(`Snapshot excede o limite de ${CAREER_MCP_IMPORT_MAX_BYTES} bytes.`);
  }
  return filePath;
}

async function loadSnapshotInput(args) {
  const input = z.object({
    path: z.string().min(1).max(4096).optional(),
    snapshot: externalCareerSnapshotSchema.optional(),
    dryRun: z.boolean().default(true),
    expectedRevision: z.number().int().min(0).optional(),
  }).strict().refine((value) => Boolean(value.path) !== Boolean(value.snapshot), {
    message: "Informe exatamente um de path ou snapshot.",
  }).parse(args);

  if (input.snapshot) return { input, snapshot: input.snapshot };
  const requestedPath = path.isAbsolute(input.path)
    ? input.path
    : path.resolve(CAREER_MCP_IMPORT_ROOTS[0], input.path);
  const filePath = await resolveImportPath(requestedPath);
  const raw = await fs.readFile(filePath, "utf8");
  return { input, snapshot: externalCareerSnapshotSchema.parse(JSON.parse(raw)) };
}

export async function toolSnapshotValidate(args) {
  const { snapshot } = await loadSnapshotInput(args);
  return {
    valid: true,
    schemaVersion: snapshot.schemaVersion,
    capturedAt: snapshot.capturedAt,
    planCards: snapshot.visiblePlanCards.length,
    apiResponses: snapshot.apiResponses.length,
  };
}

export async function toolSnapshotImport(args) {
  const { input, snapshot } = await loadSnapshotInput(args);
  if (input.dryRun) {
    const currentState = await loadOnlineState();
    const currentRevision = currentState?.revision ?? 0;
    return {
      imported: false,
      dryRun: true,
      currentRevision,
      nextRevision: currentRevision + 1,
      capturedAt: snapshot.capturedAt,
      planCards: snapshot.visiblePlanCards.length,
      apiResponses: snapshot.apiResponses.length,
    };
  }
  return withStorageMutation(async () => {
    const currentState = await loadOnlineState();
    const currentRevision = currentState?.revision ?? 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new Error(`Conflito de revisão do snapshot: esperado ${input.expectedRevision}, atual ${currentRevision}.`);
    }
    const importedAt = new Date().toISOString();
    const sanitized = {
      ...snapshot,
      importedAt,
      revision: currentRevision + 1,
    };
    await saveOnlineState(sanitized);
    const historyRecord = {
      id: `external-${Date.now()}`,
      kind: "external-career-state",
      capturedAt: snapshot.capturedAt,
      importedAt,
      data: sanitized,
    };
    await saveSnapshot(historyRecord);
    return {
      imported: true,
      revision: currentRevision + 1,
      capturedAt: snapshot.capturedAt,
      importedAt,
      planCards: snapshot.visiblePlanCards.length,
      apiResponses: snapshot.apiResponses.length,
    };
  });
}
