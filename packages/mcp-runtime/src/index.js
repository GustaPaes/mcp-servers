import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

const atomicWriteExecutors = new Map();

export const TOOL_RISK = Object.freeze({
  READ: "READ",
  LOCAL_STATE: "LOCAL_STATE",
  EXECUTION: "EXECUTION",
  REMOTE_WRITE: "REMOTE_WRITE",
  DESTRUCTIVE: "DESTRUCTIVE",
  SECRET_READ: "SECRET_READ",
});
const TOOL_RISK_VALUES = new Set(Object.values(TOOL_RISK));
const MAX_REDACTION_ITEMS = 100;
const MAX_REDACTION_STRING_CHARS = 65_536;

function pathKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isInside(root, candidate) {
  const rootKey = pathKey(root);
  const candidateKey = pathKey(candidate);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function projectPhysicalPath(input) {
  const absolute = path.resolve(input);
  const missingSegments = [];
  let cursor = absolute;

  while (true) {
    try {
      const real = fs.realpathSync.native?.(cursor) ?? fs.realpathSync(cursor);
      return path.resolve(real, ...missingSegments);
    } catch (error) {
      if (!error || typeof error !== "object" || !["ENOENT", "ENOTDIR"].includes(error.code)) {
        throw error;
      }
      try {
        if (fs.lstatSync(cursor).isSymbolicLink()) {
          throw new Error(`path contains an unresolved symbolic link: ${cursor}`);
        }
      } catch (linkError) {
        if (!linkError || typeof linkError !== "object" || linkError.code !== "ENOENT") {
          throw linkError;
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function isSensitiveFieldName(name) {
  const canonical = String(name ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return canonical === "token"
    || canonical === "secret"
    || /(?:accesstoken|refreshtoken|idtoken|authtoken|bearertoken|apikey|clientsecret|privatekey|password|passwd|credential|connectionstring|authorization|cookie|session|sessionid|sessiontoken)$/.test(canonical);
}

export function assertSafeIdentifier(value, label = "id") {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new Error(`${label} must contain only letters, numbers, "_" or "-"`);
  }
  return normalized;
}

export function annotationsForRisk(risk, { idempotent, openWorld, title } = {}) {
  if (!TOOL_RISK_VALUES.has(risk)) throw new Error(`unsupported MCP tool risk: ${risk}`);
  const readOnly = risk === TOOL_RISK.READ || risk === TOOL_RISK.SECRET_READ;
  const annotations = {
    readOnlyHint: readOnly,
    destructiveHint: risk === TOOL_RISK.DESTRUCTIVE,
    idempotentHint: idempotent ?? [TOOL_RISK.READ, TOOL_RISK.LOCAL_STATE, TOOL_RISK.SECRET_READ].includes(risk),
    openWorldHint: openWorld ?? [
      TOOL_RISK.EXECUTION,
      TOOL_RISK.REMOTE_WRITE,
      TOOL_RISK.DESTRUCTIVE,
      TOOL_RISK.SECRET_READ,
    ].includes(risk),
  };
  return title ? { title, ...annotations } : annotations;
}

export function assertToolManifest({ definitions, handlers, policies, label = "MCP" }) {
  if (!Array.isArray(definitions)) throw new Error(`${label} tool definitions must be an array`);
  const names = definitions.map((definition) => definition?.name);
  if (names.some((name) => typeof name !== "string" || !name)) {
    throw new Error(`${label} contains a tool definition without a name`);
  }
  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) throw new Error(`${label} contains duplicate tool names`);

  const policyNames = Object.keys(policies ?? {});
  const handlerNames = Object.keys(handlers ?? {});
  const missingPolicies = names.filter((name) => !policies?.[name]);
  const orphanPolicies = policyNames.filter((name) => !uniqueNames.has(name));
  const missingHandlers = names.filter((name) => typeof handlers?.[name] !== "function");
  const orphanHandlers = handlerNames.filter((name) => !uniqueNames.has(name));
  const invalidRisks = policyNames.filter((name) => !TOOL_RISK_VALUES.has(policies[name]?.risk));
  if (missingPolicies.length || orphanPolicies.length || missingHandlers.length || orphanHandlers.length || invalidRisks.length) {
    throw new Error([
      `${label} tool manifest mismatch`,
      `missing policies: ${missingPolicies.join(", ") || "none"}`,
      `orphan policies: ${orphanPolicies.join(", ") || "none"}`,
      `missing handlers: ${missingHandlers.join(", ") || "none"}`,
      `orphan handlers: ${orphanHandlers.join(", ") || "none"}`,
      `invalid risks: ${invalidRisks.join(", ") || "none"}`,
    ].join("; "));
  }
  return definitions;
}

export function resolveInside(root, ...segments) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...segments);
  if (!isInside(base, candidate)) {
    throw new Error("path escapes the configured root");
  }
  const physicalBase = projectPhysicalPath(base);
  const physicalCandidate = projectPhysicalPath(candidate);
  if (!isInside(physicalBase, physicalCandidate)) {
    throw new Error("path escapes the configured root through a symbolic link");
  }
  return physicalCandidate;
}

export function resolveInsideAny(roots, input, { createRoot = false } = {}) {
  const candidate = path.resolve(String(input ?? ""));
  for (const rootValue of roots) {
    const root = path.resolve(rootValue);
    if (createRoot) fs.mkdirSync(root, { recursive: true });
    if (!isInside(root, candidate)) continue;
    const physicalRoot = projectPhysicalPath(root);
    const physicalCandidate = projectPhysicalPath(candidate);
    if (!isInside(physicalRoot, physicalCandidate)) continue;
    return physicalCandidate;
  }
  throw new Error("path is outside the configured allowed roots");
}

function getAtomicWriteExecutor(target) {
  let entry = atomicWriteExecutors.get(target);
  if (!entry) {
    entry = { executor: createSerialExecutor(), pending: 0 };
    atomicWriteExecutors.set(target, entry);
  }
  return function run(task) {
    entry.pending += 1;
    return entry.executor(task).finally(() => {
      entry.pending -= 1;
      if (entry.pending === 0 && atomicWriteExecutors.get(target) === entry) {
        atomicWriteExecutors.delete(target);
      }
    });
  };
}

async function replaceFile(temporary, target) {
  try {
    await fsp.rename(temporary, target);
    return;
  } catch (error) {
    const replaceBlocked = process.platform === "win32"
      && error
      && typeof error === "object"
      && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code);
    if (!replaceBlocked) throw error;
  }

  const backup = `${target}.${process.pid}.${randomUUID()}.bak`;
  let movedExisting = false;
  let replacementComplete = false;
  try {
    try {
      await fsp.rename(target, backup);
      movedExisting = true;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
    await fsp.rename(temporary, target);
    replacementComplete = true;
  } catch (error) {
    if (movedExisting) {
      const restored = await fsp.rename(backup, target).then(() => true, () => false);
      if (restored) movedExisting = false;
    }
    throw error;
  } finally {
    if (movedExisting && replacementComplete) {
      await fsp.rm(backup, { force: true }).catch(() => {});
    }
  }
}

export async function atomicWriteJson(filePath, value) {
  const target = path.resolve(filePath);
  return getAtomicWriteExecutor(target)(async () => {
    const directory = path.dirname(target);
    await fsp.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await replaceFile(temporary, target);
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  });
}

export function atomicWriteJsonSync(filePath, value) {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      const replaceBlocked = process.platform === "win32"
        && error
        && typeof error === "object"
        && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code);
      if (!replaceBlocked) throw error;

      const backup = `${target}.${process.pid}.${randomUUID()}.bak`;
      let movedExisting = false;
      let replacementComplete = false;
      try {
        try {
          fs.renameSync(target, backup);
          movedExisting = true;
        } catch (moveError) {
          if (!moveError || typeof moveError !== "object" || moveError.code !== "ENOENT") {
            throw moveError;
          }
        }
        fs.renameSync(temporary, target);
        replacementComplete = true;
      } catch (replaceError) {
        if (movedExisting) {
          try {
            fs.renameSync(backup, target);
            movedExisting = false;
          } catch {
            // Preserve the backup when automatic recovery is not possible.
          }
        }
        throw replaceError;
      } finally {
        if (movedExisting && replacementComplete) {
          try {
            fs.rmSync(backup, { force: true });
          } catch {
            // Best effort cleanup after successful replacement.
          }
        }
      }
    }
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Best effort cleanup after an interrupted or failed atomic replacement.
    }
  }
}

