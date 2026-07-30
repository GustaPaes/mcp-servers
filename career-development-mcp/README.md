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
- stdio and authenticated Streamable HTTP transports
- structured MCP results and explicit safety annotations

## Install

```powershell
cd "C:\Workspace\MCP Servers\career-development-mcp"
npm install
Copy-Item .env.example .env
npm test
```

For stdio clients, run:

```json
{
  "command": "node",
  "args": ["C:/Workspace/MCP Servers/career-development-mcp/index.js"]
}
```

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `CAREER_MCP_DATA_DIR` | `./data` | Private local JSON storage |
| `TFS_MCP_SERVER_DIR` | `../tfs-mcp` | Optional TFS MCP integration |
| `LOG_LEVEL` | `info` | Log level |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `3020` | HTTP port |
| `MCP_HTTP_TOKEN` | empty | Bearer token; mandatory outside loopback |
| `MCP_HTTP_BODY_LIMIT_BYTES` | `1048576` | Maximum request body |
| `MCP_HTTP_SESSION_TTL_MS` | `1800000` | Idle session lifetime |
| `MCP_HTTP_MAX_SESSIONS` | `50` | Concurrent session cap |

Legacy environment aliases remain temporarily supported for local upgrades,
but new configurations should use the generic names above.

## Privacy

The directories `data/` and `local-private/`, plus `.env`, are ignored by Git.
Keep real feedback, review exports, organization-specific adapters, browser
profiles and credentials there. Public fixtures must be fictional and neutral.

See [`AGENTS.md`](./AGENTS.md) for the operating policy.

## Validation

```powershell
npm test
npm run smoke:http
```

## License

MIT — see the repository root [`LICENSE`](../LICENSE).
