import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, TOOL_POLICIES } from '../src/mcp/registry.js';
import { ToolEnvelopeSchema } from '../src/mcp/toolKit.js';
import { AuditLog } from '../src/security/auditLog.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('tool contracts', () => {
  it('has one explicit policy for every tool and no orphan policies', () => {
    const tools = ALL_TOOLS.map((tool) => tool.name).sort();
    expect(Object.keys(TOOL_POLICIES).sort()).toEqual(tools);
    expect(new Set(tools).size).toBe(tools.length);
    for (const tool of ALL_TOOLS) {
      expect(tool.policy).toEqual(TOOL_POLICIES[tool.name]);
      expect(typeof tool.policy.idempotent).toBe('boolean');
      expect(typeof tool.policy.openWorld).toBe('boolean');
    }
  });

  it('validates the shared success and error envelopes', () => {
    expect(ToolEnvelopeSchema.parse({ ok: true, data: { id: 'example' } })).toEqual({
      ok: true,
      data: { id: 'example' },
    });
    expect(ToolEnvelopeSchema.parse({ ok: false, errors: ['denied'] })).toEqual({
      ok: false,
      errors: ['denied'],
    });
    expect(() => ToolEnvelopeSchema.parse({ ok: true, unexpected: true })).toThrow();
  });
});

describe('AuditLog', () => {
  it('records invocation and completion events with secrets redacted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'meta-audit-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'audit.jsonl');
    const audit = new AuditLog(file);

    audit.record({
      action: 'tool.invoked',
      tool: 'example_tool',
      meta: { accessToken: 'sensitive-value' },
    });
    audit.record({ action: 'tool.completed', tool: 'example_tool', meta: { ok: true } });

    const entries = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { action: string; meta: unknown });
    expect(entries.map((entry) => entry.action)).toEqual(['tool.invoked', 'tool.completed']);
    expect(JSON.stringify(entries)).not.toContain('sensitive-value');
  });

  it('fails closed when a required audit entry cannot be persisted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'meta-audit-'));
    temporaryDirectories.push(directory);
    const audit = new AuditLog(directory);
    expect(() =>
      audit.record(
        { action: 'tool.invoked', tool: 'remote_mutation' },
        { required: true },
      ),
    ).toThrow(/Required audit write failed/);
  });
});
