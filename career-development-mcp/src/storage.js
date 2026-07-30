import fs from "fs/promises";
import path from "path";
import {
  assertSafeIdentifier,
  atomicWriteJson,
  createSerialExecutor,
  resolveInside,
} from "@gustapaes/mcp-runtime";
import {
  DATA_DIR,
  ONLINE_DIR,
  PDIS_DIR,
  GOALS_DIR,
  SNAPSHOTS_DIR,
  PROFILE_PATH,
  COMPETENCIES_PATH,
  EVIDENCE_LOG_PATH,
  ONLINE_STATE_PATH,
  ONLINE_APPROVED_CHANGES_PATH,
} from "./config.js";

const runStorageMutation = createSerialExecutor();

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureStorageReady() {
  await Promise.all([
    ensureDir(DATA_DIR),
    ensureDir(ONLINE_DIR),
    ensureDir(PDIS_DIR),
    ensureDir(GOALS_DIR),
    ensureDir(SNAPSHOTS_DIR),
  ]);
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await atomicWriteJson(filePath, value);
}

function entityPath(root, id) {
  const safeId = assertSafeIdentifier(id);
  return resolveInside(root, `${safeId}.json`);
}

export function withStorageMutation(task) {
  return runStorageMutation(task);
}

async function listJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dirPath, entry.name))
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadProfile() {
  return readJsonFile(PROFILE_PATH, {});
}

export async function saveProfile(profile) {
  return writeJsonFile(PROFILE_PATH, profile);
}

export async function loadCompetencies() {
  return readJsonFile(COMPETENCIES_PATH, { assessments: [] });
}

export async function saveCompetencies(competencies) {
  return writeJsonFile(COMPETENCIES_PATH, competencies);
}

export async function loadEvidenceLog() {
  return readJsonFile(EVIDENCE_LOG_PATH, { evidences: [] });
}

export async function saveEvidenceLog(evidenceLog) {
  return writeJsonFile(EVIDENCE_LOG_PATH, evidenceLog);
}

export async function loadOnlineState() {
  return readJsonFile(ONLINE_STATE_PATH, null);
}

export async function saveOnlineState(onlineState) {
  return writeJsonFile(ONLINE_STATE_PATH, onlineState);
}

export async function loadApprovedChanges() {
  return readJsonFile(ONLINE_APPROVED_CHANGES_PATH, { changes: [] });
}

export async function saveApprovedChanges(changes) {
  return writeJsonFile(ONLINE_APPROVED_CHANGES_PATH, changes);
}

export async function listPdis() {
  const files = await listJsonFiles(PDIS_DIR);
  const pdis = await Promise.all(files.map((filePath) => readJsonFile(filePath, null)));
  return pdis.filter(Boolean);
}

export async function getPdi(id) {
  return readJsonFile(entityPath(PDIS_DIR, id), null);
}

export async function savePdi(pdi) {
  return writeJsonFile(entityPath(PDIS_DIR, pdi.id), pdi);
}

export async function listGoals() {
  const files = await listJsonFiles(GOALS_DIR);
  const goals = await Promise.all(files.map((filePath) => readJsonFile(filePath, null)));
  return goals.filter(Boolean);
}

export async function getGoal(id) {
  return readJsonFile(entityPath(GOALS_DIR, id), null);
}

export async function saveGoal(goal) {
  return writeJsonFile(entityPath(GOALS_DIR, goal.id), goal);
}

export async function saveSnapshot(snapshot) {
  return writeJsonFile(entityPath(SNAPSHOTS_DIR, snapshot.id), snapshot);
}

export async function listSnapshots() {
  const files = await listJsonFiles(SNAPSHOTS_DIR);
  const snapshots = await Promise.all(files.map((filePath) => readJsonFile(filePath, null)));
  return snapshots.filter(Boolean);
}
