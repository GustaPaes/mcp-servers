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
import { ToolEnvelopeSchema } from './toolKit.js';
import { annotationsForRisk } from '@gustapaes/mcp-runtime';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import type { ToolContext } from './context.js';

export interface BuiltServer {
  server: McpServer;
  ctx: ToolContext;
  toolCount: number;
}

function auditInvocationMeta(args: unknown, risk: string): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { risk, inputType: typeof args };
  }
  const input = args as Record<string, unknown>;
  return {
    risk,
    inputKeys: Object.keys(input).sort(),
    dryRun: typeof input.dryRun === 'boolean' ? input.dryRun : undefined,
    confirmed: input.confirm === true,
  };
}

function auditResultMeta(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { resultType: typeof result };
  }
  const value = result as Record<string, unknown>;
  return {
    ok: value.ok,
    resultKeys: Object.keys(value).sort(),
    dataKeys:
      value.data && typeof value.data === 'object' && !Array.isArray(value.data)
        ? Object.keys(value.data as Record<string, unknown>).sort()
        : undefined,
  };
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
        outputSchema: ToolEnvelopeSchema.shape,
        annotations: annotationsForRisk(tool.policy.risk, {
          title: tool.name,
          idempotent: tool.policy.idempotent,
          openWorld: tool.policy.openWorld,
        }),
      },
      async (args: unknown) => {
        try {
          const rawArgs = args ?? {};
          const accountId =
            rawArgs && typeof rawArgs === 'object' && 'accountId' in rawArgs
              ? String((rawArgs as { accountId?: unknown }).accountId ?? '') || undefined
              : undefined;
          audit.record(
            {
              action: 'tool.invoked',
              tool: tool.name,
              accountId,
              meta: auditInvocationMeta(rawArgs, tool.policy.risk),
            },
            { required: tool.policy.risk === 'REMOTE_WRITE' || tool.policy.risk === 'DESTRUCTIVE' },
          );
          const parsed = tool.inputSchema.parse(args ?? {});
          const result = await tool.handler(parsed, ctx);
          const failed = Boolean(
            result &&
              typeof result === 'object' &&
              'ok' in result &&
              (result as { ok?: boolean }).ok === false,
          );
          audit.record({
            action: failed ? 'tool.failed' : 'tool.completed',
            tool: tool.name,
            accountId,
            meta: auditResultMeta(result),
          });
          const structuredContent: Record<string, unknown> | undefined =
            result && typeof result === 'object'
              ? Array.isArray(result)
                ? { items: result }
                : (result as Record<string, unknown>)
              : undefined;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            ...(structuredContent ? { structuredContent } : {}),
            isError: failed,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ tool: tool.name, err: message }, 'tool.error');
          audit.record({
            action: 'tool.rejected',
            tool: tool.name,
            error: message,
          });
          const errorResult = { ok: false, errors: [message] };
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(errorResult, null, 2),
              },
            ],
            structuredContent: errorResult,
          };
        }
      },
    );
  }

  registerResources(server, ctx);
  registerPrompts(server);

  return { server, ctx, toolCount: ALL_TOOLS.length };
}
