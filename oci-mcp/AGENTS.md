# AGENTS.md — Operating Policy For oci-mcp

This toolkit combines official Oracle MCP servers with the local `oci-extras-mcp`. Treat all calls as acting with the configured OCI identity permissions.

## Mandatory Safety Rules

- Keep OCI tools bound to localhost unless there is an explicit remote deployment design.
- Prefer session-token or least-privilege API key authentication for local development.
- Use dry-run first for create, update, scale, apply, rotate, delete or invoke operations that may change cloud state.
- Never reveal secret values unless the user explicitly asks and `OCI_MCP_ALLOW_SECRET_REVEAL=true` is intentionally set.
- Never mutate or delete a resource not created by this MCP unless the user confirms the exact resource name or OCID.
- Treat production compartments, OKE clusters, Vault/KMS keys, IAM policies and networking changes as high impact.

## Tool Groups

### READ
List, get, describe, recommend, health, log-tail and status tools are read oriented. They may still expose sensitive metadata, so summarize results when possible.

### WRITE
Create, update, apply, sync, rotate, invoke and scale tools should be called first with the effective dry-run behavior.

### DESTRUCTIVE
Delete, terminate, schedule deletion and third-party mutation require the server guardrails plus explicit human acknowledgement.

## Defaults

- Check active profile, region and compartment before mutating resources.
- Prefer `oci-extras-mcp` for OKE/Vault/Kubernetes workflows and official Oracle MCP servers for generic OCI service coverage.
- Keep audit logs, ownership ledger, kubeconfig and `.env` files out of Git.

## Public/private boundary

- Store real tenancy, compartment, cluster, Vault, function, stream and Kubernetes details only in `.env` or `local-private/`; both are ignored by Git.
- Keep kubeconfigs, ownership ledgers, exported manifests, operational runbooks and organization-specific scripts under `local-private/config`, `local-private/runbooks`, `local-private/scripts` or `local-private/tests`.
- Commit only neutral schemas, tools and examples. Never add real OCIDs, internal endpoints, account names or production topology to tracked documentation or fixtures.
