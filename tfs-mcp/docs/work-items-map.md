# Example Work Item Map

This file is a sanitized example of how to map an epic into work items and
component ownership. Replace the placeholders with your real project tree.

## Context

| Field | Example |
|---|---|
| Epic | `Enable release approval audit trail` |
| Iteration | `ExampleProject\\2026-Q3` |
| Area | `ExampleProject\\Core Platform` |
| Goal | `Make release decisions traceable end-to-end` |

## Suggested breakdown

| Item | Repo / Area | Scope | Owner |
|---|---|---|---|
| `US-01` | `example-suite/server` | Persist approval events and expose history API | `<backend-owner>` |
| `US-02` | `example-suite/client` | Show approval history in release UI | `<frontend-owner>` |
| `US-03` | `example-suite/worker` | Notify support on blocked approvals | `<integration-owner>` |
| `US-04` | `example-suite/platform` | Add pipeline evidence and audit export | `<devops-owner>` |

## Mapping rules

- Each row should point to one main repository or component boundary.
- Keep ownership explicit even when one person owns multiple rows.
- Add rollout dependencies in the item description instead of mixing them into
  the title.
- If an item depends on another item to be releasable, reference that
  dependency directly in the acceptance criteria or supporting notes.

## Minimal evidence expected per item

- What changed
- Where it changed
- How it will be tested
- What rollout or rollback considerations exist

## Why keep this map

The MCP uses maps like this to produce better refinement, handoff and delivery
risk output. A clean boundary map reduces duplicated acceptance criteria and
improves specialist routing.
