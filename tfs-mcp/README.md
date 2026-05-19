# tfs-mcp MCP

> **MCP server for on-prem TFS / Azure DevOps Server.** Built for the daily flow of an engineering team: backlog hygiene, refinement, PR review, release readiness, work-item writing template and executive risk score.

[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.x-6f42c1)](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

🇺🇸 **English** · 🇧🇷 [Português](#-português)

---

## Why

A wrapper around TFS REST APIs is easy. **The hard part is making an LLM useful in a TFS-driven team.** This server packages that work:

- **Premium workflows** — `tfs_prepare_pr_review`, `tfs_release_readiness`, `tfs_team_focus_report`, `tfs_work_item_handoff`, `tfs_delivery_risk_report` return both a human-readable text and a typed `structuredContent` (formal `outputSchema`).
- **Standardized writing template** — `tfs_generate_activity_template` and its bulk sibling `tfs_generate_activity_template_from_items` produce business + technical descriptions in a fixed bold-block format with `**Deve**` acceptance criteria. The MCP self-summarizes the technical block when the change estimate exceeds 50 lines.
- **Multi-PAT auth** — `TFS_PAT_<ALIAS>` lets you keep a build PAT and a personal PAT side by side; pass `auth_alias` per call.
- **Multi-repo PR search** — when `repo` is omitted, the server iterates `TFS_REPOS` until it finds the PR.
- **Both transports** — `stdio` (default) and Streamable HTTP (`--http`).

Originally built for the [`ExampleProject`](https://www.example.com.br/) project at ExampleOrg; the abstractions are generic and work against any on-prem TFS / Azure DevOps Server instance.

---

## Requirements

- **Node.js ≥ 20**
- A reachable TFS / Azure DevOps Server endpoint
- A Personal Access Token with the right scopes (Work Items: Read & Write, Code: Read, Build: Read, Wiki: Read)

## Install

```powershell
cd "C:\Workspace\MCP Servers\tfs-mcp"
npm install
copy .env.example .env
notepad .env   # fill TFS_URL, TFS_PROJECT, TFS_REPOS, TFS_PAT_*
```

Verify it starts:

```powershell
node index.js          # stdio mode (will wait on stdin)
# OR
node index.js --http   # listens on http://localhost:3010 — try /health
```

Run the premium-workflow validation harness (executes against your real TFS):

```powershell
npm run validate:premium
```

---

## Wire it into your MCP client

> Replace the path with wherever you cloned the repo.

### OpenCode (`~/.config/opencode/opencode.json`)

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
        "TFS_COLLECTION": "YourCollection",
        "TFS_PROJECT": "YourProject",
        "TFS_REPOS": "repo-one,repo-two",
        "TFS_PAT_ALICE": "alice-pat",
        "TFS_DEFAULT_AUTH_ALIAS": "alice"
      }
    }
  }
}
```

### Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "tfs-mcp": {
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/tfs-mcp/index.js"],
      "env": {
        "TFS_URL": "https://tfs.example.com",
        "TFS_PAT": "your-pat"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add tfs-mcp node "C:/Workspace/MCP Servers/tfs-mcp/index.js" \
  --env TFS_URL=https://tfs.example.com \
  --env TFS_PAT=your-pat
```

### Cursor / Cline / Codex CLI / Continue

