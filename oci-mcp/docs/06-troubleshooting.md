# 06 — Troubleshooting

## Server won't start

| Symptom                                            | Fix                                                                 |
|----------------------------------------------------|----------------------------------------------------------------------|
| `Error: Cannot find module '@modelcontextprotocol/sdk'` | `npm install` inside `oci-extras-mcp`.                          |
| `EADDRINUSE` on `--http`                           | Another process on `MCP_HTTP_PORT`. Change port in `.env`.          |
| `ENOENT ~/.oci/config`                             | Run `oci setup config` or set `OCI_AUTH_METHOD=instance_principal`. |

## Tool calls fail

| Error                              | Likely cause / fix                                                       |
|------------------------------------|--------------------------------------------------------------------------|
| `NotAuthenticated`                 | Session token expired → `scripts/refresh-oci-session.ps1`.               |
| `NotAuthorizedOrNotFound`          | Missing IAM policy or wrong compartment. Cross-check with `oci_whoami`. |
| `LimitExceeded`                    | Service limit hit (e.g. node count). Request limit increase in OCI console. |
| `dryRun:true returned`             | That's success — re-call with `dryRun:false, confirm:true`.              |
| `third-party mutation refused`     | Resource not in ledger. Use `*_register_existing` or set the explicit env flag + `humanAck:true`. |

## Kubernetes layer

- `KUBECONFIG` env wins over `~/.kube/config`. Verify with `kubectl config view`.
- After `oke_get_kubeconfig { mergeIntoLocal:true }`, the new context is
  `context-<clusterName>`; switch with `kubectl config use-context`.
- TLS errors → most often the cluster API is private. Run the MCP from a host
  with VPN/Bastion access, or switch to a public-endpoint cluster for testing.

## Streaming

- `streaming_tail_pod_logs` requires the cluster to be reachable.
- `streaming_tail_oci_log` polls Logging Search every `pollIntervalMs` (default
  3000). High-cardinality queries can be throttled — add a tighter
  `searchQuery`.

## Audit & ledger

- Audit log: `./logs/audit.jsonl` (override via `OCI_MCP_AUDIT_LOG`).
- Ledger: `./.ownership-ledger.json` (override via `OCI_MCP_OWNERSHIP_LEDGER`).
- Inspect ownership programmatically: `oci_ledger_dump`.

## Diagnostics

```powershell
# Re-run smoke tests
cd oci-extras-mcp
npm run smoke
npm run smoke:http
npm run test:auth
```

If the smoke tests pass but a specific tool fails, run the MCP with
`LOG_LEVEL=debug` and re-issue the call — the audit log will capture the
SDK error verbatim.
