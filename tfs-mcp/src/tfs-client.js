/**
 * tfs-client.js — Cliente HTTP para Azure DevOps / TFS.
 *
 * Responsabilidades:
 *  - Autenticação via PAT (Basic Auth)
 *  - Retry com backoff, jitter e Retry-After somente para operações seguras
 *  - Cache in-memory com TTL configurável por chamada
 *  - Health check de conectividade
 *
 * POST/PATCH não são repetidos para evitar mutações duplicadas.
 */
import {
  TFS_MAX_RETRIES,
  TFS_REQUEST_TIMEOUT_MS,
  TFS_RETRY_MAX_DELAY_MS,
  TFS_URL,
  getTfsScope,
  getAvailableAuthAliases,
  resolvePat,
} from "./config.js";
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

function buildScopedCacheKey(cacheKey, authAlias, url) {
  if (!cacheKey) return cacheKey;
  const resolved = resolvePat(authAlias);
  return `auth:${resolved.alias || "default"}:url:${url}:${cacheKey}`;
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
const TRUSTED_TFS_ROOT = new URL(TFS_URL);

export function assertTrustedTfsUrl(input) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL TFS deve usar HTTP ou HTTPS.");
  if (url.username || url.password) throw new Error("Credenciais embutidas na URL TFS nao sao permitidas.");
  const rootPath = TRUSTED_TFS_ROOT.pathname.replace(/\/+$/, "");
  if (url.origin !== TRUSTED_TFS_ROOT.origin || (rootPath && url.pathname !== rootPath && !url.pathname.startsWith(`${rootPath}/`))) {
    throw new Error(`Recusado encaminhar credenciais TFS para origem nao confiavel: ${url.origin}`);
  }
  return url;
}

function assertSelectedScopeUrl(url, { allowCollectionResources = false } = {}) {
  const { collection, project } = getTfsScope();
  const projectPath = `${new URL(TFS_URL).pathname.replace(/\/+$/, "")}/${encodeURIComponent(collection)}/${encodeURIComponent(project)}`;
  const collectionResourcePath = `${new URL(TFS_URL).pathname.replace(/\/+$/, "")}/${encodeURIComponent(collection)}/_apis/resources/Containers/`;
  const selectedPath = url.pathname.toLowerCase();
  if (selectedPath !== projectPath.toLowerCase() && !selectedPath.startsWith(`${projectPath.toLowerCase()}/`)
    && !(allowCollectionResources && selectedPath.startsWith(collectionResourcePath.toLowerCase()))) {
    throw new Error("URL TFS não pertence à collection e ao projeto selecionados.");
  }
  return url;
}

function buildApiUrl(endpoint, baseUrl = getTfsScope().apiBase) {
  const base = assertTrustedTfsUrl(baseUrl);
  if (typeof endpoint !== "string" || !endpoint.startsWith("/")) {
    throw new Error("Endpoint TFS deve ser um caminho relativo iniciado por /.");
  }
  const url = new URL(`${base.href.replace(/\/+$/, "")}${endpoint}`);
  const basePath = base.pathname.replace(/\/+$/, "");
  if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`)) {
    throw new Error("Endpoint TFS escapou da API da collection e do projeto selecionados.");
  }
  return url;
}

function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

export async function fetchWithTimeout(url, options = {}) {
  const trustedUrl = assertTrustedTfsUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`TFS request timeout after ${TFS_REQUEST_TIMEOUT_MS}ms`)),
    TFS_REQUEST_TIMEOUT_MS,
  );
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) abortFromUpstream();
    else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }
  try {
    const response = await fetch(trustedUrl, { ...options, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirecionamento TFS recusado (HTTP ${response.status}). Confira a URL configurada; credenciais não são reenviadas.`);
    }
    return response;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
  }
}

function attachResponseMetadata(error, response) {
  error.status = response.status;
  error.retryAfterMs = retryAfterMs(response);
  return error;
}

async function withRetry(fn, { safeToRetry = false } = {}) {
  for (let attempt = 0; attempt <= TFS_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? 0;
      const timeout = err?.name === "AbortError" || /request timeout/i.test(err?.message ?? "");
      if (!safeToRetry || attempt === TFS_MAX_RETRIES || (!RETRY_ON_STATUS.has(status) && !timeout)) throw err;

      // Exponential backoff com jitter: 1s → 2s → 4s (mais ruído aleatório)
      const baseDelay = 1000 * 2 ** attempt;
      const jitter = Math.random() * 300;
      const delay = Math.min(
        Math.max(baseDelay + jitter, err?.retryAfterMs ?? 0),
        TFS_RETRY_MAX_DELAY_MS,
      );

      logger.warn(
        { attempt: attempt + 1, maxRetries: TFS_MAX_RETRIES, status, delayMs: Math.round(delay) },
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
  const url = buildApiUrl(endpoint);
  const scopedCacheKey = buildScopedCacheKey(cacheKey, authAlias, url.pathname);
  const hit = tryCacheHit(scopedCacheKey);
  if (hit !== null) {
    logger.debug({ cacheKey: scopedCacheKey }, "TFS cache hit");
    return hit;
  }

  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  const data = await withRetry(async () => {
    logger.debug({ method: "GET", path: url.pathname + url.search }, "TFS →");
    const res = await fetchWithTimeout(url.toString(), { headers: buildHeaders({}, { authAlias }) });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} GET ${endpoint}: ${txt.slice(0, 400)}`);
      throw attachResponseMetadata(err, res);
    }
    return res.json();
  }, { safeToRetry: true });

  if (scopedCacheKey && cacheTtlMs > 0) cacheStore(scopedCacheKey, data, cacheTtlMs);
  return data;
}

/**
 * GET paginado preservando os cabeçalhos de continuação do TFS.
 * Usado por inventários que podem ultrapassar o limite de 100 itens.
 */
export async function tfsGetPage(endpoint, params = {}, { authAlias, baseUrl } = {}) {
  const url = buildApiUrl(endpoint, baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");
  return withRetry(async () => {
    logger.debug({ method: "GET", path: url.pathname + url.search }, "TFS →");
    const res = await fetchWithTimeout(url.toString(), { headers: buildHeaders({}, { authAlias }) });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} GET ${endpoint}: ${txt.slice(0, 400)}`);
      throw attachResponseMetadata(err, res);
    }
    return { data: await res.json(), continuationToken: res.headers.get("x-ms-continuationtoken") ?? res.headers.get("x-ms-continuation-token") };
  }, { safeToRetry: true });
}

