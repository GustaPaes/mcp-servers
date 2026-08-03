# AGENTS.md — Operating Policy For tfs-mcp

> This file complements the [workspace-wide instructions](../AGENTS.md). Their
> neutrality, reusability and local-content separation rules are mandatory.

This MCP can read and mutate TFS / Azure DevOps Server state. Treat all calls as acting with the configured PAT permissions.

## Tool Safety Classification

[`src/tool-policy.js`](./src/tool-policy.js) is the executable source of truth.
The server refuses to start if a tool lacks a definition, handler or explicit
risk classification. Contract tests must remain aligned with that manifest.

### READ
`tfs_doctor`, `tfs_saved_queries`, `tfs_analyze_work_item`,
`tfs_work_item_context`, `tfs_specialist_review`, `tfs_prepare_refinement`,
`tfs_work_item`, `tfs_generate_activity_template`,
`tfs_generate_activity_template_from_items`, `tfs_query_work_items`,
`tfs_list_prs`, `tfs_prepare_pr_review`, `tfs_release_readiness`,
`tfs_team_focus_report`, `tfs_work_item_handoff`,
`tfs_delivery_risk_report`, `tfs_get_pr`, `tfs_review_pr`,
`tfs_pipeline_status`, `tfs_wiki`, `tfs_sprint_info`, `tfs_list_repos`,
`tfs_build_artifact_inventory`, `tfs_compare_build_artifacts`.

READ tools may be used without extra confirmation, but summarize sensitive results instead of pasting large private payloads.

### REMOTE_WRITE

`tfs_work_item_create`, `tfs_add_pr_comment`, `tfs_comment_review_findings`,
`tfs_create_pr`.

REMOTE_WRITE tools are server-gated. They default to `dry_run:true` and return a mutation plan instead of changing TFS. To execute a real mutation, the call must include `dry_run:false`, `confirm:true`, `reason`, and `requestedBy`/`requested_by`.

For high-impact targets (production/release/releases/main/master/hml/homolog patterns), the dry-run response will also require `confirm_high_impact` with an exact value. Do not guess that value; copy it from the returned mutation plan only after user approval.

### DESTRUCTIVE

`tfs_update_work_item`, `tfs_update_issue_analysis`, `tfs_update_pr`,
`tfs_pipeline_upsert`, `tfs_branch_policy_upsert`.

These edits overwrite remote state and use the same server guard. Before
confirming a pipeline-definition or branch-policy edit, present
`changes.changedFields`, `changes.before` and `changes.after`.

A branch-policy upsert is identified by repository, case-sensitive branch ref
and build definition. Never overwrite duplicated or multi-scope policies
implicitly. Exact scopes require an existing branch; prefix scopes are always
high impact. The tool serializes this identity only inside one process, rechecks
the branch and build definition before writing, and verifies the persisted state
afterwards. Separate MCP instances can still race, so treat a reported
ambiguity as requiring manual reconciliation, not as an atomic concurrency
guarantee. Enabled Build Validation policies require an enabled definition in
the target repository unless the user explicitly approves the high-impact
`allow_cross_repository:true` exception.

Any pipeline/release definition deletion added in the future must identify the
exact target, return its current state in the preview, require exact
confirmation and be classified `DESTRUCTIVE`.

### EXECUTION
`tfs_pipeline_queue`.

Execution tools may start an existing pipeline or release-oriented YAML pipeline directly because they do not change its definition. They default to `dry_run:false`, remain audited and accept `dry_run:true` when a preview is explicitly useful. Report the definition, branch, and parameter/variable names without exposing values that may be sensitive.

All public input schemas are strict at the MCP boundary and their Zod equivalents
must use `z.strictObject`. External requests must go through `tfs-client.js`, use
the configured timeout and forward PAT credentials only to the configured TFS
origin. Retries are allowed only for safe/idempotent operations.

## Defaults

- For activity writing, technical criteria, refinement, PR review, pipeline/release readiness or delivery-risk requests, use the specialist layer by default. Prefer the tools that already embed it (`tfs_generate_activity_template`, `tfs_generate_activity_template_from_items`, `tfs_prepare_refinement`, `tfs_prepare_pr_review`, `tfs_work_item_handoff`) or call `tfs_specialist_review` explicitly when the user asks for specialist analysis.
- Treat `specialistReview.specialistsUsed` as the source of truth for which expert lenses were applied. Do not invent extra specialists outside the returned rubrics unless the user asks for a human-level brainstorming answer outside the MCP.
- Prefer `tfs_comment_review_findings` with `dry_run:true` first.
- Avoid posting duplicate PR comments; use the server deduplication flow where available.
- For PR work-item links, use the tool's revision-guarded reconciliation path.
  Do not add a second `workItemRefs` mutation around it. Report `partial` and
  the sanitized failed-item list when metadata succeeds but links do not.
- Treat pipeline evidence in PR reviews as valid only when repository and PR
  identity or commit SHA match; target-branch equality is not sufficient.
- Use `auth_alias` when the user names a specific PAT identity.
- Do not change work item state, assignee, story points or acceptance criteria without explicit confirmation in the same turn.
- For development analysis of an `Issue`, use `tfs_update_issue_analysis`. It requires `development_analysis`, accepts optional `correction_and_impacts`, and follows [`docs/issue-analysis.md`](./docs/issue-analysis.md).
- Treat production/release branches as high impact and ask for confirmation before posting, editing or deleting related items. Starting an existing run through `tfs_pipeline_queue` is the documented execution exception and remains audited.

## Public/private boundary

- Keep organization names, internal URLs, process field names, PAT aliases, repository names and real work-item defaults in `.env` or `local-private/`; both are ignored by Git.
- Prefer `local-private/config/tfs.json` (or `TFS_MCP_CONFIG_FILE`) for reusable local connection metadata, work-item profiles and saved queries. PAT values must remain in environment variables.
- Commit only neutral examples and reusable behavior. When a custom process needs special fields, configure the local JSON file, `TFS_WORK_ITEM_PROFILES_FILE` or `TFS_WORK_ITEM_PROFILES_JSON` instead of hard-coding the organization in source.
- Put one-off maintenance scripts and exported TFS payloads under `local-private/`. Never create them in tracked `src/`, `docs/`, `scripts/` or `tests/` paths.
