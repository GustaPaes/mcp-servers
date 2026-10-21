# career-development-mcp

Local-first MCP server for individual development plans, SMART goals,
competencies, evidence, career reviews and 1:1 preparation.

The server stores real career data outside Git and can optionally import a TFS
or Azure DevOps Server work item as evidence through the sibling
[`tfs-mcp`](../tfs-mcp).

## Features

- PDI creation, updates, snapshots and progress analysis
- SMART goal planning and progress tracking
- competency assessment, gap analysis and evolution reports
- evidence collection with source metadata
- career-readiness, roadmap and review preparation
- optional TFS work-item evidence import
- sanitized, versioned snapshot import from external career platforms
- daily brief for goals, evidence gaps, blockers and upcoming deadlines
- local configuration and integration diagnostics
- stdio and authenticated Streamable HTTP transports
- structured MCP results, bounded pagination and explicit safety annotations
- optimistic revisions and retained local backups for recoverable updates
- optional live IDP web API provider for personal plans, actions and evidence comments
- explicit evidence-to-criterion assessment and draft completion comments
- expiring before/after previews, confirmation digests and private audit receipts

## Install

```powershell
Set-Location "<repo-root>\career-development-mcp"
npm ci --workspaces=false
Copy-Item .env.example .env
npm test
```

For stdio clients, run:

```json
{
  "command": "node",
  "args": ["<repo-root>/career-development-mcp/index.js"]
}
```

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `CAREER_MCP_DATA_DIR` | `./data` | Private local JSON storage |
| `CAREER_MCP_IMPORT_ROOTS` | `./local-private` | Allowed snapshot roots, separated by the platform path delimiter |
| `CAREER_MCP_IMPORT_MAX_BYTES` | `1048576` | Maximum imported snapshot size (hard cap: 10 MiB) |
| `CAREER_MCP_BACKUP_RETENTION` | `20` | Backups retained per local JSON record (hard cap: 500) |
| `TFS_MCP_SERVER_DIR` | `../tfs-mcp` | Optional TFS MCP integration |
| `CAREER_MCP_TFS_TIMEOUT_MS` | `30000` | Timeout for connect/call through the optional TFS bridge (hard cap: 120 s) |
| `LOG_LEVEL` | `info` | Log level |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `3020` | HTTP port |
| `MCP_HTTP_TOKEN` | empty | Bearer token; mandatory outside loopback |
| `MCP_HTTP_BODY_LIMIT_BYTES` | `1048576` | Maximum request body |
| `MCP_HTTP_SESSION_TTL_MS` | `1800000` | Idle session lifetime |
| `MCP_HTTP_MAX_SESSIONS` | `50` | Concurrent session cap |

## Privacy

The directories `data/` and `local-private/`, plus `.env`, are ignored by Git.
Keep real feedback, review exports, organization-specific adapters, browser
profiles and credentials there. Public fixtures must be fictional and neutral.

See [`AGENTS.md`](./AGENTS.md) for the operating policy.

## Live provider

The existing `guide_pdi_*`, goal and snapshot tools operate on local records.
They do **not** represent the current state of an external platform. Use
`guide_remote_plans_list` and `guide_remote_plan_get` to read live data, and
`guide_remote_plan_analyze` to inspect action progress and writing gaps. Remote
authentication failure is reported; it never falls back silently to an old
snapshot. `guide_remote_status` checks configuration and optionally connectivity.

Configure `CAREER_REMOTE_PROVIDER=idp` with the provider's HTTPS API origin
and its exact hostname in `CAREER_REMOTE_ALLOWED_HOSTS`. Supply one authentication
source in private `.env`: `CAREER_REMOTE_AUTH_TOKEN`, `CAREER_REMOTE_AUTH_COOKIE`,
or `CAREER_REMOTE_SESSION_FILE`. The last option accepts a dedicated JSON object
containing only a `cookies` array from an authorized session; only matching
domain/path, unexpired cookies are forwarded. Keep that file inside
`CAREER_REMOTE_SESSION_ROOT` (default `./local-private/auth`) after symlink
resolution. Signing in to another browser or to the MCP client does not grant
this server access to that browser's credentials. Renew expired credentials
privately; never paste them in chat or tool arguments.

The `idp` adapter implements a reusable IDP web API contract with `employee`
identity, plans, actions and comments. Route paths can be configured with
`CAREER_REMOTE_ROUTES_JSON`; its fixed keys are `self`, `plans`, `plan`, `actions`,
`actionCreate`, `action`, `actionStatus` and `comments`. Paths remain relative
to the configured origin, and `{planId}`/`{actionId}` placeholders must match
the default contract. See `DEFAULT_IDP_ROUTES` in the configuration module.
The adapter accepts flat plan lists or `content` pages, `{plan}` details,
`{action}` entries and flat or `{comment}` comment entries. Provider-specific
configuration remains private; incompatible response models require a separate
adapter rather than silent field guessing.

