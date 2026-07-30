/**
 * config.js — Centraliza toda derivação de configuração.
 * Todas as variáveis de ambiente são resolvidas UMA VEZ aqui.
 * Outros módulos importam constantes prontas, nunca lêem process.env diretamente.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { execFileSync } from "child_process";
import {
  firstConfigured,
  isPlainObject,
  readVersionedJsonConfigSync,
  toStringArray,
} from "@gustapaes/mcp-config-kit";
import { getRequestContext } from "./request-context.js";
import {
  getProfileFieldNames,
  getWorkItemProfile,
  parseWorkItemProfiles,
} from "./work-item-profile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

// ─── Internal helpers ───────────────────────────────────────────────────────

function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function stripSlashes(v) {
  return String(v ?? "").replace(/^\/+|\/+$/g, "");
}

function normalizeName(value) {
  return String(value ?? "").trim();
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeAlias(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function positiveInteger(value, fallback, label, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${label} deve ser um inteiro positivo menor ou igual a ${max}.`);
  }
  return parsed;
}

const DEFAULT_LOCAL_CONFIG_FILE = path.join(__dirname, "../local-private/config/tfs.json");
export const TFS_MCP_CONFIG_FILE = path.resolve(
  firstNonEmpty(process.env.TFS_MCP_CONFIG_FILE, DEFAULT_LOCAL_CONFIG_FILE)
);
const LOCAL_CONFIG = readVersionedJsonConfigSync(TFS_MCP_CONFIG_FILE, {
  optional: true,
  expectedVersion: 1,
  label: "TFS MCP configuration",
});
const CONNECTION_CONFIG = isPlainObject(LOCAL_CONFIG.connection) ? LOCAL_CONFIG.connection : {};
const DEFAULTS_CONFIG = isPlainObject(LOCAL_CONFIG.defaults) ? LOCAL_CONFIG.defaults : {};
const FIELDS_CONFIG = isPlainObject(LOCAL_CONFIG.fields) ? LOCAL_CONFIG.fields : {};

const WORK_ITEM_PROFILE_FILE = firstNonEmpty(process.env.TFS_WORK_ITEM_PROFILES_FILE);
const WORK_ITEM_PROFILE_FILE_CONFIG = readVersionedJsonConfigSync(WORK_ITEM_PROFILE_FILE, {
  optional: true,
  expectedVersion: 1,
  label: "TFS work-item profiles",
});

/** Tenta detectar o repositório git pelo remote origin da workspace. Sync-safe: executado 1x ao startup. */
function detectRepositoryFromGit() {
  const candidates = [
    process.env.TFS_WORKSPACE_ROOT,
    process.env.INIT_CWD,
    process.cwd(),
  ].filter(Boolean);

  for (const cwd of candidates) {
    try {
      const remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      }).trim();
      const m = remote.match(/_git\/([^/?#\s]+)$/i);
      if (m?.[1]) return decodeURIComponent(m[1]);
    } catch {
      /* diretório sem git ou sem remote — ignorar */
    }
  }
  return "";
}

// ─── Exports ────────────────────────────────────────────────────────────────

export const TFS_URL = firstNonEmpty(
  process.env.TFS_URL,
  firstConfigured(CONNECTION_CONFIG.url),
  "https://tfs.example.com"
).replace(/\/+$/, "");
export const TFS_COLLECTION = stripSlashes(firstNonEmpty(
  process.env.TFS_COLLECTION,
  firstConfigured(CONNECTION_CONFIG.collection),
  "ExampleCollection"
));
export const TFS_PROJECT = stripSlashes(firstNonEmpty(
  process.env.TFS_PROJECT,
  firstConfigured(CONNECTION_CONFIG.project),
  "ExampleProject"
));
export const PROJECT_BASE_URL = `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}`;

const DETECTED_REPOSITORY = detectRepositoryFromGit();
const CONFIGURED_REPOSITORIES = unique([
  ...parseCsv(process.env.TFS_REPOS),
  firstNonEmpty(process.env.TFS_REPO, process.env.TFS_REPOSITORY),
  ...toStringArray(CONNECTION_CONFIG.repositories),
  firstConfigured(DEFAULTS_CONFIG.repository),
  DETECTED_REPOSITORY,
]);
export const TFS_REPOS = CONFIGURED_REPOSITORIES.length
  ? CONFIGURED_REPOSITORIES
  : ["example-repo"];
export const TFS_REPO = TFS_REPOS[0] ?? "example-repo";
export const TFS_PAT = firstNonEmpty(process.env.TFS_PAT);
export const TFS_AUDIT_LOG_PATH = firstNonEmpty(
  process.env.TFS_AUDIT_LOG_PATH,
  path.join(__dirname, "../data/audit.log")
);
export const TFS_DEFAULT_QUARTER = firstNonEmpty(
  process.env.TFS_DEFAULT_QUARTER,
  firstConfigured(DEFAULTS_CONFIG.quarter),
  `${new Date().getFullYear()} Q${Math.floor(new Date().getMonth() / 3) + 1}`
);
export const TFS_WORK_ITEM_PROFILES = parseWorkItemProfiles(
  firstConfigured(
    process.env.TFS_WORK_ITEM_PROFILES_JSON,
    WORK_ITEM_PROFILE_FILE_CONFIG.profiles,
    LOCAL_CONFIG.workItemProfiles,
  ),
  { variables: { currentQuarter: TFS_DEFAULT_QUARTER } }
);
export const TFS_WORK_ITEM_PROFILE_FIELDS = Object.freeze(
  getProfileFieldNames(TFS_WORK_ITEM_PROFILES)
);
export const TFS_ISSUE_ANALYSIS_FIELD = firstNonEmpty(
  process.env.TFS_ISSUE_ANALYSIS_FIELD,
  firstConfigured(FIELDS_CONFIG.issueAnalysis)
);
export const TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD = firstNonEmpty(
  process.env.TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD,
  firstConfigured(FIELDS_CONFIG.issueCorrectionAndImpacts)
);
export const TFS_SAVED_QUERIES = Object.freeze(
  Object.fromEntries(
    Object.entries(isPlainObject(LOCAL_CONFIG.savedQueries) ? LOCAL_CONFIG.savedQueries : {})
      .map(([name, query]) => [normalizeAlias(name), String(query ?? "").trim()])
      .filter(([name, query]) => name && query)
  )
);
export const TFS_PAT_ALIASES = Object.freeze(
  Object.fromEntries(
    Object.entries(process.env)
      .filter(([key, value]) => /^TFS_PAT_[A-Z0-9_]+$/i.test(key) && typeof value === "string" && value.trim())
      .map(([key, value]) => [normalizeAlias(key.slice("TFS_PAT_".length)), value.trim()])
      .filter(([alias]) => alias)
  )
);
export const TFS_DEFAULT_AUTH_ALIAS = normalizeAlias(
  firstNonEmpty(process.env.TFS_DEFAULT_AUTH_ALIAS, firstConfigured(DEFAULTS_CONFIG.authAlias))
);

/** Token opcional para autenticar clientes no modo HTTP (Bearer). */
export const MCP_HTTP_TOKEN = firstNonEmpty(process.env.MCP_HTTP_TOKEN);
export const MCP_HTTP_HOST = firstNonEmpty(process.env.MCP_HTTP_HOST, "127.0.0.1");
export const MCP_HTTP_PORT = positiveInteger(process.env.MCP_HTTP_PORT, 3010, "MCP_HTTP_PORT", 65_535);
export const MCP_HTTP_BODY_LIMIT_BYTES = positiveInteger(
  process.env.MCP_HTTP_BODY_LIMIT_BYTES,
  1_048_576,
  "MCP_HTTP_BODY_LIMIT_BYTES"
);
export const MCP_HTTP_SESSION_TTL_MS = positiveInteger(
  process.env.MCP_HTTP_SESSION_TTL_MS,
  30 * 60_000,
  "MCP_HTTP_SESSION_TTL_MS"
);
export const MCP_HTTP_MAX_SESSIONS = positiveInteger(
  process.env.MCP_HTTP_MAX_SESSIONS,
  50,
  "MCP_HTTP_MAX_SESSIONS"
);

/** Base URL de todos os endpoints _apis do projeto. */
export const BASE = `${PROJECT_BASE_URL}/_apis`;

export function buildProjectUrl(pathname = "") {
  if (!pathname) return PROJECT_BASE_URL;
  return `${PROJECT_BASE_URL}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function getConfiguredRepositories() {
  return [...TFS_REPOS];
}

export function getConfiguredWorkItemProfile(workItemType) {
  return getWorkItemProfile(TFS_WORK_ITEM_PROFILES, workItemType);
}

export function getSavedQuery(name) {
  return TFS_SAVED_QUERIES[normalizeAlias(name)] ?? "";
}

export function getConfigurationSummary() {
  return {
    configFileLoaded: Boolean(LOCAL_CONFIG.__file),
    endpointConfigured: !TFS_URL.includes("tfs.example.com"),
    collectionConfigured: TFS_COLLECTION !== "ExampleCollection",
    projectConfigured: TFS_PROJECT !== "ExampleProject",
    repositories: getConfiguredRepositories(),
    workItemProfiles: Object.keys(TFS_WORK_ITEM_PROFILES),
    savedQueries: Object.keys(TFS_SAVED_QUERIES),
    auth: {
      defaultPatConfigured: Boolean(TFS_PAT),
      aliases: getAvailableAuthAliases(),
      defaultAlias: TFS_DEFAULT_AUTH_ALIAS || null,
    },
  };
}

export function getRepositoryCandidates() {
  const contextRepo = normalizeName(getRequestContext()?.repo);
  return unique([contextRepo, ...TFS_REPOS]);
}

export function getDefaultRepository() {
  return getRepositoryCandidates()[0] ?? "example-repo";
}

export function getAvailableAuthAliases() {
  return Object.keys(TFS_PAT_ALIASES);
}

export function resolvePat(preferredAlias) {
  const requestedAlias = normalizeAlias(firstNonEmpty(preferredAlias, getRequestContext()?.authAlias));
  if (requestedAlias) {
    return {
      alias: requestedAlias,
      pat: TFS_PAT_ALIASES[requestedAlias] ?? "",
      isExplicitAlias: true,
    };
  }

  if (TFS_DEFAULT_AUTH_ALIAS) {
    return {
      alias: TFS_DEFAULT_AUTH_ALIAS,
      pat: TFS_PAT_ALIASES[TFS_DEFAULT_AUTH_ALIAS] ?? "",
      isExplicitAlias: false,
    };
  }

  if (!TFS_DEFAULT_AUTH_ALIAS && !TFS_PAT) {
    const aliases = Object.keys(TFS_PAT_ALIASES);
    if (aliases.length === 1) {
      return {
        alias: aliases[0],
        pat: TFS_PAT_ALIASES[aliases[0]] ?? "",
        isExplicitAlias: false,
      };
    }
  }

  return { alias: "", pat: TFS_PAT, isExplicitAlias: false };
}
