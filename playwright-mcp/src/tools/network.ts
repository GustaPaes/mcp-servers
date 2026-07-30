/**
 * tools/network.ts — request interception, waiting and HAR capture.
 */
import { sessionManager } from "../session-manager.js";
import type { ToolModule } from "../types.js";
import type { Route, Request as PWRequest } from "playwright";
import { outputPath, timestamp } from "../output-dir.js";
import { redactHeaders, redactTextPayload } from "@gustapaes/mcp-runtime";
import { config } from "../config.js";

interface ActiveRoute {
  pattern: string;
  handler: (route: Route, req: PWRequest) => Promise<void>;
}
const routesByPage = new Map<string, Map<string, ActiveRoute>>(); // page_id -> pattern -> route

function patternToMatcher(pattern: string): string | RegExp {
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const last = pattern.lastIndexOf("/");
    try {
      return new RegExp(pattern.slice(1, last), pattern.slice(last + 1));
    } catch {
      /* fallthrough */
    }
  }
  return pattern; // glob
}

export const networkTools: ToolModule = {
  defs: [
    {
      name: "page_route",
      description:
        "Intercept requests matching a URL pattern (glob or /regex/flags). Action 'abort' blocks; 'fulfill' returns a synthetic response; 'continue' (optionally modified) lets it proceed.",
      annotations: { title: "Route" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url_pattern", "action"],
        properties: {
          page_id: { type: "string" },
          url_pattern: { type: "string" },
          action: { type: "string", enum: ["abort", "fulfill", "continue"] },
          fulfill: {
            type: "object",
            additionalProperties: false,
            properties: {
              status: { type: "number", default: 200 },
              content_type: { type: "string" },
              body: { type: "string" },
              headers: { type: "object", additionalProperties: { type: "string" } },
            },
          },
          continue_with: {
            type: "object",
            additionalProperties: false,
            properties: {
              url: { type: "string" },
              method: { type: "string" },
              post_data: { type: "string" },
              headers: { type: "object", additionalProperties: { type: "string" } },
            },
          },
          times: { type: "number", description: "Match only the first N requests" },
        },
      },
    },
    {
      name: "page_unroute",
      description: "Remove a previously installed route by pattern, or all routes if pattern is omitted.",
      annotations: { title: "Unroute" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          url_pattern: { type: "string" },
        },
      },
    },
    {
      name: "page_wait_for_request",
      description: "Wait for a network request matching a URL pattern.",
      annotations: { title: "Wait for request" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url_pattern"],
        properties: {
          page_id: { type: "string" },
          url_pattern: { type: "string" },
          timeout_ms: { type: "number" },
          reveal_sensitive: { type: "boolean", default: false },
          post_data_max_bytes: {
            type: "number",
            minimum: 0,
            maximum: config.maxNetworkBodyBytes,
            default: 8192,
          },
        },
      },
    },
    {
      name: "page_wait_for_response",
      description: "Wait for a network response matching a URL pattern. Returns status, headers and a (truncated) body.",
      annotations: { title: "Wait for response" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url_pattern"],
        properties: {
          page_id: { type: "string" },
          url_pattern: { type: "string" },
          timeout_ms: { type: "number" },
          include_body: { type: "boolean", default: false },
          body_max_bytes: {
            type: "number",
            minimum: 0,
            maximum: config.maxNetworkBodyBytes,
            default: 8192,
          },
          reveal_sensitive: { type: "boolean", default: false },
        },
      },
    },
    {
      name: "network_log_start",
      description:
        "Start HAR capture by re-creating the context with recordHar. Note: HAR is a context-level feature in Playwright, so you must pass record_har=true on context_new instead. This tool reports current HAR status for an existing context.",
      annotations: { title: "Network log start (HAR)" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: { context_id: { type: "string" } },
      },
    },
    {
      name: "network_log_stop",
      description: "Stop HAR by closing the context (Playwright flushes HAR on close). Returns the HAR path.",
      annotations: { title: "Network log stop (HAR)" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: {
          context_id: { type: "string" },
          close_context: { type: "boolean", default: true },
        },
      },
    },
  ],

  handlers: {
    async page_route(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const pattern = String(args.url_pattern);
      const matcher = patternToMatcher(pattern);
      const action = String(args.action);
      const times = args.times as number | undefined;

      let count = 0;
      const handler = async (route: Route) => {
        count++;
        try {
          if (times != null && count > times) {
            await route.continue();
            return;
          }
          if (action === "abort") {
            await route.abort();
          } else if (action === "fulfill") {
            const f = (args.fulfill ?? {}) as {
              status?: number;
              content_type?: string;
              body?: string;
              headers?: Record<string, string>;
            };
            await route.fulfill({
              status: f.status ?? 200,
              contentType: f.content_type,
              body: f.body,
              headers: f.headers,
            });
          } else if (action === "continue") {
            const c = (args.continue_with ?? {}) as {
              url?: string;
              method?: string;
              post_data?: string;
              headers?: Record<string, string>;
            };
            await route.continue({ url: c.url, method: c.method, postData: c.post_data, headers: c.headers });
          } else {
            await route.continue();
          }
        } catch {
          // ignore route teardown races
        }
      };
      await rec.page.route(matcher, handler);

      const map = routesByPage.get(rec.id) ?? new Map<string, ActiveRoute>();
      map.set(pattern, { pattern, handler: handler as ActiveRoute["handler"] });
      routesByPage.set(rec.id, map);
      rec.routes.add(pattern);

      return { installed: pattern, action };
    },
    async page_unroute(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const map = routesByPage.get(rec.id);
      const pattern = args.url_pattern as string | undefined;
      if (!map) return { removed: 0 };
      let removed = 0;
      if (pattern) {
        const r = map.get(pattern);
        if (r) {
          await rec.page.unroute(patternToMatcher(pattern), r.handler);
          map.delete(pattern);
          rec.routes.delete(pattern);
          removed = 1;
        }
      } else {
        for (const [pat, r] of map) {
          await rec.page.unroute(patternToMatcher(pat), r.handler);
          rec.routes.delete(pat);
          removed++;
        }
        map.clear();
      }
      return { removed };
    },
    async page_wait_for_request(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const matcher = patternToMatcher(String(args.url_pattern));
      const req = await rec.page.waitForRequest(matcher, {
        timeout: args.timeout_ms as number | undefined,
      });
      const revealSensitive = args.reveal_sensitive === true;
      if (revealSensitive && !config.allowSecretReveal) {
        throw new Error("Sensitive network data reveal is disabled by PWMCP_ALLOW_SECRET_REVEAL.");
      }
      const rawPostData = req.postData();
      const requestedMax = (args.post_data_max_bytes as number | undefined) ?? 8192;
      const max = Math.min(Math.max(requestedMax, 0), config.maxNetworkBodyBytes);
      const postData = rawPostData?.slice(0, max) ?? null;
      return {
        url: req.url(),
        method: req.method(),
        resource_type: req.resourceType(),
        headers: revealSensitive ? req.headers() : redactHeaders(req.headers()),
        post_data: revealSensitive ? postData : redactTextPayload(postData),
        post_data_truncated: Boolean(rawPostData && rawPostData.length > max),
      };
    },
    async page_wait_for_response(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const matcher = patternToMatcher(String(args.url_pattern));
      const resp = await rec.page.waitForResponse(matcher, {
        timeout: args.timeout_ms as number | undefined,
      });
      const revealSensitive = args.reveal_sensitive === true;
      if (revealSensitive && !config.allowSecretReveal) {
        throw new Error("Sensitive network data reveal is disabled by PWMCP_ALLOW_SECRET_REVEAL.");
      }
      const out: Record<string, unknown> = {
        url: resp.url(),
        status: resp.status(),
        ok: resp.ok(),
        headers: revealSensitive ? resp.headers() : redactHeaders(resp.headers()),
      };
      if (args.include_body) {
        const requestedMax = (args.body_max_bytes as number | undefined) ?? 8192;
        const max = Math.min(Math.max(requestedMax, 0), config.maxNetworkBodyBytes);
        try {
          const buf = await resp.body();
          const body = buf.subarray(0, max).toString("utf8");
          out.body = revealSensitive ? body : redactTextPayload(body);
          out.body_truncated = buf.byteLength > max;
          out.body_total_bytes = buf.byteLength;
        } catch (err) {
          out.body_error = (err as Error).message;
        }
      }
      return out;
    },
    async network_log_start(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      if (!ctx.recording.har) {
        return {
          active: false,
          note: "HAR must be enabled at context creation. Call context_new with record_har=true.",
        };
      }
      return { active: true, har_path: ctx.recording.har.path };
    },
    async network_log_stop(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      const harPath = ctx.recording.har?.path;
      if (!harPath) return { active: false, path: null };
      const closeContext = (args.close_context as boolean | undefined) ?? true;
      if (closeContext) {
        // Playwright flushes HAR when the context closes.
        await sessionManager.closeContext(ctx.id).catch(() => {});
      }
      return { active: false, path: harPath, note: closeContext ? "context closed; HAR flushed" : "context still open; HAR may be incomplete" };
    },
  },
};

// keep imports referenced
void timestamp;
void outputPath;
