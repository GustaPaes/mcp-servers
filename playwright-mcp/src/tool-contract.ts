import { config } from "./config.js";

type JsonSchema = Record<string, any>;

export const OBJECT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
});

const FIELD_LIMITS: Record<string, { minimum?: number; maximum?: number }> = {
  timeout_ms: { minimum: 0, maximum: config.maxToolTimeoutMs },
  delay_ms: { minimum: 0, maximum: config.maxActionDelayMs },
  limit: { minimum: 1, maximum: config.maxResultItems },
  max_depth: { minimum: 1, maximum: config.maxSnapshotDepth },
  click_count: { minimum: 1, maximum: 3 },
  quality: { minimum: 0, maximum: 100 },
  scale: { minimum: 0.1, maximum: 2 },
  times: { minimum: 1, maximum: config.maxRouteMatches },
  index: { minimum: 0, maximum: config.maxResultItems },
};

export function applyContractLimits(schema: JsonSchema, fieldName = ""): JsonSchema {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.type === "object") {
    schema.additionalProperties ??= false;
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      applyContractLimits(child as JsonSchema, name);
    }
  }
  if (schema.type === "array") {
    schema.maxItems ??= config.maxInputItems;
    if (schema.items) applyContractLimits(schema.items as JsonSchema, fieldName);
  }
  if (schema.type === "string" || (!schema.type && schema.description)) {
    schema.maxLength ??= config.maxInputStringChars;
  }
  if (schema.type === "number" || schema.type === "integer") {
    const limits = FIELD_LIMITS[fieldName];
    if (limits?.minimum != null) schema.minimum ??= limits.minimum;
    if (limits?.maximum != null) schema.maximum ??= limits.maximum;
  }
  for (const alternative of schema.oneOf ?? []) applyContractLimits(alternative, fieldName);
  return schema;
}

function typeMatches(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

export function validateToolArguments(schema: JsonSchema, value: unknown, at = "arguments"): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.oneOf)) {
    const valid = schema.oneOf.some((candidate: JsonSchema) => {
      try { validateToolArguments(candidate, value, at); return true; } catch { return false; }
    });
    if (!valid) throw new Error(`${at} does not match any supported shape`);
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type: string) => typeMatches(value, type))) {
    throw new Error(`${at} must be ${types.join(" or ")}`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${at} has an unsupported value`);
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) throw new Error(`${at} is too short`);
    if (schema.maxLength != null && value.length > schema.maxLength) throw new Error(`${at} exceeds ${schema.maxLength} characters`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${at} must be finite`);
    if (schema.minimum != null && value < schema.minimum) throw new Error(`${at} must be at least ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) throw new Error(`${at} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) throw new Error(`${at} has too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) throw new Error(`${at} exceeds ${schema.maxItems} items`);
    value.forEach((item, index) => validateToolArguments(schema.items ?? {}, item, `${at}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!(required in record)) throw new Error(`${at}.${required} is required`);
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(record).find((key) => !(key in properties));
      if (unknown) throw new Error(`${at}.${unknown} is not allowed`);
    }
    for (const [name, child] of Object.entries(properties)) {
      if (name in record) validateToolArguments(child as JsonSchema, record[name], `${at}.${name}`);
    }
  }
}

export function boundedToolResult(result: unknown): Record<string, unknown> {
  const normalized = result && typeof result === "object"
    ? (Array.isArray(result) ? { items: result } : result as Record<string, unknown>)
    : { value: result ?? null };
  const encoded = JSON.stringify(normalized);
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes <= config.maxResponseBytes) return normalized;
  return {
    truncated: true,
    total_bytes: bytes,
    limit_bytes: config.maxResponseBytes,
    preview: encoded.slice(0, Math.min(encoded.length, config.maxResponsePreviewChars)),
  };
}
