# AGENTS.md — Operating Policy For tfs-mcp

This MCP can read and mutate TFS / Azure DevOps Server state. Treat all calls as acting with the configured PAT permissions.

## Tool Safety Classification

### READ
`tfs_analyze_work_item`, `tfs_work_item_context`, `tfs_prepare_refinement`, `tfs_work_item`, `tfs_generate_activity_template`, `tfs_generate_activity_template_from_items`, `tfs_query_work_items`, `tfs_list_prs`, `tfs_prepare_pr_review`, `tfs_release_readiness`, `tfs_team_focus_report`, `tfs_work_item_handoff`, `tfs_delivery_risk_report`, `tfs_get_pr`, `tfs_review_pr`, `tfs_pipeline_status`, `tfs_wiki`, `tfs_sprint_info`, `tfs_list_repos`.

READ tools may be used without extra confirmation, but summarize sensitive results instead of pasting large private payloads.

### WRITE
`tfs_work_item_create`, `tfs_update_work_item`, `tfs_add_pr_comment`, `tfs_comment_review_findings`.

WRITE tools are server-gated. They default to `dry_run:true` and return a mutation plan instead of changing TFS. To execute a real mutation, the call must include `dry_run:false`, `confirm:true`, `reason`, and `requestedBy`/`requested_by`.

For high-impact targets (production/release/main/master/hml/homolog patterns), the dry-run response will also require `confirm_high_impact` with an exact value. Do not guess that value; copy it from the returned mutation plan only after user approval.

## Defaults

- Prefer `tfs_comment_review_findings` with `dry_run:true` first.
- Avoid posting duplicate PR comments; use the server deduplication flow where available.
- Use `auth_alias` when the user names a specific PAT identity.
- Do not change work item state, assignee, story points or acceptance criteria without explicit confirmation in the same turn.
- Treat production/release branches as high impact and ask for confirmation before posting or changing related items.
