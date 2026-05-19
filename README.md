# MCP Servers — by [@GustaPaes](https://github.com/GustaPaes)

> **A curated collection of [Model Context Protocol](https://modelcontextprotocol.io) servers and AI-driven automation tools I use every day.**
> Each folder is an independent project with its own README, dependencies and license. They all plug into the same MCP-compatible clients (OpenCode, Claude Code, Claude Desktop, Cursor, Cline, Codex CLI, Continue, etc.).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.x-6f42c1)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)

---

🇺🇸 **English** · 🇧🇷 [Português](#-português) · [📦 Servers](#-servers) · [⚙️ Install](#%EF%B8%8F-install-in-your-mcp-client) · [🛡️ Safety model](#%EF%B8%8F-safety-model)

---

## Why this repo

Most public MCP server lists are catalogs of single-purpose servers maintained by their vendors. **This repo is the opposite:** a personal toolbox of servers I built (or curated) to solve real problems in my day-to-day:

- Driving **Azure Cloud** and **Oracle Cloud (OCI)** safely from inside a chat.
- Operating an **on-prem TFS / Azure DevOps Server** (work items, PRs, release readiness).
- Running **multi-session Playwright** automations from natural-language prompts.
- Managing **PDIs, goals, evidences and career conversations** with structured data.
- Filling out the long [`unattend-generator`](https://schneegans.de/windows/unattend-generator/) form for Windows unattended installs in seconds.

Everything here ships with:

- ✅ Bilingual README (EN/PT-BR)
- ✅ `.env.example` so you never need to read code to know which env vars matter
- ✅ A safety / confirmation policy in `AGENTS.md` for the destructive ones
- ✅ Ready-to-paste config snippets for OpenCode / Claude Desktop / Cursor / Cline / Codex CLI

---

## 📦 Servers

| Folder | What it does | Stack | Status |
|---|---|---|---|
| [`azure-mcp/`](./azure-mcp) | Operate Azure Cloud (Storage, AKS, Key Vault, App Service, Monitor, RBAC, …). Wraps the official [`@azure/mcp`](https://www.npmjs.com/package/@azure/mcp) with a strict safety policy. | Microsoft (npx) + PowerShell | ✅ Stable |
| [`tfs-mcp/`](./tfs-mcp) | MCP for on-prem **TFS / Azure DevOps Server**: work items, PRs, code review, release readiness, refinement helpers, work-item writing template. | Node 20 + ESM | ✅ Stable |
| [`oci-mcp/`](./oci-mcp) | Meta-toolkit for **Oracle Cloud Infrastructure**: the official `oracle.oci-*` servers plus a custom `oci-extras-mcp` that adds OKE, Vault/Secrets, Functions and streaming logs — all guarded by an ownership ledger. | Node 20 + Python (uvx) | ✅ Stable |
| [`playwright-mcp/`](./playwright-mcp) | Multi-session Playwright MCP: Chromium/Firefox/WebKit + Chrome/Edge channels, HAR/video/tracing/PDF, route mocking, stealth profile, parallel sessions. | TypeScript 5 + Node 20 | ✅ Stable |
| [`career-development-mcp/`](./career-development-mcp) | MCP for **PDIs, goals, competencies, evidence and 1:1 prep**, with optional bridge to `tfs-mcp` to import work items as evidence. | Node 20 + ESM | 🟡 Beta |
| [`unattend-autofill/`](./unattend-autofill) | Standalone Playwright script that auto-fills `schneegans.de/windows/unattend-generator/` with my hardened Windows 11 preset (services, search/cloud policies, power tweaks, scripts injection). Not an MCP server — kept here because it is part of the same toolchain. | Node 20 + Playwright + PowerShell | ✅ Stable |

---

## ⚙️ Install in your MCP client

Pick the section that matches the client you use. The path examples assume you cloned this repo to `C:\Workspace\MCP Servers` on Windows. Adjust to your OS.

### 🧠 [OpenCode](https://opencode.ai) — what I use

Edit `~/.config/opencode/opencode.json` (Linux/macOS) or `%USERPROFILE%\.config\opencode\opencode.json` (Windows). The repo's [`config/opencode.example.json`](#-ready-to-paste-snippets-) has the full block; minimum:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tfs-mcp": {
      "type": "local",
      "command": ["node", "C:/Workspace/MCP Servers/tfs-mcp/index.js"],
      "enabled": true,
      "env": {
        "TFS_URL": "https://tfs.example.com",
        "TFS_PAT": "..."
      }
    },
    "playwright": {
      "type": "local",
      "command": ["node", "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"],
      "enabled": true
    },
    "azure": {
      "type": "local",
      "command": ["npx", "-y", "@azure/mcp@latest", "server", "start"],
      "enabled": true
    }
  }
}
```

> Restart OpenCode after saving. OpenCode does not hot-reload config.

### 🤖 [Claude Code](https://docs.claude.com/en/docs/claude-code) (CLI)

Use the `claude mcp add` command (one-time per server):

```bash
# Local (stdio) MCP — example with this repo's tfs-mcp
claude mcp add tfs-mcp node "C:/Workspace/MCP Servers/tfs-mcp/index.js" \
  --env TFS_URL=https://tfs.example.com \
  --env TFS_PAT=your-pat

