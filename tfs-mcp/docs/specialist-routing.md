# Specialist Routing Pattern

This MCP applies specialist rubrics to improve business writing, technical writing, refinement, PR review and release/pipeline reasoning.

The goal is not to impersonate a human expert. The goal is to make the MCP consistently ask the questions a good set of experts would ask before writing or reviewing TFS artifacts.

## When It Runs

Specialist routing is embedded in:

- `tfs_generate_activity_template`
- `tfs_generate_activity_template_from_items`
- `tfs_prepare_refinement`
- `tfs_work_item_handoff`
- `tfs_prepare_pr_review`
- `tfs_review_pr`
- `tfs_release_readiness`
- `tfs_delivery_risk_report`
- `tfs_pipeline_status`

Use `tfs_specialist_review` directly only when the user asks for a specialist-only analysis or when another workflow needs a reusable recommendation block.

For normal MCP usage, agents should not wait for the user to mention specialists. If the user asks to use this MCP for activity writing, refinement, PR review, release readiness, delivery risk or pipeline status, choose the matching embedded workflow above and consume its `specialistReview` block automatically.

## Specialist Catalog

| Specialist | Trigger examples | Main output |
|---|---|---|
| Business Analyst / Product Owner | Any activity writing/refinement | Persona, value, scope, business criteria |
| Tech Lead | Any technical work | Design, dependencies, risks, rollout |
| QA / Test Specialist | Any activity/PR/release | Test scenarios, evidence, regression |
| Azure DevOps / Pipeline Specialist | Pipeline YAML, release, build, deploy, Docker, env/config | Pipeline gates, variables, artifacts, rollback |
| Security Specialist | Auth, token, secret, cert, TLS, permission, RBAC | Secrets, access, sensitive data, secure logging |
| Backend Specialist | C#, API, service, worker, queue, consumer | API contracts, business rules, errors |
| Frontend / UX Specialist | TSX/JSX/HTML/CSS/client/UI terms | UI states, accessibility, responsiveness |
| Database / Persistence Specialist | SQL, migrations, repository, DAO, Redis, Mongo/cache | Data compatibility, indexes, migrations, rollback |
| Architecture / Integration Specialist | Contracts, SOAP/XML, integration, compatibility | Boundaries, external dependencies, breaking changes |
| Observability / Support Specialist | Logs, metrics, traces, alerts, support, rollback | Diagnostics, runbooks, post-release signals |

## Output Contract

The standard `specialistReview` block contains:

- `detectedAreas`
- `specialistsUsed`
- `signals.fileSummary`
- `signals.criticalAreas`
- `businessWriting`
- `technicalWriting`
- `qaChecklist`
- `pipelineRecommendations`
- `risks`
- `suggestedBusinessCriteria`
- `suggestedTechnicalCriteria`
- `recommendedNextActions`

Agents should use `specialistsUsed` as evidence of which expert lenses were applied. If a workflow needs a missing lens, pass `focus`, `affected_locations`, `pr_id` or `work_item_id` with richer context instead of inventing recommendations outside the MCP result.

## Recommended Prompt Style

```text
Use o MCP de TFS para revisar a US 12345. Quero a escrita de negócio, critérios técnicos, riscos de pipeline/release e checklist de QA.
```

The agent should use an embedded workflow such as `tfs_prepare_refinement` / `tfs_generate_activity_template_from_items`. The specialist layer runs automatically and returns `specialistReview`.

For PRs:

```text
Use o MCP de TFS para preparar a revisão do PR 456 no repo X.
```

The agent should call `tfs_prepare_pr_review`, which uses changed files to route specialists.

For release/pipeline work:

```text
Use o MCP de TFS para avaliar o risco da entrega na branch release/2026.06.
```

The agent should call `tfs_delivery_risk_report`, `tfs_release_readiness` or `tfs_pipeline_status` depending on scope. Each returns specialist recommendations without requiring a separate `tfs_specialist_review` call.
