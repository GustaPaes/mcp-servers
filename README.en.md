# MCP Servers by GustaPaes

> A curated collection of [Model Context Protocol](https://modelcontextprotocol.io) servers I use every day.

Each folder is an independent project with its own README, dependencies, configuration and operating model. The collection is intentionally practical: it focuses on workflows I actually use for cloud operations, TFS/Azure DevOps Server, browser automation and career tracking.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.x-6f42c1)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)

Language: [English](./README.en.md) | [Portugues](./README.pt-BR.md)

## Why This Repository Exists

Most public MCP server lists are catalogs of single-purpose servers maintained by vendors. This repository is different: it is a personal, field-tested toolbox designed to solve day-to-day engineering problems from inside an AI client.

Some servers started from real internal workflows and were later generalized for public use. Where needed, docs and examples use placeholders instead of environment-specific values.

It helps with:

- Operating **Azure Cloud** safely from chat.
- Operating **Oracle Cloud Infrastructure** with extra guardrails around OKE, Vault and Functions.
- Operating **Facebook / Instagram Ads** (Meta Marketing API) with multi-account, dry-run, audit and budget caps.
- Managing **TFS / Azure DevOps Server** work items, PRs, sprints, wiki and delivery readiness.
- Driving **multi-session Playwright** automations with screenshots, HAR, video and trace artifacts.
- Managing **PDIs, goals, evidence and career conversations** with structured data.

## Project Matrix

| Folder | Type | What It Does | Stack | Status |
|---|---|---|---|---|
| [`azure-mcp`](./azure-mcp) | MCP wrapper | Operates Azure resources through Microsoft's official `@azure/mcp` server and adds local scripts plus an LLM safety policy. | `npx`, Azure CLI, PowerShell | Stable |
| [`meta-ads-mcp`](./meta-ads-mcp) | MCP server | Multi-account Meta Marketing API server (Facebook Ads / Instagram Ads) with strict recommend ↔ execute separation, dry-run, mutation gate, triple budget caps, audit log and protected-attribute targeting block. | TypeScript, Node 20, MCP SDK, undici, Zod | Beta |
| [`tfs-mcp`](./tfs-mcp) | MCP server | Generic TFS / Azure DevOps Server work items, configurable custom-process profiles, PRs, review, refinement, release readiness and specialist routing. | Node 20, ESM, MCP SDK | Stable |
| [`oci-mcp`](./oci-mcp) | MCP toolkit | Combines official Oracle MCP servers with a custom `oci-extras-mcp` for OKE, Vault/Secrets, Kubernetes, Functions and streaming logs. | Node 20, OCI SDK, `uvx` | Stable |
| [`playwright-mcp`](./playwright-mcp) | MCP server | Multi-session browser automation with Chromium/Firefox/WebKit, native Chrome/Edge, HAR, video, traces, PDF, request routing and light stealth. | TypeScript, Node 20, Playwright | Stable |
| [`career-development-mcp`](./career-development-mcp) | MCP server | PDIs, SMART goals, competencies, evidence, career readiness, 1:1 preparation and optional TFS evidence import. | Node 20, ESM, local JSON storage | Beta |

## Quality and Safety Baseline

- Tools expose explicit JSON schemas and reject unknown input fields where practical.
- Structured tool responses are returned as `structuredContent` when the server owns the protocol response shape.
- Mutating and destructive tools are annotated with MCP tool annotations and documented operating policies.
- Runtime state, browser profiles, logs, output artifacts and local `.env` files are ignored by Git.
- Cloud-facing tools favor dry-run, audit logging, least privilege and explicit confirmation for high-impact actions.
- Project READMEs include client configuration snippets and verification commands so each server can be tested independently.

## Repository Layout

```text
mcp-servers/
├── README.md
├── README.en.md
├── README.pt-BR.md
├── LICENSE
├── .gitignore
├── config/
│   └── opencode.example.json
├── azure-mcp/
├── meta-ads-mcp/
├── tfs-mcp/
├── oci-mcp/
│   └── oci-extras-mcp/
├── playwright-mcp/
├── career-development-mcp/
```

## Requirements

General requirements:

- Node.js 20 or newer.
- npm 10 or newer.
- An MCP-compatible client such as OpenCode, Claude Code, Claude Desktop, Cursor, Cline, Codex CLI, Continue or VS Code Copilot Agent mode.

Project-specific requirements:

- `azure-mcp`: Azure CLI and an authenticated `az login` session.
- `oci-mcp`: OCI CLI / OCI config, `uv` or `uvx`, and optional `kubectl` for Kubernetes workflows.
- `playwright-mcp`: Playwright browser binaries, installed with `npx playwright install chromium` or the tool `browser_install`.

## Install the Collection

Clone the repository:

```bash
git clone https://github.com/GustaPaes/mcp-servers.git
cd mcp-servers
```

Install only what you need:

```bash
cd tfs-mcp && npm install && cd ..
cd career-development-mcp && npm install && cd ..
cd playwright-mcp && npm install && npm run build && cd ..
```

For `azure-mcp`, there is no local install step because it uses `npx -y @azure/mcp@3.0.0-beta.30 server start`.

For `oci-mcp`, follow [`oci-mcp/docs/01-installation.md`](./oci-mcp/docs/01-installation.md) because it combines Node, OCI CLI and Oracle's Python-based MCP servers.

## Configure Environment Variables

Each project that needs secrets has a `.env.example`. Copy it to `.env` and fill in the values locally:

```bash
cp tfs-mcp/.env.example tfs-mcp/.env
cp career-development-mcp/.env.example career-development-mcp/.env
cp oci-mcp/.env.example oci-mcp/.env
```

