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
  validateFieldReferenceName,
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

function integerInRange(value, fallback, label, min, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return parsed;
}

function positiveInteger(value, fallback, label, max = Number.MAX_SAFE_INTEGER) {
  return integerInRange(value, fallback, label, 1, max);
}

function normalizeTfsRoot(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("TFS_URL deve ser uma raiz HTTP(S) sem credenciais, query ou fragmento.");
  }
  return url.toString().replace(/\/+$/, "");
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

function validateSegment(value, label) {
  if (typeof value !== "string") throw new Error(`${label} deve ser uma string.`);
  const segment = value.trim();
  if (!segment || segment === "." || segment === ".." || /[\\/?#\x00-\x1f]/.test(segment)) {
    throw new Error(`${label} deve ser um único nome de caminho, sem barras ou caracteres de controle.`);
  }
  return segment;
}

function normalizeScopeEntry(entry) {
  if (!isPlainObject(entry)) throw new Error("Cada item de scopes deve ser um objeto.");
  const collection = validateSegment(entry.collection, "scopes.collection");
  const project = validateSegment(entry.project, "scopes.project");
  const allowed = new Set(["collection", "project", "repositories", "workItemProfiles", "savedQueries", "fields", "authAlias"]);
  for (const key of Object.keys(entry)) if (!allowed.has(key)) throw new Error(`Propriedade desconhecida em scopes: ${key}`);
  if (entry.repositories !== undefined && !Array.isArray(entry.repositories)) throw new Error("scopes.repositories deve ser uma lista.");
  for (const repository of entry.repositories ?? []) {
    if (typeof repository !== "string" || !repository.trim()) throw new Error("scopes.repositories deve conter nomes não vazios.");
  }
  if (entry.authAlias !== undefined && (typeof entry.authAlias !== "string" || !normalizeAlias(entry.authAlias))) {
    throw new Error("scopes.authAlias deve ser um alias não vazio.");
  }
  for (const key of ["workItemProfiles", "savedQueries", "fields"]) {
    if (entry[key] !== undefined && !isPlainObject(entry[key])) throw new Error(`scopes.${key} deve ser um objeto.`);
  }
  for (const [key, value] of Object.entries(entry.fields ?? {})) {
    if (!["issueAnalysis", "issueCorrectionAndImpacts"].includes(key)) throw new Error(`Campo desconhecido em scopes.fields: ${key}`);
    validateFieldReferenceName(value, `scopes.fields.${key}`);
  }
  for (const [key, value] of Object.entries(entry.savedQueries ?? {})) {
    if (!normalizeAlias(key) || typeof value !== "string" || !value.trim()) throw new Error("scopes.savedQueries deve conter nomes e WIQL não vazios.");
  }
  return { ...entry, collection, project };
}

if (LOCAL_CONFIG.collections !== undefined && !Array.isArray(LOCAL_CONFIG.collections)) throw new Error("collections deve ser uma lista.");
if (LOCAL_CONFIG.scopes !== undefined && !Array.isArray(LOCAL_CONFIG.scopes)) throw new Error("scopes deve ser uma lista.");
const CONFIGURED_COLLECTIONS = Object.freeze((LOCAL_CONFIG.collections ?? []).map((item) => validateSegment(item, "collections")));
const SCOPE_CONFIGS = Object.freeze((LOCAL_CONFIG.scopes ?? []).map(normalizeScopeEntry));
if (new Set(SCOPE_CONFIGS.map((entry) => `${entry.collection.toLowerCase()}\0${entry.project.toLowerCase()}`)).size !== SCOPE_CONFIGS.length) {
  throw new Error("scopes contém collection/project duplicados.");
}

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

export const TFS_URL = normalizeTfsRoot(firstNonEmpty(
  process.env.TFS_URL,
  firstConfigured(CONNECTION_CONFIG.url),
  "https://tfs.example.com"
));
export const TFS_COLLECTION = stripSlashes(firstNonEmpty(
  process.env.TFS_COLLECTION,
  firstConfigured(CONNECTION_CONFIG.collection),
  new URL(TFS_URL).hostname === "tfs.example.com" ? "ExampleCollection" : ""
));
export const TFS_PROJECT = stripSlashes(firstNonEmpty(
  process.env.TFS_PROJECT,
  firstConfigured(CONNECTION_CONFIG.project),
  new URL(TFS_URL).hostname === "tfs.example.com" ? "ExampleProject" : ""
));
if (TFS_COLLECTION) validateSegment(TFS_COLLECTION, "TFS_COLLECTION");
if (TFS_PROJECT) validateSegment(TFS_PROJECT, "TFS_PROJECT");
export const PROJECT_BASE_URL = `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}`;

export function getTfsScope({ requireProject = true } = {}) {
  const context = getRequestContext();
  if (!context.collection && !TFS_COLLECTION) throw new Error("Informe collection ou configure TFS_COLLECTION como padrão.");
  const collection = validateSegment(context.collection || TFS_COLLECTION, "collection");
  const sameDefaultCollection = !context.collection || collection.toLowerCase() === TFS_COLLECTION.toLowerCase();
  const scopedProjects = SCOPE_CONFIGS.filter((entry) => entry.collection.toLowerCase() === collection.toLowerCase());
  const project = context.project || (sameDefaultCollection ? TFS_PROJECT : "")
    || (scopedProjects.length === 1 ? scopedProjects[0].project : "");
  if (requireProject && !project) throw new Error("Informe project: a collection selecionada não possui um projeto padrão inequívoco.");
  if (project) validateSegment(project, "project");
  const projectBaseUrl = `${TFS_URL}/${encodeURIComponent(collection)}/${encodeURIComponent(project)}`;
  return { collection, project, projectBaseUrl, apiBase: `${projectBaseUrl}/_apis` };
}

export function getConfiguredCollections() {
  return [...new Set([TFS_COLLECTION, ...CONFIGURED_COLLECTIONS, ...SCOPE_CONFIGS.map((entry) => entry.collection)].filter(Boolean))];
}

export function getScopeConfig() {
  const context = getRequestContext();
  if (!(context.collection || TFS_COLLECTION)) return {};
  const { collection, project } = getTfsScope({ requireProject: false });
  if (!project) return {};
  return SCOPE_CONFIGS.find((entry) => entry.collection.toLowerCase() === collection.toLowerCase()
    && entry.project.toLowerCase() === project.toLowerCase()) ?? {};
}

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
for (const scope of SCOPE_CONFIGS) {
  if (scope.workItemProfiles) parseWorkItemProfiles(scope.workItemProfiles, { variables: { currentQuarter: TFS_DEFAULT_QUARTER } });
}
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
export const TFS_REQUEST_TIMEOUT_MS = positiveInteger(
  process.env.TFS_REQUEST_TIMEOUT_MS,
  30_000,
  "TFS_REQUEST_TIMEOUT_MS",
  300_000
);
export const TFS_MAX_RETRIES = integerInRange(
  process.env.TFS_MAX_RETRIES,
  3,
  "TFS_MAX_RETRIES",
  0,
  5
);
export const TFS_RETRY_MAX_DELAY_MS = positiveInteger(
  process.env.TFS_RETRY_MAX_DELAY_MS,
  8_000,
  "TFS_RETRY_MAX_DELAY_MS",
  60_000
);
export const TFS_MCP_MAX_INPUT_ITEMS = positiveInteger(
  process.env.TFS_MCP_MAX_INPUT_ITEMS,
  500,
  "TFS_MCP_MAX_INPUT_ITEMS",
  10_000
);
export const TFS_MCP_MAX_INPUT_STRING_CHARS = positiveInteger(
  process.env.TFS_MCP_MAX_INPUT_STRING_CHARS,
  250_000,
  "TFS_MCP_MAX_INPUT_STRING_CHARS",
  1_000_000
);
export const TFS_MCP_MAX_RESPONSE_BYTES = positiveInteger(
  process.env.TFS_MCP_MAX_RESPONSE_BYTES,
  2_000_000,
  "TFS_MCP_MAX_RESPONSE_BYTES",
  20_000_000
);

/** Base URL de todos os endpoints _apis do projeto. */
export const BASE = `${PROJECT_BASE_URL}/_apis`;

export function buildProjectUrl(pathname = "") {
  const base = getTfsScope().projectBaseUrl;
  if (!pathname) return base;
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function getConfiguredRepositories() {
  const scoped = toStringArray(getScopeConfig().repositories);
  return scoped.length ? unique(scoped) : [...TFS_REPOS];
}

export function getConfiguredWorkItemProfile(workItemType) {
  const scoped = getScopeConfig().workItemProfiles;
  if (scoped) {
    const profiles = parseWorkItemProfiles(scoped, { variables: { currentQuarter: TFS_DEFAULT_QUARTER } });
    const scopedNames = new Set(Object.keys(profiles).map((name) => name.toLowerCase()));
    const globalProfiles = Object.entries(TFS_WORK_ITEM_PROFILES)
      .filter(([name]) => !scopedNames.has(name.toLowerCase()));
    return getWorkItemProfile(Object.fromEntries([...Object.entries(profiles), ...globalProfiles]), workItemType);
  }
  return getWorkItemProfile(TFS_WORK_ITEM_PROFILES, workItemType);
}

export function getSavedQuery(name) {
  const scoped = getScopeConfig().savedQueries ?? {};
  return Object.entries(scoped).find(([key]) => normalizeAlias(key) === normalizeAlias(name))?.[1]
    ?? TFS_SAVED_QUERIES[normalizeAlias(name)] ?? "";
}

export function getSavedQueryNames() {
  return unique([...Object.keys(TFS_SAVED_QUERIES), ...Object.keys(getScopeConfig().savedQueries ?? {}).map(normalizeAlias)]);
}

export function getIssueAnalysisFields() {
  const fields = getScopeConfig().fields ?? {};
  return {
    developmentAnalysis: fields.issueAnalysis ?? TFS_ISSUE_ANALYSIS_FIELD,
    correctionAndImpacts: fields.issueCorrectionAndImpacts ?? TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD,
  };
}

export function getWorkItemProfileFields() {
  const scoped = getScopeConfig().workItemProfiles;
  return unique([...TFS_WORK_ITEM_PROFILE_FIELDS, ...(scoped
    ? getProfileFieldNames(parseWorkItemProfiles(scoped, { variables: { currentQuarter: TFS_DEFAULT_QUARTER } })) : [])]);
}

export function getConfigurationSummary() {
  return {
    configFileLoaded: Boolean(LOCAL_CONFIG.__file),
    endpointConfigured: !TFS_URL.includes("tfs.example.com"),
    collectionConfigured: Boolean(TFS_COLLECTION) && TFS_COLLECTION !== "ExampleCollection",
    projectConfigured: Boolean(TFS_PROJECT) && TFS_PROJECT !== "ExampleProject",
    repositories: getConfiguredRepositories(),
    workItemProfiles: Object.keys(TFS_WORK_ITEM_PROFILES),
    savedQueries: getSavedQueryNames(),
    configuredCollections: getConfiguredCollections().filter((name) => name !== "ExampleCollection"),
    scopedProjects: SCOPE_CONFIGS.length,
    auth: {
      defaultPatConfigured: Boolean(TFS_PAT),
      aliases: getAvailableAuthAliases(),
      defaultAlias: TFS_DEFAULT_AUTH_ALIAS || null,
    },
  };
}

export function getRepositoryCandidates() {
  const contextRepo = normalizeName(getRequestContext()?.repo);
  return unique([contextRepo, ...getConfiguredRepositories()]);
}

export function getDefaultRepository() {
  return getRepositoryCandidates()[0] ?? "example-repo";
}

export function getAvailableAuthAliases() {
  return Object.keys(TFS_PAT_ALIASES);
}

export function resolvePat(preferredAlias) {
  const requestedAlias = normalizeAlias(firstNonEmpty(preferredAlias, getRequestContext()?.authAlias, getScopeConfig().authAlias));
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
