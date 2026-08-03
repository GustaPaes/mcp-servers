# oci-extras-mcp

Custom Node.js MCP server that complements [oracle/mcp](https://github.com/oracle/mcp) with first-class tools for **OKE (Kubernetes Engine)**, **Vault/Secrets**, **Kubernetes layer**, **Functions** and **streaming logs**.

> See the parent project's [README](../README.md) and [BEST_PRACTICES](../BEST_PRACTICES.md) for the full picture.

## Quick start

```powershell
npm install
copy ..\.env.example .env   # adjust values
npm start                    # stdio
# or
npm run start:http           # HTTP Streamable on :3020
```

## Tool categories

| Prefix | Domain |
|---|---|
| `oke_*` | Container Engine for Kubernetes |
| `vault_*` `kms_*` `secret_*` | Vault & KMS & Secrets |
| `k8s_*` | Kubernetes layer (uses kubeconfig from OKE) |
| `fn_*` | OCI Functions (FaaS) |
| `streaming_*` | Log/event tailing via SSE |
| `oci_*` | Meta / discovery |

## Safety

Every write tool obeys:
1. `dryRun` (default `true`)
2. `confirm` (required for destructive)
3. Atomic ownership ledger (corruption fails closed; third-party resources need `humanAck` round-trip)
4. Env flags: `OCI_MCP_ALLOW_DESTRUCTIVE`, `OCI_MCP_ALLOW_THIRD_PARTY_MUTATION`, `OCI_MCP_ALLOW_SECRET_REVEAL`

The server derives MCP annotations from an explicit 51-tool policy manifest.
Registration fails when a definition, handler or policy drifts. Inputs are
strict, every result follows the documented output envelope, and `npm test`
validates contracts plus stdio and HTTP transports.

Outbound OCI calls have bounded timeouts and retries. Create operations reuse
one provider `opcRetryToken` across attempts. HTTP sessions renew their idle TTL
on activity and close both transport and MCP server resources on expiry.

See [../BEST_PRACTICES.md](../BEST_PRACTICES.md#3-safety-guards-built-into-oci-extras-mcp).
