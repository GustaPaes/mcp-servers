/**
 * Exponential backoff retry helper with jitter.
 * Retries on 429, 5xx and transient network errors.
 */
const TRANSIENT_CODES = new Set([429, 500, 502, 503, 504]);

export async function withRetry(fn, { retries = 4, baseMs = 300 } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.statusCode ?? err.status;
      const transient = TRANSIENT_CODES.has(status) || /ECONN|ETIMEDOUT|EAI_AGAIN/i.test(err.code ?? "");
      if (!transient || attempt === retries) throw err;
      const delay = baseMs * 2 ** attempt + Math.random() * baseMs;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
  throw lastErr;
}
