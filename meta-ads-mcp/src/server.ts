#!/usr/bin/env node
/**
 * Meta Ads MCP Server — entrypoint.
 *
 * Seleciona o transporte (stdio padrão, ou http via MCP_TRANSPORT=http).
 * Toda saída de diagnóstico vai em stderr — stdout é reservado ao protocolo
 * MCP em modo stdio.
 */
import { getEnv } from './config/env.js';
import { runStdio } from './transports/stdio.js';
import { runHttp } from './transports/http.js';

async function main(): Promise<void> {
  const env = getEnv();
  if (env.MCP_TRANSPORT === 'http') {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  // Last-resort error handler. Goes to stderr so it doesn't pollute MCP stdio.
   
  console.error('Fatal error starting meta-ads-mcp:', err);
  process.exit(1);
});
