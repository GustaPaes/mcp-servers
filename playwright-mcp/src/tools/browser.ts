/**
 * tools/browser.ts — session and context lifecycle.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveInsideAny } from "@gustapaes/mcp-runtime";
import { sessionManager } from "../session-manager.js";
import type { BrowserChannel, BrowserName, ToolModule } from "../types.js";
import { outputPath } from "../output-dir.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { assertUrlAllowed } from "../safety/selectors.js";

const browserEnum = ["chromium", "firefox", "webkit"];
const channelEnum = ["", "chrome", "chrome-beta", "chrome-dev", "chrome-canary", "msedge", "msedge-beta", "msedge-dev", "msedge-canary"];
const FORBIDDEN_STRICT_ARGS = [
  "--disable-web-security",
  "--host-resolver-rules",
  "--load-extension",
  "--proxy-server",
  "--remote-debugging-address",
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--user-data-dir",
];

export function assertLaunchArgsAllowed(args: string[]): void {
  if (!config.strict) return;
  const blocked = args.find((arg) => FORBIDDEN_STRICT_ARGS.some((prefix) => arg.toLowerCase().startsWith(prefix)));
  if (blocked) throw new Error(`browser argument is blocked in strict mode: ${blocked.split("=")[0]}`);
}

function storagePath(input: string): string {
  return outputPath("storage", input);
}

export function resolveProfilePath(input: string): string {
  const candidate = path.resolve(config.repoRoot, input);
  return resolveInsideAny(config.allowedProfileRoots, candidate, { createRoot: true });
}

export const browserTools: ToolModule = {
  defs: [
    {
      name: "browser_launch",
      description:
        "Launch a new browser session. Returns a session_id you must keep and pass to subsequent tools. Defaults come from PWMCP_DEFAULT_* env vars.",
      annotations: { title: "Launch browser", readOnlyHint: false, idempotentHint: false },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          browser: { type: "string", enum: browserEnum, description: "Engine to launch (default: chromium)" },
          channel: { type: "string", enum: channelEnum, description: "Native channel for chromium (chrome/msedge/...)" },
          headless: { type: "boolean", description: "Run headless (default from env)" },
          user_data_dir: { type: "string", description: "Persistent profile directory (cookies/login survive restarts)" },
          viewport: {
            type: "object",
            additionalProperties: false,
            properties: { width: { type: "number" }, height: { type: "number" } },
            required: ["width", "height"],
          },
          locale: { type: "string", description: "e.g. pt-BR, en-US" },
          timezone_id: { type: "string", description: "IANA timezone, e.g. America/Sao_Paulo" },
          proxy: {
            type: "object",
            additionalProperties: false,
            properties: {
              server: { type: "string" },
              bypass: { type: "string" },
              username: { type: "string" },
              password: { type: "string" },
            },
            required: ["server"],
          },
          args: { type: "array", items: { type: "string" }, description: "Extra browser CLI args" },
          ignore_https_errors: { type: "boolean" },
          extra_http_headers: { type: "object", additionalProperties: { type: "string" } },
          stealth: { type: "boolean", description: "Apply light stealth tweaks (UA, navigator.webdriver, etc.)" },
        },
      },
    },
    {
      name: "browser_close",
      description: "Close a browser session and free its resources.",
      annotations: { title: "Close browser", destructiveHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["session_id"],
        properties: { session_id: { type: "string" } },
      },
    },
    {
      name: "browser_list",
      description: "List all active browser sessions with their contexts/pages and idle time.",
      annotations: { title: "List sessions", readOnlyHint: true, idempotentHint: true },
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "context_new",
      description:
        "Open a new isolated BrowserContext within an existing session. Useful for parallel logged-in identities.",
      annotations: { title: "New context" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["session_id"],
        properties: {
          session_id: { type: "string" },
          viewport: {
            type: "object",
            additionalProperties: false,
            properties: { width: { type: "number" }, height: { type: "number" } },
            required: ["width", "height"],
          },
          locale: { type: "string" },
          timezone_id: { type: "string" },
          user_agent: { type: "string" },
          storage_state_path: { type: "string", description: "Load cookies+localStorage from this JSON file" },
          record_video: { type: "boolean" },
          record_har: { type: "boolean" },
          ignore_https_errors: { type: "boolean" },
          stealth: { type: "boolean" },
        },
      },
    },
    {
      name: "context_close",
      description: "Close a single BrowserContext (its pages will close too).",
      annotations: { title: "Close context", destructiveHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: { context_id: { type: "string" } },
      },
    },
    {
      name: "context_storage_state",
      description:
        "Save (mode=save) or load (mode=load) cookies + localStorage of a context. Used to persist login between runs.",
      annotations: { title: "Storage state" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id", "mode"],
        properties: {
          context_id: { type: "string" },
          mode: { type: "string", enum: ["save", "load"] },
          path: {
            type: "string",
            description: "File path. For save: defaults to <output>/storage/<context>-<ts>.json. For load: required.",
          },
        },
      },
    },
    {
      name: "browser_install",
      description:
        "Run `npx playwright install <browser>` to install browser binaries on the host. Returns the command output.",
      annotations: { title: "Install browser binaries", readOnlyHint: false, idempotentHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          browser: { type: "string", enum: ["chromium", "firefox", "webkit", "all"], default: "chromium" },
          with_deps: { type: "boolean", description: "Use --with-deps (Linux only effectively)" },
        },
      },
    },
  ],

  handlers: {
    async browser_launch(args) {
      const launchArgs = args.args as string[] | undefined;
      assertLaunchArgsAllowed(launchArgs ?? []);
      const proxy = args.proxy as { server: string } | undefined;
      if (proxy?.server) await assertUrlAllowed(proxy.server);
      const session = await sessionManager.launch({
        browser: args.browser as BrowserName | undefined,
        channel: args.channel as BrowserChannel | undefined,
        headless: args.headless as boolean | undefined,
        userDataDir: args.user_data_dir ? resolveProfilePath(String(args.user_data_dir)) : undefined,
        viewport: args.viewport as { width: number; height: number } | undefined,
        locale: args.locale as string | undefined,
        timezoneId: args.timezone_id as string | undefined,
        proxy,
        args: launchArgs,
        ignoreHttpsErrors: args.ignore_https_errors as boolean | undefined,
        extraHttpHeaders: args.extra_http_headers as Record<string, string> | undefined,
        stealth: args.stealth as boolean | undefined,
      });
      const defaultCtx = [...session.contexts.values()][0];
      return {
        session_id: session.id,
        browser: session.browserName,
        channel: session.channel || null,
        headless: session.headless,
        persistent: session.isPersistent,
        default_context_id: defaultCtx?.id ?? null,
      };
    },

    async browser_close(args) {
      const id = String(args.session_id);
      await sessionManager.closeSession(id);
      return { closed: id };
    },

    async browser_list() {
      return { sessions: sessionManager.list() };
    },

    async context_new(args) {
      const ctx = await sessionManager.newContext({
        sessionId: String(args.session_id),
        viewport: args.viewport as { width: number; height: number } | undefined,
        locale: args.locale as string | undefined,
        timezoneId: args.timezone_id as string | undefined,
        userAgent: args.user_agent as string | undefined,
        storageStatePath: args.storage_state_path ? storagePath(String(args.storage_state_path)) : undefined,
        recordVideo: args.record_video as boolean | undefined,
        recordHar: args.record_har as boolean | undefined,
        ignoreHttpsErrors: args.ignore_https_errors as boolean | undefined,
        stealth: args.stealth as boolean | undefined,
      });
      return {
        context_id: ctx.id,
        session_id: ctx.sessionId,
        recording: {
          har: ctx.recording.har?.path ?? null,
          video_dir: ctx.recording.video?.dir ?? null,
        },
      };
    },

    async context_close(args) {
      const id = String(args.context_id);
      await sessionManager.closeContext(id);
      return { closed: id };
    },

    async context_storage_state(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      const mode = String(args.mode);
      if (mode === "save") {
        const file =
          args.path
            ? storagePath(String(args.path))
            : outputPath("storage", `${ctx.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
        const state = await ctx.context.storageState({ path: file });
        return {
          saved: true,
          path: file,
          cookies: state.cookies.length,
          origins: state.origins.length,
        };
      }
      if (mode === "load") {
        const file = args.path ? storagePath(String(args.path)) : undefined;
        if (!file) throw new Error("path is required when mode=load");
        const raw = await fs.readFile(file, "utf8");
        const state = JSON.parse(raw) as { cookies?: unknown[]; origins?: unknown[] };
        // Inject cookies. Origins (localStorage) require a fresh context to apply pre-navigation;
        // we set cookies here and warn the caller that localStorage needs context_new(storage_state_path).
        if (Array.isArray(state.cookies)) {
          await ctx.context.addCookies(state.cookies as Parameters<typeof ctx.context.addCookies>[0]);
        }
        return {
          loaded: true,
          path: file,
          cookies: state.cookies?.length ?? 0,
          note: "localStorage origins are only restored when passed via context_new(storage_state_path).",
        };
      }
      throw new Error(`unknown mode: ${mode}`);
    },

    async browser_install(args) {
      if (!config.allowBrowserInstall) {
        throw new Error(
          "browser_install is disabled. Set PWMCP_ALLOW_BROWSER_INSTALL=true and restart the server to enable host changes.",
        );
      }
      const target = String(args.browser ?? "chromium");
      const cliArgs = ["playwright", "install"];
      if (args.with_deps) cliArgs.push("--with-deps");
      if (target !== "all") cliArgs.push(target);
      logger.info({ target }, "browser_install starting");
      return new Promise((resolve, reject) => {
        const child = spawn("npx", cliArgs, {
          shell: process.platform === "win32",
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({
            exit_code: code,
            command: `npx ${cliArgs.join(" ")}`,
            stdout: stdout.slice(-8000),
            stderr: stderr.slice(-8000),
          });
        });
      });
    },
  },
};

// Side helper to keep TS importing path used: ensure path module is referenced when log
void path;
