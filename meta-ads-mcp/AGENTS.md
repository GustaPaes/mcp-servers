# AGENTS.md — Operating policy for the Meta Ads MCP

> This file complements the [workspace-wide instructions](../AGENTS.md). Their
> neutrality, reusability and local-content separation rules are mandatory.

> Use this document as the **playbook** an LLM (or human operator) must consult before invoking tools. It defines safety classes, default behaviors, confirmation templates and the few hard NEVER rules of paid media on Meta.

This MCP operates **real ad accounts with real money**. Treat every 🟡/🔴 tool as financially consequential.

---

## Tool safety classification

Every tool is classified by the runtime manifest as `READ`, `LOCAL_STATE`,
`REMOTE_WRITE`, `DESTRUCTIVE` or `SECRET_READ`. Match the user's intent to the
manifest. `LOCAL_STATE` requires clear user intent but no redundant approval;
`REMOTE_WRITE` and `DESTRUCTIVE` must satisfy their server-enforced guards.

### 🟢 READ (no side effects on Meta)

`list_ad_accounts`, `get_account_profile`, `list_campaigns`, `list_ad_sets`,
`get_campaign_insights`, `get_ad_set_insights`, `generate_performance_report`,
`compare_ads`, `find_wasted_spend`, `analyze_campaign_performance`,
`recommend_campaign_optimizations`, `recommend_audience_strategy`,
`generate_targeting_suggestions`, `adjust_budget_recommendation`,
`recommend_ab_tests`, `analyze_ad_creative`, `predict_best_audience_for_ad`,
`validate_meta_policy_risk`, `search_targeting_ids`.

These may still write to the local **audit log** and to the **draft storage** (file/Postgres). They never call mutating endpoints on Meta.

### 🟢 RESOURCES / PROMPTS

Resources are read-only context surfaces:
`meta-ads://accounts/config-summary`, `meta-ads://audit/recent`,
`meta-ads://audit/account/{accountId}`, `meta-ads://drafts/all`,
`meta-ads://drafts/account/{accountId}`.

Prompts are safe playbooks, not actions:
`weekly_account_audit`, `campaign_launch_plan`, `creative_review_playbook`.

Reading a resource may reveal business metadata or ad copy, but never tokens. Treat drafts and audit content as confidential.

### 🟡 WRITE (state changes on Meta or local drafts)

- **Local-only drafts (no API call):** `create_campaign_draft`, `create_ad_set_draft`, `create_ad_creative_draft`, `update_account_profile`.
- **Real mutations on Meta:** `publish_campaign`, `pause_campaign`, `apply_budget_change`.

Real mutations require the full mutation contract (see below).

### 🔴 DESTRUCTIVE

v0.1 does NOT expose `delete_campaign` / `delete_ad_set` / `delete_ad`. Deletion is intentionally out of scope. Use Meta Ads Manager.

---

## Mandatory mutation contract

To call any Meta-mutating tool, ALL of the following must hold:

1. `confirm: true`
2. `reason: string` (≥ 5 chars, human-readable)
3. `requestedBy: string` (≥ 2 chars — name, email or ticket id)
4. `dryRun: false`
5. Account `mode = "write-enabled"`
6. Global `READ_ONLY = false`
7. (Budget tools only) the change passes per-account AND global caps:
   - per-account `maxDailyBudget`
   - per-account `maxBudgetChangePct`
   - global `GLOBAL_MAX_DAILY_BUDGET`
   - global `GLOBAL_MAX_BUDGET_CHANGE_PCT`

If any of (1)–(6) is missing, the tool returns a **dry-run plan**. If (7) fails, the tool returns a `BudgetCapExceeded` error. **Newly published campaigns are ALWAYS `PAUSED`.** Activation is a separate explicit call.

---

## Hard NEVER rules

The LLM MUST refuse — without negotiation — when a request:

1. **Targets protected attributes.** Race, ethnicity, religion, sexual orientation, gender identity, health status (including pregnancy, disability, conditions), political affiliation, immigration status, criminal history. The `PolicyRiskEngine` blocks these; the LLM must not try to work around it with synonyms.
2. **Uses Special Ad Categories** (HOUSING / EMPLOYMENT / CREDIT / ISSUES_ELECTIONS_POLITICS) **without** the operator explicitly declaring it AND adjusting the targeting accordingly. Targeting by age, gender, ZIP code or detailed demographics is forbidden or limited inside these categories.
3. **Promises results.** Never write "this will increase ROAS by X %" or "guaranteed conversions". Always frame as "heuristic estimate".
4. **Pulls or logs tokens.** Tokens come from env vars; logs and audit entries pass through `redactSecrets`. The LLM must not echo the token back to the user.
5. **Asks to disable `READ_ONLY` or `DRY_RUN` mid-session without an out-of-band confirmation.** The operator must change `.env` deliberately and restart the server.

