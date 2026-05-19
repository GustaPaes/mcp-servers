/**
 * safety/selectors.ts — selector and URL guardrails.
 *
 * In strict mode, refuse navigation/interaction with privileged URLs and
 * selectors that obviously target browser-internal pages.
 */
import { config } from "../config.js";

const BLOCKED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "view-source:",
  "devtools://",
];

export function assertUrlAllowed(url: string): void {
  if (!config.strict) return;
  const lower = url.trim().toLowerCase();
  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lower.startsWith(prefix)) {
      throw new Error(`URL blocked by strict mode: ${prefix} scheme not allowed`);
    }
  }
  if (lower.startsWith("file://")) {
    throw new Error("file:// URLs are blocked by strict mode");
  }
}

export function assertSelectorAllowed(selector: string): void {
  if (!config.strict) return;
  // Playwright supports text=, css=, xpath=, role=, etc. The only worry here
  // is users embedding inline scripts via a URL-like selector — bail if it
  // smells like a privileged scheme.
  const lower = selector.toLowerCase();
  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lower.includes(prefix)) {
      throw new Error(`Selector blocked by strict mode: contains ${prefix}`);
    }
  }
}
