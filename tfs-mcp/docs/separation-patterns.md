# Story Separation Patterns for TFS

This guide captures the split heuristics used by the MCP when a large request
must become several work items. Examples are anonymized.

## When to split

Split a request when at least one of these is true:

- Backend, frontend, mobile or integration changes can be delivered
  independently.
- One item would require different owners, different repositories or different
  release cadences.
- Validation evidence would be easier to review per component.
- Risk is concentrated in one subsystem and should not block lower-risk work.

## Recommended split axes

### By technical boundary

- API / backend service
- Web frontend
- Mobile app
- Integration or batch worker
- Infrastructure / pipeline

### By rollout dependency

- Schema or contract change first
- Producer implementation
- Consumer implementation
- Observability and rollback guardrails

### By business capability

- Core user flow
- Reporting / backoffice
- Notifications
- Migration / cleanup

## Example decomposition

Original request:

```text
Support approval comments in the release workflow, show history in the UI and
notify support when a deployment is blocked.
```

Possible split:

- `US-01`: Backend API and persistence for approval comments
- `US-02`: Frontend history and approval timeline
- `US-03`: Notification worker and support routing
- `US-04`: Pipeline and audit evidence updates

## Anti-patterns

- One story spanning multiple repos with different deploy owners.
- Splitting only by estimated hours instead of real boundaries.
- Hiding schema, migration or rollout work inside a frontend-only item.
- Creating "umbrella" stories that duplicate acceptance criteria of child items.

## Practical rule for agents

If the change crosses more than one major codebase or owner, the MCP should
propose a split before generating final acceptance criteria. The goal is not to
maximize item count; it is to produce reviewable, testable slices.