export function createSerialExecutor() {
  let tail = Promise.resolve();
  return function runSerial(task) {
    const execution = tail.then(task, task);
    tail = execution.catch(() => {});
    return execution;
  };
}

export function redactHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? "[REDACTED]" : value,
    ])
  );
}

export function redactSensitiveValue(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    const redacted = value
      .slice(0, MAX_REDACTION_ITEMS)
      .map((item) => redactSensitiveValue(item, depth + 1));
    if (value.length > MAX_REDACTION_ITEMS) {
      redacted.push(`[TRUNCATED_${value.length - MAX_REDACTION_ITEMS}_ITEMS]`);
    }
    return redacted;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const redacted = Object.fromEntries(
      entries.slice(0, MAX_REDACTION_ITEMS).map(([key, item]) => [
        key,
        isSensitiveFieldName(key) ? "[REDACTED]" : redactSensitiveValue(item, depth + 1),
      ])
    );
    if (entries.length > MAX_REDACTION_ITEMS) {
      redacted._redactionTruncatedKeys = entries.length - MAX_REDACTION_ITEMS;
    }
    return redacted;
  }
  if (typeof value !== "string") return value;
  const redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, "[REDACTED_JWT]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bEAA[A-Za-z0-9]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(
      /((?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|password|refresh[_-]?token|secret|session)=)[^&\s]+/gi,
      "$1[REDACTED]"
    );
  return redacted.length > MAX_REDACTION_STRING_CHARS
    ? `${redacted.slice(0, MAX_REDACTION_STRING_CHARS)}[TRUNCATED]`
    : redacted;
}

export function redactTextPayload(text) {
  const source = String(text ?? "");
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(source)));
  } catch {
    return redactSensitiveValue(source);
  }
}
