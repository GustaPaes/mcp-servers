/**
 * Tool wrapper — uniform error handling, audit, validation.
 * Every tool registered with the MCP server is wrapped through this helper.
 */
import { audit, logger } from "./audit.js";
import { GuardError } from "./guards.js";

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
    try {
      const output = await handler(input);
      audit({
        tool: name,
        status: "ok",
        durationMs: Date.now() - start,
        input,
        output: summarise(output),
      });
      return output;
    } catch (err) {
      audit({
        tool: name,
        status: "error",
        durationMs: Date.now() - start,
        input,
        error: { message: err.message, code: err.code, stack: err.stack?.split("\n")[0] },
      });
      logger.error({ err, tool: name }, "tool error");
      if (err instanceof GuardError) {
        return { ok: false, error: err.message, code: err.code };
      }
      return {
        ok: false,
        error: err.message || String(err),
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
