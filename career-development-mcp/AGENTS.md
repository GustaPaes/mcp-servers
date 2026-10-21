# AGENTS.md — Operating Policy For career-development-mcp

> This file complements the [workspace-wide instructions](../AGENTS.md). Their
> neutrality, reusability and local-content separation rules are mandatory.

This MCP stores personal career, PDI, goal and evidence data in local JSON files. Treat the data as private by default.

## Tool Safety Classification

### READ
`guide_doctor`, `guide_daily_brief`, `guide_snapshot_validate`,
`guide_online_state_get`, `guide_online_review_suggestions`, `guide_pdi_list`,
`guide_pdi_get`, `guide_pdi_analyze`, `guide_goal_list`,
`guide_goal_analyze`, `guide_goal_progress`, `guide_competency_gap`,
`guide_competency_evolution`, `guide_competency_benchmark`,
`guide_evidence_list`, `guide_evidence_report`, `guide_career_roadmap`,
`guide_career_readiness`, `guide_review_prepare` and
`guide_review_self_assessment`.

Live READ tools are `guide_remote_status`, `guide_remote_plans_list`,
`guide_remote_plan_get` and `guide_remote_plan_analyze`. `guide_action_assess`
is a local READ tool for supplied criteria/evidence and comment drafting.
Remote reads never fall back to cached or local PDI records. Tool definitions,
schemas, handlers and policies for this optional surface live together in
`src/tools/remote.js` and are included by the canonical server manifest.

READ tools may be used freely for local analysis. Do not quote private feedback or evidence verbatim unless the user asks.

### LOCAL_STATE

`guide_remote_change_prepare` stores an expiring private before/after preview
without writing to the provider. It is a draft, not approval to publish.
`guide_snapshot_import`, `guide_pdi_create`, `guide_pdi_update`,
`guide_pdi_snapshot`, `guide_goal_create`, `guide_goal_update`,
`guide_competency_assess` and `guide_evidence_add` write only to private local
storage. `guide_evidence_from_tfs` reads an external MCP and writes locally only
when `dryRun=false`.

Before LOCAL_STATE tools, show the record that will be created or updated and ask for explicit approval when the change affects a real review packet, promotion material or imported TFS evidence.

- Use `dryRun=true` first for snapshot and TFS imports.
- Pass `expectedRevision` when updating a PDI, goal or imported snapshot. On a
  conflict, reload the current record instead of overwriting it.
- Local draft creation and append-only notes do not require an extra approval
  when the user's current request already explicitly asks for that write.
- Never retry non-idempotent create/import tools automatically.

### REMOTE_WRITE

`guide_remote_change_apply` requires explicit approval of the exact displayed
preview, its ID and confirmation digest. Never use the tool to obtain approval
implicitly. It rechecks identity, plan digest and any evidence comment, writes
an audit intent before transmitting, and does not retry uncertain outcomes.
Replaying a successfully applied preview returns the stored receipt. An
interrupted write or stale lock requires reconciliation before any new write.

- Keep provider credentials in `.env` or a dedicated cookie-only JSON file
  inside `CAREER_REMOTE_SESSION_ROOT`, under ignored `local-private/auth/`.
  Never expose cookies or tokens through tools, errors, audit entries or tests.
- Complete an action only after an evidence comment naming the action and
  linking its evidence is published. Completing a PDI action does not close a
  work item. Do not claim course completion from experience with another tool.
- The provider has no documented conditional update API. The digest check and
  cross-process local lock prevent local stale writes; avoid concurrent edits
  in other clients and report any discrepancy after writing. Do not describe
  this as an atomic remote transaction.
- Do not delete remote records or change another employee's plan. No such
  capability is exposed.

## Defaults

- Prefer adding evidence with source metadata so it remains auditable.
- Keep local `data/` out of Git.
- Remote previews and bounded audit journals stay in ignored
  `data/remote-previews/`. Quotas fail closed; archive reconciled records when
  the retention cap is reached. Keep unresolved receipts for investigation.
- Use bounded `limit`/`offset` pagination for list tools; do not request or quote
  more private data than needed.
- Storage writes create retained backups under ignored `data/backups/`. Do not
  copy backups into tracked fixtures.
- When importing from TFS, link the originating work item and avoid copying confidential implementation details into public-facing summaries.
- For review/promotion outputs, separate factual evidence from suggested wording.

## Public/private boundary

- Store real career data, review exports, external-platform snapshots, browser profiles and organization-specific adapters only in `data/`, `.env` or `local-private/`; all are ignored by Git.
- Commit neutral schemas, tools and examples only. One-off browser automation for a company portal must live in `local-private/`, never in tracked source or scripts.
- Keep `guide_online_*` inputs sanitized: do not persist session cookies, access tokens or full private API responses in public fixtures.
- The tool manifest in `src/server.js` is the source of truth for definition,
  handler, risk and annotations. Any tool change must update the manifest and
  its contract test; manual tool lists must never be allowed to drift.
