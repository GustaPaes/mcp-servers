import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "career-mcp-unit-"));
const dataDir = path.join(root, "data");
const importDir = path.join(root, "imports");
await fs.mkdir(importDir, { recursive: true });
process.env.CAREER_MCP_DATA_DIR = dataDir;
process.env.CAREER_MCP_IMPORT_ROOTS = importDir;

const storage = await import("../src/storage.js");
const snapshots = await import("../src/tools/snapshots.js");
const daily = await import("../src/tools/daily.js");

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("rejects path traversal in entity identifiers", async () => {
  await assert.rejects(() => storage.getGoal("../profile"), /only letters|apenas letras/i);
  await assert.rejects(
    () => storage.savePdi({ id: "../../outside" }),
    /only letters|apenas letras/i,
  );
});

test("writes JSON atomically under concurrent calls", async () => {
  await storage.ensureStorageReady();
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      storage.saveEvidenceLog({ evidences: [{ id: `ev-${index}` }] }),
    ),
  );
  const parsed = JSON.parse(await fs.readFile(path.join(dataDir, "evidence-log.json"), "utf8"));
  assert.equal(Array.isArray(parsed.evidences), true);
  assert.equal(parsed.evidences.length, 1);
});

test("validates and imports a sanitized versioned snapshot", async () => {
  const snapshotPath = path.join(importDir, "snapshot.json");
  const snapshot = {
    schemaVersion: 1,
    capturedAt: "2026-07-30T12:00:00.000Z",
    url: "https://career.example.test/plans",
    pageTitle: "Career plans",
    visiblePlanCards: [{ title: "Architecture growth", progressPct: 40 }],
    apiResponses: [{
      url: "https://career.example.test/api/plans",
      status: 200,
      detectedKeys: ["plans"],
    }],
  };
  await fs.writeFile(snapshotPath, JSON.stringify({
    ...snapshot,
    apiResponses: [{ ...snapshot.apiResponses[0], body: "must be rejected" }],
  }), "utf8");

  await assert.rejects(
    () => snapshots.toolSnapshotValidate({ path: "snapshot.json" }),
    /unrecognized key|unrecognized_keys/i,
  );
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

  const validation = await snapshots.toolSnapshotValidate({ path: "snapshot.json" });
  assert.equal(validation.valid, true);
  const preview = await snapshots.toolSnapshotImport({ path: snapshotPath });
  assert.equal(preview.dryRun, true);
  assert.equal(await storage.loadOnlineState(), null);

  const result = await snapshots.toolSnapshotImport({ path: snapshotPath, dryRun: false, expectedRevision: 0 });
  assert.equal(result.imported, true);
  assert.equal(result.revision, 1);
  const state = await storage.loadOnlineState();
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.revision, 1);

  const brief = await daily.toolDailyBrief({});
  assert.equal(brief.externalSnapshot.available, true);
});

test("rejects import through a symbolic link that escapes the allowed root", async (t) => {
  const outsideDir = path.join(root, "outside");
  await fs.mkdir(outsideDir, { recursive: true });
  const outsideFile = path.join(outsideDir, "snapshot.json");
  await fs.writeFile(outsideFile, JSON.stringify({ schemaVersion: 1, capturedAt: "2026-08-01T12:00:00.000Z" }), "utf8");
  const linkPath = path.join(importDir, "outside-link.json");
  try {
    await fs.symlink(outsideFile, linkPath, "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("A criação de symlink não está habilitada neste host.");
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => snapshots.toolSnapshotValidate({ path: linkPath }),
    /outside|fora|symbolic link/i,
  );
});
