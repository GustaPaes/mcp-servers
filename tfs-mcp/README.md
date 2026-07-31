# tfs-mcp

> **MCP server for on-prem TFS / Azure DevOps Server.** Built for the daily flow of an engineering team: backlog hygiene, refinement, PR review, release readiness, work-item writing template and executive risk score.

[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.x-6f42c1)](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

🇺🇸 **English** · 🇧🇷 [Português](#-português)

Collection docs: [English](../README.en.md) | [Portugues](../README.pt-BR.md)

---

## Why

A wrapper around TFS REST APIs is easy. **The hard part is making an LLM useful in a TFS-driven team.** This server packages that work:

- **Premium workflows** — `tfs_prepare_pr_review`, `tfs_release_readiness`, `tfs_team_focus_report`, `tfs_work_item_handoff`, `tfs_delivery_risk_report` return both a human-readable text and a typed `structuredContent` (formal `outputSchema`).
- **Specialist routing** — activity writing, refinement, handoff, PR review, release readiness, delivery risk and pipeline status apply explicit specialist rubrics (Business Analyst/PO, Tech Lead, QA, DevOps, Security, Backend, Frontend, Database, Architecture and Observability) so the MCP explains which expert lenses were used and why.
- **Standardized writing template** — `tfs_generate_activity_template` and its bulk sibling `tfs_generate_activity_template_from_items` produce business + technical descriptions in a fixed bold-block format with `**Deve**` acceptance criteria. The MCP self-summarizes the technical block when the change estimate exceeds 50 lines.
- **Multi-PAT auth** — `TFS_PAT_<ALIAS>` lets you keep a build PAT and a personal PAT side by side; pass `auth_alias` per call.
- **Multi-repo PR search** — when `repo` is omitted, the server iterates `TFS_REPOS` until it finds the PR.
- **Both transports** — `stdio` (default) and Streamable HTTP (`--http`).

Originally built against a real enterprise TFS installation. The public docs in this repository are intentionally sanitized so the engineering patterns stay visible without exposing internal project details.

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

For organization-specific fields and reusable queries, copy
[`config/tfs.example.json`](./config/tfs.example.json) to the ignored
`local-private/config/tfs.json`. Keep PATs in `.env`; never put credentials in
the JSON file.

Verify it starts:

```powershell
node index.js          # stdio mode (will wait on stdin)
# OR
node index.js --http   # http://localhost:3010/healthz and authenticated /readyz
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
        "TFS_MCP_CONFIG_FILE": "C:/Workspace/MCP Servers/tfs-mcp/local-private/config/tfs.json"
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
| `TFS_MCP_CONFIG_FILE` | `./local-private/config/tfs.json` when present | Versioned JSON configuration path; must not contain secrets |
| `TFS_WORK_ITEM_PROFILES_FILE` | _(empty)_ | Optional separate JSON file containing only work-item profiles |
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
| `MCP_HTTP_HOST` | `127.0.0.1` | Host for HTTP mode; non-loopback requires `MCP_HTTP_TOKEN` |
| `MCP_HTTP_TOKEN` | _(empty)_ | Bearer token for HTTP mode |
| `MCP_HTTP_BODY_LIMIT_BYTES` | `1048576` | Maximum HTTP request size |
| `MCP_HTTP_SESSION_TTL_MS` | `1800000` | Idle HTTP session lifetime |
| `MCP_HTTP_MAX_SESSIONS` | `50` | Concurrent HTTP session cap |
| `TFS_AUDIT_LOG_PATH` | `./data/audit.log` | Append-only JSONL audit log for mutation attempts |
| `TFS_DEFAULT_QUARTER` | _(current quarter)_ | Value available as `{{currentQuarter}}` inside profile defaults |
| `TFS_WORK_ITEM_PROFILES_JSON` | `{}` | Per-type rich-text fields and required/default fields, indexed by work item type |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |

---

## Tool catalog

### Context & backlog
- `tfs_doctor` — sanitized configuration diagnosis with optional connectivity check
- `tfs_saved_queries` — names of reusable queries loaded from local configuration
- `tfs_work_item` — full details of a work item; `include_fields:true` also returns the raw field map
- `tfs_analyze_work_item` — quality score, US format, gaps, refinement checklist
- `tfs_work_item_context` — work item + related items + PRs + wiki pages
- `tfs_specialist_review` — reusable specialist-only analysis block. Normal writing/refinement/PR/release/pipeline workflows already run specialists automatically.
- `tfs_prepare_refinement` — refinement package (DOR, questions, dependencies)
- `tfs_generate_activity_template` — generate the standardized business + technical description
- `tfs_generate_activity_template_from_items` — bulk version starting from existing items
- `tfs_query_work_items` — WIQL, presets, structured filters or a configured `saved_query`
- `tfs_sprint_info` — current iteration metrics

### Pull requests & review
- `tfs_list_prs`, `tfs_get_pr`
- `tfs_review_pr` — automated code review with project-specific rules + modern frontend/backend best practices
- `tfs_comment_review_findings` — turn findings into PR comments with suggested fixes
- `tfs_prepare_pr_review` — **premium** review-prep workflow (work items, threads, risks, areas, automated review, pipeline)
- `tfs_add_pr_comment`

### Execution & governance
- `tfs_release_readiness` — **premium** release-readiness workflow
- `tfs_team_focus_report` — **premium** WIP / focus / bottleneck workflow
- `tfs_work_item_handoff` — **premium** PO ↔ Dev ↔ QA ↔ Support handoff package
- `tfs_delivery_risk_report` — **premium** executive delivery-risk score
- `tfs_pipeline_status` — recent pipeline runs
- `tfs_pipeline_upsert` — safely create or update a repository-backed YAML pipeline definition
- `tfs_pipeline_queue` — safely queue a pipeline by ID/name, branch and YAML parameters
- `tfs_list_repos`
- `tfs_wiki` — list every wiki, recursively search nested page paths, read exact page content or enumerate a subtree

`tfs_wiki` keeps the legacy `{ "search": "term" }` call, but the explicit actions are preferred:

```json
{ "action": "list" }
{ "action": "search", "search": "Code-Review", "top": 50 }
{ "action": "read", "wiki": "Product.wiki", "path": "/Engineering/Code-Review" }
{ "action": "read", "url": "https://tfs.example.test/Collection/Project/_wiki/wikis/Product.wiki/123/Code-Review" }
{ "action": "tree", "wiki": "Product.wiki", "path": "/Engineering", "skip": 0, "top": 200 }
```

`wiki` accepts either the wiki name or ID. When omitted, the operation covers every configured wiki. Search treats spaces, hyphens, underscores and accents equivalently. `read` also accepts the browser URL directly. `search` and `tree` support `skip`/`top` pagination. `tree` returns paths by default; use `include_content:true` only when the complete contents are required because the response can be large (maximum 200 pages per call with content).

### Controlled mutation
- `tfs_work_item_create` — create any standard or custom work item type; profile defaults and `custom_fields` support process-specific required fields; defaults to `dry_run:true`
- `tfs_update_work_item` — change standard fields, write arbitrary `custom_fields` or clear `remove_fields`; defaults to `dry_run:true`
- `tfs_update_issue_analysis` — write the required development analysis and optional correction/impact fields for an Issue; defaults to `dry_run:true`. See [`docs/issue-analysis.md`](./docs/issue-analysis.md).
- `tfs_add_pr_comment` — add a PR comment; defaults to `dry_run:true`

Real writes require `dry_run:false`, `confirm:true`, `reason` and `requestedBy`/`requested_by`. High-impact targets such as production/release/main/master/hml/homolog branches require the extra `confirm_high_impact` value returned by the dry-run mutation plan.

### Premium workflows produce structured output
The 5 premium workflows ship with formal `outputSchema` so MCP clients can validate the `structuredContent` payload, while still returning the human-readable text for simpler clients.

---

## Work item profiles

Different Azure DevOps processes can require different fields for the same
operation. Keep installation-specific rules outside the source in
`local-private/config/tfs.json` (recommended), `TFS_WORK_ITEM_PROFILES_FILE`, or
`TFS_WORK_ITEM_PROFILES_JSON`:

```json
{
  "Continuous Improvement": {
    "businessField": "Custom.BusinessContext",
    "technicalField": "Custom.TechnicalDetails",
    "defaults": {
      "Custom.Portfolio": "Platform",
      "Custom.Quarter": "{{currentQuarter}}"
    }
  }
}
```

The public tool remains generic. Calls can override profile defaults or provide additional fields by reference name:

```json
{
  "work_item_type": "Continuous Improvement",
  "title": "Automate the release workflow",
  "custom_fields": {
    "Custom.Impact": "High",
    "Custom.ExpectedBenefits": "<div>Shorter lead time and fewer manual errors.</div>"
  }
}
```

Keep real process names, field reference names and allowed values under
`local-private/`, which is ignored by Git. Keep PATs in the local `.env`. The
committed examples contain only neutral values.

---

## Specialist routing

Português: veja [`docs/specialist-routing.pt-BR.md`](./docs/specialist-routing.pt-BR.md).

The MCP uses a deterministic specialist layer whenever the task involves activity writing, technical criteria, refinement, handoff, PR review, release readiness, delivery risk or pipeline status. This is not an external AI call and it does not rely on vague personas. The server detects signals from work item fields, tags, area path, affected locations, PR branches and changed files, then applies explicit rubrics.

Agents do not need the user to mention `tfs_specialist_review` or "specialists". If the user asks to use this MCP for one of these workflows, choose the normal domain tool and read its `specialistReview` block.

Specialists currently modeled:

- **Business Analyst / Product Owner** — persona, business value, scope and acceptance language.
- **Tech Lead** — implementation approach, technical risks, dependencies and rollout.
- **QA / Test Specialist** — test scenarios, regression, evidence and acceptance criteria.
- **Azure DevOps / Pipeline Specialist** — build/release gates, variables, secrets, artifacts, rollback and deployment.
- **Security Specialist** — auth, permissions, tokens, TLS, secrets and sensitive data.
- **Backend Specialist** — APIs, services, queues, workers, error handling and contracts.
- **Frontend / UX Specialist** — UI states, accessibility, responsiveness and visual behavior.
- **Database / Persistence Specialist** — migrations, queries, indexes, cache, transactions and data rollback.
- **Architecture / Integration Specialist** — contracts, compatibility, dependencies and system boundaries.
- **Observability / Support Specialist** — logs, metrics, traces, alerts, runbooks and post-release diagnosis.

Automatic usage:

- `tfs_generate_activity_template` enriches business and technical acceptance criteria with `specialistReview`.
- `tfs_generate_activity_template_from_items` applies specialist guidance per item.
- `tfs_prepare_refinement` and `tfs_work_item_handoff` include specialist checklists and risks.
- `tfs_prepare_pr_review` and `tfs_review_pr` use changed files to choose specialist lenses.
- `tfs_release_readiness`, `tfs_delivery_risk_report` and `tfs_pipeline_status` include pipeline/release specialist recommendations.
- `tfs_specialist_review` can be called directly only when you want a standalone specialist analysis.

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
│       ├── doctor.js
│       ├── pull-request.js
│       ├── sprint.js
│       ├── handoff.js
│       └── infra.js
└── docs/
    ├── creation-patterns.md
    ├── separation-patterns.md
    ├── pipeline-release-patterns.md
    ├── specialist-routing.md
    ├── specialist-routing.pt-BR.md
    ├── work-items-map.md
    ├── writing-patterns.md
    └── issue-analysis.md
```

`local-private/` holds organization-specific configuration, exports and
ad-hoc scripts. It is gitignored and stays available locally without becoming
part of the public server.

---

## Security

- The `.env` file is gitignored. Use `.env.example` as the template.
- Organization-specific files belong under ignored `local-private/` paths.
- PATs are sent over HTTPS to your TFS endpoint and never logged.
- Mutating tools (`tfs_update_work_item`, `tfs_update_issue_analysis`, `tfs_add_pr_comment`, `tfs_comment_review_findings`) require explicit input — there is no implicit batch-write.
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
- **Roteamento por especialistas** — escrita de atividade, refinamento, handoff, revisão de PR, release readiness, delivery risk e pipeline status aplicam rubricas explícitas de Business Analyst/PO, Tech Lead, QA, DevOps, Segurança, Backend, Frontend, Banco, Arquitetura e Observabilidade.
- **Template padronizado de escrita** — `tfs_generate_activity_template` (e a versão em massa) gera descrições de negócio + técnicas em formato de blocos em negrito com critérios `**Deve**`. O MCP resume o bloco técnico se a estimativa de alteração passar de 50 linhas.
- **Multi-PAT** — `TFS_PAT_<ALIAS>` permite manter um PAT de build e um pessoal lado a lado; passe `auth_alias` por chamada.
- **Busca de PR multi-repo** — quando `repo` é omitido, o servidor itera `TFS_REPOS` até achar.
- **Dois transportes** — `stdio` (padrão) e Streamable HTTP (`--http`).

Originalmente construído contra uma instalação enterprise real de TFS. A documentação pública deste repositório foi sanitizada para preservar os padrões de engenharia sem expor detalhes internos de projeto.

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

Copie `config/tfs.example.json` para o caminho ignorado
`local-private/config/tfs.json` e personalize campos, perfis e consultas
salvas. Mantenha PATs somente no `.env`.

### Perfis de work item

Use `local-private/config/tfs.json` preferencialmente, ou
`TFS_WORK_ITEM_PROFILES_FILE`/`TFS_WORK_ITEM_PROFILES_JSON`, para mapear campos
ricos e defaults obrigatórios de qualquer tipo customizado. A tool continua
genérica: `custom_fields` cria ou altera campos pelo reference name,
`remove_fields` limpa campos na edição e `include_fields:true` retorna o mapa
bruto para inspeção. Nomes e valores específicos da organização não devem ser
versionados.

### Catálogo de tools

Mesma lista da seção em inglês. As tools premium produzem `structuredContent` validável.

### Padrão de escrita

Mesmo formato apresentado na seção em inglês. Labels em negrito, critérios começando com `**Deve**`, summary automático para grandes mudanças.

### Como configurar nos clientes MCP

Veja a seção [Wire it into your MCP client](#wire-it-into-your-mcp-client) acima — os snippets para OpenCode, Claude Desktop, Claude Code, Cursor, Cline, Codex CLI e Continue funcionam em qualquer idioma.

### Licença

MIT — veja [LICENSE](../LICENSE).
