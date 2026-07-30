import fs from "node:fs";
import path from "node:path";

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readVersionedJsonConfigSync(filePath, {
  optional = true,
  expectedVersion = 1,
  label = "configuration",
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
  return Object.freeze({ ...parsed, __file: absolutePath });
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
