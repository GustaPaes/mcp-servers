# Pipeline and Release Patterns for On-Prem TFS

This document captures the operational lessons behind the MCP's pipeline and
release guidance. All names, URLs, IDs, paths and approvers below are
anonymized placeholders.

## 1. Authentication and endpoints

- Store PATs in environment variables, never in tracked files.
- Keep release-management PATs separate from day-to-day work-item PATs when
  permissions differ.
- Example REST endpoints:
  - Build/YAML: `https://tfs.example.com/ExampleCollection/{project}/_apis/build/...`
  - Release: `https://tfs.example.com/ExampleCollection/{project}/_apis/release/...`
  - Hooks: `https://tfs.example.com/ExampleCollection/_apis/hooks/subscriptions`

Reference placeholders:

| Name | Placeholder |
|---|---|
| Collection | `<collection-id>` |
| Project | `<project-id>` |
| Build repo | `<build-repo-id>` |
| GitOps repo | `<gitops-repo-id>` |
| Agent pool | `<queue-id>` |
| Manual approver | `<approver-id>` |

## 2. Operating rules

- Pushes to `main` should remain controlled by a designated owner.
- PR validation pipelines should not share the same trigger strategy as deploy
  pipelines.
- Semantic tags (`x.y.z`) are a good release trigger when the on-prem setup
  supports them reliably.
- Keep approvals explicit for homologation and production stages.

## 3. Artifact publication trap

TFS on-prem commonly supports `PublishBuildArtifacts@1`, not
`PublishPipelineArtifact@1`.

```yaml
- task: PublishBuildArtifacts@1
  inputs:
    PathtoPublish: $(Build.ArtifactStagingDirectory)
    ArtifactName: drop
    publishLocation: Container
```

If the environment rejects pipeline artifacts, do not fight the platform. Use
the classic artifact task and document the convention.

## 4. PATH propagation in pipeline steps

When installing tools mid-pipeline:

- On Linux, exporting `PATH` inside one task affects only that task unless the
  platform explicitly persists it.
- On Windows, prefer calling the binary via absolute path in the same task.

## 5. `partiallySucceeded` usually does not trigger CD

On several on-prem TFS installations, builds ending as `partiallySucceeded` do
not fire the classic release continuous-deployment trigger.

Practical rule:

- Do not rely on `continueOnError: true` for optional integrations.
- Swallow acceptable non-blocking failures inside the shell step and keep the
  build result `Succeeded` when the deploy path should continue.

## 6. Classic Release Definition traps

### 6.1 Create with the UI-compatible source

Definitions created only via REST can miss internal subscriptions that the UI
creates automatically. If your installation behaves like this, create the
definition with the same shape expected by the UI and validate it visually.

### 6.2 Keep mandatory properties explicit

If your release payload supports additional metadata or creation-source fields,
send them consistently. Some on-prem versions accept the POST but silently skip
trigger wiring when metadata is incomplete.

### 6.3 Git artifact branch references may need the plain branch name

Some installations accept `main` but not `refs/heads/main` in the release
artifact branch reference. If a release fails with an
`ArtifactVersionUnavailableException`, test the branch field first.

### 6.4 `triggerConditions` should not be empty

An empty array can behave as "trigger disabled", not "match everything". Use an
explicit wildcard branch condition when the platform expects one.

### 6.5 Build artifact payloads may require filler fields

Older APIs sometimes validate unused fields anyway. If a known-good payload
contains dummy branch/version keys, keep them. The goal is reproducibility, not
payload minimalism.

### 6.6 Save in the UI at least once

Some installations only register the internal `BuildCompletedEvent`
subscription after a manual UI save. If REST creation looks correct but no
release is created, open the definition, click Edit, then Save.

## 7. CD subscriptions may not appear in hooks APIs

Do not assume `/_apis/hooks/subscriptions` is the source of truth for classic
release CD triggers. Diagnose with:

- `release/definitions/{id}`
- `release/releases?definitionId={id}&$top=5`
- A manual release creation test against the latest build

## 8. GitOps release permissions

When a release stage performs `git push`:

1. Identify the account actually used by the agent.
2. Grant only the repository permissions it needs.
3. Configure a bot identity explicitly:

```bash
git config user.email "pipelines@example.com"
git config user.name "Release Bot"
git commit -m "chore(dev): bump image to $(Build.BuildId) [skip ci]"
```

Use `[skip ci]` or the installation's equivalent to avoid trigger loops.

## 9. Suggested trigger strategy

| Pipeline | Trigger CI | Trigger PR |
|---|---|---|
| PR validation | `none` | `*` |
| Dev deploy / GitOps | `main`, `release/*`, `feature/*` as needed | `none` |
| Tag release | `refs/tags/*` when the installation supports it | `none` |

If the on-prem platform does not react to tags reliably, queue the release
build explicitly through the REST API.

### 9.1 Definition-level CI override for YAML pipelines

Azure DevOps stores a small CI trigger object in the build definition even when
branch, tag and path filters are declared in YAML. Use `ci_trigger_mode` in
`tfs_pipeline_upsert` to make that intent explicit:

| Mode | Behavior |
|---|---|
| `preserve` | Keeps the current definition-level CI configuration. This is the safe default. |
| `yaml` | Enables CI at the definition level and delegates filters to the repository YAML. |
| `disabled` | Removes definition-level CI triggers while preserving schedules and other trigger types. |

The `yaml` mode writes a `continuousIntegration` trigger with
`settingsSourceType: 2`; branch and path filters remain empty in the REST
definition because their source is the YAML file. The `disabled` mode writes an
empty CI trigger list when no other trigger types exist. This is different from
`trigger: none` in the repository: the former is a definition-level control,
while the latter is versioned YAML behavior.

Always preview the mutation before changing a definition:

```json
{
  "name": "Example Release",
  "yaml_path": "pipelines/release.yml",
  "ci_trigger_mode": "yaml",
  "dry_run": true
}
```

## 10. Suggested release-stage layout

### Deploy Dev

- Triggered automatically from the validated build.
- Uses one automated stage.
- Updates the GitOps or deployment configuration for the development
  environment.

### Release Promotion

- Triggered by tag or explicit release queue.
- Uses sequential stages such as Test, Homolog and Prod.
- Keeps homologation and production behind explicit approval gates.

## 11. Script strategy

Keep canonical release-definition scripts outside ad-hoc scratchpads:

- One script per release-definition type
- One payload snapshot for diff/review
- One troubleshooting checklist beside the scripts

Scripts should encode the quirks above so operators do not rediscover them in
production windows.

## 12. Fast checklist for "build passed but release did not trigger"

1. Did the build finish as `Succeeded`?
2. Was an artifact actually published?
3. Does the release definition have an explicit trigger condition?
4. Are branch references using the format your installation accepts?
5. Was the definition saved in the UI at least once?
6. Does the agent identity still have permission in the target repo/system?
7. Can a manual release be created from the same build?

If manual release creation works but auto-trigger does not, suspect trigger
registration or UI-save quirks before changing the pipeline logic.
