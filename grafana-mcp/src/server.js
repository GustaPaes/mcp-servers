import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GrafanaReadClient } from './client.js';
import { analyzeDashboardExport, summarySchema, candidatesSchema } from './analyzer.js';
import { readExport } from './files.js';

const fileInput = z.object({ file: z.string().min(1).max(240) }).strict();
const envelope = data => z.object({ data, meta: z.object({ tool: z.string(), durationMs: z.number().nonnegative(), correlationId: z.string().uuid() }).strict() }).strict();
export function createTools(config, client = new GrafanaReadClient(config)) {
  return [
    { name: 'grafana_health', description: 'Read Grafana public health. This does not verify token permissions.', input: z.object({}).strict(), output: z.object({ database: z.string().max(80).nullable(), version: z.string().max(80).nullable() }).strict(), remote: true,
      handler: async (_, signal) => { const data = await client.metadata('health', undefined, signal); return { database: typeof data.database === 'string' ? data.database.slice(0, 80) : null, version: typeof data.version === 'string' ? data.version.slice(0, 80) : null }; } },
    { name: 'analyze_remote_grafana_dashboard', description: 'Read a dashboard by UID and return a bounded summary without raw queries or datasource credentials.', input: z.object({ uid: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }).strict(), output: summarySchema, remote: true,
      handler: async ({ uid }, signal) => analyzeDashboardExport(await client.metadata('dashboard', uid, signal)).summary },
    { name: 'analyze_grafana_dashboard_export', description: 'Summarize a JSON dashboard inside the configured export root without returning query text.', input: fileInput, output: summarySchema, remote: false,
      handler: async ({ file }) => analyzeDashboardExport(await readExport(config.exportRoot, file)).summary },
    { name: 'suggest_grafana_alert_candidates', description: 'Suggest alert candidates from a local dashboard export. Does not create or validate alert rules.', input: fileInput, output: candidatesSchema, remote: false,
      handler: async ({ file }) => ({ candidates: analyzeDashboardExport(await readExport(config.exportRoot, file)).candidates }) },
  ].map(tool => ({ ...tool, risk: 'READ', output: envelope(tool.output), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: tool.remote } }));
}
export function createServer(config, client) {
  const server = new McpServer({ name: 'grafana-mcp', version: '1.0.0' });
  let running = false;
  for (const tool of createTools(config, client)) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input, outputSchema: tool.output, annotations: tool.annotations }, async (input, extra) => {
      if (running) return { isError: true, content: [{ type: 'text', text: 'BUSY_RETRY_LATER' }] };
      running = true;
      const started = performance.now();
      const correlationId = randomUUID();
      let status = 'error';
      try {
        const data = await tool.handler(tool.input.parse(input), extra.signal);
        const structuredContent = tool.output.parse({ data, meta: { tool: tool.name, durationMs: Math.round(performance.now() - started), correlationId } });
        status = 'ok';
        return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] };
      } catch (error) {
        const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'GRAFANA_OPERATION_FAILED';
        return { isError: true, content: [{ type: 'text', text: code }] };
      } finally {
        console.error(JSON.stringify({ tool: tool.name, risk: tool.risk, correlationId, durationMs: Math.round(performance.now() - started), status }));
        running = false;
      }
    });
  }
  return server;
}
