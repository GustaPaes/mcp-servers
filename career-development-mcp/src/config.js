import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export const SERVER_VERSION = "1.0.0";
export const MCP_HTTP_PORT = Number(process.env.MCP_HTTP_PORT ?? 3020);
export const MCP_HTTP_TOKEN = firstNonEmpty(process.env.MCP_HTTP_TOKEN);
export const TEAM_GUIDE_NAME = "career-development-mcp";
export const ROOT_DIR = path.join(__dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const ONLINE_DIR = path.join(DATA_DIR, "online");
export const PDIS_DIR = path.join(DATA_DIR, "pdis");
export const GOALS_DIR = path.join(DATA_DIR, "goals");
export const SNAPSHOTS_DIR = path.join(DATA_DIR, "snapshots");
export const PROFILE_PATH = path.join(DATA_DIR, "profile.json");
export const COMPETENCIES_PATH = path.join(DATA_DIR, "competencies.json");
export const EVIDENCE_LOG_PATH = path.join(DATA_DIR, "evidence-log.json");
export const ONLINE_STATE_PATH = path.join(ONLINE_DIR, "latest-online-state.json");
export const ONLINE_APPROVED_CHANGES_PATH = path.join(ONLINE_DIR, "approved-changes.json");
export const TFS_MCP_SERVER_DIR = firstNonEmpty(
  process.env.TFS_MCP_SERVER_DIR,
  path.join(ROOT_DIR, "..", "tfs-mcp")
);
