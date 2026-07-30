import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveInsideAny } from "@gustapaes/mcp-runtime";
import { CAREER_MCP_IMPORT_ROOTS } from "../config.js";
import { saveOnlineState, saveSnapshot, withStorageMutation } from "../storage.js";

const visiblePlanCardSchema = z.object({
  sourceId: z.union([z.string(), z.number()]).optional(),
  title: z.string().min(1),
  status: z.string().optional(),
  progressPct: z.number().min(0).max(100).optional(),
  period: z.string().optional(),
  summary: z.string().optional(),
});

const apiResponseMetadataSchema = z.object({
  url: z.string().url(),
  status: z.number().int().min(100).max(599),
  contentType: z.string().optional(),
  detectedKeys: z.array(z.string()).default([]),
});

export const externalCareerSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().min(1),
  url: z.string().url().optional(),
  pageTitle: z.string().optional(),
  visiblePlanCards: z.array(visiblePlanCardSchema).default([]),
  apiResponses: z.array(apiResponseMetadataSchema).default([]),
});

async function loadSnapshotInput(args) {
  const input = z.object({
    path: z.string().min(1).optional(),
    snapshot: externalCareerSnapshotSchema.optional(),
  }).refine((value) => Boolean(value.path) !== Boolean(value.snapshot), {
    message: "Informe exatamente um de path ou snapshot.",
  }).parse(args);

  if (input.snapshot) return input.snapshot;
  const requestedPath = path.isAbsolute(input.path)
    ? input.path
    : path.resolve(CAREER_MCP_IMPORT_ROOTS[0], input.path);
  const filePath = resolveInsideAny(CAREER_MCP_IMPORT_ROOTS, requestedPath);
  const raw = await fs.readFile(filePath, "utf8");
  return externalCareerSnapshotSchema.parse(JSON.parse(raw));
}

export async function toolSnapshotValidate(args) {
  const snapshot = await loadSnapshotInput(args);
  return {
    valid: true,
    schemaVersion: snapshot.schemaVersion,
    capturedAt: snapshot.capturedAt,
    planCards: snapshot.visiblePlanCards.length,
    apiResponses: snapshot.apiResponses.length,
  };
}

export async function toolSnapshotImport(args) {
  const snapshot = await loadSnapshotInput(args);
  return withStorageMutation(async () => {
    const importedAt = new Date().toISOString();
    const sanitized = {
      ...snapshot,
      importedAt,
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
      capturedAt: snapshot.capturedAt,
      importedAt,
      planCards: snapshot.visiblePlanCards.length,
      apiResponses: snapshot.apiResponses.length,
    };
  });
}
