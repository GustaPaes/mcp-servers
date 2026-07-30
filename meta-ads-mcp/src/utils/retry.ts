/**
 * Generic retry with exponential backoff and full jitter.
 *
 * Respects Retry-After when provided by the caller's shouldRetry function.
 */
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  /** Decide whether `err` is retryable. May return a forced delay (ms). */
  shouldRetry: (err: unknown, attempt: number) => { retry: boolean; delayMs?: number };
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let attempt = 0;
   
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const decision = opts.shouldRetry(err, attempt);
      if (!decision.retry || attempt >= opts.maxRetries) throw err;
      const expDelay = opts.baseDelayMs * 2 ** attempt;
      const jittered = Math.floor(Math.random() * expDelay);
      const delay = decision.delayMs ?? Math.max(opts.baseDelayMs, jittered);
      opts.onRetry?.(err, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}
