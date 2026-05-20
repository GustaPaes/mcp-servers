# Meta Ads MCP Web Panel

Administrative web panel for `meta-ads-mcp`. It is intentionally **MCP-first**: browser requests hit Next.js Route Handlers, and the server side talks to the MCP over Streamable HTTP. The panel never calls the Meta Graph API directly and never exposes tokens to the browser.

## What is implemented

- Local password auth via signed HTTP-only cookie (`WEB_PANEL_PASSWORD`, `WEB_PANEL_SESSION_SECRET`).
- Account selector (`/accounts`).
- Account dashboard (`/[accountId]`) with KPIs from `generate_performance_report` and waste flags from `find_wasted_spend`.
- Campaign list and campaign detail (`/[accountId]/campaigns`, `/[accountId]/campaigns/[id]`).
- Recommendations center (`/[accountId]/recommendations`) using `recommend_campaign_optimizations`.
- Creative analyzer (`/[accountId]/creatives/analyze`) using `analyze_ad_creative` + `predict_best_audience_for_ad`.
- Settings page (`/[accountId]/settings`) for safe local strategic fields through `update_account_profile`.
- Audit page (`/[accountId]/audit`) reading `meta-ads://audit/account/{accountId}` resource.
- API routes under `/api/accounts/*` for browser-safe operations.

## Requirements

- Node.js 20+
- MCP server built and running in HTTP mode:

```powershell
cd "C:\Workspace\MCP Servers\meta-ads-mcp"
npm run build
$env:MCP_TRANSPORT="http"
$env:MCP_HTTP_BEARER_TOKENS="dev-panel-token"
npm start
```

## Configure

```powershell
cd "C:\Workspace\MCP Servers\meta-ads-mcp\web-panel"
copy .env.example .env.local
```

Set at least:

```env
WEB_PANEL_PASSWORD=change-this
WEB_PANEL_SESSION_SECRET=replace-with-at-least-32-random-chars
META_ADS_MCP_HTTP_URL=http://127.0.0.1:8787/mcp
META_ADS_MCP_BEARER_TOKEN=dev-panel-token
```

## Run

```powershell
npm install
npm run dev
```

Open `http://localhost:3000/login`.

## Validate

```powershell
npm run typecheck
npm run build
npm audit --omit=dev
```

Current validation target: typecheck clean, production build clean, `npm audit --omit=dev` with 0 vulnerabilities.

## Security model

- The panel is not a replacement for MCP guardrails. Every mutation still goes through MCP tools.
- `publish_campaign`, `pause_campaign` and `apply_budget_change` are not exposed as one-click actions in v0.1. Operators should approve and execute through MCP after reviewing a dry-run plan.
- Keep the MCP with `READ_ONLY=true` and `DRY_RUN=true` by default.
- Do not expose the panel without TLS, a strong password, a strong session secret and network restrictions.

## Known gaps

- No NextAuth/SSO yet. Local password auth is deliberately minimal for v0.1.
- No Recharts/TanStack Query yet. The current implementation uses server-rendered pages and native fetch for forms.
- No direct apply buttons for real mutations. This is intentional until RBAC/approval flows are expanded.
