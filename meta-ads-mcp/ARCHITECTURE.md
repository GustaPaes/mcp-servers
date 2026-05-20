# Architecture — meta-ads-mcp

## High-level

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MCP Client (LLM agent)                        │
│   Claude Desktop · Cursor · Cline · OpenCode · VS Code · custom      │
└──────────────────────────────────────────────────────────────────────┘
                          │  MCP (stdio | Streamable HTTP)
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          meta-ads-mcp                                 │
│                                                                       │
│  ┌──────────────────────────┐    ┌────────────────────────────────┐  │
│  │   Transports             │    │   MCP surfaces                  │  │
│  │   • stdio                │    │   • accounts / campaigns /     │  │
│  │   • Streamable HTTP      │───▶│     adsets / creatives /       │  │
│  │     (bearer auth,        │    │     insights / optimization /  │  │
│  │      stateful sessions)  │    │     policy / targeting tools   │  │
│  │                          │    │   • audit/draft resources      │  │
│  │                          │    │   • operational prompts        │  │
│  └──────────────────────────┘    └────────────────┬───────────────┘  │
│                                                    │                  │
│                          ┌────────────────────────┼─────────────┐    │
│                          ▼                        ▼             ▼    │
│                ┌──────────────────┐   ┌────────────────┐  ┌────────┐ │
│                │  Engines (pure)  │   │  Security      │  │ Audit  │ │
│                │  • Optimization  │   │  • permissions │  │ JSONL  │ │
│                │  • Budget        │   │  • secrets     │  │ append │ │
│                │  • Creative      │   │  • mutation    │  │ only   │ │
│                │  • Audience      │   │    gate        │  │ redact │ │
│                │  • PolicyRisk    │   └────────┬───────┘  └────┬───┘ │
│                └──────────────────┘            │               │     │
│                                                ▼               ▼     │
│                                       ┌────────────────────────────┐ │
│                                       │      ToolContext           │ │
│                                       │   accounts · meta · storage│ │
│                                       │   audit · engines          │ │
│                                       └─────────┬──────────────────┘ │
│                                                 │                    │
│  ┌──────────────────────────┐    ┌─────────────┴─────────────────┐  │
│  │   AccountRegistry        │    │   Storage backend             │  │
│  │   • file-based config    │    │   • file (default)            │  │
│  │   • tokenEnvVar lookup   │    │   • memory (tests)            │  │
│  │   • per-account caps     │    │   • prisma (Postgres, opt.)   │  │
│  └──────────────────────────┘    └───────────────────────────────┘  │
│                                                                       │
│                          ┌──────────────────────────────────────┐    │
│                          │   MetaAdsClient (undici)             │    │
│                          │   • retry/backoff/jitter             │    │
│                          │   • Meta-specific retryable codes    │    │
│                          │   • token mask in logs               │    │
│                          └──────────────────┬───────────────────┘    │
└─────────────────────────────────────────────┼────────────────────────┘
                                              │
                                              ▼
                            ┌──────────────────────────────────┐
                            │  Meta Marketing API (Graph v21)  │
                            │  • Campaigns / AdSets / Ads      │
                            │  • Insights                      │
                            │  • Targeting Search              │
                            └──────────────────────────────────┘
