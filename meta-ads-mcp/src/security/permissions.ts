import type { AccountConfig, AccountMode } from '../schemas/account.schema.js';
import { getEnv } from '../config/env.js';

export type Capability =
  | 'read'
  | 'recommend'
  | 'draft' // create local drafts (no API mutation)
  | 'mutate.budget'
  | 'mutate.status' // publish/pause
  | 'mutate.create'
  | 'mutate.delete';

const MODE_CAPS: Record<AccountMode, Set<Capability>> = {
  'read-only': new Set(['read', 'recommend']),
  'dry-run': new Set(['read', 'recommend', 'draft']),
  'write-enabled': new Set([
    'read',
    'recommend',
    'draft',
    'mutate.budget',
    'mutate.status',
    'mutate.create',
    'mutate.delete',
  ]),
};

export interface CapabilityCheckResult {
  allowed: boolean;
  reason?: string;
  /** Effective mode considering global READ_ONLY/DRY_RUN env switches. */
  effectiveMode: AccountMode;
}

export function effectiveMode(account: AccountConfig): AccountMode {
  const env = getEnv();
  // Global switches always reduce capabilities, never expand them.
  if (env.READ_ONLY) return 'read-only';
  if (env.DRY_RUN && account.mode === 'write-enabled') return 'dry-run';
  return account.mode;
}

export function checkCapability(
  account: AccountConfig,
  capability: Capability,
): CapabilityCheckResult {
  const mode = effectiveMode(account);
  const allowed = MODE_CAPS[mode].has(capability);
  return {
    allowed,
    effectiveMode: mode,
    reason: allowed
      ? undefined
      : `Capability "${capability}" not permitted for account "${account.id}" in mode "${mode}". ` +
        `Set account mode to "write-enabled" and unset READ_ONLY/DRY_RUN to allow.`,
  };
}

/**
 * For mutating tools, callers must explicitly opt in. We require:
 *   - confirm=true
 *   - non-empty reason
 *   - non-empty requestedBy
 *   - dryRun=false (otherwise we only simulate)
 */
export interface MutationConfirmation {
  confirm?: boolean;
  reason?: string;
  requestedBy?: string;
  dryRun?: boolean;
}

export interface ConfirmationCheckResult {
  willMutate: boolean;
  reason?: string;
}

export function checkMutationConfirmation(c: MutationConfirmation): ConfirmationCheckResult {
  if (c.dryRun !== false) {
    return { willMutate: false, reason: 'dryRun is not explicitly set to false' };
  }
  if (!c.confirm) return { willMutate: false, reason: 'confirm must be true' };
  if (!c.reason || c.reason.trim().length < 5) {
    return { willMutate: false, reason: 'reason must be a meaningful string (>=5 chars)' };
  }
  if (!c.requestedBy || c.requestedBy.trim().length < 2) {
    return { willMutate: false, reason: 'requestedBy is required' };
  }
  return { willMutate: true };
}