# A pure-npx server (azure-mcp)
claude mcp add azure -- npx -y @azure/mcp@latest server start

# List configured servers
claude mcp list
```

### 🖥️ [Claude Desktop](https://claude.ai/download)

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) / `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "tfs-mcp": {
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/tfs-mcp/index.js"],
      "env": { "TFS_URL": "https://tfs.example.com", "TFS_PAT": "..." }
    },
    "playwright": {
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop fully (system-tray quit) for changes to apply.

### 🟦 [Cursor](https://docs.cursor.com/context/model-context-protocol)

Edit `~/.cursor/mcp.json` (or via Settings → MCP). Same shape as Claude Desktop:

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

### 🐝 [Cline](https://github.com/cline/cline) (VS Code extension)

In the Cline panel → **MCP Servers** → **Edit Configuration**:

```json
{
  "mcpServers": {
    "tfs-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/tfs-mcp/index.js"],
      "disabled": false,
      "timeout": 60
    }
  }
}
```

### 🐢 [Codex CLI](https://github.com/openai/codex)

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.example-product_tfs]
command = "node"
args    = ["C:/Workspace/MCP Servers/tfs-mcp/index.js"]
env     = { TFS_URL = "https://tfs.example.com", TFS_PAT = "..." }

[mcp_servers.playwright]
command = "node"
args    = ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]
```

### 🟣 [Continue.dev](https://docs.continue.dev/customize/deep-dives/mcp)

Edit `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: tfs-mcp
    command: node
    args:
      - "C:/Workspace/MCP Servers/tfs-mcp/index.js"
    env:
      TFS_URL: https://tfs.example.com
      TFS_PAT: your-pat
```

### 🌐 Generic / VS Code GitHub Copilot

VS Code (Copilot Chat in Agent mode) reads workspace `.vscode/mcp.json`:

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

---

## 🚀 Getting started

```bash
# 1. Clone
git clone https://github.com/GustaPaes/mcp-servers.git
cd mcp-servers

# 2. Install dependencies of the server(s) you want
cd tfs-mcp && npm install && cd ..
cd career-development-mcp   && npm install && cd ..
cd playwright-mcp && npm install && npm run build && cd ..
cd unattend-autofill && npm install && npx playwright install chromium && cd ..
# (azure-mcp uses npx — no install step. oci-mcp has its own scripts/install-prereqs.ps1)

# 3. Copy each .env.example to .env and fill in secrets
copy tfs-mcp\.env.example tfs-mcp\.env
notepad tfs-mcp\.env   # add your PAT

