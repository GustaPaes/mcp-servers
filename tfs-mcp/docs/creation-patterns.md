# Work Item Creation Patterns for On-Prem TFS

This document describes the creation conventions that worked well in the
original installation behind this MCP. Public examples are sanitized and use
placeholder names.

## Goal

Keep item creation predictable for humans and safe for agents:

- Use explicit area and iteration paths.
- Prefer dry-run generation before any real write.
- Preserve a stable writing template for business and technical acceptance.
- Make custom-field usage obvious when a TFS template differs from stock fields.

## Recommended field map

| Field | Example value | Notes |
|---|---|---|
| `System.Title` | `Add audit trail to approval flow` | Keep it outcome-oriented. |
| `System.WorkItemType` | `User Story` | The MCP also supports Bug, Feature and Sprint Task. |
| `System.AreaPath` | `ExampleProject\\Core Platform` | Use the team's real area tree. |
| `System.IterationPath` | `ExampleProject\\2026-Q3` | Always target a real iteration. |
| `System.Description` | Business description | Use when the template is stock TFS. |
| `Microsoft.VSTS.Common.AcceptanceCriteria` | Technical acceptance criteria | Use when the template is stock TFS. |

If your TFS template has custom rich-text fields, map them explicitly. The
original installation used custom business and technical fields, and the MCP
still supports that compatibility path.

## Safe creation flow

1. Generate the activity template first.
2. Review the business and technical blocks.
3. Resolve area path, iteration path and owner before writing.
4. Run `tfs_work_item_create` with `dry_run:true`.
5. Only then execute the real mutation with `dry_run:false`, `confirm:true`,
   `reason` and `requestedBy`.

## Example payload

```json
{
  "title": "Add audit trail to approval flow",
  "work_item_type": "User Story",
  "actor": "operations analyst",
  "intent": "record who approved each release gate",
  "outcome": "audits can reconstruct the release path",
  "business_acceptance_criteria": [
    "Deve registrar aprovador, data e decisao",
    "Deve permitir consulta do historico sem acesso ao banco"
  ],
  "technical_dependencies": "Depends on the release orchestration service",
  "technical_acceptance_criteria": [
    "Deve persistir eventos de aprovacao",
    "Deve expor a trilha em endpoint autenticado"
  ],
  "affected_locations": [
    "services/release-orchestrator",
    "api/release-history"
  ],
  "dry_run": true
}
```

## Creation checklist

- Title describes business intent, not implementation trivia.
- Area path matches the owning team.
- Iteration path is real and active.
- Business criteria are testable and written for a reviewer.
- Technical criteria point to behavior, evidence and affected locations.
- Dependencies are explicit when rollout or integration is involved.

## Update and removal guidance

- Prefer state transitions over deletion when the process requires traceability.
- If your process has no `Removed` state for a given type, move the item to the
  documented terminal state and explain the reason in a comment.
- Never batch-create or batch-update items without first generating the dry-run
  plan for each entry.