Never commit real `.env` files. The root `.gitignore` and project `.gitignore` files ignore them.

## Install in OpenCode

OpenCode reads MCP servers from `~/.config/opencode/opencode.json` on Linux/macOS and `%USERPROFILE%\.config\opencode\opencode.json` on Windows.

Use [`config/opencode.example.json`](./config/opencode.example.json) as a complete starting point, or add only the servers you want:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["node", "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"],
      "enabled": true
    },
    "azure": {
      "type": "local",
      "command": ["npx", "-y", "@azure/mcp@3.0.0-beta.30", "server", "start"],
      "enabled": true
    }
  }
}
```

Restart OpenCode after editing the config. It does not hot-reload MCP configuration.

## Install in Claude Code

Use `claude mcp add`:

```bash
claude mcp add playwright node "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"
claude mcp add azure -- npx -y @azure/mcp@3.0.0-beta.30 server start
claude mcp list
```

For a server with environment variables:

```bash
claude mcp add tfs-mcp node "C:/Workspace/MCP Servers/tfs-mcp/index.js" \
  --env TFS_URL=https://tfs.example.com \
  --env TFS_PAT=your-pat
```

## Install in Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]
    },
    "azure": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@3.0.0-beta.30", "server", "start"]
    }
  }
}
```

Restart Claude Desktop fully after editing the file.

## Install in Cursor or Cline

Cursor and Cline use a shape similar to Claude Desktop. Example:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]
    }
  }
}
```

For Cline, add `"type": "stdio"`, `"disabled": false` and optionally `"timeout": 60` if your local setup requires it.

## Install in Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.playwright]
command = "node"
args = ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]

[mcp_servers.azure]
command = "npx"
args = ["-y", "@azure/mcp@3.0.0-beta.30", "server", "start"]
```

## Install in Continue

Edit `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: playwright
    command: node
    args:
      - "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"
```

## Install in VS Code Copilot Agent Mode

Add `.vscode/mcp.json` to your workspace:

```json
{
  "servers": {
    "playwright": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]
    }
  }
}
```

## Safety Model

The cloud and work-management servers are intentionally conservative.

Common operating rules:

- Read-only tools such as `list`, `get`, `show`, `query` and `status` can run without confirmation.
- Write tools such as `create`, `update`, `set`, `deploy`, `scale` and `comment` should show a plan and wait for explicit confirmation.
- Destructive tools such as `delete`, `purge`, `remove`, `terminate` and `revoke` require reinforced confirmation.
- Production-like names such as `prod`, `prd`, `production`, `live`, `hml`, `homolog` and `preprod` are treated as high risk.
- Runtime artifacts such as HAR files, storage states, browser profiles, logs and captured external career platform state must not be committed.

Project-specific safety docs:

- [`azure-mcp/AGENTS.md`](./azure-mcp/AGENTS.md)
- [`meta-ads-mcp/AGENTS.md`](./meta-ads-mcp/AGENTS.md)
- [`meta-ads-mcp/BEST_PRACTICES.md`](./meta-ads-mcp/BEST_PRACTICES.md)
- [`playwright-mcp/AGENTS.md`](./playwright-mcp/AGENTS.md)
- [`oci-mcp/BEST_PRACTICES.md`](./oci-mcp/BEST_PRACTICES.md)
- [`oci-mcp/docs/07-security-checklist.md`](./oci-mcp/docs/07-security-checklist.md)

## What to Commit

Commit:

- Source files.
- README files and docs.
- `.env.example` files.
- `package.json` and lockfiles.
- Safety policies and examples.

Do not commit:

- `.env` files.
- PATs, API keys, OCI private keys or Azure service principal secrets.
- `node_modules`.
- `dist` unless a project explicitly documents that it must be committed.
- Runtime output (`output`, `logs`, HAR, videos, traces, screenshots, browser storage state).
- Local-only sprint archives.

## Project Notes

### azure-mcp

This folder wraps the official Microsoft Azure MCP server with local documentation, safety rules and helper scripts. It uses your Azure CLI login by default.

### meta-ads-mcp

A from-scratch TypeScript MCP for the Meta Marketing API. Multi-account by design: each account has its own mode (`read-only` / `dry-run` / `write-enabled`) and budget caps. Mutations require a four-field confirmation contract on top of account mode AND global `READ_ONLY`/`DRY_RUN` switches. Engines (Optimization, Budget, Creative, Audience, PolicyRisk) are deterministic and never call the API; only the tool layer does. Targeting by protected attributes is rejected. Two transports (stdio + Streamable HTTP) ship from the same builder.

### tfs-mcp

This generic server targets TFS / Azure DevOps Server workflows: standard and custom work items, PRs, review, release readiness, wiki, delivery risk and automatic specialist routing. Required fields and rich-text mappings for organization-specific processes are configured with `TFS_WORK_ITEM_PROFILES_JSON` in the local `.env`; the committed source and examples remain neutral.

### oci-mcp

This is a meta-toolkit. Use official Oracle MCP servers for generic OCI APIs and `oci-extras-mcp` for the missing operational workflows around OKE, Vault, Secrets, Functions and log streaming.

### playwright-mcp

This server is intentionally different from Microsoft's Playwright MCP. It focuses on parallel sessions, artifacts and lower-level browser automation primitives.

### career-development-mcp

This server stores career-development data locally and can optionally import TFS work items as evidence.

## License

MIT for the repository-level material. Some subprojects carry their own license notes, especially `oci-mcp` (UPL-1.0). Third-party tools keep their original licenses.
