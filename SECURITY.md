# Security policy

## Public/private boundary

This repository contains reusable MCP implementations and fictional examples.
Credentials, customer or employer identifiers, internal URLs, real resource
inventories, personal career data, browser profiles and operational runbooks
must never be committed.

Use `.env`, `data/` or a `local-private/` directory inside the relevant MCP.
Those paths are ignored by Git. Organization-specific Azure material belongs in
`azure-mcp/local-private/`, with optional `config`, `docs`, `runbooks`,
`scripts` and `tests` subdirectories.

Before every push:

```powershell
git status --short
npm run validate:fast
gitleaks git --redact
```

Do not bypass ignore rules with `git add -f` for private material. Examples must
use reserved domains, placeholder IDs and synthetic tokens.

## Runtime security baseline

- Treat MCP annotations and agent instructions as usability metadata, not as an
  authorization boundary. Enforce destructive, secret-reading and high-impact
  guards inside the server.
- Bind HTTP transports to loopback by default. Remote exposure requires
  authentication, request/session limits, idle expiry and graceful shutdown.
- Restrict file access after resolving symbolic links. Use dedicated ignored
  roots for uploads, exports and generated artifacts, with quotas and retention.
- When forwarding credentials, only call configured provider origins. Validate
  redirects and block unintended private or cloud-metadata destinations.
- Apply bounded timeouts and retry budgets. Never retry a non-idempotent mutation
  unless it has a provider-supported idempotency or deduplication key.
- Centralize structured audit and redact secrets before logs, errors and MCP
  responses. Critical remote mutations must not silently continue when their
  required audit record cannot be persisted.

## Reporting

Report a vulnerability privately through GitHub Security Advisories for this
repository. Do not open a public issue containing credentials or private data.

If a real credential is ever committed, revoke or rotate it first, then purge
the affected paths or values from every Git ref and force-push the sanitized
history. Rewriting history alone does not invalidate a leaked credential.