/**
 * POST com corpo JSON.
 */
export async function tfsPost(endpoint, body, params = {}, { authAlias } = {}) {
  const url = buildApiUrl(endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  return withRetry(async () => {
    logger.debug({ method: "POST", path: url.pathname }, "TFS →");
    const res = await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: buildHeaders({ "Content-Type": "application/json" }, { authAlias }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} POST ${endpoint}: ${txt.slice(0, 400)}`);
      throw attachResponseMetadata(err, res);
    }
    return res.json();
  });
}

/**
 * PATCH ou POST com Content-Type: application/json-patch+json.
 * Usado para criar (POST) e atualizar (PATCH) work items.
 */
export async function tfsJsonPatch(method, endpoint, ops, { authAlias } = {}) {
  const url = buildApiUrl(endpoint);
  url.searchParams.set("api-version", "7.0");

  return withRetry(async () => {
    logger.debug({ method, path: url.pathname }, "TFS →");
    const res = await fetchWithTimeout(url.toString(), {
      method,
      headers: buildHeaders({ "Content-Type": "application/json-patch+json" }, { authAlias }),
      body: JSON.stringify(ops),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} ${method} ${endpoint}: ${txt.slice(0, 400)}`);
      throw attachResponseMetadata(err, res);
    }
    return res.json();
  });
}

/**
 * PATCH com corpo JSON.
 * Usado para atualizar recursos como Pull Requests.
 */
export async function tfsPatch(endpoint, body, params = {}, { authAlias } = {}) {
  const url = buildApiUrl(endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  return withRetry(async () => {
    logger.debug({ method: "PATCH", path: url.pathname }, "TFS →");
    const res = await fetchWithTimeout(url.toString(), {
      method: "PATCH",
      headers: buildHeaders({ "Content-Type": "application/json" }, { authAlias }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} PATCH ${endpoint}: ${txt.slice(0, 400)}`);
      throw attachResponseMetadata(err, res);
    }
    return res.json();
  });
}

/**
 * PUT com corpo JSON.
 * Usado para substituir recursos versionados, como definições de build.
 * `retry:false` permite que fluxos com reconciliação própria enviem a escrita
 * exatamente uma vez antes de reler o estado remoto.
 */
export async function tfsPut(endpoint, body, params = {}, { authAlias, retry = true } = {}) {
  const url = buildApiUrl(endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "7.0");

  const request = async () => {
    logger.debug({ method: "PUT", path: url.pathname }, "TFS →");
    const res = await fetchWithTimeout(url.toString(), {
      method: "PUT",
      headers: buildHeaders({ "Content-Type": "application/json" }, { authAlias }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} PUT ${endpoint}: ${txt.slice(0, 400)}`);
      throw attachResponseMetadata(err, res);
    }
    return res.json();
  };
  return retry ? withRetry(request, { safeToRetry: true }) : request();
}

export async function tfsGetAbsoluteJson(url, { cacheKey, cacheTtlMs = 0, authAlias } = {}) {
  const trustedUrl = assertSelectedScopeUrl(assertTrustedTfsUrl(url), { allowCollectionResources: true });
  const scopedCacheKey = buildScopedCacheKey(cacheKey, authAlias, trustedUrl.toString());
  const hit = tryCacheHit(scopedCacheKey);
  if (hit !== null) {
    logger.debug({ cacheKey: scopedCacheKey }, "TFS absolute cache hit");
    return hit;
  }

  const data = await withRetry(async () => {
    logger.debug({ method: "GET", path: trustedUrl.pathname }, "TFS absolute →");
    const res = await fetchWithTimeout(trustedUrl, { headers: buildHeaders({}, { authAlias }) });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`TFS ${res.status} GET ${trustedUrl.pathname}: ${txt.slice(0, 400)}`);
      throw attachResponseMetadata(err, res);
    }
    return res.json();
  }, { safeToRetry: true });

  if (scopedCacheKey && cacheTtlMs > 0) cacheStore(scopedCacheKey, data, cacheTtlMs);
  return data;
}

export async function tfsGetAbsoluteText(url, { authAlias } = {}) {
  const trustedUrl = assertSelectedScopeUrl(assertTrustedTfsUrl(url));
  return withRetry(async () => {
    const res = await fetchWithTimeout(trustedUrl, { headers: buildHeaders({}, { authAlias }) });
    if (!res.ok) {
      const body = await res.text();
      throw attachResponseMetadata(
        new Error(`TFS ${res.status} GET ${trustedUrl.pathname}: ${body.slice(0, 400)}`),
        res,
      );
    }
    return res.text();
  }, { safeToRetry: true });
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
