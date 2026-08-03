# Meta Ads MCP

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Meta Marketing API](https://img.shields.io/badge/Meta%20Marketing%20API-v25.0-1877F2?logo=meta&logoColor=white)](https://developers.facebook.com/docs/marketing-apis)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.x-6f42c1)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

🇺🇸 **English** · 🇧🇷 [Português](#-português)

> Project-specific README. For the broader bilingual MCP collection see [`../README.md`](../README.md). For the operating policy LLMs must follow, see [`AGENTS.md`](./AGENTS.md).

---

> A **production-grade, multi-account** Model Context Protocol server for the [Meta Marketing API](https://developers.facebook.com/docs/marketing-apis) (Facebook Ads / Instagram Ads). It lets an LLM **analyze, recommend and — only with explicit human confirmation — execute** changes on real ad accounts, with audit, dry-run, budget caps and policy guardrails.

Built in TypeScript (strict). Stdio **and** Streamable HTTP transports. Logs go to stderr. Tokens are read from environment variables, never from JSON or code. Mutations are gated by three independent checks (per-call confirmation, account mode, global `READ_ONLY`/`DRY_RUN`).

---

## Why this exists

There are several open-source Meta Ads MCP servers around (`pipeboard-co/meta-ads-mcp`, `mikusnuz/meta-ads-mcp`, etc.). They are good starting points but, for paid-media operations on **real client budgets**, none of them models:

| Need | Most public servers | This MCP |
|------|---------------------|----------|
| Strict **recommend ↔ execute** separation | mixed | ✅ engines never call the API; tools do |
| **Multi-account** with per-account caps and mode (`read-only` / `dry-run` / `write-enabled`) | single token via env | ✅ `accounts.json` + `tokenEnvVar` indirection |
| **Mutation gate**: `confirm + reason + requestedBy + dryRun:false` | often missing | ✅ enforced by `permissions.checkMutationConfirmation` |
| **Global kill-switch** (`READ_ONLY=true`) that downgrades every account | — | ✅ reduces effective mode for every call |
| **Triple budget cap** (per-account + global daily + max % change) | — | ✅ `BudgetEngine` + env-level caps |
| **Audit log** as append-only JSONL with secret redaction | partial | ✅ `auditLog.ts` + `redactSecrets` |
| **Protected-attribute targeting** block (race, religion, health, politics, sexual orientation) | — | ✅ `PolicyRiskEngine` |
| **Special Ad Categories** awareness (HOUSING / EMPLOYMENT / CREDIT / ISSUES_ELECTIONS_POLITICS) | partial | ✅ surfaced in policy + create-campaign flow |
| Real **targeting ID lookup** via `/search` | placeholders | ✅ `search_targeting_ids` tool |
| **HTTP transport** for remote / web-panel use | stdio only | ✅ Streamable HTTP with Bearer auth |
| **Pluggable storage** (file / memory / Postgres via Prisma) | file only | ✅ via `STORAGE_BACKEND` |

What we **don't** do, on purpose:

- No automatic mutations on a schedule (cron-style). A human (or LLM-with-human) must trigger every change.
- No promise of results. Every recommendation is heuristic and labeled as such.
- No support for Lead Ads form download, Conversions API ingestion, or asset upload in v0.1 — tracked as backlog.

---

## Requirements

- **Node.js >= 20.19.0**
- A Meta **System User access token** with `ads_management` + `ads_read` scopes for each ad account you want to operate
- The numeric Ad Account ID (the one starting with `act_`)

## Install

```powershell
cd "<repo-root>/meta-ads-mcp"
npm install
npm run build
```

## Configuration

### 1) Environment

Copy `.env.example` to `.env` and adjust:

```env
NODE_ENV=development
LOG_LEVEL=info

# Multi-account config (tokens are NOT here — see step 2)
ACCOUNTS_CONFIG_PATH=./config/accounts.json
AUDIT_LOG_PATH=./data/audit.log
STORAGE_PATH=./data/storage.json

# Meta Graph API
META_GRAPH_API_VERSION=v25.0
META_GRAPH_API_BASE_URL=https://graph.facebook.com

# Global safety switches
READ_ONLY=true    # disables every mutating tool everywhere
DRY_RUN=true      # mutating tools simulate but never call the real API

# Triple budget cap (in account currency, major units)
GLOBAL_MAX_DAILY_BUDGET=500
GLOBAL_MAX_BUDGET_CHANGE_PCT=25

# Transport: stdio (default) or http
MCP_TRANSPORT=stdio
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=8787
MCP_HTTP_BEARER_TOKENS=          # CSV; empty disables auth (localhost only!)
MCP_HTTP_STATEFUL=true

# Storage backend: file | memory | prisma
STORAGE_BACKEND=file
# DATABASE_URL=postgresql://user:pass@localhost:5432/meta_ads_mcp

# One env var PER account token — the name is referenced from accounts.json
META_TOKEN_ACME_FASHION=
META_TOKEN_ACME_SAAS=
```

### 2) Accounts

Copy `config/accounts.example.json` to `config/accounts.json` and fill it. Tokens are NEVER stored in this file — each account references the **name of an environment variable** that holds the real token (`tokenEnvVar`). This makes secrets rotation trivial and keeps the file safe to commit (it's still gitignored by default).

```json
{
  "accounts": [
    {
      "id": "acme-fashion",
      "displayName": "ACME Fashion",
      "adAccountId": "act_123456789",
      "businessId": "987654321",
      "currency": "BRL",
      "timezone": "America/Sao_Paulo",
      "tokenEnvVar": "META_TOKEN_ACME_FASHION",
      "mode": "dry-run",
      "maxDailyBudget": 250,
      "maxBudgetChangePct": 20,
      "owners": ["marketing@acme.example"],
      "tags": ["fashion", "br"]
    }
  ]
}
```

Account `mode` values:

- `read-only` — only read + recommend.
- `dry-run` — read + recommend + create local drafts; no API mutation.
- `write-enabled` — full set, but still subject to per-call confirmation and global `READ_ONLY`/`DRY_RUN`.

### 3) Wire it into your MCP client

See [`mcp.json.example`](./mcp.json.example) for ready-to-paste blocks for **Claude Desktop**, **OpenCode** and **Cline**.

Minimal OpenCode snippet:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "meta-ads-mcp": {
      "type": "local",
      "command": ["node", "<repo-root>/meta-ads-mcp/dist/server.js"],
      "enabled": true,
      "env": {
        "READ_ONLY": "true",
        "DRY_RUN": "true"
      }
    }
  }
}
```

For HTTP transport (web panel, remote clients):

```powershell
$env:MCP_TRANSPORT="http"
$env:MCP_HTTP_BEARER_TOKENS="some-strong-token"
npm start
# POST http://127.0.0.1:8787/mcp  with  Authorization: Bearer some-strong-token
```

---

## Tools

All tools follow `<domain>_<verb>_<resource>` naming. Every tool returns the same envelope:

```json
{ "ok": true, "data": { ... }, "warnings": [], "errors": [] }
```

### 🟢 Accounts (READ)

| Tool | Purpose |
|------|---------|
| `list_ad_accounts` | List every configured account with effective mode, currency, caps. |
| `get_account_profile` | Pull live account info from Meta (name, currency, status, amount spent). |
| `update_account_profile` | Update LOCAL metadata (tags, owners, caps). Does NOT call Meta. |

### 🟢 Campaigns (READ + DRAFT) / 🟡 Campaigns (WRITE)

| Tool | Purpose |
|------|---------|
| `list_campaigns` | List campaigns of an account with effective status and budgets. |
| `create_campaign_draft` | Build a campaign draft locally and persist it. No API call. |
| `publish_campaign` | 🟡 Create the campaign on Meta — always `status=PAUSED`. Needs full confirmation. |
| `pause_campaign` | 🟡 Pause an existing campaign. Needs full confirmation. |

### 🟢/🟡 Ad Sets

| Tool | Purpose |
|------|---------|
| `list_ad_sets` | List ad sets (optionally filtered by campaign). |
| `create_ad_set_draft` | Build an ad set draft locally. |

### 🟢 Creatives

| Tool | Purpose |
|------|---------|
| `create_ad_creative_draft` | Persist a creative draft. |
| `analyze_ad_creative` | Score copy & hooks against Meta best practices. |
| `predict_best_audience_for_ad` | Suggest persona/interests for a creative (heuristic). |

### 🟢 Insights / Reporting

| Tool | Purpose |
|------|---------|
| `get_campaign_insights` | Pull insights for a campaign (date preset or range). |
| `get_ad_set_insights` | Same, for an ad set. |
| `generate_performance_report` | Aggregated report with deltas. |
| `compare_ads` | Side-by-side metric comparison. |
| `find_wasted_spend` | Flag ads burning budget below thresholds. |

### 🟢 Optimization (recommendations only)

| Tool | Purpose |
|------|---------|
| `analyze_campaign_performance` | Score campaign vs goals (CPA, ROAS, CTR, Frequency). |
| `recommend_campaign_optimizations` | Heuristic action list, never auto-applied. |
| `recommend_audience_strategy` | Audience funnel (cold / warm / hot) suggestions. |
| `generate_targeting_suggestions` | Targeting structure suggestions (use with `search_targeting_ids`). |
| `adjust_budget_recommendation` | Safe budget recommendation respecting caps. |
| `recommend_ab_tests` | A/B test plan (1 variable, sample-size friendly). |

### 🟡 Budget (WRITE)

| Tool | Purpose |
|------|---------|
| `apply_budget_change` | Apply a budget change to an ad set. Needs full confirmation. Enforces triple caps. |

### 🟢 Policy / Compliance

| Tool | Purpose |
|------|---------|
| `validate_meta_policy_risk` | Block protected attributes, forbidden words, missing Special Ad Category. |

### 🟢 Targeting search

| Tool | Purpose |
|------|---------|
| `search_targeting_ids` | Look up real IDs from `/search?type=adinterest|adlocale|adgeolocation|...`. Replaces placeholders before any draft. |

---

## Resources

The server also exposes MCP Resources for safe, navigable context. These are read-only and secrets are redacted before returning content.

| Resource | Purpose |
|----------|---------|
| `meta-ads://accounts/config-summary` | Configured accounts without `tokenEnvVar` values or secrets. |
| `meta-ads://audit/recent` | Last 100 audit entries, newest first. |
| `meta-ads://audit/account/{accountId}` | Last 200 audit entries for one account. |
| `meta-ads://drafts/all` | All campaign/ad set/creative drafts from the storage backend. |
| `meta-ads://drafts/account/{accountId}` | Drafts filtered by account. |

## Prompts

Operational MCP Prompts are available for repeatable workflows:

| Prompt | Purpose |
|--------|---------|
| `weekly_account_audit` | Weekly account audit: KPIs, waste, recommendations, policy risks, recent audit log. |
| `campaign_launch_plan` | Safe launch workflow before local drafts and any later publish approval. |
| `creative_review_playbook` | Creative clarity, audience fit, policy risk and A/B plan. |

---

## Mutation contract

Every mutating tool requires ALL of the following to actually call Meta:

1. `confirm: true`
2. `reason: string` (≥ 5 chars)
3. `requestedBy: string` (≥ 2 chars)
4. `dryRun: false`
5. Account `mode = "write-enabled"`
6. Global `READ_ONLY = false`
7. (For budget tools) the change passes per-account AND global caps.

If any of (1)–(6) is missing, the tool returns a **dry-run plan** instead of executing. If any of (7) fails, the tool returns a `BudgetCapExceeded` error and the change is rejected.

Newly created campaigns are ALWAYS published as `PAUSED`. A separate, explicit call is required to activate them.

---

## Architecture

```
meta-ads-mcp/
├── src/
│   ├── server.ts                # entry — picks transport from MCP_TRANSPORT
│   ├── transports/
│   │   ├── stdio.ts             # default
│   │   └── http.ts              # StreamableHTTPServerTransport, bearer auth, sessions
│   ├── mcp/
│   │   ├── buildServer.ts       # wires ToolContext + registers all tools
│   │   ├── registry.ts          # ALL_TOOLS master list
│   │   ├── toolKit.ts           # defineTool + ok/fail envelope
│   │   ├── resources.ts         # audit/draft/account MCP resources
│   │   ├── prompts.ts           # weekly audit / launch / creative playbooks
│   │   └── tools/               # 8 files, 26 tools
│   ├── meta/
│   │   ├── MetaAdsClient.ts     # Graph API client (retry, backoff, mask token)
│   │   ├── MetaApiError.ts
│   │   └── types.ts
│   ├── optimization/            # deterministic engines (never call the API)
│   │   ├── OptimizationEngine.ts
│   │   ├── BudgetEngine.ts
│   │   ├── CreativeAnalysisEngine.ts
│   │   ├── AudienceStrategyEngine.ts
│   │   └── PolicyRiskEngine.ts
│   ├── security/
│   │   ├── permissions.ts       # capability + mutation gates
│   │   ├── secrets.ts           # maskToken, redactSecrets
│   │   └── auditLog.ts          # append-only JSONL
│   ├── storage/
│   │   ├── factory.ts           # picks backend
│   │   ├── fileStorage.ts       # default
│   │   ├── memoryStorage.ts
│   │   ├── prismaStorage.ts     # optional Postgres
│   │   └── interfaces.ts
│   ├── schemas/                 # Zod schemas: account, campaign, adset, creative, insights
│   ├── config/                  # env + AccountRegistry
│   └── utils/                   # logger, retry
├── prisma/schema.prisma         # optional Prisma schema for STORAGE_BACKEND=prisma
├── tests/                       # vitest — 22+ tests
├── config/accounts.example.json
├── examples/                    # example tool calls, client configs
└── web-panel/                  # optional Next.js administrative panel
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full layered diagram and decision log.

---

## Run / test

```powershell
npm run typecheck            # strict TS check
npm test                     # vitest run (22+ tests, ~5s)
npm start                    # stdio
$env:MCP_TRANSPORT="http"; npm start    # HTTP transport on 127.0.0.1:8787
```

Healthcheck (HTTP): `GET http://127.0.0.1:8787/healthz`.

---

## Limitations / non-goals

- **Lead Ads**, **Conversions API** ingestion and **asset upload** are NOT implemented in v0.1. Backlog.
- **Audience overlap** and **automated rules** are not exposed. Use Meta Ads Manager.
- **No multi-tenant SaaS mode**. This is single-operator (or single-team) by design.
- The optional **web panel** in `web-panel/` is implemented as a Next.js admin panel over the MCP HTTP transport. It is intentionally conservative and does not expose one-click real mutations in v0.1.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Invalid environment configuration: ...` | Check `.env` against `.env.example`; numeric vars must be numbers as strings. |
| `Account "X" not found` | Make sure `id` in `accounts.json` matches what the tool received. |
| `tokenEnvVar "..." is empty` | Set the env var in `.env` or via your secret manager. |
| `BudgetCapExceeded` | The change broke a per-account or global cap. Raise the cap explicitly OR reduce the change. |
| Mutations always return a dry-run plan | `READ_ONLY=true` or `DRY_RUN=true` in env, OR account is not `write-enabled`, OR confirm fields are missing. |
| HTTP transport returns 401 | Missing/invalid `Authorization: Bearer <token>` header; check `MCP_HTTP_BEARER_TOKENS`. |

## License

MIT — see [`../LICENSE`](../LICENSE).

---

## 🇧🇷 Português

> **MCP server multi-conta, pronto para produção, para a [Meta Marketing API](https://developers.facebook.com/docs/marketing-apis) (Facebook Ads / Instagram Ads).** Permite que um LLM **analise, recomende e — somente com confirmação humana explícita — execute** mudanças em contas reais, com auditoria, dry-run, tetos de orçamento e guardrails de política.

Construído em TypeScript estrito. Transportes **stdio** e **Streamable HTTP**. Logs vão em stderr. Tokens vêm SEMPRE de variável de ambiente, nunca de JSON ou código. Mutações exigem três checagens independentes (confirmação por chamada, modo da conta, switches globais `READ_ONLY`/`DRY_RUN`).

### Por que existe

Existem alguns servidores MCP públicos para Meta Ads (`pipeboard-co/meta-ads-mcp`, `mikusnuz/meta-ads-mcp`, etc.). São bons pontos de partida, mas para operar **mídia paga com dinheiro de cliente real** nenhum deles modela:

- Separação estrita **recomendar ↔ executar** (engines nunca chamam a API).
- **Multi-conta** com modo e tetos por conta.
- Gate triplo de mutação (`confirm + reason + requestedBy + dryRun:false`).
- Kill-switch global (`READ_ONLY=true`).
- **Bloqueio de targeting** por atributos protegidos (raça, religião, orientação sexual, saúde, política).
- Auditoria append-only JSONL com redação de segredos.
- Tool real `search_targeting_ids` em vez de placeholder.
- Transporte HTTP para painel web/remoto.
- Storage plugável (file / memory / Postgres via Prisma).

### Requisitos

- **Node.js >= 20.19.0**
- **Token de System User** da Meta com escopos `ads_management` + `ads_read`
- ID da Ad Account (formato `act_...`)

### Instalação

```powershell
cd "<repo-root>/meta-ads-mcp"
npm install
npm run build
```

### Configuração

Veja a seção [Configuration](#configuration) acima — o passo a passo (`.env` → `accounts.json` → cliente MCP) é o mesmo. Snippets prontos para OpenCode / Claude Desktop / Cline estão em [`mcp.json.example`](./mcp.json.example).

Para transporte HTTP:

```powershell
$env:MCP_TRANSPORT="http"
$env:MCP_HTTP_BEARER_TOKENS="token-forte-aqui"
npm start
# POST http://127.0.0.1:8787/mcp com Authorization: Bearer token-forte-aqui
```

### Modos de conta

- `read-only` — apenas leitura + recomendação.
- `dry-run` — leitura + recomendação + drafts locais; nada vai para a Meta.
- `write-enabled` — habilitado para mutação, mas ainda sujeito à confirmação por chamada e aos switches globais.

### Contrato de mutação

Toda tool mutativa exige TODOS os itens abaixo para realmente chamar a Meta:

1. `confirm: true`
2. `reason: string` (≥ 5 chars)
3. `requestedBy: string` (≥ 2 chars)
4. `dryRun: false`
5. Modo da conta `write-enabled`
6. `READ_ONLY=false` global
7. (Orçamento) a mudança respeita o teto por conta E o teto global.

Se qualquer item de 1–6 falhar, a tool retorna um **plano dry-run**. Se 7 falhar, retorna `BudgetCapExceeded` e a mudança é rejeitada.

Toda nova campanha é publicada como `PAUSED`. Para ativar é necessária uma chamada separada e explícita.

### Política operacional

Leia [`AGENTS.md`](./AGENTS.md) — classifica todas as tools em 🟢 READ / 🟡 WRITE / 🔴 DESTRUCTIVE e define os templates de confirmação que o LLM deve usar antes de executar.

Boas práticas de mídia paga (audiência, fase de aprendizado, fadiga criativa, testes A/B) estão em [`BEST_PRACTICES.md`](./BEST_PRACTICES.md).

### Licença

MIT — veja [`../LICENSE`](../LICENSE).
