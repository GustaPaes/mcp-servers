# AGENTS.md — Operating Policy For oci-mcp

> This file complements the [workspace-wide instructions](../AGENTS.md). Their
> neutrality, reusability and local-content separation rules are mandatory.

This toolkit combines official Oracle MCP servers with the local `oci-extras-mcp`. Treat all calls as acting with the configured OCI identity permissions.

## Mandatory Safety Rules

- Keep OCI tools bound to localhost unless there is an explicit remote deployment design.
- Prefer session-token or least-privilege API key authentication for local development.
- Use dry-run first for create, update, scale, apply, rotate, delete or invoke operations that may change cloud state.
- Never reveal secret values unless the user explicitly asks and `OCI_MCP_ALLOW_SECRET_REVEAL=true` is intentionally set.
- Never mutate or delete a resource not created by this MCP unless the user confirms the exact resource name or OCID.
- Treat production compartments, OKE clusters, Vault/KMS keys, IAM policies and networking changes as high impact.

## Tool risk manifest

Every exported tool must have exactly one policy in `src/tool-manifest.js` using
the canonical classes `READ`, `LOCAL_STATE`, `EXECUTION`, `REMOTE_WRITE`,
`DESTRUCTIVE` or `SECRET_READ`. Startup and tests fail when a definition,
handler or policy drifts. MCP annotations are derived from this manifest.

- `READ` tools may be invoked without confirmation. Metadata can still be sensitive, so return only what is needed.
- `LOCAL_STATE` covers kubeconfig/session state and ownership-ledger updates. It requires clear user intent, not a redundant confirmation prompt.
- `EXECUTION` and `REMOTE_WRITE` use dry-run when supported. Non-idempotent execution must not be retried without a provider idempotency token.
- `SECRET_READ` is read-only for MCP annotations but remains disclosure-sensitive and must satisfy the secret-reveal guard.
- `DESTRUCTIVE` requires the environment gate, exact target confirmation and third-party acknowledgement where applicable.

Every tool returns the strict `{ ok, data, errors, meta }` envelope with an
`outputSchema`. Inputs are parsed strictly and reject unknown fields.

## Defaults

- Check active profile, region and compartment before mutating resources.
- Prefer `oci-extras-mcp` for OKE/Vault/Kubernetes workflows and official Oracle MCP servers for generic OCI service coverage.
- Keep audit logs, ownership ledger, kubeconfig and `.env` files out of Git.
- Keep audit redaction enabled; the server refuses to start when an environment override attempts to disable it.
- `LOCAL_STATE`, `EXECUTION`, `REMOTE_WRITE`, `DESTRUCTIVE` and `SECRET_READ` calls require a durable audit record before the handler runs. `AUDIT_UNAVAILABLE` means the handler did not start; `AUDIT_OUTCOME_UNKNOWN` means the handler may have changed state and must be reconciled before retrying.
- The official `oci-cloud` server's generic `invoke_oci_api` can call SDK write methods. Use separate OCI identities/profiles with least privilege for read and write workflows.
- Bound request timeouts, retries, polling duration, pagination, HTTP body size, session TTL and active-session count.
- HTTP activity refreshes session TTL. Session expiry and server shutdown must close both the MCP transport and its server instance.

## Public/private boundary

- Store real tenancy, compartment, cluster, Vault, function, stream and Kubernetes details only in `.env` or `local-private/`; both are ignored by Git.
- Keep kubeconfigs, ownership ledgers, exported manifests, operational runbooks and organization-specific scripts under `local-private/config`, `local-private/runbooks`, `local-private/scripts` or `local-private/tests`.
- Commit only neutral schemas, tools and examples. Never add real OCIDs, internal endpoints, account names or production topology to tracked documentation or fixtures.