```

## Decisions

### D1 — Engines never call the API
`OptimizationEngine`, `BudgetEngine`, `CreativeAnalysisEngine`, `AudienceStrategyEngine` and `PolicyRiskEngine` are deterministic and pure. They take insights/inputs and return recommendations. The **tools** orchestrate engines + `MetaAdsClient`. This keeps the engines trivially testable and the mutation surface area minimal.

### D2 — Three independent mutation gates
Defense in depth:

1. **Tool category** — only a handful of tools are flagged mutating.
2. **Account mode** — `read-only` / `dry-run` / `write-enabled`.
3. **Global env switches** — `READ_ONLY=true` collapses every account to `read-only`; `DRY_RUN=true` collapses `write-enabled` to `dry-run`.

For budget tools, a **fourth gate** kicks in: per-account `maxDailyBudget` / `maxBudgetChangePct` AND global `GLOBAL_MAX_DAILY_BUDGET` / `GLOBAL_MAX_BUDGET_CHANGE_PCT`.

### D3 — Per-call confirmation contract
Every Meta-mutating call requires `confirm:true + reason(≥5) + requestedBy(≥2) + dryRun:false`. The LLM cannot accidentally mutate by hallucinating a sensible default — the absence of any field returns a dry-run plan.

### D4 — Tokens via env var indirection (`tokenEnvVar`)
`config/accounts.json` never holds tokens. Each account has `"tokenEnvVar": "META_TOKEN_ACME_FASHION"` and the registry resolves at call time. Result: the JSON is safe to commit (we still gitignore it) and token rotation is a single env-var change.

### D5 — Append-only JSONL audit log
Every tool invocation, every rejection, every mutation produces a JSON line through `AuditLog`. All entries pass through `redactSecrets` (regex on `EAA…`, `Bearer …`, `access_token=…`). In production, ship the JSONL to a centralized store (CloudWatch, BigQuery, Loki).

### D6 — Stdio AND Streamable HTTP from the same `buildMcpServer()`
The transport is selected by `MCP_TRANSPORT`. Both transports go through the EXACT same `buildMcpServer()` factory — there is no parallel tool-registration path that could drift.

HTTP supports:
- **Stateful sessions** (default) with `Mcp-Session-Id` header.
- **Stateless** one-shot when `MCP_HTTP_STATEFUL=false`.
- **Bearer auth** via CSV in `MCP_HTTP_BEARER_TOKENS`. Empty = no auth (only safe on localhost; logged as warning otherwise).
- **Healthcheck** at `GET /healthz`.

### D7 — Resources and prompts are first-class MCP surfaces
Resources provide read-only, secret-redacted context:

- `meta-ads://accounts/config-summary`
- `meta-ads://audit/recent`
- `meta-ads://audit/account/{accountId}`
- `meta-ads://drafts/all`
- `meta-ads://drafts/account/{accountId}`

Prompts encode repeatable operating workflows:

- `weekly_account_audit`
- `campaign_launch_plan`
- `creative_review_playbook`

These surfaces keep LLM clients from re-discovering the same workflow every session and provide a stable bridge for the future web panel without bypassing tool-level guardrails.

### D8 — Pluggable storage with file as default
`Storage` is an interface (`read()`/`write()` of `StorageState`). The factory in `src/storage/factory.ts` picks the implementation:

- `file` — `FileStorage` writes JSON. Zero-config.
- `memory` — `MemoryStorage` for tests.
- `prisma` — `PrismaStorage` against Postgres. `@prisma/client` is loaded via dynamic import so it's a truly optional dependency.

Prisma schema in `prisma/schema.prisma` uses a single `Draft` table with a `kind` enum and a JSON `data` column. Trade-off: simple migrations, no per-domain joins; the MCP doesn't need them.

### D9 — Web panel stays out of the protocol
The optional `web-panel/` (Next.js + shadcn + TanStack + Recharts, 8 screens) talks to the MCP over the HTTP transport. It does NOT call Meta directly. Every panel action flows through the same validation/audit chain that an LLM goes through. Currently architecture-only.

## Data flow — applying a budget change

```
LLM ──► apply_budget_change({
          accountId, adSetId, newDailyBudget,
          confirm, reason, requestedBy, dryRun:false
        })
            │
            ▼
   checkCapability(account, 'mutate.budget')
            │ allowed?
            ▼
   checkMutationConfirmation(confirm, reason, requestedBy, dryRun)
            │ willMutate?
            ▼
   BudgetEngine.validateChange({
     currentBudget, newBudget, accountCaps, globalCaps
   })
            │ within caps?
            ▼
   MetaAdsClient.updateAdSetBudget(account, adSet, newBudget)
            │ HTTP 200?
            ▼
   AuditLog.record({ action:'mutation.applied', before, after })
            │
            ▼
   ok({ before, after, deltaPct })
```

At ANY step that returns "no", the tool returns either:

- a **dry-run plan** envelope (for confirmation/permission failures), or
- a **`fail()` envelope** with a clear `BudgetCapExceeded` / `CapabilityDenied` reason (for cap failures), and the audit log records `mutation.failed` / `tool.rejected`.

## Versioning

`meta-ads-mcp` follows SemVer. The Meta Graph API version is pinned via `META_GRAPH_API_VERSION` (default `v21.0`). Breaking changes in the Graph API are tracked in [`CHANGELOG.md`](./CHANGELOG.md).
