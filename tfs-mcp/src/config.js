/**
 * config.js — Centraliza toda derivação de configuração.
 * Todas as variáveis de ambiente são resolvidas UMA VEZ aqui.
 * Outros módulos importam constantes prontas, nunca lêem process.env diretamente.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { execFileSync } from "child_process";
import { getRequestContext } from "./request-context.js";

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

export const TFS_URL = firstNonEmpty(process.env.TFS_URL, "https://tfs.example.com").replace(/\/+$/, "");
export const TFS_COLLECTION = stripSlashes(firstNonEmpty(process.env.TFS_COLLECTION, "ExampleCollection"));
export const TFS_PROJECT = stripSlashes(firstNonEmpty(process.env.TFS_PROJECT, "ExampleProject"));
export const PROJECT_BASE_URL = `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}`;

const DETECTED_REPOSITORY = detectRepositoryFromGit();
export const TFS_REPOS = unique([
  ...parseCsv(process.env.TFS_REPOS),
  firstNonEmpty(process.env.TFS_REPO, process.env.TFS_REPOSITORY),
  DETECTED_REPOSITORY,
  "ExampleProject",
]);
export const TFS_REPO = TFS_REPOS[0] ?? "ExampleProject";
export const TFS_PAT = firstNonEmpty(process.env.TFS_PAT);
export const TFS_PAT_ALIASES = Object.freeze(
  Object.fromEntries(
    Object.entries(process.env)
      .filter(([key, value]) => /^TFS_PAT_[A-Z0-9_]+$/i.test(key) && typeof value === "string" && value.trim())
      .map(([key, value]) => [normalizeAlias(key.slice("TFS_PAT_".length)), value.trim()])
      .filter(([alias]) => alias)
  )
);
export const TFS_DEFAULT_AUTH_ALIAS = normalizeAlias(process.env.TFS_DEFAULT_AUTH_ALIAS);

/** Token opcional para autenticar clientes no modo HTTP (Bearer). */
export const MCP_HTTP_TOKEN = firstNonEmpty(process.env.MCP_HTTP_TOKEN);

/** Base URL de todos os endpoints _apis do projeto. */
export const BASE = `${PROJECT_BASE_URL}/_apis`;

export function buildProjectUrl(pathname = "") {
  if (!pathname) return PROJECT_BASE_URL;
  return `${PROJECT_BASE_URL}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function getConfiguredRepositories() {
  return [...TFS_REPOS];
}

export function getRepositoryCandidates() {
  const contextRepo = normalizeName(getRequestContext()?.repo);
  return unique([contextRepo, ...TFS_REPOS]);
}

export function getDefaultRepository() {
  return getRepositoryCandidates()[0] ?? "ExampleProject";
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
