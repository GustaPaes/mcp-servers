/**
 * types.ts — Shared types used across the server.
 */
import type { Browser, BrowserContext, Page, CDPSession } from "playwright";
import type { BrowserName } from "./config.js";

export type { BrowserName };

export type BrowserChannel =
  | ""
  | "chrome"
  | "chrome-beta"
  | "chrome-dev"
  | "chrome-canary"
  | "msedge"
  | "msedge-beta"
  | "msedge-dev"
  | "msedge-canary";

export interface SessionRecord {
  id: string;
  browser: Browser;
  browserName: BrowserName;
  channel: BrowserChannel;
  headless: boolean;
  isPersistent: boolean;
  userDataDir?: string;
  createdAt: number;
  lastUsedAt: number;
  contexts: Map<string, ContextRecord>;
}

export interface ContextRecord {
  id: string;
  context: BrowserContext;
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
  pages: Map<string, PageRecord>;
  recording: {
    har?: { path: string };
    video?: { dir: string };
    tracing?: { active: boolean; outputPath?: string };
  };
}

export interface PageRecord {
  id: string;
  page: Page;
  contextId: string;
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
  routes: Set<string>;
  cdp?: CDPSession;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolModule {
  defs: ToolDef[];
  handlers: Record<string, ToolHandler>;
}
