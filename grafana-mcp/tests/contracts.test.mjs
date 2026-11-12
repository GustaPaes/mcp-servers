import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTools } from '../src/server.js';
import { GrafanaReadClient } from '../src/client.js';
import { analyzeDashboardExport } from '../src/analyzer.js';
import { readExport } from '../src/files.js';
import { loadConfig, configKeys } from '../src/config.js';

const dashboard = { uid: 'example', title: 'Example dashboard', panels: [{ id: 1, title: 'Errors', type: 'timeseries', targets: [{ expr: 'private query $environment' }] }] };
const root = path.resolve(import.meta.dirname, '..');

test('canonical manifest has strict input, validated envelopes and explicit READ risk', async () => {
  const tools = createTools({ exportRoot: root }, { metadata: async kind => kind === 'health' ? { database: 'ok', version: 'example' } : dashboard });
  assert.equal(tools.length, 4);
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.equal(tool.risk, 'READ');
    assert.equal(typeof tool.handler, 'function');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(tool.annotations.openWorldHint, tool.remote);
    assert.equal(tool.input.safeParse({ unknown: true }).success, false);
  }
  for (const tool of tools.filter(tool => tool.remote)) {
    const data = await tool.handler(tool.name === 'grafana_health' ? {} : { uid: 'example' });
    tool.output.parse({ data, meta: { tool: tool.name, durationMs: 0, correlationId: randomUUID() } });
  }
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  for (const tool of tools) assert.ok(readme.includes('`' + tool.name + '`'));
});

test('analysis never returns query content and enforces document limits', () => {
  const result = analyzeDashboardExport(dashboard);
  assert.equal(JSON.stringify(result).includes('private query'), false);
  assert.equal(result.candidates[0].eligibleForDirectReuse, false);
  assert.throws(() => analyzeDashboardExport({ panels: Array(201).fill({}) }), /PANEL_LIMIT/);
  assert.throws(() => analyzeDashboardExport({ panels: [{ targets: Array(21).fill({}) }] }), /TARGET_LIMIT/);
  let nested = { panels: [] };
  for (let i = 0; i < 12; i++) nested = { panels: [nested] };
  assert.throws(() => analyzeDashboardExport(nested), /DEPTH_LIMIT/);
});

test('configuration examples match consumed keys and reject invalid startup values', async () => {
  const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
  assert.deepEqual([...example.matchAll(/^(GRAFANA_\w+)=/gm)].map(match => match[1]).sort(), [...configKeys].sort());
  assert.throws(() => loadConfig({ GRAFANA_TIMEOUT_MS: '0' }), /INVALID/);
  assert.throws(() => loadConfig({ GRAFANA_TOKEN: 'line\nbreak' }), /INVALID/);
  for (const url of ['ftp://localhost', 'http://example.com', 'https://' + 'user:pass@example.com', 'https://example.com/?token=example']) {
    assert.throws(() => new GrafanaReadClient({ url }));
  }
});

test('transport limits routes, credentials, response size, errors and cancellation', async () => {
  let seen;
  const client = new GrafanaReadClient({ url: 'https://grafana.example.com/subpath', token: 'example', fetchImpl: async (url, options) => {
    seen = { url, options }; return new Response(JSON.stringify(dashboard));
  } });
  await client.metadata('dashboard', 'example');
  assert.equal(seen.url, 'https://grafana.example.com/subpath/api/dashboards/uid/example');
  assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.method, 'GET');
  assert.equal(seen.options.headers.Authorization, 'Bearer example');
  await client.metadata('health');
  assert.equal(seen.options.headers.Authorization, undefined);
  await assert.rejects(client.metadata('dashboard', '../escape'), /ROUTE_NOT_ALLOWED/);
  client.fetchImpl = async () => new Response('x'.repeat(2_000_001));
  await assert.rejects(client.metadata('health'), /RESPONSE_LIMIT/);
  client.fetchImpl = async () => { throw new Error('private-provider-detail'); };
  await assert.rejects(client.metadata('health'), error => !error.message.includes('private-provider-detail'));
  client.fetchImpl = async (_, { signal }) => { signal.throwIfAborted(); };
  await assert.rejects(client.metadata('health', undefined, AbortSignal.abort()), /CANCELLED/);
  client.timeoutMs = 100;
  client.fetchImpl = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  await assert.rejects(client.metadata('health'), /TIMEOUT_OR_CANCELLED/);
});

test('real redirects are rejected before forwarding authentication', async () => {
  let destinationHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') { res.writeHead(302, { Location: '/destination' }); res.end(); }
    else { destinationHits++; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new GrafanaReadClient({ url: `http://127.0.0.1:${server.address().port}`, token: 'example' });
    await assert.rejects(client.metadata('health'), /TRANSPORT_ERROR/);
    assert.equal(destinationHits, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('exports reject traversal, secrets, oversize files and symlink escape', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'grafana-test-'));
  try {
    const exports = path.join(temp, 'exports'); await fs.mkdir(exports);
    await fs.writeFile(path.join(exports, 'example.json'), JSON.stringify(dashboard));
    await fs.writeFile(path.join(temp, 'outside.json'), '{}');
    assert.deepEqual(await readExport(exports, 'example.json'), dashboard);
    await assert.rejects(readExport(exports, '../outside.json'));
    await assert.rejects(readExport(exports, 'secret.json'), /NOT_ALLOWED/);
    await fs.writeFile(path.join(exports, 'large.json'), ' '.repeat(2_000_001));
    await assert.rejects(readExport(exports, 'large.json'), /SIZE_LIMIT/);
    try { await fs.symlink(path.join(temp, 'outside.json'), path.join(exports, 'link.json')); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('Symlink creation unavailable on this host'); return; } throw error; }
    await assert.rejects(readExport(exports, 'link.json'), /OUTSIDE_ROOT/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('stdio lists every tool and returns a validated structured response offline', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'grafana-protocol-'));
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  try {
    await fs.writeFile(path.join(temp, 'example.json'), JSON.stringify(dashboard));
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'index.js')], env: { ...process.env, GRAFANA_EXPORT_ROOT: temp, GRAFANA_URL: '', GRAFANA_TOKEN: '' }, stderr: 'pipe' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
    for (const tool of tools) { assert.equal(tool.inputSchema.additionalProperties, false); assert.ok(tool.outputSchema); }
    const result = await client.callTool({ name: 'analyze_grafana_dashboard_export', arguments: { file: 'example.json' } });
    assert.notEqual(result.isError, true);
    const manifest = createTools({ exportRoot: temp });
    manifest.find(tool => tool.name === 'analyze_grafana_dashboard_export').output.parse(result.structuredContent);
    assert.equal(JSON.stringify(result).includes('private query'), false);
    const failed = await client.callTool({ name: 'analyze_grafana_dashboard_export', arguments: { file: '../outside.json' } });
    assert.equal(failed.isError, true);
    const invalid = await client.callTool({ name: 'grafana_health', arguments: { unknown: true } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await fs.rm(temp, { recursive: true, force: true }); }
});
