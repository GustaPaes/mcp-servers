/**
 * tools/advanced.ts — frame eval, dialog handling, stealth toggle and health check.
 */
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { sessionManager } from "../session-manager.js";
import type { ToolModule } from "../types.js";
import { assertEvalEnabled, checkSafeEval, evalTimeoutMs, withTimeout } from "../safety/safe-eval.js";
import { applyStealth } from "../lib/stealth.js";
import { config } from "../config.js";

interface DialogConfig {
  accept: boolean;
  promptText?: string;
  filterTypes?: ("alert" | "confirm" | "prompt" | "beforeunload")[];
}
const dialogConfigByPage = new Map<string, DialogConfig>();

function detectInstalledBrowsers(): { chromium: boolean; firefox: boolean; webkit: boolean; ms_chromium_dir: string | null } {
  const home = os.homedir();
  const candidates = [
    path.join(home, "AppData", "Local", "ms-playwright"),
    path.join(home, ".cache", "ms-playwright"),
    path.join(home, "Library", "Caches", "ms-playwright"),
  ];
  const dir = candidates.find((p) => existsSync(p)) ?? null;
  const has = (prefix: string) => {
    if (!dir) return false;
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      return fs.readdirSync(dir).some((f) => f.startsWith(prefix));
    } catch {
      return false;
    }
  };
  return {
    chromium: has("chromium"),
    firefox: has("firefox"),
    webkit: has("webkit"),
    ms_chromium_dir: dir,
  };
}

export const advancedTools: ToolModule = {
  defs: [
    {
      name: "page_eval_in_frame",
      description:
        "Evaluate a JS function inside an iframe (selected by name, url substring or zero-based index).",
      annotations: { title: "Evaluate in frame" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["function", "frame"],
        properties: {
          page_id: { type: "string" },
          function: { type: "string" },
          arg: {},
          frame: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              url_contains: { type: "string" },
              index: { type: "number" },
            },
          },
        },
      },
    },
    {
      name: "page_handle_dialog",
      description:
        "Configure how dialogs (alert/confirm/prompt/beforeunload) are handled on this page going forward. Re-call to change.",
      annotations: { title: "Handle dialogs" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["accept"],
        properties: {
          page_id: { type: "string" },
          accept: { type: "boolean" },
          prompt_text: { type: "string" },
          types: {
            type: "array",
            items: { type: "string", enum: ["alert", "confirm", "prompt", "beforeunload"] },
            description: "If specified, only those types are auto-handled (others wait/raise).",
          },
        },
      },
    },
    {
      name: "browser_stealth",
      description:
        "Apply light stealth tweaks (navigator.webdriver=undefined, sane languages, fake chrome.runtime, etc.) on a context. NOT a full anti-bot bypass.",
      annotations: { title: "Stealth tweaks" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: { context_id: { type: "string" } },
      },
    },
    {
      name: "mcp_status",
      description: "Server health: version, browsers installed, sessions/contexts/pages, RAM, uptime.",
      annotations: { title: "Status", readOnlyHint: true, idempotentHint: true },
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
  ],

  handlers: {
    async page_eval_in_frame(args) {
      assertEvalEnabled();
      const source = String(args.function);
      const check = checkSafeEval(source);
      if (!check.ok) throw new Error(`page_eval_in_frame rejected: ${check.reason}`);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const sel = (args.frame ?? {}) as { name?: string; url_contains?: string; index?: number };
      const frames = rec.page.frames();
      let frame = frames.find((f) => {
        if (sel.name && f.name() === sel.name) return true;
        if (sel.url_contains && f.url().includes(sel.url_contains)) return true;
        return false;
      });
      if (!frame && typeof sel.index === "number") frame = frames[sel.index];
      if (!frame) throw new Error("frame not found by name/url_contains/index");
      const fn = new Function("arg", `return (${source})(arg)`) as (arg: unknown) => unknown;
      const evalPromise = frame.evaluate(fn, args.arg ?? null);
      const result = await withTimeout(evalPromise, evalTimeoutMs(), "page_eval_in_frame");
      return { frame_url: frame.url(), frame_name: frame.name(), result };
    },

    async page_handle_dialog(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const cfg: DialogConfig = {
        accept: Boolean(args.accept),
        promptText: args.prompt_text as string | undefined,
        filterTypes: args.types as DialogConfig["filterTypes"],
      };
      const previous = dialogConfigByPage.get(rec.id);
      dialogConfigByPage.set(rec.id, cfg);
      if (!previous) {
        rec.page.on("dialog", async (dialog) => {
          const cur = dialogConfigByPage.get(rec.id);
          if (!cur) {
            await dialog.dismiss().catch(() => {});
            return;
          }
          if (cur.filterTypes && !cur.filterTypes.includes(dialog.type() as "alert")) return;
          if (cur.accept) {
            await dialog.accept(cur.promptText ?? "").catch(() => {});
          } else {
            await dialog.dismiss().catch(() => {});
          }
        });
      }
      return { configured: true, accept: cfg.accept, types: cfg.filterTypes ?? "all" };
    },

    async browser_stealth(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      await applyStealth(ctx.context);
      return { applied: true, context_id: ctx.id };
    },

    async mcp_status() {
      const totals = sessionManager.totals();
      const mem = process.memoryUsage();
      const installed = detectInstalledBrowsers();
      const pkg = await import("../../package.json", { with: { type: "json" } }).then((m) => m.default).catch(() => ({ version: "unknown" }));
      return {
        version: (pkg as { version: string }).version,
        node: process.version,
        platform: process.platform,
        uptime_seconds: Math.round(process.uptime()),
        memory_mb: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heap_used: Math.round(mem.heapUsed / 1024 / 1024),
          heap_total: Math.round(mem.heapTotal / 1024 / 1024),
        },
        sessions: totals.sessions,
        contexts: totals.contexts,
        pages: totals.pages,
        config: {
          max_sessions: config.maxSessions,
          ttl_minutes: config.sessionTtlMinutes,
          default_browser: config.defaultBrowser,
          default_channel: config.defaultChannel || null,
          headless_default: config.defaultHeadless,
          strict: config.strict,
          allow_eval: config.allowEval,
          block_private_networks: config.blockPrivateNetworks,
          allowed_hosts: config.allowedHosts,
          output_dir: config.outputDir,
          max_output_bytes: config.maxOutputBytes,
        },
        browsers_installed: installed,
      };
    },
  },
};
