/**
 * Safety guards — run BEFORE any write/destructive tool actually contacts OCI.
 *
 * Three layered policies:
 *   1. Destructive flag (env-gated)
 *   2. Confirmation parameter (must match resource name/ocid exactly)
 *   3. Ownership ledger (third-party resources need extra humanAck round-trip)
 *
 * Tools call these helpers and either get { ok: true } and proceed,
 * or get { ok: false, reason } / { ok: false, requiresHumanAck, message, payload }
 * which they MUST return verbatim to the LLM (without contacting OCI).
 */
import { config } from "../config.js";
import * as ownership from "./ownership.js";

export class GuardError extends Error {
  constructor(message, code = "GUARD_BLOCKED") {
    super(message);
    this.code = code;
  }
}

/**
 * Check whether dry-run is in effect. Returns the *effective* dryRun.
 * Tools should branch on this and return a "plan" instead of executing.
 */
export function effectiveDryRun(input) {
  if (typeof input?.dryRun === "boolean") return input.dryRun;
  return config.defaultDryRun;
}

/**
 * Validate confirmation token: must match either the resource name or its OCID.
 */
function confirmMatches(input, { name, ocid }) {
  const c = (input?.confirm ?? "").trim();
  if (!c) return false;
  if (name && c === name) return true;
  if (ocid && c === ocid) return true;
  return false;
}

/**
 * Comprehensive guard for ANY mutation (create with overrides, update, delete).
 *
 * @param {object} opts
 * @param {object} opts.input        - tool input
 * @param {string} opts.action       - 'create' | 'update' | 'delete' | 'rotate' | ...
 * @param {string} [opts.ocid]       - target OCID (required for update/delete)
 * @param {string} [opts.name]       - human name (used for confirm matching)
 * @param {string} [opts.resourceType] - e.g. 'oke_cluster'
 * @param {boolean} [opts.destructive] - true for delete/terminate/schedule_deletion
 * @returns {object} { ok, reason?, requiresHumanAck?, message?, payload? }
 */
export function guardMutation(opts) {
  const { input = {}, action, ocid, name, resourceType, destructive = false } = opts;

  // ----- Destructive flag gate -----
  if (destructive && !config.allowDestructive) {
    return {
      ok: false,
      reason:
        `Destructive action '${action}' on ${resourceType ?? "resource"} is blocked. ` +
        `Set OCI_MCP_ALLOW_DESTRUCTIVE=true and re-call with confirm:"<name-or-ocid>" to proceed.`,
    };
  }

  // ----- Confirmation gate (always required for destructive) -----
  if (destructive && !confirmMatches(input, { name, ocid })) {
    return {
      ok: false,
      reason:
        `Destructive action '${action}' requires explicit confirmation. ` +
        `Re-call with confirm:"${name ?? ocid}" (must match the resource name or OCID exactly).`,
    };
  }

  // ----- Ownership / third-party gate -----
  // Applies whenever we touch an existing OCID (update or delete).
  if (ocid && (action === "update" || action === "delete" || destructive)) {
    const owned = ownership.isOwned(ocid);

    if (!owned) {
      // Resource was NOT created by this MCP — treat as third-party.
      if (!config.allowThirdPartyMutation) {
        return {
          ok: false,
          reason:
            `Resource ${ocid} was NOT created by this MCP server (not in the ownership ledger). ` +
            `Modifying or deleting third-party resources is disabled. ` +
            `Set OCI_MCP_ALLOW_THIRD_PARTY_MUTATION=true to enable, then re-call with ` +
            `confirm:"${name ?? ocid}" and humanAck:true after a human acknowledges the prompt.`,
        };
      }

      // Confirm + humanAck required
      if (!confirmMatches(input, { name, ocid })) {
        return {
          ok: false,
          reason:
            `Mutating a third-party resource requires confirm:"${name ?? ocid}" matching exactly.`,
        };
      }
      if (!input.humanAck) {
        return {
          ok: false,
          requiresHumanAck: true,
          message:
            `⚠️  About to ${action.toUpperCase()} a resource that was NOT created by this MCP.\n` +
            `Type:        ${resourceType ?? "(unknown)"}\n` +
            `OCID:        ${ocid}\n` +
            `Name:        ${name ?? "(unknown)"}\n\n` +
            `This resource pre-existed your MCP session. Please confirm with the user that ` +
            `they explicitly want to ${action} it. If yes, re-call this tool with humanAck:true.`,
          payload: { ocid, name, action, resourceType },
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Specialised guard for secret reveal.
 */
export function guardSecretReveal(input) {
  if (input?.reveal !== true) return { ok: true, mask: true };
  if (!config.allowSecretReveal) {
    return {
      ok: false,
      reason:
        "Secret reveal is disabled. Set OCI_MCP_ALLOW_SECRET_REVEAL=true to enable, " +
        "then re-call with reveal:true.",
    };
  }
  return { ok: true, mask: false };
}

/**
 * Helper to build a "plan" response for dry-run executions.
 */
export function buildDryRunPlan({ action, resourceType, target, payload }) {
  return {
    dryRun: true,
    action,
    resourceType,
    target,
    payload,
    note: "No changes were made. Re-call with dryRun:false to execute.",
  };
}
