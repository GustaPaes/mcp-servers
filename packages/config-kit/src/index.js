import fs from "node:fs";
import path from "node:path";

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function readVersionedJsonConfigSync(filePath, {
  optional = true,
  expectedVersion = 1,
  label = "configuration",
  allowedKeys,
  onUnknown = "error",
  validate,
} = {}) {
  const configured = String(filePath ?? "").trim();
  if (!configured) return Object.freeze({});
  const absolutePath = path.resolve(configured);
  if (!fs.existsSync(absolutePath)) {
    if (optional) return Object.freeze({});
    throw new Error(`${label} file not found: ${absolutePath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${error.message}`);
  }
  if (!isPlainObject(parsed)) throw new Error(`${label} must be a JSON object`);
  if (parsed.schemaVersion !== expectedVersion) {
    throw new Error(`${label}.schemaVersion must be ${expectedVersion}`);
  }
  if (allowedKeys) {
    const allowed = new Set(["schemaVersion", ...allowedKeys]);
    const unknown = Object.keys(parsed).filter((key) => !allowed.has(key));
    if (unknown.length) {
      const message = `${label} contains unknown keys: ${unknown.join(", ")}`;
      if (onUnknown === "warn") process.emitWarning(message, { code: "MCP_UNKNOWN_CONFIG" });
      else if (onUnknown !== "ignore") throw new Error(message);
    }
  }
  if (validate) {
    const validationResult = validate(parsed);
    if (validationResult === false) throw new Error(`${label} failed validation`);
  }
  return deepFreeze({ ...parsed, __file: absolutePath });
}

export function firstConfigured(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value !== undefined && value !== null && typeof value !== "string") return value;
  }
  return "";
}

export function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toBoolean(value, { defaultValue = false, label = "value" } = {}) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${label} must be a boolean`);
}

export function toBoundedInteger(value, {
  defaultValue,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
  label = "value",
} = {}) {
  const candidate = value === undefined || value === null || value === "" ? defaultValue : value;
  const parsed = typeof candidate === "number" ? candidate : Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function toEnum(value, allowed, { defaultValue, label = "value" } = {}) {
  const candidate = value === undefined || value === null || value === "" ? defaultValue : value;
  if (!allowed.includes(candidate)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return candidate;
}
