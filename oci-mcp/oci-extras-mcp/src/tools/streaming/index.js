/**
 * Streaming tools — long-running tools that progressively emit content.
 *
 * Two modes:
 *  - When the MCP transport supports progress notifications (Streamable HTTP),
 *    we forward chunks via the `progress` callback (3rd arg from MCP server).
 *  - In stdio fallback, we accumulate chunks until the deadline and return them
 *    as a single response.
 *
 * Two sources:
 *  - streaming_tail_oci_log: tails an OCI Logging log via search API (poll loop)
 *  - streaming_tail_pod_logs: tails a Kubernetes pod's logs (uses k8s SDK stream)
 */
import { z } from "zod";
import * as k8s from "@kubernetes/client-node";
import fs from "node:fs";
import { loggingSearchClient } from "../../lib/ociClient.js";
import { config } from "../../config.js";
import { LogOcid } from "../../schemas.js";

let activeKc = null;
function getKc() {
  if (activeKc) return activeKc;
  const kc = new k8s.KubeConfig();
  if (fs.existsSync(config.kubeconfigPath)) kc.loadFromFile(config.kubeconfigPath);
  else kc.loadFromDefault();
  activeKc = kc;
  return kc;
}

/**
 * Tail OCI Logging by polling search API. Emits new entries every poll cycle.
 */
export const streaming_tail_oci_log = {
  description:
    "Tail (stream) entries from an OCI Logging log. Emits chunks via progress when supported, or accumulates them. Stops on deadline.",
  input: z.object({
    logOcid: LogOcid.optional().describe(
      "If omitted, you must provide a custom search query covering one or more logs"
    ),
    searchQuery: z
      .string()
      .optional()
      .describe(
        "OCI Logging search query. Default uses logOcid if provided. Example: search \"<compartment-ocid>/<log-group-ocid>/<log-ocid>\""
      ),
    durationSeconds: z.number().int().positive().max(900).default(120),
    pollIntervalMs: z.number().int().positive().max(30000).default(3000),
    maxEntriesPerPoll: z.number().int().positive().max(1000).default(200),
  }),
  async handler(input, ctx = {}) {
    const ls = await loggingSearchClient();
    const deadline = Date.now() + input.durationSeconds * 1000;
    const collected = [];
    let lastTs = new Date().toISOString();

    const baseSearch = input.searchQuery ?? `search "${input.logOcid}"`;

    while (Date.now() < deadline) {
      const now = new Date().toISOString();
      try {
        const res = await ls.searchLogs({
          searchLogsDetails: {
            timeStart: new Date(lastTs),
            timeEnd: new Date(now),
            searchQuery: baseSearch,
            isReturnFieldInfo: false,
          },
          limit: input.maxEntriesPerPoll,
        });
        const results = res.searchResponse?.results ?? [];
        for (const r of results) {
          const entry = {
            time: r?.data?.datetime ?? r?.data?.time,
            message: r?.data?.logContent?.data?.message ?? r?.data?.message,
            source: r?.data?.source,
            raw: r?.data,
          };
          collected.push(entry);
          if (typeof ctx.progress === "function") {
            ctx.progress({ chunk: entry });
          }
        }
        lastTs = now;
      } catch (e) {
        const errChunk = { error: e.message, code: e.statusCode };
        collected.push(errChunk);
        if (typeof ctx.progress === "function") ctx.progress({ chunk: errChunk });
      }
      await new Promise((r) => setTimeout(r, input.pollIntervalMs));
    }
    return { ok: true, count: collected.length, entries: collected };
  },
};

/**
 * Tail Kubernetes pod logs. Streams via watch when progress is available.
 */
export const streaming_tail_pod_logs = {
  description:
    "Stream Kubernetes pod logs (one container) for a duration. Emits each log chunk via progress when supported.",
  input: z.object({
    namespace: z.string().default("default"),
    pod: z.string(),
    container: z.string().optional(),
    durationSeconds: z.number().int().positive().max(900).default(60),
    sinceSeconds: z.number().int().positive().default(60),
    tailLines: z.number().int().positive().default(200),
  }),
  async handler(input, ctx = {}) {
    const api = getKc().makeApiClient(k8s.CoreV1Api);
    const collected = [];
    const deadline = Date.now() + input.durationSeconds * 1000;

    // Initial dump (history)
    try {
      const res = await api.readNamespacedPodLog({
        name: input.pod,
        namespace: input.namespace,
        container: input.container,
        sinceSeconds: input.sinceSeconds,
        tailLines: input.tailLines,
      });
      const text = typeof res === "string" ? res : res?.body ?? "";
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        collected.push(line);
        if (typeof ctx.progress === "function") ctx.progress({ chunk: line });
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }

    // Follow loop — incremental polling for new lines (avoids streaming complexity)
    let lastSeen = collected.length;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await api.readNamespacedPodLog({
          name: input.pod,
          namespace: input.namespace,
          container: input.container,
          sinceSeconds: 5,
        });
        const text = typeof res === "string" ? res : res?.body ?? "";
        const lines = text.split("\n").filter(Boolean);
        for (const line of lines) {
          collected.push(line);
          if (typeof ctx.progress === "function") ctx.progress({ chunk: line });
        }
        lastSeen = collected.length;
      } catch {
        /* keep tailing */
      }
    }
    return { ok: true, count: collected.length, lines: collected };
  },
};
