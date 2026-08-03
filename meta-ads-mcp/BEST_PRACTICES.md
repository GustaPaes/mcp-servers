# Best Practices — Meta Ads MCP

Practical patterns to get reliable, defensible paid-media operations out of this MCP. These are the rules we apply when the LLM is the operator and a human approves each change.

## 1. Always run the diagnostic chain BEFORE any mutation

```
list_campaigns → get_campaign_insights → analyze_campaign_performance
              → validate_meta_policy_risk → adjust_budget_recommendation
              → (human review) → apply_budget_change / publish_campaign
```

Never jump straight to a mutating tool. The diagnostic chain produces the **plan** the human will approve.

## 2. Respect the learning phase

Meta enters a **learning phase** after any significant change (objective, budget ±20 %, bid strategy, audience, creative). During learning, metrics are unstable.

Rules:

- Don't change a campaign that is in learning unless the change is to **stop the bleeding** (paused due to broken creative, off-brand targeting, etc.).
- If a change is unavoidable, do **one variable at a time** — not budget AND audience AND creative in the same call.
- After a change, wait at least **50 optimization events** (purchases, leads, etc.) before judging performance.

## 3. Budget change discipline

- Increases above **20 %** typically restart learning. Prefer **step increases** (10–15 %) over a few days.
- Decreases above **20 %** also reset learning AND throttle reach. Pause + relaunch is sometimes cleaner.
- The `BudgetEngine` will clip your request to the lower of: per-account cap, global cap, and `currentBudget × (1 + maxBudgetChangePct/100)`.

## 4. Audience strategy

| Stage | What it means | Typical targeting |
|-------|---------------|-------------------|
| **Cold** | Has never heard of you | Broad interests, lookalikes 1–3 % |
| **Warm** | Visited site, watched video ≥ 50 % | Custom audience (website, engagement) |
| **Hot** | Added to cart, abandoned checkout, viewed key page | CA with high-intent events, 7–14 day window |

Rules:

- Don't put cold and hot in the same ad set — let the algorithm optimize per intent.
- Exclude hot from cold campaigns to avoid double-billing the same user.
- Lookalikes < 1 % are almost always too small to escape learning. Start at 1–3 %.

## 5. Creative fatigue

Watch **Frequency** in `get_campaign_insights`:

- `frequency < 2.0` → fine.
- `2.0–3.5` → start preparing a new variation.
- `> 3.5` → CPM and CTR will degrade; rotate creative or pause.

Pair `frequency` with `ctr` decay over a 7-day rolling window. `find_wasted_spend` automates this for active ads.

## 6. A/B testing

- **One variable per test.** If you change copy AND image AND audience, you can't attribute the lift.
- Budget per variant must be enough to reach **statistical significance** (Meta exits learning at ~50 events; you usually want 100+ for confidence).
- Use `recommend_ab_tests` to scope a defensible test plan.

## 7. Special Ad Categories

If the ad promotes **HOUSING / EMPLOYMENT / CREDIT / ISSUES_ELECTIONS_POLITICS**, you MUST declare it on the campaign. Consequences:

- Detailed targeting is restricted (no age narrow, no gender, limited interests).
- Lookalike audiences must be **Special Ad Audiences**, not regular LALs.
- ZIP code targeting is restricted to a minimum radius.

`validate_meta_policy_risk` warns when keywords suggest a Special Ad Category but the campaign is not declared as such.

## 8. Compliance — what the LLM must NEVER do

- Target by **race, ethnicity, religion, sexual orientation, gender identity, health status, political affiliation, immigration status, criminal history**. The `PolicyRiskEngine` blocks these; do not paraphrase to dodge it.
- Use **forbidden words** (e.g., "you" in personal sensitive context, claims of guaranteed weight loss, miracle cures). The engine flags these.
- Promise **results** ("guaranteed 3× ROAS"). Always frame recommendations as heuristic.

## 9. Audit and reproducibility

Every tool call goes to the **append-only JSONL audit log** with timestamp,
account, tool, risk, bounded input metadata and outcome. Domain-specific events
record redacted before/after details for consequential changes. For finance and
post-mortem reviews:

- Keep audit logs for at least 90 days.
- When investigating a regression, the audit log + Meta's change log together reconstruct the timeline.

## 10. Operational hygiene

- One `.env` per environment (dev / staging / prod). Never share tokens across environments.
- Rotate tokens at least every 60 days. Because tokens are referenced by `tokenEnvVar` name, rotation is a single env-var update — no JSON change.
- Run with `READ_ONLY=true` by default. Flip to `false` only for an explicit operations window.
- The HTTP transport must be behind TLS + Bearer auth + IP allowlist when exposed beyond `127.0.0.1`.

## 11. When to use this MCP vs Ads Manager

| Task | Prefer |
|------|--------|
| Quick visual check, A/B preview, asset upload | Ads Manager |
| Bulk diagnostics across N accounts | This MCP (`list_ad_accounts` + insights) |
| Scripted budget change with audit trail | This MCP (`apply_budget_change`) |
| Lead form download, Conversions API setup | Ads Manager / Events Manager |
| Audience overlap analysis | Ads Manager Audience Insights |
| Repeatable weekly performance report | This MCP (`generate_performance_report`) |

The MCP is for **structured, auditable, repeatable** operations. The UI is still the right tool for visual judgment and one-off creative work.

## 12. Tool contracts and concurrency

- Treat the policy manifest as the source of truth for risk, idempotency and external access. A contract test must compare it with every registered definition and handler.
- Expose the shared strict output envelope through `outputSchema`; add a more specific data schema when consumers depend on stable fields.
- Audit centrally at the registration boundary so a new tool cannot bypass invocation/completion records. Keep detailed mutation events for before/after evidence.
- Perform local draft changes with the storage transaction API. The revision identifies the exact state observed by resources and prevents concurrent writers from silently overwriting one another.
- Set hard caps for timeouts, retries, body size, session count, session TTL, page size and text/array inputs. Prefer cursors and explicit truncation metadata over large responses.