See the [root README](../README.md#%EF%B8%8F-install-in-your-mcp-client) for ready-to-paste blocks for every supported client.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TFS_URL` | `https://tfs.example.com` | Base URL of the TFS / Azure DevOps Server |
| `TFS_COLLECTION` | `ExampleCollection` | Collection name |
| `TFS_PROJECT` | `ExampleProject` | Project name |
| `TFS_REPOS` | _(empty)_ | Comma-separated list of repos to search PRs across |
| `TFS_REPO` | _(empty)_ | Legacy single-repo fallback (still accepted) |
| `TFS_PAT` | _(empty)_ | Default PAT |
| `TFS_PAT_<ALIAS>` | _(empty)_ | Multiple PATs by alias (e.g. `TFS_PAT_ALICE`) |
| `TFS_DEFAULT_AUTH_ALIAS` | _(empty)_ | Alias used when calls don't specify `auth_alias` |
| `TFS_WORKSPACE_ROOT` | _(auto)_ | Helps repo auto-detection from working dir |
| `MCP_HTTP_PORT` | `3010` | Port for `--http` mode |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |

---

## Tool catalog

### Context & backlog
- `tfs_work_item` — full details of a work item
- `tfs_analyze_work_item` — quality score, US format, gaps, refinement checklist
- `tfs_work_item_context` — work item + related items + PRs + wiki pages
- `tfs_prepare_refinement` — refinement package (DOR, questions, dependencies)
- `tfs_generate_activity_template` — generate the standardized business + technical description
- `tfs_generate_activity_template_from_items` — bulk version starting from existing items
- `tfs_query_work_items` — WIQL, presets, structured filters
- `tfs_sprint_info` — current iteration metrics

### Pull requests & review
- `tfs_list_prs`, `tfs_get_pr`
- `tfs_review_pr` — automated code review with ExampleProject rules + modern frontend/backend best practices
- `tfs_comment_review_findings` — turn findings into PR comments with suggested fixes
- `tfs_prepare_pr_review` — **premium** review-prep workflow (work items, threads, risks, areas, automated review, pipeline)
- `tfs_add_pr_comment`

### Execution & governance
- `tfs_release_readiness` — **premium** release-readiness workflow
- `tfs_team_focus_report` — **premium** WIP / focus / bottleneck workflow
- `tfs_work_item_handoff` — **premium** PO ↔ Dev ↔ QA ↔ Support handoff package
- `tfs_delivery_risk_report` — **premium** executive delivery-risk score
- `tfs_pipeline_status` — recent pipeline runs
- `tfs_list_repos`, `tfs_wiki`

### Controlled mutation
- `tfs_update_work_item` — change state, owner, comment, title or story points

### Premium workflows produce structured output
The 5 premium workflows ship with formal `outputSchema` so MCP clients can validate the `structuredContent` payload, while still returning the human-readable text for simpler clients.

---

## Activity-writing template

The MCP enforces a fixed format used by the team for User Stories / Sprint Tasks / PBIs:

```text
**Enquanto** ...
**eu quero** ...
**para que eu** ...

**Critérios de Aceite de Negócio:**
**Deve** ...
**Deve** ...

**Definições Visuais:** ...

**Dependências Técnicas:** ...

**Critérios de Aceite Técnico:**
**Deve** ...
**Deve** ...

**Locais Afetados:**
...
```

Rules implemented:

- Labels always rendered in bold.
- Acceptance criteria always start with `**Deve**`.
- If the estimated change exceeds 50 lines, the MCP attempts to summarize the technical block.
- Generation can come from manual fields or from existing TFS items (single or bulk).
- Optionally pulls TFS wiki pages as supporting context.

Example call (single):

```json
{
  "title": "Configurar headers de segurança HTTP",
  "work_item_type": "User Story",
  "actor": "responsável pela segurança da aplicação",
  "intent": "que os cabeçalhos de segurança HTTP estejam configurados",
  "outcome": "a aplicação esteja em conformidade com as melhores práticas",
  "business_acceptance_criteria": ["Deve adicionar os headers HTTP de segurança", "..."],
  "technical_dependencies": "Não há",
  "technical_acceptance_criteria": ["Deve editar Web.config", "..."],
  "affected_locations": ["server/API/Web.config", "client/src/web.config"]
}
```

---

## Architecture

```
tfs-mcp/
├── index.js                    # Bootstrap: --http picks src/http.js, else src/server.js
├── schemas.js                  # JSON Schema contracts for premium workflows
├── validate-premium.mjs        # End-to-end harness against your real TFS
├── smoke-http.mjs              # HTTP smoke test
├── package.json
├── src/
│   ├── server.js               # MCP server registration (stdio)
│   ├── http.js                 # Streamable HTTP transport
│   ├── config.js               # Env loading + defaults
│   ├── tfs-client.js           # Auth, GET/POST helpers, normalizers
│   ├── analytics.js            # Risk score, readiness, focus heuristics
│   ├── activity-template.js    # Writing template engine
│   ├── formatters.js           # Human-readable output composition
│   ├── rules.js                # Code-review rule set
│   ├── logger.js               # pino → stderr
│   ├── request-context.js      # Per-request context (auth alias, etc.)
│   └── tools/
│       ├── work-item.js
│       ├── pull-request.js
│       ├── sprint.js
│       ├── handoff.js
│       └── infra.js
└── docs/
    ├── creation-patterns.md
    ├── separation-patterns.md
    ├── pipeline-release-patterns.md
    ├── work-items-map.md
    └── writing-patterns.md
```

`scripts/sprint-archive/` holds historical ad-hoc scripts used during sprint cleanups (creation/update batches, wiki readers, etc.). The folder is gitignored — it lives on disk for personal reference but is not published.

---

## Security

- The `.env` file is gitignored. Use `.env.example` as the template.
- PATs are sent over HTTPS to your TFS endpoint and never logged.
- Mutating tools (`tfs_update_work_item`, `tfs_add_pr_comment`, `tfs_comment_review_findings`) require explicit input — there is no implicit batch-write.
- `tfs_review_pr` and `tfs_comment_review_findings` default to `dry_run=true`.

---

## License

MIT — see [LICENSE](../LICENSE).

---

## 🇧🇷 Português

> **MCP para TFS / Azure DevOps Server on-prem.** Construído para o fluxo diário de um time de engenharia: higiene de backlog, refinamento, revisão de PR, prontidão de release, template padronizado de escrita e score executivo de risco.

### Por quê

Um wrapper das APIs TFS é fácil. **O difícil é deixar um LLM realmente útil dentro de um time TFS.** Este servidor entrega esse trabalho:

- **Workflows premium** — `tfs_prepare_pr_review`, `tfs_release_readiness`, `tfs_team_focus_report`, `tfs_work_item_handoff`, `tfs_delivery_risk_report` retornam texto legível **e** `structuredContent` tipado (com `outputSchema` formal).
- **Template padronizado de escrita** — `tfs_generate_activity_template` (e a versão em massa) gera descrições de negócio + técnicas em formato de blocos em negrito com critérios `**Deve**`. O MCP resume o bloco técnico se a estimativa de alteração passar de 50 linhas.
- **Multi-PAT** — `TFS_PAT_<ALIAS>` permite manter um PAT de build e um pessoal lado a lado; passe `auth_alias` por chamada.
- **Busca de PR multi-repo** — quando `repo` é omitido, o servidor itera `TFS_REPOS` até achar.
- **Dois transportes** — `stdio` (padrão) e Streamable HTTP (`--http`).

Originalmente construído para o projeto [`ExampleProject`](https://www.example.com.br/) na ExampleOrg; as abstrações são genéricas e funcionam contra qualquer instância on-prem.

### Pré-requisitos

- **Node.js ≥ 20**
- TFS / Azure DevOps Server acessível
- PAT com escopos: Work Items (Read & Write), Code (Read), Build (Read), Wiki (Read)

### Instalação

```powershell
cd "C:\Workspace\MCP Servers\tfs-mcp"
npm install
copy .env.example .env
notepad .env
```

### Variáveis de ambiente

Veja a tabela acima na seção em inglês — os nomes são os mesmos.

### Catálogo de tools

Mesma lista da seção em inglês. As tools premium produzem `structuredContent` validável.

### Padrão de escrita

Mesmo formato apresentado na seção em inglês. Labels em negrito, critérios começando com `**Deve**`, summary automático para grandes mudanças.

### Como configurar nos clientes MCP

Veja a seção [Wire it into your MCP client](#wire-it-into-your-mcp-client) acima — os snippets para OpenCode, Claude Desktop, Claude Code, Cursor, Cline, Codex CLI e Continue funcionam em qualquer idioma.

### Licença

MIT — veja [LICENSE](../LICENSE).
