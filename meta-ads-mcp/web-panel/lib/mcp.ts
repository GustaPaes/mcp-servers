import 'server-only';
import type { AdAccountSummary, AuditEntry, CampaignSummary, InsightRow, ToolEnvelope } from './types';

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface CallToolResult {
  content?: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface ReadResourceResult {
  contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
}

let sessionId: string | undefined;
let initialized = false;
let seq = 1;

function endpoint(): string {
  return process.env.META_ADS_MCP_HTTP_URL ?? 'http://127.0.0.1:8787/mcp';
}

function headers(): HeadersInit {
  const token = process.env.META_ADS_MCP_BEARER_TOKEN;
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
  };
}

function parseSseOrJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLine = trimmed
    .split(/\r?\n/)
    .find((line) => line.startsWith('data:'));
  if (!dataLine) throw new Error(`Unexpected MCP HTTP response: ${trimmed.slice(0, 120)}`);
  return JSON.parse(dataLine.slice('data:'.length).trim());
}

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  const id = seq++;
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    cache: 'no-store',
  });
  const nextSessionId = res.headers.get('mcp-session-id');
  if (nextSessionId) sessionId = nextSessionId;
  const body = (await parseSseOrJson(await res.text())) as JsonRpcResponse<T>;
  if (!res.ok) throw new Error(body.error?.message ?? `MCP HTTP ${res.status}`);
  if (body.error) throw new Error(body.error.message);
  if (body.result == null) return {} as T;
  return body.result;
}

async function notify(method: string, params?: unknown): Promise<void> {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    cache: 'no-store',
  });
  const nextSessionId = res.headers.get('mcp-session-id');
  if (nextSessionId) sessionId = nextSessionId;
  if (!res.ok) throw new Error(`MCP notification failed: HTTP ${res.status}`);
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'meta-ads-mcp-web-panel', version: '0.1.0' },
  });
  await notify('notifications/initialized');
  initialized = true;
}

function parseToolEnvelope<T>(result: CallToolResult): ToolEnvelope<T> {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (!text) return { ok: false, errors: ['MCP tool returned no text content'] };
  return JSON.parse(text) as ToolEnvelope<T>;
}

export async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<ToolEnvelope<T>> {
  await ensureInitialized();
  const result = await rpc<CallToolResult>('tools/call', { name, arguments: args });
  return parseToolEnvelope<T>(result);
}

export async function readResource<T>(uri: string): Promise<T> {
  await ensureInitialized();
  const result = await rpc<ReadResourceResult>('resources/read', { uri });
  const text = result.contents?.find((c) => c.text)?.text;
  if (!text) throw new Error(`Resource ${uri} returned no text content`);
  return JSON.parse(text) as T;
}

export async function listAccounts(): Promise<AdAccountSummary[]> {
  const res = await callTool<{ count: number; accounts: AdAccountSummary[] }>('list_ad_accounts');
  if (!res.ok) throw new Error(res.errors?.join('; ') ?? 'Failed to list accounts');
  return res.data?.accounts ?? [];
}

export async function accountProfile(accountId: string): Promise<Record<string, unknown>> {
  const res = await callTool<Record<string, unknown>>('get_account_profile', { accountId });
  if (!res.ok) throw new Error(res.errors?.join('; ') ?? 'Failed to load account profile');
  return res.data ?? {};
}

export async function campaigns(accountId: string): Promise<CampaignSummary[]> {
  const res = await callTool<{ campaigns?: CampaignSummary[]; data?: CampaignSummary[] }>('list_campaigns', {
    accountId,
    limit: 50,
  });
  if (!res.ok) throw new Error(res.errors?.join('; ') ?? 'Failed to list campaigns');
  return res.data?.campaigns ?? res.data?.data ?? [];
}

export async function performanceReport(accountId: string): Promise<Record<string, unknown>> {
  const res = await callTool<Record<string, unknown>>('generate_performance_report', {
    accountId,
    level: 'account',
    datePreset: 'last_30d',
  });
  if (!res.ok) return { error: res.errors?.join('; ') ?? 'Failed to generate report' };
  return res.data ?? {};
}

export async function wastedSpend(accountId: string): Promise<Record<string, unknown>> {
  const res = await callTool<Record<string, unknown>>('find_wasted_spend', {
    accountId,
    datePreset: 'last_7d',
  });
  if (!res.ok) return { error: res.errors?.join('; ') ?? 'Failed to find wasted spend' };
  return res.data ?? {};
}

export async function campaignInsights(accountId: string, campaignId: string): Promise<InsightRow[]> {
  const res = await callTool<{ rows?: InsightRow[]; insights?: InsightRow[]; data?: InsightRow[] }>('get_campaign_insights', {
    accountId,
    level: 'campaign',
    objectId: campaignId,
    datePreset: 'last_30d',
  });
  if (!res.ok) return [];
  return res.data?.rows ?? res.data?.insights ?? res.data?.data ?? [];
}

export async function accountAudit(accountId: string): Promise<AuditEntry[]> {
  const res = await readResource<{ entries: AuditEntry[] }>(`meta-ads://audit/account/${encodeURIComponent(accountId)}`);
  return res.entries ?? [];
}

export async function accountDrafts(accountId: string): Promise<Record<string, unknown>> {
  return readResource<Record<string, unknown>>(`meta-ads://drafts/account/${encodeURIComponent(accountId)}`);
}
