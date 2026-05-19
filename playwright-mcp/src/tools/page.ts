/**
 * tools/page.ts — page lifecycle and navigation.
 */
import { sessionManager } from "../session-manager.js";
import type { ToolModule } from "../types.js";
import { assertUrlAllowed, assertSelectorAllowed } from "../safety/selectors.js";

const waitUntilEnum = ["load", "domcontentloaded", "networkidle", "commit"];

export const pageTools: ToolModule = {
  defs: [
    {
      name: "page_new",
      description: "Open a new page (tab) in a session or specific context. Returns page_id.",
      annotations: { title: "New page" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["target_id"],
        properties: {
          target_id: { type: "string", description: "session_id (uses default context) or context_id" },
        },
      },
    },
    {
      name: "page_close",
      description: "Close a page.",
      annotations: { title: "Close page", destructiveHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["page_id"],
        properties: { page_id: { type: "string" } },
      },
    },
    {
      name: "page_list",
      description: "List all open pages across all sessions.",
      annotations: { title: "List pages", readOnlyHint: true, idempotentHint: true },
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "page_goto",
      description: "Navigate to URL.",
      annotations: { title: "Go to URL" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          page_id: { type: "string" },
          url: { type: "string" },
          wait_until: { type: "string", enum: waitUntilEnum, default: "load" },
          timeout_ms: { type: "number" },
          referer: { type: "string" },
        },
      },
    },
    {
      name: "page_reload",
      description: "Reload the current page.",
      annotations: { title: "Reload" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          wait_until: { type: "string", enum: waitUntilEnum, default: "load" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_back",
      description: "Navigate back in history.",
      annotations: { title: "Back" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          wait_until: { type: "string", enum: waitUntilEnum, default: "load" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_forward",
      description: "Navigate forward in history.",
      annotations: { title: "Forward" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          wait_until: { type: "string", enum: waitUntilEnum, default: "load" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_wait_for_url",
      description: "Wait until the page URL matches a glob/regex pattern or exact string.",
      annotations: { title: "Wait for URL" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          page_id: { type: "string" },
          url: { type: "string", description: "glob (e.g. **/dashboard) or exact URL or /regex/" },
          timeout_ms: { type: "number" },
          wait_until: { type: "string", enum: waitUntilEnum },
        },
      },
    },
    {
      name: "page_wait_for_selector",
      description: "Wait for a selector to reach a state (visible/hidden/attached/detached).",
      annotations: { title: "Wait for selector" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          page_id: { type: "string" },
          selector: { type: "string" },
          state: { type: "string", enum: ["attached", "detached", "visible", "hidden"], default: "visible" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_wait_for_load_state",
      description: "Wait for a load state.",
      annotations: { title: "Wait for load state" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          state: { type: "string", enum: ["load", "domcontentloaded", "networkidle"], default: "load" },
          timeout_ms: { type: "number" },
        },
      },
    },
  ],

  handlers: {
    async page_new(args) {
      const rec = await sessionManager.newPage(String(args.target_id));
      return { page_id: rec.id, session_id: rec.sessionId, context_id: rec.contextId };
    },
    async page_close(args) {
      const id = String(args.page_id);
      await sessionManager.closePage(id);
      return { closed: id };
    },
    async page_list() {
      const pages = sessionManager.listPages();
      const resolved = await Promise.all(
        pages.map(async (p) => ({
          page_id: p.id,
          session_id: p.sessionId,
          context_id: p.contextId,
          url: p.url,
          title: await p.title.catch(() => ""),
        })),
      );
      return { pages: resolved };
    },
    async page_goto(args) {
      const url = String(args.url);
      assertUrlAllowed(url);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const resp = await rec.page.goto(url, {
        waitUntil: (args.wait_until as "load") ?? "load",
        timeout: args.timeout_ms as number | undefined,
        referer: args.referer as string | undefined,
      });
      return {
        url: rec.page.url(),
        status: resp?.status() ?? null,
        ok: resp?.ok() ?? null,
      };
    },
    async page_reload(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const resp = await rec.page.reload({
        waitUntil: (args.wait_until as "load") ?? "load",
        timeout: args.timeout_ms as number | undefined,
      });
      return { url: rec.page.url(), status: resp?.status() ?? null };
    },
    async page_back(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const resp = await rec.page.goBack({
        waitUntil: (args.wait_until as "load") ?? "load",
        timeout: args.timeout_ms as number | undefined,
      });
      return { url: rec.page.url(), status: resp?.status() ?? null };
    },
    async page_forward(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const resp = await rec.page.goForward({
        waitUntil: (args.wait_until as "load") ?? "load",
        timeout: args.timeout_ms as number | undefined,
      });
      return { url: rec.page.url(), status: resp?.status() ?? null };
    },
    async page_wait_for_url(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const pattern = String(args.url);
      let target: string | RegExp = pattern;
      if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
        const last = pattern.lastIndexOf("/");
        try {
          target = new RegExp(pattern.slice(1, last), pattern.slice(last + 1));
        } catch {
          target = pattern;
        }
      }
      await rec.page.waitForURL(target, {
        timeout: args.timeout_ms as number | undefined,
        waitUntil: args.wait_until as "load" | undefined,
      });
      return { url: rec.page.url() };
    },
    async page_wait_for_selector(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const handle = await rec.page.waitForSelector(selector, {
        state: (args.state as "visible") ?? "visible",
        timeout: args.timeout_ms as number | undefined,
      });
      return { found: !!handle };
    },
    async page_wait_for_load_state(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.waitForLoadState((args.state as "load") ?? "load", {
        timeout: args.timeout_ms as number | undefined,
      });
      return { state: args.state ?? "load", url: rec.page.url() };
    },
  },
};
