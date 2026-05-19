# Architecture — oci-mcp

## High-level

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MCP Client (LLM agent)                        │
│   Cursor · Claude Desktop · Cline · VS Code · OpenCode · custom      │
└──────────────────────────────────────────────────────────────────────┘
                          │  MCP (stdio | HTTP-Streamable | SSE)
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          oci-mcp toolkit                              │
│                                                                       │
│  ┌────────────────────────────┐    ┌──────────────────────────────┐  │
│  │  Upstream Oracle servers   │    │     oci-extras-mcp (Node)    │  │
│  │  (uvx oracle.oci-*)        │    │  ─────────────────────────   │  │
│  │  • compute, identity       │    │  • OKE (clusters, pools…)    │  │
│  │  • networking, lb, nlb     │    │  • Vault & Secrets           │  │
│  │  • monitoring, logging     │    │  • Kubernetes layer          │  │
│  │  • registry, cloud-guard   │    │  • Functions                 │  │
│  │  • api (catch-all)         │    │  • Streaming logs (SSE)      │  │
│  │  • migration, support      │    │  • Meta / discovery           │  │
│  │  • limits, usage, pricing  │    │                              │  │
│  └────────────┬───────────────┘    └──────────────┬───────────────┘  │
│               │                                    │                  │
│               │                       ┌────────────┴───────────────┐  │
│               │                       │  Auth resolver (4 modes)   │  │
│               │                       │  Safety guards             │  │
│               │                       │   • dry-run default        │  │
│               │                       │   • destructive flag       │  │
│               │                       │   • ownership ledger       │  │
│               │                       │   • secret masking         │  │
│               │                       │  Audit log (JSONL)         │  │
│               │                       └────────────┬───────────────┘  │
└───────────────┼────────────────────────────────────┼─────────────────┘
                │                                    │
                ▼                                    ▼
       ┌──────────────────┐                ┌──────────────────────────┐
       │  OCI Python SDK  │                │  oci-sdk-node + k8s lib  │
       └────────┬─────────┘                └──────────────┬───────────┘
                │                                          │
                └──────────────────┬───────────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  Oracle Cloud Infrastructure │
                    │   IAM · OKE · KMS · Vault    │
                    │   Compute · Functions · Logs │
                    └──────────────────────────────┘
```

## Decisions

### D1 — Polyglot, agregator approach
We did **not** rewrite the official servers. They are mature, maintained by Oracle, and packaged on PyPI. We **wrap them** via configuration and add a single Node.js companion that fills the OKE/Vault/Functions/Streaming gap.

### D2 — Node.js for the custom server
Aligned with the existing `tfs-mcp` MCP in the same workspace, leveraging `@modelcontextprotocol/sdk`. The OCI SDK has full Node.js coverage for the services we target.

### D3 — Ownership ledger as JSON file
Stateless servers can't track resource ownership across restarts. A local JSON ledger persists OCIDs created by the MCP. For multi-instance deployments, the ledger location can be pointed at a shared filesystem or Object Storage (configurable via `OCI_MCP_OWNERSHIP_LEDGER`).

### D4 — Defense in depth for write operations
Three independent gates must align for a destructive op to succeed:
1. Tool category (destructive vs not)
2. Env flag (`OCI_MCP_ALLOW_DESTRUCTIVE`)
3. Per-call `confirm` parameter matching the resource identifier

For **third-party** resources (not in the ledger), a fourth gate is added: a two-step `requiresHumanAck` round-trip.

### D5 — HTTP Streamable + SSE for streaming
The MCP spec supports HTTP Streamable transport. We expose log tailing as long-running tools that stream chunks back. This works for Cline and any client supporting SSE; for stdio-only clients, the same tools fall back to a paginated bulk fetch.

## Data flow — destructive call on third-party resource

```
LLM ──► tool: oke_delete_cluster({ id, confirm })
                │
                ▼
       guards.checkDestructive() ── env flag? ── no ──► reject
                │ yes
                ▼
       guards.checkOwnership(id) ── in ledger? ── no ──► (third-party)
                │                                        │
                │                                        ▼
                │                          allowThirdParty? + confirm match? ── no ──► reject
                │                                        │ yes, but humanAck missing
                │                                        ▼
                │                          return { requiresHumanAck: true,
                │                                   message: "...", payload }
                │                                        │
                │                          (LLM shows user, user confirms)
                │                                        │
                │                          tool re-called with humanAck:true
                │                                        │
                ▼                                        ▼
       audit.log(call) ◄─────────────────────────────────┘
                │
                ▼
       OCI SDK ──► OCI control plane
                │
                ▼
       ledger.remove(id)  +  audit.log(result)
```

## Versioning

The custom server follows SemVer. Upstream Oracle servers are pinned via the generated MCP config (`@latest` only in dev configs).
