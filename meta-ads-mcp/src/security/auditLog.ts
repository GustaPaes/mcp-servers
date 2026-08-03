import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getEnv } from '../config/env.js';
import { getLogger, redactSecrets } from '../utils/logger.js';

export type AuditAction =
  | 'tool.invoked'
  | 'tool.completed'
  | 'tool.failed'
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

export interface AuditRecordOptions {
  /** Fail before a consequential operation when its audit trail is unavailable. */
  required?: boolean;
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

  record(entry: Omit<AuditEntry, 'ts'>, options: AuditRecordOptions = {}): void {
    const full: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
      before: redactSecrets(entry.before),
      after: redactSecrets(entry.after),
      result: redactSecrets(entry.result),
      error: redactSecrets(entry.error) as string | undefined,
      meta: redactSecrets(entry.meta) as Record<string, unknown> | undefined,
    };
    try {
      if (!this.headerEnsured) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.headerEnsured = true;
      }
      appendFileSync(this.path, JSON.stringify(full) + '\n', 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error({ err: redactSecrets(message) }, 'failed to write audit log');
      if (options.required) {
        throw new Error(`Required audit write failed: ${message}`);
      }
    }
    getLogger().info({ audit: full }, `audit:${full.action}`);
  }
}

let cached: AuditLog | undefined;
export function getAuditLog(): AuditLog {
  if (!cached) cached = new AuditLog();
  return cached;
}
