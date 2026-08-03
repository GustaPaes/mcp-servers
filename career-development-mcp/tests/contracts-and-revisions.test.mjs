import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "career-mcp-contract-"));
process.env.CAREER_MCP_DATA_DIR = path.join(root, "data");
process.env.CAREER_MCP_IMPORT_ROOTS = path.join(root, "imports");

const storage = await import("../src/storage.js");
const pdiTools = await import("../src/tools/pdi.js");
const { TOOL_MANIFEST, TOOL_RISK, TOTAL_TOOLS } = await import("../src/server.js");
const { normalizeWorkItemId } = await import("../src/integrations/tfs-bridge.js");

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("keeps definitions, handlers and explicit risk policies in one manifest", () => {
  assert.equal(TOOL_MANIFEST.length, TOTAL_TOOLS);
  assert.equal(new Set(TOOL_MANIFEST.map((entry) => entry.name)).size, TOTAL_TOOLS);
  for (const entry of TOOL_MANIFEST) {
    assert.equal(typeof entry.handler, "function");
    assert.ok(Object.values(TOOL_RISK).includes(entry.policy.risk));
    assert.equal(entry.definition.inputSchema.additionalProperties, false);
    assert.equal(entry.definition.annotations.readOnlyHint, entry.policy.risk === TOOL_RISK.READ);
  }
});

test("accepts only complete positive numeric work-item identifiers", () => {
  assert.equal(normalizeWorkItemId("12345"), 12345);
  assert.equal(normalizeWorkItemId(42), 42);
  assert.equal(normalizeWorkItemId("item-12345"), null);
  assert.equal(normalizeWorkItemId("0"), null);
  assert.equal(normalizeWorkItemId("9999999999999999"), null);
});

test("rejects unknown inputs and returns bounded pagination metadata", async () => {
  await storage.ensureStorageReady();
  await assert.rejects(() => pdiTools.toolPdiList({ unexpected: true }), /unrecognized key/i);
  const result = await pdiTools.toolPdiList({ limit: 1, offset: 0 });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.pagination, { offset: 0, limit: 1, total: 0, hasMore: false, nextOffset: null });
});

test("uses optimistic revisions and retains a recoverable backup", async () => {
  await storage.ensureStorageReady();
  const now = new Date().toISOString();
  await storage.savePdi({
    id: "pdi-revision-test",
    title: "Plano de revisão",
    status: "draft",
    currentRole: "Engineer",
    targetRole: "Senior Engineer",
    vision: "Evoluir competências técnicas com evidências verificáveis.",
    strengths: [],
    tags: [],
    goals: [],
    period: { start: "2026-01-01", end: "2026-12-31" },
    developmentAreas: [],
    checkpoints: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });

  const updated = await pdiTools.toolPdiUpdate({
    id: "pdi-revision-test",
    expectedRevision: 1,
    status: "active",
  });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    () => pdiTools.toolPdiUpdate({ id: "pdi-revision-test", expectedRevision: 1, status: "review" }),
    /conflito de revisão/i,
  );

  const backupDir = path.join(process.env.CAREER_MCP_DATA_DIR, "backups", "pdis");
  const backups = await fs.readdir(backupDir);
  assert.ok(backups.some((name) => name.startsWith("pdi-revision-test.")));
});
