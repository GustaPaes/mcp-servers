/**
 * Stdio transport — modo padrão para Claude Desktop / Cursor / opencode.
 *
 * stdout é EXCLUSIVO do protocolo MCP. Qualquer log/erro vai em stderr (fd=2).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { buildMcpServer } from '../mcp/buildServer.js';

export async function runStdio(): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  const { server, ctx, toolCount } = await buildMcpServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info(
    {
      transport: 'stdio',
      tools: toolCount,
      accounts: ctx.accounts.list().length,
      readOnly: env.READ_ONLY,
      dryRun: env.DRY_RUN,
    },
    'meta-ads-mcp ready',
  );
}
