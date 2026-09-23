/**
 * Tool wrapper — uniform error handling, audit, validation.
 * Every tool registered with the MCP server is wrapped through this helper.
 */
import { audit, auditCritical, logger, normaliseError } from "./audit.js";
import { GuardError } from "./guards.js";
import { TOOL_POLICIES } from "../tool-manifest.js";

const AUDITED_BEFORE_EXECUTION = new Set(["LOCAL_STATE", "EXECUTION", "REMOTE_WRITE", "DESTRUCTIVE", "SECRET_READ"]);

function auditInputSummary(input) {
  const entries = Object.entries(input ?? {});
  return {
    inputKeys: entries.map(([key]) => key).slice(0, 100),
    target: Object.fromEntries(entries
      .filter(([key, value]) => /(?:id|name|ocid|namespace)$/i.test(key) && ["string", "number"].includes(typeof value))
      .slice(0, 10)
      .map(([key, value]) => [key, String(value).slice(0, 200)])),
  };
}

/**
 * Wrap a tool handler with audit + error normalisation.
 *
 * @param {string} name
 * @param {function} handler  async (input) => result
 * @returns {function}
 */
export function withSafety(name, handler) {
  return async (input = {}) => {
    const start = Date.now();
    const critical = AUDITED_BEFORE_EXECUTION.has(TOOL_POLICIES[name]?.risk);
    let handlerStarted = false;
    let handlerCompleted = false;
    try {
      if (critical) auditCritical({ tool: name, status: "started", durationMs: 0, ...auditInputSummary(input) });
      handlerStarted = true;
      const output = await handler(input);
      handlerCompleted = true;
      const record = {
        tool: name,
        status: "ok",
        durationMs: Date.now() - start,
        ...(critical ? auditInputSummary(input) : { input }),
        output: critical ? { ok: output?.ok !== false, code: output?.code ?? null } : summarise(output),
      };
      if (critical) auditCritical(record);
      else audit(record);
      return output;
    } catch (err) {
      const safeError = normaliseError(err);
      if (critical) {
        if (!handlerStarted) {
          logger.error({ tool: name }, "critical audit unavailable before operation");
          return { ok: false, error: "Auditoria indisponível; operação não iniciada.", code: "AUDIT_UNAVAILABLE" };
        }
        try {
          auditCritical({ tool: name, status: "error", durationMs: Date.now() - start, ...auditInputSummary(input), error: safeError });
        } catch {
          logger.error({ tool: name }, "critical audit unavailable after operation");
          return { ok: false, error: "Não foi possível registrar o resultado; confira o estado remoto antes de repetir.", code: "AUDIT_OUTCOME_UNKNOWN" };
        }
        if (handlerCompleted) {
          return { ok: false, error: "Não foi possível registrar o resultado; confira o estado remoto antes de repetir.", code: "AUDIT_OUTCOME_UNKNOWN" };
        }
      } else {
        audit({ tool: name, status: "error", durationMs: Date.now() - start, input, error: safeError });
      }
      logger.error({ error: safeError, tool: name }, "tool error");
      if (err instanceof GuardError) {
        return { ok: false, error: safeError.message, code: err.code };
      }
      return {
        ok: false,
        error: safeError.message,
        code: err.code || "TOOL_ERROR",
        statusCode: err.statusCode,
        opcRequestId: err.opcRequestId,
      };
    }
  };
}

function summarise(o) {
  // Avoid logging huge payloads (e.g. kubeconfig). Cap strings at 1000 chars.
  if (o == null) return o;
  const s = JSON.stringify(o);
  if (s.length <= 4000) return o;
  return { _truncated: true, preview: s.slice(0, 4000) + "…" };
}
