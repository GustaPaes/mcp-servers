/**
 * tools/visual.ts — screenshots, PDFs, video and tracing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { sessionManager } from "../session-manager.js";
import type { ToolModule } from "../types.js";
import { outputPath, timestamp } from "../output-dir.js";
import { config } from "../config.js";

export const visualTools: ToolModule = {
  defs: [
    {
      name: "context_recording_status",
      description: "Report HAR, video and trace recording state for a context without changing or closing it.",
      annotations: { title: "Recording status", readOnlyHint: true, idempotentHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: { context_id: { type: "string" } },
      },
    },
    {
      name: "page_screenshot",
      description: "Take a screenshot. Saves to <output>/screenshots and optionally returns base64.",
      annotations: { title: "Screenshot", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          selector: { type: "string", description: "Optional element to screenshot" },
          full_page: { type: "boolean", default: false },
          type: { type: "string", enum: ["png", "jpeg"], default: "png" },
          quality: { type: "number", description: "JPEG quality 0-100" },
          omit_background: { type: "boolean", default: false },
          clip: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
          },
          filename: { type: "string", description: "Optional file name (relative to screenshots dir)" },
          return_base64: { type: "boolean", default: false },
        },
      },
    },
    {
      name: "page_pdf",
      description: "Render the page to a PDF (Chromium only, headless required for high fidelity).",
      annotations: { title: "PDF", readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: { type: "string" },
          format: { type: "string", description: "A4, Letter, etc.", default: "A4" },
          landscape: { type: "boolean", default: false },
          scale: { type: "number", default: 1 },
          print_background: { type: "boolean", default: true },
          margin: {
            type: "object",
            additionalProperties: false,
            properties: {
              top: { type: "string" },
              right: { type: "string" },
              bottom: { type: "string" },
              left: { type: "string" },
            },
          },
          filename: { type: "string" },
        },
      },
    },
    {
      name: "page_video_start",
      description:
        "Enable video recording for a context. Note: must be set when context is created — this tool reports the active recording dir, since Playwright cannot toggle recording on an existing context. Recommend creating context with record_video=true.",
      annotations: { title: "Start video" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: { context_id: { type: "string" } },
      },
    },
    {
      name: "page_video_stop",
      description:
        "Stop video by closing the page (or its context). Returns the saved video file path(s) for already-closed pages in this context.",
      annotations: { title: "Stop video" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: {
          context_id: { type: "string" },
          close_pages: { type: "boolean", default: true, description: "Close all pages to flush videos" },
        },
      },
    },
    {
      name: "tracing_start",
      description: "Start Playwright tracing for a context. Open trace.zip later in https://trace.playwright.dev/.",
      annotations: { title: "Start tracing" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: {
          context_id: { type: "string" },
          screenshots: { type: "boolean", default: true },
          snapshots: { type: "boolean", default: true },
          sources: { type: "boolean", default: true },
          title: { type: "string" },
        },
      },
    },
    {
      name: "tracing_stop",
      description: "Stop tracing and write the trace.zip to the output dir.",
      annotations: { title: "Stop tracing" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["context_id"],
        properties: {
          context_id: { type: "string" },
          filename: { type: "string" },
        },
      },
    },
  ],

  handlers: {
    async context_recording_status(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      return {
        context_id: ctx.id,
        har: ctx.recording.har ? { active: true, path: ctx.recording.har.path } : { active: false },
        video: ctx.recording.video ? { active: true, dir: ctx.recording.video.dir } : { active: false },
        tracing: ctx.recording.tracing?.active
          ? { active: true, output_path: ctx.recording.tracing.outputPath ?? null }
          : { active: false },
      };
    },
    async page_screenshot(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const type = (args.type as "png" | "jpeg" | undefined) ?? "png";
      const fileName =
        (args.filename as string | undefined) ?? `page-${rec.id}-${timestamp()}.${type}`;
      const filePath = outputPath("screenshots", fileName);
      const opts: Parameters<typeof rec.page.screenshot>[0] = {
        path: filePath,
        type,
        fullPage: (args.full_page as boolean | undefined) ?? false,
        omitBackground: (args.omit_background as boolean | undefined) ?? false,
        clip: args.clip as { x: number; y: number; width: number; height: number } | undefined,
      };
      if (type === "jpeg" && args.quality != null) opts.quality = args.quality as number;

      let buf: Buffer;
      if (args.selector) {
        buf = await rec.page.locator(String(args.selector)).screenshot(opts);
      } else {
        buf = await rec.page.screenshot(opts);
      }
      const result: Record<string, unknown> = { path: filePath, bytes: buf.byteLength, type };
      if (args.return_base64) {
        if (buf.byteLength <= config.maxArtifactBytes) {
          result.base64 = buf.toString("base64");
        } else {
          result.base64_omitted = true;
          result.base64_limit_bytes = config.maxArtifactBytes;
        }
      }
      return result;
    },
    async page_pdf(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const fileName = (args.filename as string | undefined) ?? `page-${rec.id}-${timestamp()}.pdf`;
      const filePath = outputPath("pdf", fileName);
      try {
        await rec.page.pdf({
          path: filePath,
          format: (args.format as string | undefined) ?? "A4",
          landscape: (args.landscape as boolean | undefined) ?? false,
          scale: (args.scale as number | undefined) ?? 1,
          printBackground: (args.print_background as boolean | undefined) ?? true,
          margin: args.margin as { top?: string; right?: string; bottom?: string; left?: string } | undefined,
        });
      } catch (err) {
        throw new Error(`page_pdf failed (note: requires Chromium, ideally headless): ${(err as Error).message}`);
      }
      return { path: filePath };
    },
    async page_video_start(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      if (!ctx.recording.video) {
        throw new Error(
          "video recording must be enabled at context creation. Re-create the context with record_video=true.",
        );
      }
      return { active: true, video_dir: ctx.recording.video.dir };
    },
    async page_video_stop(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      if (!ctx.recording.video) return { active: false, videos: [] };
      const dir = ctx.recording.video.dir;
      const closePages = (args.close_pages as boolean | undefined) ?? true;
      const pages = [...ctx.pages.values()];
      const videoHandles = pages
        .map((record) => record.page.video())
        .filter((video) => video != null);
      if (closePages) {
        await Promise.allSettled(pages.map((record) => record.page.close()));
      } else {
        return {
          active: true,
          videos: [],
          note: "Video remains active until pages or the context are closed.",
        };
      }
      const settledPaths = await Promise.all(
        videoHandles.map((video) => video.path().catch(() => null)),
      );
      const discovered = await fs.readdir(dir).catch(() => [] as string[]);
      const videos = [
        ...settledPaths.filter((item): item is string => Boolean(item)),
        ...discovered.map((file) => path.join(dir, file)),
      ];
      return {
        active: false,
        videos: [...new Set(videos)],
      };
    },
    async tracing_start(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      const fileName = `trace-${ctx.id}-${timestamp()}.zip`;
      const outPath = outputPath("traces", fileName);
      await ctx.context.tracing.start({
        screenshots: (args.screenshots as boolean | undefined) ?? true,
        snapshots: (args.snapshots as boolean | undefined) ?? true,
        sources: (args.sources as boolean | undefined) ?? true,
        title: args.title as string | undefined,
      });
      ctx.recording.tracing = { active: true, outputPath: outPath };
      return { active: true, output_path: outPath };
    },
    async tracing_stop(args) {
      const { ctx } = sessionManager.requireContext(String(args.context_id));
      if (!ctx.recording.tracing?.active) return { active: false, path: null };
      const outPath =
        (args.filename as string | undefined)
          ? outputPath("traces", String(args.filename))
          : ctx.recording.tracing.outputPath!;
      await ctx.context.tracing.stop({ path: outPath });
      ctx.recording.tracing = { active: false };
      return { active: false, path: outPath, viewer: "https://trace.playwright.dev/" };
    },
  },
};
