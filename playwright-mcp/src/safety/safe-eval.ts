/**
 * safety/safe-eval.ts — guardrails for page_evaluate.
 *
 * Playwright runs the function inside the BROWSER, not inside Node, so this
 * isn't a true sandbox — it's a defense-in-depth filter against obvious abuse:
 *  - blocks references to `eval`, dynamic `import(...)`, `Function(...)`, `require(...)`
 *  - blocks Chrome internals (`chrome.webRequest`, `chrome.declarativeNetRequest`)
 *  - enforces a wall-clock timeout per evaluation
 *
 * The function source must be a single arrow/function expression that takes a
 * single `arg` parameter (any JSON-serializable value).
 */
import { config } from "../config.js";

const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bFunction\s*\(\s*['"`]/,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bchrome\s*\.\s*webRequest\b/,
  /\bchrome\s*\.\s*declarativeNetRequest\b/,
];
const STRICT_FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bdocument\s*\.\s*cookie\b/i,
  /\bdocument\s*\[\s*['"`]cookie['"`]\s*\]/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\bindexedDB\b/i,
  /\b(?:window|globalThis|self)\s*\[\s*['"`](?:localStorage|sessionStorage|indexedDB)['"`]\s*\]/i,
];

export interface SafeEvalCheck {
  ok: boolean;
  reason?: string;
}

export function checkSafeEval(source: string): SafeEvalCheck {
  if (typeof source !== "string" || source.trim() === "") {
    return { ok: false, reason: "function source must be a non-empty string" };
  }
  if (source.length > 50_000) {
    return { ok: false, reason: "function source exceeds 50_000 characters" };
  }
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(source)) {
      return { ok: false, reason: `forbidden token matched: ${pat}` };
    }
  }
  if (config.strict) {
    for (const pat of STRICT_FORBIDDEN_PATTERNS) {
      if (pat.test(source)) {
        return { ok: false, reason: `sensitive browser storage access matched: ${pat}` };
      }
    }
  }
  // Must look like an arrow fn or `function`. Be permissive but require parens.
  const looksCallable = /^\s*(?:async\s+)?(?:\([\s\S]*?\)\s*=>|function\b|\([\s\S]*?\)\s*=>)/.test(source);
  if (!looksCallable) {
    return { ok: false, reason: "source must be an arrow function or function expression" };
  }
  return { ok: true };
}

export const evalTimeoutMs = (): number => config.evalTimeoutMs;

export function assertEvalEnabled(): void {
  if (!config.allowEval) {
    throw new Error("page evaluation is disabled by default; set PWMCP_ALLOW_EVAL=true only for a trusted local client");
  }
}

/** Race a promise against a timeout, rejecting if the timeout wins. */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
