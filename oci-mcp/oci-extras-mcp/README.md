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

The server declares MCP annotations from an explicit allowlist: the 51-tool
contract marks every read-only operation as non-mutating and treats every other
operation conservatively. `npm test` validates the complete tool catalog over
both stdio and HTTP transports.

See [../BEST_PRACTICES.md](../BEST_PRACTICES.md#3-safety-guards-built-into-oci-extras-mcp).
