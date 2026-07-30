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

const SENSITIVE_FIELD_PATTERN =
  /(?:^|[_-])(?:access[_-]?token|api[_-]?key|authorization|cookie|password|refresh[_-]?token|secret|session)(?:$|[_-])/i;
const atomicWriteExecutors = new Map();

export function assertSafeIdentifier(value, label = "id") {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new Error(`${label} must contain only letters, numbers, "_" or "-"`);
  }
  return normalized;
}

export function resolveInside(root, ...segments) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...segments);
  const baseKey = process.platform === "win32" ? base.toLowerCase() : base;
  const candidateKey = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  if (candidateKey !== baseKey && !candidateKey.startsWith(`${baseKey}${path.sep}`)) {
    throw new Error("path escapes the configured root");
  }
  return candidate;
}

export function resolveInsideAny(roots, input, { createRoot = false } = {}) {
  const candidate = path.resolve(String(input ?? ""));
  const candidateKey = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  for (const rootValue of roots) {
    const root = path.resolve(rootValue);
    if (createRoot) fs.mkdirSync(root, { recursive: true });
    const rootKey = process.platform === "win32" ? root.toLowerCase() : root;
    if (candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`)) {
      return candidate;
    }
  }
  throw new Error("path is outside the configured allowed roots");
}

function getAtomicWriteExecutor(target) {
  let executor = atomicWriteExecutors.get(target);
  if (!executor) {
    executor = createSerialExecutor();
    atomicWriteExecutors.set(target, executor);
  }
  return executor;
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
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key) ? "[REDACTED]" : redactSensitiveValue(item, depth + 1),
      ])
    );
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /((?:access[_-]?token|api[_-]?key|password|refresh[_-]?token|secret|session)=)[^&\s]+/gi,
      "$1[REDACTED]"
    );
}

export function redactTextPayload(text) {
  const source = String(text ?? "");
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(source)));
  } catch {
    return redactSensitiveValue(source);
  }
}
