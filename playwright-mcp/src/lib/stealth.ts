/**
 * lib/stealth.ts — light "human profile" tweaks for browser_stealth.
 *
 * This is intentionally NOT a full bot-bypass kit. It applies sensible defaults
 * that make a fresh automated browser less obviously automated:
 *  - realistic UA (Chrome stable on Windows)
 *  - viewport 1366x768
 *  - locale pt-BR / timezone America/Sao_Paulo
 *  - navigator.webdriver = undefined
 *  - sane navigator.plugins / languages
 *
 * For heavy anti-bot environments (Cloudflare Turnstile, DataDome, etc.) you
 * need a dedicated stack — out of scope for this MCP.
 */
import type { BrowserContext } from "playwright";
import { config } from "../config.js";

export const HUMAN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface StealthOptions {
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
}

export function stealthContextOptions(opts: StealthOptions = {}) {
  return {
    userAgent: opts.userAgent ?? HUMAN_USER_AGENT,
    locale: opts.locale ?? config.defaultLocale,
    timezoneId: opts.timezoneId ?? config.defaultTimezone,
    viewport: config.defaultViewport,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
  };
}

const STEALTH_INIT_SCRIPT = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch {}
  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
    }
  } catch {}
  try {
    if (!('chrome' in window)) {
      window.chrome = { runtime: {} };
    }
  } catch {}
  try {
    const original = navigator.permissions && navigator.permissions.query;
    if (original) {
      navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : original.call(navigator.permissions, params);
    }
  } catch {}
})();
`;

export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
}
