import { TFS_MCP_MAX_INPUT_ITEMS, TFS_MCP_MAX_INPUT_STRING_CHARS, TFS_MCP_MAX_RESPONSE_BYTES } from "./config.js";

export const GENERIC_OBJECT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
});

const NUMBER_LIMITS = Object.freeze({
  top: { minimum: 1, maximum: 500 },
  estimated_changed_lines: { minimum: 0, maximum: 10_000_000 },
  story_points: { minimum: 0, maximum: 1_000_000 },
});

export function applyContractLimits(schema, fieldName = "") {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.type === "object") {
    schema.additionalProperties ??= false;
    for (const [name, child] of Object.entries(schema.properties ?? {})) applyContractLimits(child, name);
  }
  if (schema.type === "array") {
    schema.maxItems ??= TFS_MCP_MAX_INPUT_ITEMS;
    if (schema.items) applyContractLimits(schema.items, fieldName);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("string")) schema.maxLength ??= TFS_MCP_MAX_INPUT_STRING_CHARS;
  if (types.includes("number") || types.includes("integer")) {
    const limits = NUMBER_LIMITS[fieldName];
    if (limits) {
      schema.minimum ??= limits.minimum;
      schema.maximum ??= limits.maximum;
    }
  }
  for (const option of schema.oneOf ?? []) applyContractLimits(option, fieldName);
  for (const option of schema.anyOf ?? []) applyContractLimits(option, fieldName);
  return schema;
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

export function validateToolArguments(schema, value, at = "arguments") {
  if (!schema || typeof schema !== "object") return;
  if (schema.oneOf) {
    const valid = schema.oneOf.some((candidate) => {
      try { validateToolArguments(candidate, value, at); return true; } catch { return false; }
    });
    if (!valid) throw new Error(`${at} nao corresponde a um formato suportado.`);
    return;
  }
  if (schema.anyOf) {
    const valid = schema.anyOf.some((candidate) => {
      try { validateToolArguments(candidate, value, at); return true; } catch { return false; }
    });
    if (!valid) throw new Error(`${at} nao corresponde a um formato suportado.`);
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) {
    throw new Error(`${at} deve ser ${types.join(" ou ")}.`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${at} possui valor nao suportado.`);
  if (typeof value === "string" && schema.minLength != null && value.length < schema.minLength) {
    throw new Error(`${at} deve ter no minimo ${schema.minLength} caracteres.`);
  }
  if (typeof value === "string" && schema.maxLength != null && value.length > schema.maxLength) {
    throw new Error(`${at} excede ${schema.maxLength} caracteres.`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${at} deve ser finito.`);
    if (schema.minimum != null && value < schema.minimum) throw new Error(`${at} deve ser no minimo ${schema.minimum}.`);
    if (schema.maximum != null && value > schema.maximum) throw new Error(`${at} deve ser no maximo ${schema.maximum}.`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) throw new Error(`${at} possui poucos itens.`);
    if (schema.maxItems != null && value.length > schema.maxItems) throw new Error(`${at} excede ${schema.maxItems} itens.`);
    value.forEach((item, index) => validateToolArguments(schema.items ?? {}, item, `${at}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!(required in value)) throw new Error(`${at}.${required} e obrigatorio.`);
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !(key in properties));
      if (unknown) throw new Error(`${at}.${unknown} nao e permitido.`);
    }
    for (const [name, child] of Object.entries(properties)) {
      if (name in value) validateToolArguments(child, value[name], `${at}.${name}`);
    }
  }
}

export function boundToolResult(result) {
  const normalized = result && typeof result === "object"
    ? (Array.isArray(result) ? { items: result } : result)
    : { value: result ?? null };
  const encoded = JSON.stringify(normalized);
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes <= TFS_MCP_MAX_RESPONSE_BYTES) return normalized;
  return {
    truncated: true,
    totalBytes: bytes,
    limitBytes: TFS_MCP_MAX_RESPONSE_BYTES,
    preview: encoded.slice(0, 32_000),
  };
}
