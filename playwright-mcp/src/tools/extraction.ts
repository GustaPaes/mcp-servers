/**
 * tools/extraction.ts — read state from the page.
 */
import { sessionManager } from "../session-manager.js";
import type { ToolModule } from "../types.js";
import { assertSelectorAllowed } from "../safety/selectors.js";
import { assertEvalEnabled, checkSafeEval, evalTimeoutMs, withTimeout } from "../safety/safe-eval.js";
import { config } from "../config.js";

export const extractionTools: ToolModule = {
  defs: [
    {
      name: "page_console_messages",
      description:
        "Return console messages and page errors captured for a page. Useful for diagnosing frontend failures without reading screenshots.",
      annotations: { title: "Console messages", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          level: { type: "string", enum: ["all", "error", "warning", "info", "debug"], default: "all" },
          limit: { type: "number", default: 100 },
        },
      },
    },
    {
      name: "page_text_content",
      description: "Return the textContent of the first element matching selector.",
      annotations: { title: "Text content", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          page_id: { type: "string" },
          selector: { type: "string" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_inner_text",
      description: "Return innerText (rendered text) of the first element matching selector.",
      annotations: { title: "Inner text", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          page_id: { type: "string" },
          selector: { type: "string" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_inner_html",
      description: "Return innerHTML of the first element matching selector.",
      annotations: { title: "Inner HTML", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          page_id: { type: "string" },
          selector: { type: "string" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_get_attribute",
      description: "Return the value of an HTML attribute of the first matching element.",
      annotations: { title: "Get attribute", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector", "name"],
        properties: {
          page_id: { type: "string" },
          selector: { type: "string" },
          name: { type: "string" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_evaluate",
      description:
        "Evaluate a JS function in the page context. The function source must be an arrow function or function expression and may take one JSON-serializable argument. eval/import/Function are blocked. Timeout: PWMCP_EVAL_TIMEOUT_MS.",
      annotations: { title: "Evaluate JS" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["function"],
        properties: {
          page_id: { type: "string" },
          function: { type: "string", description: "e.g. (arg) => document.title.length" },
          arg: { description: "Optional JSON-serializable argument" },
        },
      },
    },
    {
      name: "page_query_selector_all",
      description:
        "Return up to N elements matching selector with their tag, text and bounding box. Useful for scanning a page.",
      annotations: { title: "Query selector all", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          page_id: { type: "string" },
          selector: { type: "string" },
          limit: { type: "number", default: 50 },
        },
      },
    },
    {
      name: "page_accessibility_snapshot",
      description:
        "Capture an ARIA snapshot of the page (YAML, optimized for LLMs). Includes element refs like [ref=e2] in 'ai' mode, plus iframe contents. Much more compact than HTML or screenshots.",
      annotations: { title: "Accessibility snapshot", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          mode: { type: "string", enum: ["ai", "default"], default: "ai" },
          root_selector: { type: "string", description: "Limit snapshot to a subtree" },
          max_depth: { type: "number", description: "0 = unlimited (default)" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_get_url",
      description: "Return current URL.",
      annotations: { title: "Get URL", readOnlyHint: true, idempotentHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { page_id: { type: "string" } },
      },
    },
    {
      name: "page_get_title",
      description: "Return current document title.",
      annotations: { title: "Get title", readOnlyHint: true, idempotentHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { page_id: { type: "string" } },
      },
    },
    {
      name: "page_get_cookies",
      description: "Return cookies for the page (or specific URLs).",
      annotations: { title: "Get cookies", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          urls: { type: "array", items: { type: "string" } },
          reveal_values: {
            type: "boolean",
            default: false,
            description: "Reveal cookie values only when PWMCP_ALLOW_SECRET_REVEAL=true.",
          },
        },
      },
    },
  ],

  handlers: {
    async page_console_messages(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const level = String(args.level ?? "all");
      const limit = (args.limit as number | undefined) ?? 100;
      const severity: Record<string, number> = {
        pageerror: 50,
        error: 40,
        warning: 30,
        warn: 30,
        info: 20,
        log: 20,
        debug: 10,
      };
      const min = level === "all" ? 0 : severity[level] ?? 0;
      const messages = rec.consoleMessages
        .filter((m) => (severity[m.type] ?? 20) >= min)
        .slice(-Math.max(1, limit));
      return { page_id: rec.id, count: messages.length, messages };
    },
    async page_text_content(args) {
      const sel = String(args.selector);
      assertSelectorAllowed(sel);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const text = await rec.page.textContent(sel, { timeout: args.timeout_ms as number | undefined });
      return { selector: sel, text };
    },
    async page_inner_text(args) {
      const sel = String(args.selector);
      assertSelectorAllowed(sel);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const text = await rec.page.innerText(sel, { timeout: args.timeout_ms as number | undefined });
      return { selector: sel, text };
    },
    async page_inner_html(args) {
      const sel = String(args.selector);
      assertSelectorAllowed(sel);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const html = await rec.page.innerHTML(sel, { timeout: args.timeout_ms as number | undefined });
      return { selector: sel, html };
    },
    async page_get_attribute(args) {
      const sel = String(args.selector);
      assertSelectorAllowed(sel);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const value = await rec.page.getAttribute(sel, String(args.name), {
        timeout: args.timeout_ms as number | undefined,
      });
      return { selector: sel, name: args.name, value };
    },
    async page_evaluate(args) {
      assertEvalEnabled();
      const source = String(args.function);
      const check = checkSafeEval(source);
      if (!check.ok) throw new Error(`page_evaluate rejected: ${check.reason}`);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      // Pass the source as a STRING. Playwright will compile it inside the page.
      // arg must be serializable; Playwright handles JSON.
      const evalPromise = rec.page.evaluate(
        // eslint-disable-next-line no-new-func
        new Function("arg", `return (${source})(arg)`) as (arg: unknown) => unknown,
        args.arg ?? null,
      );
      const result = await withTimeout(evalPromise, evalTimeoutMs(), "page_evaluate");
      return { result };
    },
    async page_query_selector_all(args) {
      const sel = String(args.selector);
      assertSelectorAllowed(sel);
      const limit = (args.limit as number | undefined) ?? 50;
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const items = await rec.page.$$eval(
        sel,
        (els: Element[], cap: number) =>
          els.slice(0, cap).map((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              id: (el as HTMLElement).id || null,
              cls: (el as HTMLElement).className || null,
              text: ((el as HTMLElement).innerText || el.textContent || "").trim().slice(0, 200),
              bbox: { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 },
            };
          }),
        limit,
      );
      return { selector: sel, count: items.length, items };
    },
    async page_accessibility_snapshot(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const opts = {
        mode: ((args.mode as "ai" | "default" | undefined) ?? "ai"),
        depth: args.max_depth as number | undefined,
        timeout: args.timeout_ms as number | undefined,
      };
      const target = args.root_selector
        ? rec.page.locator(String(args.root_selector))
        : rec.page.locator("body");
      const yaml = await target.ariaSnapshot(opts);
      return { mode: opts.mode, root: (args.root_selector as string | undefined) ?? "body", yaml };
    },
    async page_get_url(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      return { url: rec.page.url() };
    },
    async page_get_title(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      return { title: await rec.page.title() };
    },
    async page_get_cookies(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const ctx = sessionManager.requireContext(rec.contextId).ctx;
      const cookies = await ctx.context.cookies(args.urls as string[] | undefined);
      const reveal = Boolean(args.reveal_values);
      if (reveal && !config.allowSecretReveal) {
        throw new Error("cookie value reveal requires PWMCP_ALLOW_SECRET_REVEAL=true");
      }
      return {
        count: cookies.length,
        cookies: reveal ? cookies : cookies.map((cookie) => ({ ...cookie, value: "[REDACTED]" })),
      };
    },
  },
};
