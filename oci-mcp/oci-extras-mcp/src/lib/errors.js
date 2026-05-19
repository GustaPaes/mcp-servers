/**
 * Normalise OCI SDK errors into a flat shape useful for LLM responses.
 */
export function normaliseError(err) {
  return {
    message: err.message ?? String(err),
    statusCode: err.statusCode ?? err.status ?? null,
    code: err.code ?? err.serviceCode ?? null,
    opcRequestId: err.opcRequestId ?? null,
    targetService: err.targetService ?? null,
    operationName: err.operationName ?? null,
  };
}