Additional bounds are documented in `.env.example`: request timeout, response
bytes, preview expiry and retained record quota. Requests run sequentially,
with zero automatic retries, HTTPS certificate verification, pinned public DNS
resolution and no redirects. Private, loopback, metadata, transition and mapped
IP ranges are denied. Errors omit upstream bodies, headers and credentials.
Unknown `CAREER_REMOTE_*` keys are reported without their values.
MCP request cancellation stops queued requests and destroys an in-flight HTTPS
request. A cancelled write with uncertain delivery still requires reconciliation.

Use `guide_action_assess` with the actual action description, its complete
criteria and explicit evidence for each criterion. It prepares a linked comment
and identifies gaps. It does not independently verify supplied links, invent
metrics, infer completion from a closed PBI or substitute experience with a
different technology for a required course. Review the proposed text and sources.

For writing, `guide_remote_change_prepare` accepts one of these operations:

| Operation | Target | Allowed changes |
|---|---|---|
| `plan_create` | authenticated employee | title, description, startDate, endDate, actions, expectations |
| `plan_update` | planId | title, description, startDate, endDate |
| `action_create` | planId | title, description, dueDate |
| `action_update` | planId + actionId | title, description, dueDate |
| `comment_add` | planId, optional actionId | text; action title is prepended when linked |
| `action_status` | planId + actionId | status; commentId and optional commentPage for completion |

Fields outside the selected operation are rejected. Dates must be real calendar
dates and action deadlines must fit the plan. New plans require at least one
action. Provider-specific identifiers, tags, permissions and arbitrary HTTP
requests are not public tool inputs. Only the authenticated employee's plans
can be accessed. Remote deletion and editing another employee are unsupported.
The combined change payload is limited to 64 KiB before a preview is created.

Preparation returns the target, before/after, preview ID, confirmation digest
and expiry. The `before`/`after` maps intentionally vary by the selected operation;
all mutating inputs remain strict. Show the preview and obtain explicit approval
before `guide_remote_change_apply`. Publish the approved evidence comment first;
then prepare completion using its returned `commentId`. The comment must name
the action and link evidence. Other statuses are `PENDING` and `IN_PROGRESS`.

Apply rechecks identity and the remote content digest, serializes local writes
across processes, persists audit intent before writing and verifies updates.
It never resends an uncertain create/comment. An applied preview can be replayed
to retrieve its stored receipt without writing again. After an interrupted or
uncertain write, read the source and reconcile before preparing a replacement.
An unresolved attempt blocks new previews for the same plan (or new-plan scope).
A fresh preview cannot bypass an uncertain write. After an operator verifies the
outcome, archive the reconciled record privately with its audit history; do not
discard an unresolved record to retry a mutation.
An interrupted process may leave `data/remote-previews/apply.lock`; remove it
only after confirming no process is applying and reconciling outstanding records.
The bounded private records retain the preview and audit history; archive
reconciled records when the quota is reached. No automatic purge loses receipts.

IDP web API does not expose a documented atomic conditional update contract. The
immediate digest comparison prevents stale local previews but cannot prevent an
external editor racing the provider's write. Avoid concurrent editing in other
clients; mismatches after update are reported for reconciliation. No remote
transaction or atomic multi-step completion is claimed.

The adapter uses the provider's web API contract, which can change independently
of this server. Unsupported shapes fail closed. Public tests use synthetic data;
validate a read with your authorized account after configuring the provider.
Reload MCP tools in already-open clients after installing this version.

## Daily workflow

- `guide_doctor` checks storage, import roots and the optional `tfs-mcp`
  integration without returning private paths.
- `guide_daily_brief` turns active PDIs, goals and evidence into a prioritized
  workday summary.
- `guide_snapshot_validate` validates a neutral external snapshot without
  persisting it.
- `guide_snapshot_import` stores only the versioned, sanitized schema. Start
  from [`examples/snapshot.example.json`](./examples/snapshot.example.json).
  It defaults to `dryRun=true`; use `dryRun=false` after reviewing the preview
  and pass `expectedRevision` to prevent lost updates.
- `guide_evidence_from_tfs` defaults to dry-run and can convert a configured TFS
  work item into deduplicated career evidence after review.

The PDI, goal, evidence and competency-evolution list tools accept `offset` and
`limit` (maximum 100) and return `items` plus pagination metadata. Evidence
reports use the same bounded page contract. Updates accept `expectedRevision`;
a conflict is rejected instead of silently overwriting newer local data.

All persisted replacements are written atomically. The previous value is kept
under ignored `data/backups/` according to `CAREER_MCP_BACKUP_RETENTION`.
Snapshot paths are constrained after symbolic-link resolution and files are
size-limited before parsing.

## Validation

```powershell
npm test
npm run smoke:http
```

## License

MIT — see the repository root [`LICENSE`](../LICENSE).
