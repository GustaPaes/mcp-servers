/**
 * session-manager.ts — pool of browsers / contexts / pages with TTL & limits.
 *
 * Sessions are kept in-memory. A sweep timer auto-closes idle sessions
 * (config.sessionTtlMinutes). At process shutdown all sessions are closed.
 *
 * One "session" = one launched Browser instance (or persistent context). It
 * may host multiple BrowserContexts, each with multiple Pages.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type {
  BrowserName,
  BrowserChannel,
  ContextRecord,
  PageRecord,
  SessionRecord,
} from "./types.js";
import { applyStealth, stealthContextOptions } from "./lib/stealth.js";
import { ensureOutputDir, outputPath, timestamp } from "./output-dir.js";

const ENGINES = { chromium, firefox, webkit } as const;

export interface LaunchSpec {
  browser?: BrowserName;
  channel?: BrowserChannel;
  headless?: boolean;
  userDataDir?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  proxy?: { server: string; bypass?: string; username?: string; password?: string };
  args?: string[];
  ignoreHttpsErrors?: boolean;
  extraHttpHeaders?: Record<string, string>;
  stealth?: boolean;
}

export interface NewContextSpec {
  sessionId: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
  userAgent?: string;
  storageStatePath?: string;
  recordVideo?: boolean;
  recordHar?: boolean;
  ignoreHttpsErrors?: boolean;
  stealth?: boolean;
}

class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  start(): void {
    if (this.sweepTimer || config.sessionTtlMinutes <= 0) return;
    const interval = Math.max(5, config.sessionSweepIntervalSeconds) * 1000;
    this.sweepTimer = setInterval(() => this.sweep().catch((e) => logger.warn({ err: e }, "sweep failed")), interval);
    this.sweepTimer.unref?.();
    logger.info({ ttlMinutes: config.sessionTtlMinutes, intervalSec: interval / 1000 }, "session sweep started");
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.closeSession(id)));
  }

  // --------------------------------------------------------- launch / close
  async launch(spec: LaunchSpec): Promise<SessionRecord> {
    if (this.sessions.size >= config.maxSessions) {
      throw new Error(
        `max sessions reached (${config.maxSessions}). Close one with browser_close before launching another.`,
      );
    }
    const browserName: BrowserName = spec.browser ?? config.defaultBrowser;
    const engine = ENGINES[browserName];
    if (!engine) throw new Error(`unsupported browser: ${browserName}`);

    const channel: BrowserChannel =
      ((spec.channel ?? config.defaultChannel) as BrowserChannel) || "";
    const headless = spec.headless ?? config.defaultHeadless;
    const id = `s_${randomUUID().slice(0, 8)}`;

    const launchOptions: LaunchOptions = {
      headless,
      args: spec.args,
      proxy: spec.proxy,
    };
    if (channel && browserName === "chromium") launchOptions.channel = channel;

    const contextOptions: BrowserContextOptions = {
      viewport: spec.viewport ?? config.defaultViewport,
      locale: spec.locale ?? config.defaultLocale,
      timezoneId: spec.timezoneId ?? config.defaultTimezone,
      ignoreHTTPSErrors: spec.ignoreHttpsErrors ?? false,
      extraHTTPHeaders: spec.extraHttpHeaders,
    };

    let browser: Browser;
    let isPersistent = false;
    let userDataDir: string | undefined;

    if (spec.userDataDir) {
      // Persistent context: launch returns a BrowserContext, but we need a Browser
      // handle for symmetry. Playwright exposes context.browser() — for chromium
      // persistent it returns null, so we wrap. We model persistent specially.
      userDataDir = path.resolve(spec.userDataDir);
      const persistentCtx = await engine.launchPersistentContext(userDataDir, {
        ...launchOptions,
        ...contextOptions,
      });
      isPersistent = true;
      // Synthesize a Browser-like wrapper using the actual context
      browser = persistentCtx.browser() ?? (persistentCtx as unknown as Browser);
      const session: SessionRecord = {
        id,
        browser,
        browserName,
        channel,
        headless,
        isPersistent,
        userDataDir,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        contexts: new Map(),
      };
      // Register the persistent context as the default context.
      const ctxRec = await this.registerContext(session, persistentCtx);
      // Adopt any pre-existing pages
      for (const page of persistentCtx.pages()) this.registerPage(ctxRec, page);
      // close listener — when the persistent context dies, the session dies
      persistentCtx.on("close", () => {
        if (this.shuttingDown) return;
        this.sessions.delete(id);
        logger.info({ sessionId: id }, "persistent session closed by browser");
      });
      this.sessions.set(id, session);
      logger.info({ id, browser: browserName, channel, persistent: true }, "session launched");
      return session;
    }

    browser = await engine.launch(launchOptions);
    const session: SessionRecord = {
      id,
      browser,
      browserName,
      channel,
      headless,
      isPersistent,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      contexts: new Map(),
    };
    // Default context for convenience
    const defaultCtx = await browser.newContext(contextOptions);
    if (spec.stealth) await applyStealth(defaultCtx);
    await this.registerContext(session, defaultCtx);

    browser.on("disconnected", () => {
      if (this.shuttingDown) return;
      this.sessions.delete(id);
      logger.info({ sessionId: id }, "browser disconnected");
    });

    this.sessions.set(id, session);
    logger.info({ id, browser: browserName, channel, headless }, "session launched");
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    try {
      // Close all contexts gracefully (stop tracing/HAR/video first)
      for (const ctx of s.contexts.values()) {
        try {
          if (ctx.recording.tracing?.active && ctx.recording.tracing.outputPath) {
            await ctx.context.tracing.stop({ path: ctx.recording.tracing.outputPath }).catch(() => {});
          }
        } catch {}
        try {
          await ctx.context.close();
        } catch {}
      }
      try {
        // For persistent sessions, browser is actually the context — close() works on both
        await (s.browser as unknown as { close: () => Promise<void> }).close();
      } catch {}
    } finally {
      logger.info({ sessionId }, "session closed");
    }
  }

  list(): Array<{
    id: string;
    browser: BrowserName;
    channel: BrowserChannel;
    headless: boolean;
    persistent: boolean;
    contexts: number;
    pages: number;
    createdAt: string;
    lastUsedAt: string;
    idleMs: number;
  }> {
    const now = Date.now();
    return [...this.sessions.values()].map((s) => {
      const pages = [...s.contexts.values()].reduce((acc, c) => acc + c.pages.size, 0);
      return {
        id: s.id,
        browser: s.browserName,
        channel: s.channel,
        headless: s.headless,
        persistent: s.isPersistent,
        contexts: s.contexts.size,
        pages,
        createdAt: new Date(s.createdAt).toISOString(),
        lastUsedAt: new Date(s.lastUsedAt).toISOString(),
        idleMs: now - s.lastUsedAt,
      };
    });
  }

  // --------------------------------------------------------- contexts / pages
  async newContext(spec: NewContextSpec): Promise<ContextRecord> {
    const session = this.requireSession(spec.sessionId);
    if (session.isPersistent) {
      throw new Error(
        "cannot create a new context inside a persistent session (use the existing default context).",
      );
    }
    const opts: BrowserContextOptions = {
      viewport: spec.viewport ?? config.defaultViewport,
      locale: spec.locale ?? config.defaultLocale,
      timezoneId: spec.timezoneId ?? config.defaultTimezone,
      userAgent: spec.userAgent,
      storageState: spec.storageStatePath,
      ignoreHTTPSErrors: spec.ignoreHttpsErrors,
    };
    if (spec.recordVideo) {
      ensureOutputDir();
      opts.recordVideo = { dir: outputPath("videos", session.id) };
    }
    if (spec.recordHar) {
      ensureOutputDir();
      const harPath = outputPath("har", `${session.id}-${timestamp()}.har`);
      opts.recordHar = { path: harPath, content: "embed" };
    }
    if (spec.stealth) {
      Object.assign(opts, stealthContextOptions({}));
    }

    const ctx = await session.browser.newContext(opts);
    if (spec.stealth) await applyStealth(ctx);
    const rec = await this.registerContext(session, ctx);
    if (spec.recordVideo) rec.recording.video = { dir: outputPath("videos", session.id) };
    if (spec.recordHar && opts.recordHar) rec.recording.har = { path: opts.recordHar.path };
    return rec;
  }

  async closeContext(contextId: string): Promise<void> {
    const { session, ctx } = this.requireContext(contextId);
    if (session.isPersistent && session.contexts.size === 1) {
      throw new Error("cannot close the last context of a persistent session — close the session instead");
    }
    try {
      if (ctx.recording.tracing?.active && ctx.recording.tracing.outputPath) {
        await ctx.context.tracing.stop({ path: ctx.recording.tracing.outputPath }).catch(() => {});
      }
      await ctx.context.close();
    } finally {
      session.contexts.delete(contextId);
    }
  }

  async newPage(sessionOrContextId: string): Promise<PageRecord> {
    // Accept either a session id (creates page in default context) or a context id.
    const ctx =
      this.findContext(sessionOrContextId) ??
      this.findDefaultContext(sessionOrContextId);
    if (!ctx) throw new Error(`session or context not found: ${sessionOrContextId}`);
    const page = await ctx.context.newPage();
    return this.registerPage(ctx, page);
  }

  async closePage(pageId: string): Promise<void> {
    const { ctx, page } = this.requirePage(pageId);
    await page.page.close();
    ctx.pages.delete(pageId);
  }

  // --------------------------------------------------------- lookups
  requireSession(sessionId: string): SessionRecord {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`session not found: ${sessionId}`);
    s.lastUsedAt = Date.now();
    return s;
  }

  findContext(contextId: string): ContextRecord | undefined {
    for (const s of this.sessions.values()) {
      const c = s.contexts.get(contextId);
      if (c) {
        s.lastUsedAt = Date.now();
        c.lastUsedAt = Date.now();
        return c;
      }
    }
    return undefined;
  }

  findDefaultContext(sessionId: string): ContextRecord | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    const first = s.contexts.values().next().value as ContextRecord | undefined;
    if (first) {
      s.lastUsedAt = Date.now();
      first.lastUsedAt = Date.now();
    }
    return first;
  }

  requireContext(contextId: string): { session: SessionRecord; ctx: ContextRecord } {
    for (const s of this.sessions.values()) {
      const c = s.contexts.get(contextId);
      if (c) {
        s.lastUsedAt = Date.now();
        c.lastUsedAt = Date.now();
        return { session: s, ctx: c };
      }
    }
    throw new Error(`context not found: ${contextId}`);
  }

  requirePage(pageId: string): { session: SessionRecord; ctx: ContextRecord; page: PageRecord } {
    for (const s of this.sessions.values()) {
      for (const c of s.contexts.values()) {
        const p = c.pages.get(pageId);
        if (p) {
          s.lastUsedAt = Date.now();
          c.lastUsedAt = Date.now();
          p.lastUsedAt = Date.now();
          return { session: s, ctx: c, page: p };
        }
      }
    }
    throw new Error(`page not found: ${pageId}`);
  }

  /** Resolve target page by id, or default to the most recently used page anywhere. */
  resolvePage(pageId?: string): PageRecord {
    if (pageId) return this.requirePage(pageId).page;
    let best: PageRecord | undefined;
    for (const s of this.sessions.values()) {
      for (const c of s.contexts.values()) {
        for (const p of c.pages.values()) {
          if (!best || p.lastUsedAt > best.lastUsedAt) best = p;
        }
      }
    }
    if (!best) throw new Error("no pages open — call browser_launch and page_new first");
    return best;
  }

  listPages(): Array<{ id: string; sessionId: string; contextId: string; url: string; title: Promise<string> }> {
    const out: Array<{ id: string; sessionId: string; contextId: string; url: string; title: Promise<string> }> = [];
    for (const s of this.sessions.values()) {
      for (const c of s.contexts.values()) {
        for (const p of c.pages.values()) {
          out.push({ id: p.id, sessionId: s.id, contextId: c.id, url: p.page.url(), title: p.page.title() });
        }
      }
    }
    return out;
  }

  totals(): { sessions: number; contexts: number; pages: number } {
    let contexts = 0;
    let pages = 0;
    for (const s of this.sessions.values()) {
      contexts += s.contexts.size;
      for (const c of s.contexts.values()) pages += c.pages.size;
    }
    return { sessions: this.sessions.size, contexts, pages };
  }

  // --------------------------------------------------------- internals
  private async registerContext(session: SessionRecord, context: BrowserContext): Promise<ContextRecord> {
    const id = `c_${randomUUID().slice(0, 8)}`;
    const rec: ContextRecord = {
      id,
      context,
      sessionId: session.id,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      pages: new Map(),
      recording: {},
    };
    session.contexts.set(id, rec);
    context.on("page", (page: Page) => {
      // Auto-register pages opened by clicks/window.open
      if (![...rec.pages.values()].some((pr) => pr.page === page)) {
        this.registerPage(rec, page);
      }
    });
    context.on("close", () => {
      session.contexts.delete(id);
    });
    return rec;
  }

  private registerPage(ctx: ContextRecord, page: Page): PageRecord {
    const id = `p_${randomUUID().slice(0, 8)}`;
    const rec: PageRecord = {
      id,
      page,
      contextId: ctx.id,
      sessionId: ctx.sessionId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      routes: new Set(),
    };
    page.on("close", () => {
      ctx.pages.delete(id);
    });
    ctx.pages.set(id, rec);
    page.setDefaultTimeout(config.actionTimeoutMs);
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    return rec;
  }

  private async sweep(): Promise<void> {
    if (config.sessionTtlMinutes <= 0) return;
    const now = Date.now();
    const ttlMs = config.sessionTtlMinutes * 60 * 1000;
    const stale: string[] = [];
    for (const [id, s] of this.sessions) {
      if (now - s.lastUsedAt > ttlMs) stale.push(id);
    }
    for (const id of stale) {
      logger.info({ sessionId: id }, "auto-closing idle session (TTL)");
      await this.closeSession(id).catch(() => {});
    }
  }
}

export const sessionManager = new SessionManager();
