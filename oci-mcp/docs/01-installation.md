# 01 — Installation (Windows)

## 1. Prerequisites

Run an elevated PowerShell:

```powershell
cd '<repo-root>/oci-mcp'
.\scripts\install-prereqs.ps1
```

Installs (idempotent, via winget):

- Node.js 20 LTS
- Python 3.12 + `uv` (provides `uvx`)
- OCI CLI
- kubectl

Verify everything:

```powershell
.\scripts\verify-setup.ps1
```

## 2. OCI authentication

Pick **one** of the supported methods (see `docs/02-authentication.md`).

Quick start (interactive session token, recommended for laptops):

```powershell
oci session authenticate --region sa-saopaulo-1 --profile-name DEFAULT
```

This writes `~/.oci/config` with `security_token_file` pointing at a token cached locally.

## 3. Install the custom MCP server (`oci-extras-mcp`)

```powershell
cd '<repo-root>/oci-mcp/oci-extras-mcp'
copy .env.example .env
npm install
npm run smoke
```

`smoke` boots the stdio transport and lists every registered tool — no OCI calls.

## 4. Wire it into your MCP client

Pick the snippet for your client and copy the `mcpServers`/`mcp` block:

| Client          | File                                      |
|-----------------|-------------------------------------------|
| Claude Desktop  | `config/claude_desktop_config.json`       |
| Cursor          | `config/cursor_mcp.json`                  |
| Cline (VS Code) | `config/cline_mcp_settings.json`          |
| VS Code MCP     | `config/vscode_mcp.json`                  |
| OpenCode        | `config/opencode.json`                    |

Or generate one from the CLI:

```powershell
node scripts\generate-mcp-config.mjs --client cursor --out .cursor\mcp.json
```

Restart your client. The toolkit registers two families of servers:

- `oci-extras` (this repo) — OKE, Vault/Secrets, K8s layer, Functions, streaming logs.
- `oci-*` — Oracle's official Python servers via `uvx oracle.oci-*-mcp-server@latest`
  (compute, identity, networking, lb, monitoring, logging, registry, cloud-guard, api).

## 5. (Optional) HTTP transport

```powershell
cd '<repo-root>/oci-mcp/oci-extras-mcp'
$env:MCP_HTTP_PORT = 3020
npm run start:http
```

Then point any HTTP-capable client at `http://127.0.0.1:3020/mcp`.
