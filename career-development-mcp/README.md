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
