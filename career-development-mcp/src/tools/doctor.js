import fs from "node:fs/promises";
import {
  CAREER_MCP_IMPORT_ROOTS,
  DATA_DIR,
  TFS_MCP_SERVER_DIR,
} from "../config.js";
import { ensureStorageReady } from "../storage.js";

async function isDirectory(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export async function toolCareerDoctor() {
  await ensureStorageReady();
  const importRoots = await Promise.all(CAREER_MCP_IMPORT_ROOTS.map(isDirectory));
  const tfsBridgeAvailable = await isDirectory(TFS_MCP_SERVER_DIR);
  const issues = [];
  if (!importRoots.some(Boolean)) {
    issues.push("Crie ao menos uma raiz de importação configurada por CAREER_MCP_IMPORT_ROOTS.");
  }
  if (!tfsBridgeAvailable) {
    issues.push("TFS MCP não encontrado; guide_evidence_from_tfs ficará indisponível.");
  }
  return {
    ok: issues.length === 0,
    storageReady: await isDirectory(DATA_DIR),
    importRoots: {
      configured: CAREER_MCP_IMPORT_ROOTS.length,
      available: importRoots.filter(Boolean).length,
    },
    tfsBridgeAvailable,
    issues,
  };
}
