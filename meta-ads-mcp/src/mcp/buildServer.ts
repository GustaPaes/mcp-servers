/**
 * Wiring: monta o ToolContext + McpServer com todas as tools registradas.
 *
 * Isolado em um módulo para que diferentes transportes (stdio, HTTP) compartilhem
 * EXATAMENTE a mesma instância de configuração/validação. NUNCA duplicar lógica
 * de registro de tools — alterações de tooling devem refletir nos dois transports.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { AccountRegistry } from '../config/accounts.js';
import { MetaAdsClient } from '../meta/MetaAdsClient.js';
import { createStorage } from '../storage/factory.js';
import { getAuditLog } from '../security/auditLog.js';
import { OptimizationEngine } from '../optimization/OptimizationEngine.js';
import { CreativeAnalysisEngine } from '../optimization/CreativeAnalysisEngine.js';
import { AudienceStrategyEngine } from '../optimization/AudienceStrategyEngine.js';
import { PolicyRiskEngine } from '../optimization/PolicyRiskEngine.js';
import { BudgetEngine } from '../optimization/BudgetEngine.js';
import { ALL_TOOLS } from './registry.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import type { ToolContext } from './context.js';

export interface BuiltServer {
  server: McpServer;
  ctx: ToolContext;
  toolCount: number;
}

export async function buildMcpServer(): Promise<BuiltServer> {
  const env = getEnv();
  const log = getLogger();

  const accounts = AccountRegistry.fromFile();
  const meta = new MetaAdsClient(accounts);
  const storage = await createStorage();
  const audit = getAuditLog();

  const ctx: ToolContext = {
    accounts,
    meta,
    storage,
    audit,
    engines: {
      optimization: new OptimizationEngine(),
      creative: new CreativeAnalysisEngine(),
      audience: new AudienceStrategyEngine(),
      policy: new PolicyRiskEngine(),
      budget: new BudgetEngine(),
    },
  };

  const server = new McpServer(
    { name: 'meta-ads-mcp', version: '0.1.0' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      instructions: [
        'Servidor MCP para Meta Marketing API (Facebook/Instagram Ads).',
        'NUNCA execute mudanças que gastem dinheiro sem confirm=true, reason, requestedBy e dryRun=false.',
        'Toda recomendação é heurística e não garante resultado.',
        'Targeting por atributos sensíveis (raça, religião, saúde, política, orientação sexual) é proibido.',
        `Modo global: READ_ONLY=${env.READ_ONLY} | DRY_RUN=${env.DRY_RUN}.`,
      ].join('\n'),
    },
  );

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: (tool.inputSchema as any).shape ?? undefined,
        annotations: {
          title: tool.name,
          readOnlyHint: !tool.mutating,
          destructiveHint: tool.destructive ?? false,
          idempotentHint: tool.idempotent ?? !tool.mutating,
          openWorldHint: tool.openWorld ?? true,
        },
      },
      async (args: unknown) => {
        try {
          const parsed = tool.inputSchema.parse(args ?? {});
          const result = await tool.handler(parsed, ctx);
          const structuredContent: Record<string, unknown> | undefined =
            result && typeof result === 'object'
              ? Array.isArray(result)
                ? { items: result }
                : (result as Record<string, unknown>)
              : undefined;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            ...(structuredContent ? { structuredContent } : {}),
            isError:
              Boolean(
                result &&
                  typeof result === 'object' &&
                  'ok' in result &&
                  (result as { ok?: boolean }).ok === false,
              ),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ tool: tool.name, err: message }, 'tool.error');
          audit.record({
            action: 'tool.rejected',
            tool: tool.name,
            error: message,
          });
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: false, errors: [message] }, null, 2),
              },
            ],
          };
        }
      },
    );
  }

  registerResources(server, ctx);
  registerPrompts(server);

  return { server, ctx, toolCount: ALL_TOOLS.length };
}
