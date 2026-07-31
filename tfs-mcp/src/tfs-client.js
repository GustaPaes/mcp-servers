/**
 * tfs-client.js — Cliente HTTP para Azure DevOps / TFS.
 *
 * Responsabilidades:
 *  - Autenticação via PAT (Basic Auth)
 *  - Retry com exponential backoff + jitter para erros transientes (429, 5xx)
 *  - Cache in-memory com TTL configurável por chamada
 *  - Health check de conectividade
 *
 * Padrão 2026: retry com jitter evita thundering-herd em ambientes Azure.
 */
import { BASE, getAvailableAuthAliases, resolvePat } from "./config.js";
import { logger } from "./logger.js";

// ─── Auth ──────────────────────────────────────────────────────────────────

function ensurePat(authAlias) {
  const resolved = resolvePat(authAlias);
  if (resolved.pat) return resolved;

  const aliases = getAvailableAuthAliases();
  if (resolved.alias) {
    const available = aliases.length ? ` Aliases disponíveis: ${aliases.join(", ")}.` : "";
    throw new Error(`Alias TFS '${resolved.alias}' não configurado.${available}`);
  }

  if (!resolved.pat) {
    const aliasHint = aliases.length
      ? ` Defina TFS_PAT ou use auth_alias com um dos aliases configurados: ${aliases.join(", ")}.`
      : " Defina TFS_PAT no .env do servidor MCP.";
    throw new Error(
      `PAT do TFS não configurado.${aliasHint}`
    );
  }
}

function buildScopedCacheKey(cacheKey, authAlias) {
  if (!cacheKey) return cacheKey;
  const resolved = resolvePat(authAlias);
  return `auth:${resolved.alias || "default"}:${cacheKey}`;
}

export function buildHeaders(extra = {}, { authAlias } = {}) {
  const { pat } = ensurePat(authAlias);
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
    Accept: "application/json",
    ...extra,
  };
}

// ─── Retry ─────────────────────────────────────────────────────────────────

const RETRY_ON_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_DELAY_MS = 8_000;

async function withRetry(fn) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? 0;
      if (attempt === MAX_RETRIES || !RETRY_ON_STATUS.has(status)) throw err;

      // Exponential backoff com jitter: 1s → 2s → 4s (mais ruído aleatório)
      const baseDelay = 1000 * 2 ** attempt;
      const jitter = Math.random() * 300;
      const delay = Math.min(baseDelay + jitter, MAX_DELAY_MS);

      logger.warn(
        { attempt: attempt + 1, maxRetries: MAX_RETRIES, status, delayMs: Math.round(delay) },
        "TFS request retry"
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Cache ─────────────────────────────────────────────────────────────────

const _cache = new Map();

export function cacheInvalidate(key) {
  _cache.delete(key);
}

export function cacheClearAll() {
  _cache.clear();
}

function tryCacheHit(key) {
  if (!key) return null;
  const entry = _cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  _cache.delete(key); // expired
  return null;
}

function cacheStore(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ─── Core HTTP ──────────────────────────────────────────────────────────────

/**
 * GET com cache opcional.
 * @param {string} endpoint  — caminho relativo ao BASE (ex: "/wit/workitems/123")
 * @param {object} params    — query string params
 * @param {object} [cache]   — { cacheKey: string, cacheTtlMs: number }
 */
export async function tfsGet(endpoint, params = {}, { cacheKey, cacheTtlMs = 0, authAlias } = {}) {
  const scopedCacheKey = buildScopedCacheKey(cacheKey, authAlias);
  const hit = tryCacheHit(scopedCacheKey);
  if (hit !== null) {
    logger.debug({ cacheKey: scopedCacheKey }, "TFS cache hit");
    return hit;
  }

  const url = new URL(`${BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  const data = await withRetry(async () => {
    logger.debug({ method: "GET", path: url.pathname + url.search }, "TFS →");
    const res = await fetch(url.toString(), { headers: buildHeaders({}, { authAlias }) });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} GET ${endpoint}: ${txt.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });

  if (scopedCacheKey && cacheTtlMs > 0) cacheStore(scopedCacheKey, data, cacheTtlMs);
  return data;
}

/**
 * POST com corpo JSON.
 */
export async function tfsPost(endpoint, body, params = {}, { authAlias } = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  return withRetry(async () => {
    logger.debug({ method: "POST", path: url.pathname }, "TFS →");
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: buildHeaders({ "Content-Type": "application/json" }, { authAlias }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} POST ${endpoint}: ${txt.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

/**
 * PATCH ou POST com Content-Type: application/json-patch+json.
 * Usado para criar (POST) e atualizar (PATCH) work items.
 */
export async function tfsJsonPatch(method, endpoint, ops, { authAlias } = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  url.searchParams.set("api-version", "7.0");

  return withRetry(async () => {
    logger.debug({ method, path: url.pathname }, "TFS →");
    const res = await fetch(url.toString(), {
      method,
      headers: buildHeaders({ "Content-Type": "application/json-patch+json" }, { authAlias }),
      body: JSON.stringify(ops),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} ${method} ${endpoint}: ${txt.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

/**
 * POST arbitrário com fetch direto (sem passar pelo BASE).
 * Usado para buscar conteúdo de arquivos via URL completa.
 */
export async function tfsFetchRaw(url, opts = {}, { authAlias } = {}) {
  return withRetry(async () => {
    const res = await fetch(url, { headers: buildHeaders({}, { authAlias }), ...opts });
    if (!res.ok) return null;
    return res.text();
  });
}

/**
 * PATCH com corpo JSON.
 * Usado para atualizar recursos como Pull Requests.
 */
export async function tfsPatch(endpoint, body, params = {}, { authAlias } = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  return withRetry(async () => {
    logger.debug({ method: "PATCH", path: url.pathname }, "TFS →");
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: buildHeaders({ "Content-Type": "application/json" }, { authAlias }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} PATCH ${endpoint}: ${txt.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

/**
 * PUT com corpo JSON.
 * Usado para substituir recursos versionados, como definições de build.
 */
export async function tfsPut(endpoint, body, params = {}, { authAlias } = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  return withRetry(async () => {
    logger.debug({ method: "PUT", path: url.pathname }, "TFS →");
    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: buildHeaders({ "Content-Type": "application/json" }, { authAlias }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} PUT ${endpoint}: ${txt.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

export async function tfsGetAbsoluteJson(url, { cacheKey, cacheTtlMs = 0, authAlias } = {}) {
  const scopedCacheKey = buildScopedCacheKey(cacheKey, authAlias);
  const hit = tryCacheHit(scopedCacheKey);
  if (hit !== null) {
    logger.debug({ cacheKey: scopedCacheKey }, "TFS absolute cache hit");
    return hit;
  }

  const data = await withRetry(async () => {
    logger.debug({ method: "GET", url }, "TFS absolute →");
    const res = await fetch(url, { headers: buildHeaders({}, { authAlias }) });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} GET ${url}: ${txt.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });

  if (scopedCacheKey && cacheTtlMs > 0) cacheStore(scopedCacheKey, data, cacheTtlMs);
  return data;
}

// ─── Health check ──────────────────────────────────────────────────────────

/**
 * Verifica conectividade com o TFS fazendo uma chamada leve.
 * Retorna { ok: boolean, latencyMs: number, error?: string }
 */
export async function checkTfsConnectivity() {
  const t0 = Date.now();
  try {
    await tfsGet("/wit/fields", { "$top": 1 }, { cacheKey: "__health_tfs", cacheTtlMs: 30_000 });
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: err.message };
  }
}
