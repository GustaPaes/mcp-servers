/**
 * Exponential backoff retry helper with jitter.
 * Retries on 429, 5xx and transient network errors.
 */
const TRANSIENT_CODES = new Set([429, 500, 502, 503, 504]);
import { config } from "../config.js";

function retryAfterMs(error) {
  const raw = error?.retryAfter
    ?? error?.headers?.["retry-after"]
    ?? error?.response?.headers?.get?.("retry-after");
  if (raw == null) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function withTimeout(fn, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`OCI request exceeded ${timeoutMs} ms`);
          error.code = "ETIMEDOUT";
          reject(error);
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withRetry(
  fn,
  { retries = 4, baseMs = 300, timeoutMs = config.requestTimeoutMs } = {}
) {
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
    throw new Error("retries must be an integer between 0 and 10");
  }
  if (!Number.isInteger(baseMs) || baseMs < 50 || baseMs > 5_000) {
    throw new Error("baseMs must be an integer between 50 and 5000");
  }
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      return await withTimeout(fn, timeoutMs);
    } catch (err) {
      lastErr = err;
      const status = err.statusCode ?? err.status;
      const transient = TRANSIENT_CODES.has(status) || /ECONN|ETIMEDOUT|EAI_AGAIN/i.test(err.code ?? "");
      if (!transient || attempt === retries) throw err;
      const delay = Math.min(
        30_000,
        Math.max(retryAfterMs(err), baseMs * 2 ** attempt + Math.random() * baseMs)
      );
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
  throw lastErr;
}
