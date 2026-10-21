import path from "node:path";
import { ROOT_DIR } from "../config.js";

export const DEFAULT_IDP_ROUTES = Object.freeze({
  self: "/me",
  plans: "/idp/plans",
  plan: "/idp/plans/{planId}",
  actions: "/idp/actions/with-growth",
  actionCreate: "/idp/actions",
  action: "/idp/actions/{actionId}",
  actionStatus: "/idp/actions/{actionId}/status",
  comments: "/idp/plans/comments",
});

export const REMOTE_ENV_KEYS = Object.freeze([
  "CAREER_REMOTE_PROVIDER",
  "CAREER_REMOTE_API_URL",
  "CAREER_REMOTE_ALLOWED_HOSTS",
  "CAREER_REMOTE_AUTH_TOKEN",
  "CAREER_REMOTE_AUTH_COOKIE",
  "CAREER_REMOTE_SESSION_FILE",
  "CAREER_REMOTE_SESSION_ROOT",
  "CAREER_REMOTE_TIMEOUT_MS",
  "CAREER_REMOTE_MAX_RESPONSE_BYTES",
  "CAREER_REMOTE_PREVIEW_TTL_MS",
  "CAREER_REMOTE_MAX_RECORDS",
  "CAREER_REMOTE_ROUTES_JSON",
]);

function integer(env, key, fallback, min, max) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  return value;
}

export function readRemoteConfig(env = process.env) {
  const provider = env.CAREER_REMOTE_PROVIDER?.trim() || "none";
  if (!["none", "idp"].includes(provider))
    throw new Error("CAREER_REMOTE_PROVIDER must be none or idp.");
  const apiUrl = env.CAREER_REMOTE_API_URL?.trim() || "";
  const allowedHosts = (env.CAREER_REMOTE_ALLOWED_HOSTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  let origin = "";
  if (apiUrl) {
    let url;
    try {
      url = new URL(apiUrl);
    } catch {
      throw new Error("CAREER_REMOTE_API_URL must be a valid HTTPS origin.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.port && url.port !== "443")
    )
      throw new Error(
        "CAREER_REMOTE_API_URL must be an HTTPS origin on port 443 without credentials, path, query or fragment.",
      );
    if (!allowedHosts.includes(url.hostname.toLowerCase()))
      throw new Error(
        "The API host must appear exactly in CAREER_REMOTE_ALLOWED_HOSTS.",
      );
    origin = url.origin;
  }
  const token = env.CAREER_REMOTE_AUTH_TOKEN || "";
  const cookie = env.CAREER_REMOTE_AUTH_COOKIE || "";
  const sessionFile = env.CAREER_REMOTE_SESSION_FILE?.trim() || "";
  let overrides = {};
  try {
    overrides = JSON.parse(env.CAREER_REMOTE_ROUTES_JSON || "{}");
  } catch {
    throw new Error("CAREER_REMOTE_ROUTES_JSON must be a JSON object.");
  }
  if (!overrides || Array.isArray(overrides) || typeof overrides !== "object")
    throw new Error("CAREER_REMOTE_ROUTES_JSON must be a JSON object.");
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(DEFAULT_IDP_ROUTES, key) ||
      typeof value !== "string" ||
      value.length > 512 ||
      !/^\/[A-Za-z0-9_/{\}.\-]+$/.test(value) ||
      value.startsWith("//") ||
      value.split("/").some((segment) => segment === "." || segment === "..")
    )
      throw new Error(
        "Remote route overrides must use known route names and safe relative paths without queries.",
      );
    const expected = [...DEFAULT_IDP_ROUTES[key].matchAll(/\{([^}]+)\}/g)]
      .map((m) => m[1])
      .sort();
    const supplied = [...value.matchAll(/\{([^}]+)\}/g)]
      .map((m) => m[1])
      .sort();
    if (
      JSON.stringify(expected) !== JSON.stringify(supplied) ||
      value.replace(/\{(?:planId|actionId)\}/g, "").match(/[{}]/)
    )
      throw new Error(
        "Remote route placeholders must match the documented route contract.",
      );
  }
  if ([token, cookie, sessionFile].filter(Boolean).length > 1)
    throw new Error("Configure exactly one remote authentication source.");
  if ([token, cookie].some((x) => /[\r\n]/.test(x) || x.length > 32768))
    throw new Error(
      "Remote authentication headers contain invalid characters or exceed the limit.",
    );
  return Object.freeze({
    provider,
    origin,
    allowedHosts,
    token,
    cookie,
    routes: Object.freeze({ ...DEFAULT_IDP_ROUTES, ...overrides }),
    sessionFile: sessionFile ? path.resolve(ROOT_DIR, sessionFile) : "",
    sessionRoot: path.resolve(
      ROOT_DIR,
      env.CAREER_REMOTE_SESSION_ROOT || "./local-private/auth",
    ),
    timeoutMs: integer(env, "CAREER_REMOTE_TIMEOUT_MS", 15000, 100, 60000),
    maxResponseBytes: integer(
      env,
      "CAREER_REMOTE_MAX_RESPONSE_BYTES",
      1048576,
      1024,
      5242880,
    ),
    previewTtlMs: integer(
      env,
      "CAREER_REMOTE_PREVIEW_TTL_MS",
      600000,
      1000,
      1800000,
    ),
    maxRecords: integer(env, "CAREER_REMOTE_MAX_RECORDS", 500, 10, 2000),
    unknownKeys: Object.keys(env).filter(
      (key) =>
        key.startsWith("CAREER_REMOTE_") && !REMOTE_ENV_KEYS.includes(key),
    ),
  });
}

export function requireRemoteConfig(config) {
  if (config.provider === "none" || !config.origin)
    throw new Error(
      "Remote career access is disabled. Configure CAREER_REMOTE_PROVIDER, CAREER_REMOTE_API_URL and CAREER_REMOTE_ALLOWED_HOSTS in the private .env.",
    );
  if (!config.token && !config.cookie && !config.sessionFile)
    throw new Error(
      "Configure a private remote authentication source. No credentials are accepted in tool arguments.",
    );
}
