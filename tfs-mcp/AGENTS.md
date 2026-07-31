# AGENTS.md — Operating Policy For tfs-mcp

> This file complements the [workspace-wide instructions](../AGENTS.md). Their
> neutrality, reusability and local-content separation rules are mandatory.

This MCP can read and mutate TFS / Azure DevOps Server state. Treat all calls as acting with the configured PAT permissions.

## Tool Safety Classification

### READ
`tfs_analyze_work_item`, `tfs_work_item_context`, `tfs_specialist_review`, `tfs_prepare_refinement`, `tfs_work_item`, `tfs_generate_activity_template`, `tfs_generate_activity_template_from_items`, `tfs_query_work_items`, `tfs_list_prs`, `tfs_prepare_pr_review`, `tfs_release_readiness`, `tfs_team_focus_report`, `tfs_work_item_handoff`, `tfs_delivery_risk_report`, `tfs_get_pr`, `tfs_review_pr`, `tfs_pipeline_status`, `tfs_wiki`, `tfs_sprint_info`, `tfs_list_repos`.

READ tools may be used without extra confirmation, but summarize sensitive results instead of pasting large private payloads.

### WRITE
`tfs_work_item_create`, `tfs_update_work_item`, `tfs_update_issue_analysis`, `tfs_add_pr_comment`, `tfs_comment_review_findings`, `tfs_create_pr`, `tfs_update_pr`, `tfs_pipeline_upsert`, `tfs_pipeline_queue`.

WRITE tools are server-gated. They default to `dry_run:true` and return a mutation plan instead of changing TFS. To execute a real mutation, the call must include `dry_run:false`, `confirm:true`, `reason`, and `requestedBy`/`requested_by`.

For high-impact targets (production/release/main/master/hml/homolog patterns), the dry-run response will also require `confirm_high_impact` with an exact value. Do not guess that value; copy it from the returned mutation plan only after user approval.

## Defaults

- For activity writing, technical criteria, refinement, PR review, pipeline/release readiness or delivery-risk requests, use the specialist layer by default. Prefer the tools that already embed it (`tfs_generate_activity_template`, `tfs_generate_activity_template_from_items`, `tfs_prepare_refinement`, `tfs_prepare_pr_review`, `tfs_work_item_handoff`) or call `tfs_specialist_review` explicitly when the user asks for specialist analysis.
- Treat `specialistReview.specialistsUsed` as the source of truth for which expert lenses were applied. Do not invent extra specialists outside the returned rubrics unless the user asks for a human-level brainstorming answer outside the MCP.
- Prefer `tfs_comment_review_findings` with `dry_run:true` first.
- Avoid posting duplicate PR comments; use the server deduplication flow where available.
- Use `auth_alias` when the user names a specific PAT identity.
- Do not change work item state, assignee, story points or acceptance criteria without explicit confirmation in the same turn.
- For development analysis of an `Issue`, use `tfs_update_issue_analysis`. It requires `development_analysis`, accepts optional `correction_and_impacts`, and follows [`docs/issue-analysis.md`](./docs/issue-analysis.md).
- Treat production/release branches as high impact and ask for confirmation before posting or changing related items.

## Public/private boundary

- Keep organization names, internal URLs, process field names, PAT aliases, repository names and real work-item defaults in `.env` or `local-private/`; both are ignored by Git.
- Prefer `local-private/config/tfs.json` (or `TFS_MCP_CONFIG_FILE`) for reusable local connection metadata, work-item profiles and saved queries. PAT values must remain in environment variables.
- Commit only neutral examples and reusable behavior. When a custom process needs special fields, configure the local JSON file, `TFS_WORK_ITEM_PROFILES_FILE` or `TFS_WORK_ITEM_PROFILES_JSON` instead of hard-coding the organization in source.
- Put one-off maintenance scripts and exported TFS payloads under `local-private/`. Never create them in tracked `src/`, `docs/`, `scripts/` or `tests/` paths.
