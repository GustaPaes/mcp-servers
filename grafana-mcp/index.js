import dotenv from 'dotenv';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, configKeys, serverRoot } from './src/config.js';
import { createServer } from './src/server.js';

dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });
for (const key of Object.keys(process.env).filter(key => key.startsWith('GRAFANA_') && !configKeys.includes(key))) console.error(`Unknown Grafana configuration key: ${key}`);
const server = createServer(loadConfig());
await server.connect(new StdioServerTransport());
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  if (closing) return;
  closing = true;
  await server.close();
});
