# Changelog

All notable changes to **meta-ads-mcp** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-20

### Added
- Initial release of **meta-ads-mcp**: a multi-account MCP server for the
  Meta Marketing API (Facebook Ads / Instagram Ads).
- **26 tools** grouped in 8 domains:
  accounts, campaigns, ad sets, creatives, insights, optimization, policy,
  targeting.
- **Two transports** wired into the same tool registry:
  - `stdio` (default) for Claude Desktop / Cursor / OpenCode / Cline.
  - Streamable HTTP (`MCP_TRANSPORT=http`) with stateful sessions,
    optional Bearer auth and `/healthz` endpoint.
- **Multi-account configuration** via `config/accounts.json` with the
  `tokenEnvVar` indirection — tokens never live in JSON or code.
- Three account modes: `read-only`, `dry-run`, `write-enabled`.
- **Mutation contract** enforced by `permissions.checkMutationConfirmation`:
  `confirm + reason(≥5) + requestedBy(≥2) + dryRun:false`.
- **Triple budget cap**: per-account `maxDailyBudget` and
  `maxBudgetChangePct` + global `GLOBAL_MAX_DAILY_BUDGET` and
  `GLOBAL_MAX_BUDGET_CHANGE_PCT`.
- Global kill-switches `READ_ONLY` and `DRY_RUN` that reduce effective
  capabilities for every account.
- Newly created campaigns are always published as `PAUSED`.
- Deterministic engines (never call the API):
  - `OptimizationEngine` — performance vs goals.
  - `BudgetEngine` — safe budget recommendation + cap validation.
  - `CreativeAnalysisEngine` — copy/hook scoring.
  - `AudienceStrategyEngine` — cold / warm / hot funnel.
  - `PolicyRiskEngine` — protected-attribute block, forbidden words,
    Special Ad Category hints.
- `MetaAdsClient` (undici) with timeout, exponential backoff + jitter and
  Meta-specific retryable codes (1, 2, 4, 17, 32, 613, 429, 5xx).
- **Append-only JSONL audit log** with secret redaction
  (`EAA…`, `Bearer …`, `access_token=…`).
- **Pluggable storage** via `STORAGE_BACKEND`:
  `file` (default) / `memory` (tests) / `prisma` (optional Postgres).
  Prisma schema included in `prisma/schema.prisma`; `@prisma/client` is a
  dynamic import so it stays a truly optional dependency.
- New tool `search_targeting_ids` against Meta `/search` endpoint
  (`adinterest`, `adinterestsuggestion`, `adlocale`, `adgeolocation`,
  `adeducationschool`, `adeducationmajor`, `adworkemployer`,
  `adworkposition`).
- MCP **Resources** for secret-redacted operational context:
  `meta-ads://accounts/config-summary`, `meta-ads://audit/recent`,
  `meta-ads://audit/account/{accountId}`, `meta-ads://drafts/all`,
  `meta-ads://drafts/account/{accountId}`.
- MCP **Prompts** for repeatable workflows:
  `weekly_account_audit`, `campaign_launch_plan`,
  `creative_review_playbook`.
- 22+ vitest tests covering policy, budget, permissions, secret redaction,
  Zod schemas, resources and targeting search normalization.
- Documentation suite aligned with the repo standard:
  `README.md` (bilingual EN/PT), `AGENTS.md`, `BEST_PRACTICES.md`,
  `ARCHITECTURE.md`, `mcp.json.example`, `.env.example`,
  `config/accounts.example.json`.
- Optional `web-panel/` implementation in Next.js 15:
  account selector, dashboard, campaigns, campaign detail,
  recommendations, creative analysis, settings and audit screens.
  The panel talks to the MCP over Streamable HTTP and never calls Meta
  Graph API directly.

### Security
- Tokens are read exclusively from environment variables referenced by
  `tokenEnvVar` in `accounts.json`. They are never logged, never returned
  by tools and never written to the audit log (regex-redacted).
- Targeting by protected attributes (race, religion, sexual orientation,
  gender identity, health status, political affiliation, immigration
  status, criminal history) is rejected at the engine level. The LLM is
  instructed (via `AGENTS.md`) not to paraphrase around the block.
- HTTP transport without `MCP_HTTP_BEARER_TOKENS` is only allowed on
  `127.0.0.1`; non-local hosts without auth produce a startup warning.

### Known limitations
- No Lead Ads form download, Conversions API ingestion or asset upload.
- No automated rules / scheduled mutations — every change is manual.
- No `delete_campaign` / `delete_ad_set` / `delete_ad` tools. Use Meta
  Ads Manager for deletions.
- Web panel v0.1 uses local password auth and server-rendered pages.
  NextAuth/SSO, RBAC, TanStack Query and Recharts remain future upgrades.