## Default-deny patterns

Confirm or escalate when:

- The change moves daily budget by **more than 20 %** in a single step (Meta's learning phase usually resets).
- The change happens during a campaign's **learning phase** (`inLearningPhase=true` in insights). Prefer waiting.
- The user asks to publish multiple campaigns in one go. Publish them **one by one** with one confirmation per call.
- The account is named or tagged with `prod`, `production`, `live`, or carries clients listed in `owners`. Treat as high-risk.
- The targeting includes ZIP/CEP lists, custom audiences from third parties, or lookalikes built from sensitive sources — ask for the data lineage before proceeding.

---

## Recommended confirmation template

> **About to:** publish campaign **"Black Friday — Conversions"** in account **`acme-fashion`** (`act_123456789`) with daily budget **R$ 200**, objective **OUTCOME_SALES**, status **PAUSED** (will require a second call to activate).
>
> **Side effect:** creates the campaign object in Meta with status `PAUSED`. This server does not expose activation; review and activate it separately in Meta Ads Manager.
>
> **Limits checked:** R$ 200/day ≤ account cap R$ 250/day ≤ global cap R$ 500/day ✅.
>
> **Proceed?** (yes / no / dry-run)

For **dry-run**, prefer:

1. `validate_meta_policy_risk` first — confirm targeting is compliant.
2. `analyze_ad_creative` — score the copy.
3. `recommend_audience_strategy` + `search_targeting_ids` — replace any placeholder ID.
4. `adjust_budget_recommendation` — confirm the budget is inside caps.
5. THEN call the mutating tool with `dryRun:false` only when the user has reviewed the plan.

---

## Resource discipline

- Pull insights with the **smallest date range** that answers the question. `last_7d` is the default; only use `last_90d` for strategic reviews.
- Avoid breakdowns by `placement` × `age` × `gender` in one call — the response can be huge and rate-limited.
- Respect Meta rate limits. The client retries on 1/2/4/17/32/613/429 with backoff; if you see repeated `meta.retry` warnings in logs, slow down.

## Logging & privacy

- Every invocation, completion and rejection is audited centrally; domain events add before/after details where applicable.
- A remote mutation is blocked before contacting Meta when its mandatory invocation audit cannot be persisted.

- The MCP writes structured logs to stderr and an **append-only JSONL audit log** to `AUDIT_LOG_PATH`. Audit entries pass through `redactSecrets` — tokens are masked.
- Drafts in storage may contain ad copy and targeting. Treat the storage file as sensitive.
- HTTP transport without `MCP_HTTP_BEARER_TOKENS` is ONLY safe on `127.0.0.1`. The server logs a warning if you bind to a non-local host without auth.

## Contract and storage discipline

- Add every tool to the explicit policy manifest. Startup and contract tests must fail when a definition, handler or policy is missing or duplicated.
- Derive MCP annotations from the canonical risk class; never maintain annotations as an independent list.
- Return the shared strict `{ ok, data, warnings, errors, meta }` envelope and expose its `outputSchema`.
- Change drafts only through `storage.update()`. It serializes read-modify-write, persists a monotonic revision and prevents lost updates.
- Bound inputs, page sizes, network timeouts, HTTP bodies, session counts and session TTLs. A new unbounded field requires a documented reason and a focused test.

## Public/private boundary

- Store real ad account IDs, owners, access-token environment names, client budgets, copy, exports and audience definitions only in `.env`, `data/` or `local-private/`; all are ignored by Git.
- Keep organization-specific account configuration under `local-private/config` and reference it with `ACCOUNTS_CONFIG_PATH`. Commit only the neutral `config/accounts.example.json`.
- One-off reports, campaign exports and customer-specific automation belong in `local-private/reports` or `local-private/scripts`, never in tracked examples, tests or documentation.

## Escalation

When uncertain, prefer:

1. `validate_meta_policy_risk` — confirm the change is policy-safe.
2. `analyze_campaign_performance` — confirm the change is data-justified.
3. Ask **one specific** question of the operator, with the exact dollar/real impact, instead of guessing.
