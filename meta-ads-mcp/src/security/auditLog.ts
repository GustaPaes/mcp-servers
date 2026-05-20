import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getEnv } from '../config/env.js';
import { getLogger, redactSecrets } from '../utils/logger.js';

export type AuditAction =
  | 'tool.invoked'
  | 'tool.rejected'
  | 'recommendation.generated'
  | 'recommendation.approved'
  | 'recommendation.rejected'
  | 'mutation.dryrun'
  | 'mutation.applied'
  | 'mutation.failed'
  | 'config.updated'
  | 'targeting.search';

export interface AuditEntry {
  ts: string;
  action: AuditAction;
  accountId?: string;
  tool?: string;
  requestedBy?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  result?: unknown;
  error?: string;
  meta?: Record<string, unknown>;
}

/**
 * Append-only audit log. Writes a JSON line per entry. In production this
 * should be shipped to a centralized log store (CloudWatch, BigQuery, etc.).
 */
export class AuditLog {
  private readonly path: string;
  private headerEnsured = false;

  constructor(path?: string) {
    this.path = path ?? getEnv().AUDIT_LOG_PATH;
  }

  record(entry: Omit<AuditEntry, 'ts'>): void {
    const full: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
      before: redactSecrets(entry.before),
      after: redactSecrets(entry.after),
      result: redactSecrets(entry.result),
      meta: redactSecrets(entry.meta) as Record<string, unknown> | undefined,
    };
    try {
      if (!this.headerEnsured) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.headerEnsured = true;
      }
      appendFileSync(this.path, JSON.stringify(full) + '\n', 'utf8');
    } catch (err) {
      getLogger().error({ err }, 'failed to write audit log');
    }
    getLogger().info({ audit: full }, `audit:${full.action}`);
  }
}

let cached: AuditLog | undefined;
export function getAuditLog(): AuditLog {
  if (!cached) cached = new AuditLog();
  return cached;
}
