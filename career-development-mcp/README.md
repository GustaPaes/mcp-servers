# career-development-mcp MCP

> **MCP server for managing PDIs (Individual Development Plans), SMART goals, competencies, evidence and 1:1 / career-conversation prep.** Optionally bridges to [`tfs-mcp`](../tfs-mcp) to import work items as evidence.

[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.x-6f42c1)](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
[![Status](https://img.shields.io/badge/status-beta-orange.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

🇺🇸 **English** · 🇧🇷 [Português](#-português)

---

## Why

Most career-development tooling is either a HR-grade platform (heavy, slow, opinionated) or a personal Notion page (no structure, no analytics). This MCP sits in the middle: a small typed data model (PDI, Goal, Competency, Evidence, Profile) backed by local JSON storage, and a set of tools an LLM can use to:

- Turn a PDI into a **living, actionable artifact**.
- Push goals from generic to **measurable + completable by real tasks**.
- Capture evidences with **measurable impact** for self-development and manager recognition.
- **Import** real deliveries from TFS into the career plan, no copy-paste.
- Build the agenda for 1:1s and self-evaluations from the latest evidence.

There is also an optional integration with the [external career platform](https://career.example.com/) online product: capture your authenticated browser session and let the MCP read suggestions from your live profile.

---

## Requirements

- **Node.js ≥ 20**
- (Optional) the [`tfs-mcp`](../tfs-mcp) MCP installed and configured if you want `guide_evidence_from_tfs`.
- (Optional) Playwright if you want to capture the external career platform online session.

## Install

```powershell
cd "C:\Workspace\MCP Servers\career-development-mcp"
npm install
copy .env.example .env
```

Run it:

```powershell
npm start            # stdio (for MCP clients)
npm run start:http   # Streamable HTTP on http://localhost:3020
```

Validate the tool surface:

```powershell
npm test             # runs validate-tools.mjs
```

---

## Wire it into your MCP client

### OpenCode (`~/.config/opencode/opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "career-development-mcp": {
      "type": "local",
      "command": ["node", "C:/Workspace/MCP Servers/career-development-mcp/index.js"],
      "enabled": true,
      "env": {
        "LOG_LEVEL": "info",
        "TFS_MCP_SERVER_DIR": "C:/Workspace/MCP Servers/tfs-mcp"
      }
    }
  }
}
```

### Claude Desktop / Claude Code / Cursor / Cline / Codex CLI

See the [root README](../README.md#%EF%B8%8F-install-in-your-mcp-client) for ready-to-paste blocks. All paths point to `C:/Workspace/MCP Servers/career-development-mcp/index.js`.

---

## Tool catalog

| Family | Tools | Purpose |
|---|---|---|
| `guide_pdi_*` | create / update / list / score | PDIs |
| `guide_goal_*` | create / update / list / progress | SMART goals |
| `guide_competency_*` | self-assess / matrix / gap | Competencies and gap analysis |
| `guide_evidence_*` | create / list / `from_tfs` | Evidence — including auto-import from a TFS work item |
| `guide_career_*` | readiness / roadmap | Career readiness and next-steps roadmap |
| `guide_review_*` | one-on-one / self-eval | Build the agenda for 1:1s and self-evaluations |
| `guide_online_*` | state / suggestions | Read your captured external career platform online session and surface revision suggestions |

Full list of tool names and JSON Schemas: `npm run validate:tools`.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |
| `MCP_HTTP_PORT` | `3020` | Port for Streamable HTTP mode |
| `MCP_HTTP_TOKEN` | _(none)_ | Optional bearer token to gate the HTTP endpoint |
| `TFS_MCP_SERVER_DIR` | _(none)_ | Path to the sibling `tfs-mcp` MCP — required for `guide_evidence_from_tfs` |
| `CAREER_MCP_DATA_DIR` | `./data` | Where the JSON store for PDIs/goals/evidences lives |

---

## Optional: capture your external career platform online session

If you use the [external career platform](https://career.example.com/) product, you can authenticate once with Playwright and let the MCP read your live profile:

```powershell
npm run career-platform:capture
# 1. Login manually via Microsoft / AD in the opened browser
# 2. Open https://login.career.example.com/idp/person
# 3. Return to the terminal and confirm the capture
```

After that, the `guide_online_*` tools work:

- `guide_online_state_get` — read the captured profile state
- `guide_online_review_suggestions` — surface review suggestions

> ⚠️ Captured sessions contain cookies. They are gitignored (`browser/state/`). Treat them like passwords.

---

## Architecture

```
career-development-mcp/
├── index.js                    # Bootstrap (stdio / --http)
├── schemas.js                  # Public JSON Schemas
├── validate-tools.mjs          # Local validation harness
├── smoke-http.mjs              # HTTP smoke test
├── package.json
├── browser/                    # Playwright capture script (separate from MCP runtime)
├── data/                       # Local JSON storage (gitignored)
├── docs/                       # Design notes
└── src/
    ├── server.js               # MCP registration
    ├── http.js                 # Streamable HTTP transport
    ├── config.js               # Env + defaults
    ├── storage.js              # JSON storage layer
    ├── logger.js               # pino → stderr
    ├── analytics/
    │   ├── pdi-scoring.js
    │   ├── competency-gap.js
    │   ├── progress-tracker.js
    │   └── recognition-builder.js
    ├── frameworks/
    │   ├── career-ladder.js
    │   ├── competency-matrix.js
    │   └── smart-goals.js
    ├── integrations/
    │   └── tfs-bridge.js       # spawns tfs-mcp MCP to fetch work items
    ├── models/                 # PDI, Goal, Competency, Evidence, Profile
    └── tools/                  # career, competencies, evidence, goals, online, pdi, review
```

---

## License

MIT — see [LICENSE](../LICENSE).

---

## 🇧🇷 Português

> **MCP para gerenciar PDIs, metas SMART, competências, evidências e preparo de 1:1 / conversas de carreira.** Integra opcionalmente com o [`tfs-mcp`](../tfs-mcp) para importar work items como evidência.

### Por quê

Ferramentas de carreira costumam ser ou plataforma corporativa pesada ou página de Notion. Este MCP fica no meio: um modelo de dados pequeno e tipado (PDI, Meta, Competência, Evidência, Perfil) com armazenamento JSON local, e tools que um LLM pode usar para:

- Transformar PDI em **artefato vivo e acionável**.
- Tirar metas do "genérico" e deixar concluíveis por tarefas reais.
- Registrar evidências com impacto para auto-desenvolvimento e reconhecimento.
- **Importar entregas reais do TFS** para o plano de carreira, sem copiar-colar.
- Montar pauta de 1:1 e auto-avaliação a partir das últimas evidências.

Há também integração opcional com o [external career platform](https://career.example.com/) online: captura sua sessão autenticada via Playwright e expõe leitura/sugestões.

### Pré-requisitos

- **Node.js ≥ 20**
- (Opcional) MCP [`tfs-mcp`](../tfs-mcp) configurado, se for usar `guide_evidence_from_tfs`.
- (Opcional) Playwright para captura de sessão online.

### Instalação

```powershell
cd "C:\Workspace\MCP Servers\career-development-mcp"
npm install
copy .env.example .env
npm start
```

### Tools principais

Mesma tabela da seção em inglês. As famílias são `guide_pdi_*`, `guide_goal_*`, `guide_competency_*`, `guide_evidence_*`, `guide_career_*`, `guide_review_*`, `guide_online_*`.

### Como configurar nos clientes

Veja [Wire it into your MCP client](#wire-it-into-your-mcp-client) acima.

### Licença

MIT — veja [LICENSE](../LICENSE).
