/**
 * lib/retry.ts — small retry helper with fixed backoff steps.
 *
 * Used internally for actions where Playwright's own auto-waiting isn't enough
 * (e.g. resolving a selector that flickers in and out of the DOM).
 */
import { logger } from "../logger.js";

const DEFAULT_BACKOFF_MS = [200, 500, 1000];

export interface RetryOptions {
  attempts?: number;
  backoffMs?: number[];
  label?: string;
  shouldRetry?: (err: unknown) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const attempts = opts.attempts ?? backoff.length + 1;
  const label = opts.label ?? "retry";
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err)) break;
      const wait = backoff[Math.min(i, backoff.length - 1)] ?? 1000;
      logger.debug({ label, attempt: i + 1, wait, err: (err as Error).message }, "retrying");
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