# 4. Wire whichever client you use (see the section above)
```

---

## 🛡️ Safety model

The cloud-touching servers (`azure-mcp`, `oci-mcp`, `tfs-mcp`) ship with a written **operating policy** in `AGENTS.md` that any LLM driving them is supposed to read first. Recurring rules:

- 🟢 **Read** tools (`*_list`, `*_get`, `*_show`, `*_query`) run freely.
- 🟡 **Write** tools (`*_create`, `*_update`, `*_set`, `*_deploy`) require an explicit "ok / sim / confirm" from the user, with a **plan-of-change** block printed first.
- 🔴 **Destructive** tools (`*_delete`, `*_purge`, `*_remove`, `*_terminate`) require a reinforced confirmation: backup acknowledged, maintenance window, and the user typing the resource name back (anti-typo).
- 🔍 Anything matching `\b(prod|prd|production|live|hml|homolog|preprod)\b` is treated as 🔴 even if the underlying tool is 🟡.
- 📜 Every mutation is logged — to the conversation, and (for `oci-mcp`) to `logs/audit.jsonl`.

The full policies live in:
- [`azure-mcp/AGENTS.md`](./azure-mcp/AGENTS.md)
- [`oci-mcp/`](./oci-mcp) (`docs/07-security-checklist.md` + `BEST_PRACTICES.md`)
- [`playwright-mcp/AGENTS.md`](./playwright-mcp/AGENTS.md)

---

## 🗂 Repository layout

```
mcp-servers/
├── README.md                  ← you are here
├── LICENSE                    ← MIT
├── .gitignore                 ← monorepo-wide
├── azure-mcp/                 ← Azure Cloud (wrapper around @azure/mcp)
├── tfs-mcp/              ← TFS / Azure DevOps Server on-prem
├── oci-mcp/                   ← Oracle Cloud Infrastructure
│   └── oci-extras-mcp/        ←   custom server (OKE, Vault, Functions)
├── playwright-mcp/            ← Playwright MCP (TS)
├── career-development-mcp/                ← PDI / goals / evidence MCP
└── unattend-autofill/         ← Windows unattend.xml form-filler (not an MCP)
```

---

## 🤝 Contributing / forking

This is a personal collection — if a server here is useful to you, **fork the folder** into your own repo or PR improvements that don't break my use case.
Bug reports and well-scoped suggestions are welcome via GitHub issues.

---

## 📜 License

MIT — see [LICENSE](./LICENSE). The bundled servers may carry their own licenses (`oci-mcp` is UPL-1.0; the official `@azure/mcp` upstream is MIT). All third-party assets stay under their original licenses.

---

## 🇧🇷 Português

> **Coleção curada de servidores [Model Context Protocol](https://modelcontextprotocol.io) e ferramentas de automação que uso no dia a dia.**
> Cada pasta é um projeto independente com README próprio, dependências próprias e licença própria. Todos plugam nos mesmos clientes MCP (OpenCode, Claude Code, Claude Desktop, Cursor, Cline, Codex CLI, Continue, etc.).

### Por que este repo existe

A maioria das listas públicas de MCP é um catálogo de servidores de propósito único mantidos pelos vendors. **Este repo é o oposto:** uma caixa de ferramentas pessoal que construí (ou curei) para resolver problemas reais:

- Operar **Azure Cloud** e **Oracle Cloud (OCI)** com segurança a partir de um chat.
- Operar um **TFS / Azure DevOps Server on-prem** (work items, PRs, prontidão de release).
- Rodar **automações Playwright multi-sessão** a partir de prompts em linguagem natural.
- Gerenciar **PDIs, metas, evidências e conversas de carreira** com dados estruturados.
- Preencher o longo formulário do [`unattend-generator`](https://schneegans.de/windows/unattend-generator/) para instalações Windows unattended em segundos.

Cada projeto inclui:

- ✅ README bilíngue (EN/PT-BR)
- ✅ `.env.example` — você não precisa ler código para saber quais variáveis configurar
- ✅ Política de segurança / confirmação em `AGENTS.md` para os MCPs destrutivos
- ✅ Snippets prontos para OpenCode / Claude Desktop / Cursor / Cline / Codex CLI

### Servidores

Veja a tabela em [📦 Servers](#-servers). Os links levam ao README específico de cada projeto, todos bilíngues.

### Instalação rápida

1. Clone o repo: `git clone https://github.com/GustaPaes/mcp-servers.git`
2. Entre na pasta do servidor que quer usar e rode `npm install` (ou siga o README dele).
3. Copie `.env.example` → `.env` e preencha os segredos.
4. Cole o snippet correspondente no config do seu cliente MCP (seção [⚙️ Install in your MCP client](#%EF%B8%8F-install-in-your-mcp-client)).
5. Reinicie o cliente.

### Modelo de segurança

Os MCPs que tocam infraestrutura cloud (`azure-mcp`, `oci-mcp`, `tfs-mcp`) têm uma **política operacional escrita** em `AGENTS.md` que qualquer LLM que os usar deve ler antes. Regras gerais:

- 🟢 **Leitura** (`*_list`, `*_get`) roda livre.
- 🟡 **Escrita** (`*_create`, `*_update`) exige confirmação explícita do usuário, depois de mostrar o plano da mudança.
- 🔴 **Destrutivo** (`*_delete`, `*_purge`) exige confirmação reforçada — backup confirmado, janela de manutenção e o usuário digitando o nome do recurso de volta (anti-typo).
- 🔍 Qualquer recurso que case com `prod|prd|production|live|hml|homolog|preprod` é tratado como 🔴 mesmo se a tool for 🟡.
- 📜 Toda mutação é logada — na conversa e (no `oci-mcp`) em `logs/audit.jsonl`.

### Contribuindo

É uma coleção pessoal — se algum servidor for útil pra você, **forke a pasta** ou abra PRs pequenos que não quebrem meu uso. Issues bem descritas são bem-vindas.

### Licença

MIT. Veja [LICENSE](./LICENSE).
