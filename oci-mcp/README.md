# oci-mcp

[![Oracle Cloud](https://img.shields.io/badge/Oracle-Cloud%20Infrastructure-F80000?logo=oracle&logoColor=white)](https://www.oracle.com/cloud/)
[![License: UPL-1.0](https://img.shields.io/badge/License-UPL--1.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)

🇺🇸 **English** · 🇧🇷 [Português](#-português)

> Project-specific README. For the broader bilingual MCP collection see [`../README.md`](../README.md).

> **MCP (Model Context Protocol) toolkit for Oracle Cloud Infrastructure (OCI)** — opinionated, security-first, focused on **OKE (Kubernetes)**, **Vault/Secrets**, **Compute**, **Functions** and **streaming logs**.

This project is a **meta-toolkit** that combines:

1. The **official Oracle MCP servers** (`oracle.oci-*`) installed on demand via `uvx`, giving you up-to-date coverage for Compute, Identity, Networking, Load Balancer, Monitoring, Logging, Registry, Cloud Guard, etc.
2. A **custom Node.js MCP server** (`oci-extras-mcp`) that fills the gaps in the upstream catalog with first-class tools for **OKE**, **Vault/Secrets**, **Kubernetes layer**, **Functions** and **log streaming** — all with hardened safety guards (ownership tracking, dry-run defaults, destructive-action confirmation).

Inspired by — and interoperable with — [`oracle/mcp`](https://github.com/oracle/mcp).

---

## Why this project?

`oracle/mcp` is excellent but, as of this writing, has **no dedicated server for OKE or Vault/Secrets**, which are central to most production OCI Kubernetes workloads. `oci-extras-mcp` closes that gap and adds an extra layer of guardrails:

- **Ownership ledger** — only resources created by the MCP can be mutated/deleted freely. Pre-existing resources demand explicit confirmation.
- **Dry-run by default** for all write operations.
- **Secret masking** by default; reveal requires an env flag.
- **Audit log** (JSONL) of every tool call.
- **Multi-mode auth**: API Key, Session Token, Instance Principal, Resource Principal.
- **Streaming**: HTTP Streamable transport + SSE log tailing.

---

## Quickstart (Windows)

```powershell
cd "<repo-root>/oci-mcp"

# 1. Install prerequisites (uv, OCI CLI, Node 20+, kubectl, optional podman)
.\scripts\install-prereqs.ps1

# 2. Authenticate against OCI (creates ~/.oci/config or refreshes session token)
oci session authenticate --region <your-region> --tenancy-name <your-tenancy>

# 3. Install custom server dependencies
cd oci-extras-mcp
npm install

# 4. Validate everything
cd ..
.\scripts\verify-setup.ps1

# 5. Generate config for your MCP client
node .\scripts\generate-mcp-config.mjs --client cursor --out "$env:USERPROFILE\.cursor\mcp.json"
```

---

## Server Matrix

| Need | Use | Source |
|---|---|---|
| Generic OCI API access (OCI Python SDK) | `oci-cloud` | `uvx oracle.oci-cloud-mcp-server` |
| Compute (VMs, shapes, images) | `oci-compute` | `uvx oracle.oci-compute-mcp-server` |
| Identity (IAM, policies, compartments) | `oci-identity` | `uvx oracle.oci-identity-mcp-server` |
| Networking (VCN, subnets, SL) | `oci-networking` | `uvx oracle.oci-networking-mcp-server` |
| Load Balancer | `oci-load-balancer` | `uvx oracle.oci-load-balancer-mcp-server` |
| Monitoring | `oci-monitoring` | `uvx oracle.oci-monitoring-mcp-server` |
| Logging (search) | `oci-logging` | `uvx oracle.oci-logging-mcp-server` |
| Container Registry (OCIR) | `oci-registry` | `uvx oracle.oci-registry-mcp-server` |
| Cloud Guard | `oci-cloud-guard` | `uvx oracle.oci-cloud-guard-mcp-server` |
| **OKE (Kubernetes)** | `oci-extras` | this repo |
| **Vault & Secrets** | `oci-extras` | this repo |
| **K8s apply / sync from Vault** | `oci-extras` | this repo |
| **Functions (FaaS)** | `oci-extras` | this repo |
| **Streaming logs (SSE)** | `oci-extras` | this repo |

> ℹ️ The `oci-extras-mcp` server **does not duplicate** what upstream already covers; it **complements** it. Run them side-by-side.

Oracle recommends the [OCI Cloud MCP server](https://github.com/oracle/mcp/tree/main/src/oci-cloud-mcp-server)
for generic SDK access. Its `invoke_oci_api` tool can invoke SDK **write** methods
as well as reads, according to the IAM permissions of the selected profile.
Use a separate least-privilege, read-only OCI identity/profile for routine
discovery, and enable a write-capable identity only in a local, untracked MCP
client configuration when a task calls for it. The OCI CLI-backed `oci-api`
server remains an optional upstream alternative for CLI-specific workflows.
The committed client examples use `EXAMPLE_READ_ONLY` as a placeholder profile;
replace it in your ignored local client config with a real read-only profile.

---

## Documentation

| Doc | Topic |
|---|---|
| [docs/01-installation.md](docs/01-installation.md) | Step-by-step install (uv, OCI CLI, Node, kubectl, podman) |
| [docs/02-authentication.md](docs/02-authentication.md) | API Key, Session Token, Instance/Resource Principal |
| [docs/03-oke-workflows.md](docs/03-oke-workflows.md) | Production-ready OKE patterns end-to-end |
| [docs/04-vault-secrets.md](docs/04-vault-secrets.md) | KMS, Secrets, rotation, K8s sync |
| [docs/05-compute-workflows.md](docs/05-compute-workflows.md) | Lançar VM, shapes, custom images |
| [docs/06-troubleshooting.md](docs/06-troubleshooting.md) | Common pitfalls |
| [docs/07-security-checklist.md](docs/07-security-checklist.md) | IAM least-privilege, network, audit |
| [BEST_PRACTICES.md](BEST_PRACTICES.md) | Master playbook |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Decisions, diagrams |

---

## Safety Model (read this!)

| Layer | Behavior |
|---|---|
| **Read tools** (list/get/describe/recommend) | Always allowed |
| **Write tools** (create/update/scale) | Allowed; default `dryRun=true` |
| **Destructive tools** (delete/terminate/schedule_deletion) | Require `OCI_MCP_ALLOW_DESTRUCTIVE=true` **AND** explicit `confirm: "<name-or-ocid>"` |
| **Mutation of pre-existing resources** (not created by MCP) | Require `OCI_MCP_ALLOW_THIRD_PARTY_MUTATION=true` **AND** explicit `confirm` **AND** a human prompt acknowledgement returned to the LLM |
| **Secret values** | Masked by default; reveal needs `OCI_MCP_ALLOW_SECRET_REVEAL=true` + `reveal:true` |
| **Audit** | Every call → `logs/audit.jsonl` (JSON Lines); local writes, executions, remote writes, destructive and secret-read tools require a durable pre-execution record |

Resources created by `oci-extras-mcp` are tracked in `.ownership-ledger.json` and may be edited/deleted with the standard guardrails. Resources NOT in the ledger are treated as **third-party** and protected.

---

## Project Layout

```
oci-mcp/
├── README.md, BEST_PRACTICES.md, ARCHITECTURE.md, CHANGELOG.md, LICENSE
├── .env.example, .gitignore
├── config/                  # Pre-built MCP client configs (Cursor, Claude, etc.)
├── docs/                    # Operational documentation + curated LLM prompts
├── scripts/                 # PowerShell helpers (install, verify, refresh, generate)
└── oci-extras-mcp/          # Custom Node.js MCP server
    ├── index.js             # Entry: stdio (default) or --http
    ├── src/
    │   ├── server.js, http.js, config.js, schemas.js
    │   ├── auth/            # 4-mode auth resolver
    │   ├── safety/          # Guards, audit, ownership ledger
    │   ├── lib/             # Client factories, retries, errors
    │   └── tools/           # oke/, vault/, kubernetes/, functions/, streaming/, meta/
    └── tests/               # Smoke + unit tests
```

---

## Running the custom server standalone

```powershell
cd oci-extras-mcp

# stdio (for MCP clients)
npm start

# HTTP Streamable (for remote / SSE / multi-client)
npm run start:http
```

---

## Contributing

1. Open an issue describing the OCI service / tool you want to add.
2. Follow the patterns in `oci-extras-mcp/src/tools/oke/` (one file per tool).
3. Add a smoke test under `tests/`.
4. Run `npm test` and `node ../scripts/generate-mcp-config.mjs --validate`.

---

## Wire it into your MCP client

The custom server in `oci-extras-mcp/` runs over stdio. Use the helper to generate a client-specific config:

```powershell
node .\scripts\generate-mcp-config.mjs --client cursor   --out "$env:USERPROFILE\.cursor\mcp.json"
node .\scripts\generate-mcp-config.mjs --client claude   --out "$env:APPDATA\Claude\claude_desktop_config.json"
node .\scripts\generate-mcp-config.mjs --client opencode --out "$env:USERPROFILE\.config\opencode\opencode.json"
```

Or add manually to OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "oci-extras-mcp": {
      "type": "local",
      "command": ["node", "<repo-root>/oci-mcp/oci-extras-mcp/index.js"],
      "enabled": true,
      "env": {
        "OCI_AUTH_METHOD": "session_token",
        "OCI_CONFIG_PROFILE": "DEFAULT"
      }
    }
  }
}
```

For Claude Desktop / Claude Code / Cursor / Cline / Codex CLI / Continue snippets, see the [root README](../README.md#%EF%B8%8F-install-in-your-mcp-client).

---

## License

UPL-1.0 — see [LICENSE](LICENSE). Inspired by and compatible with [oracle/mcp](https://github.com/oracle/mcp).

---

## 🇧🇷 Português

> **Toolkit MCP para Oracle Cloud Infrastructure (OCI)** — opinativo, security-first, focado em **OKE (Kubernetes)**, **Vault/Secrets**, **Compute**, **Functions** e **logs por streaming**.

### Por que este projeto

`oracle/mcp` é excelente, mas hoje **não tem servidor dedicado de OKE nem de Vault/Secrets**, que são centrais em workloads K8s em OCI. O `oci-extras-mcp` fecha essa lacuna e ainda adiciona uma camada extra de guardrails:

- **Ledger de ownership** — apenas recursos criados pelo MCP podem ser mutados/deletados livremente. Recursos pré-existentes exigem confirmação explícita.
- **Dry-run por padrão** em todas as operações de escrita.
- **Mascaramento de secrets** por padrão; revelar exige flag de env.
- **Audit log** (JSONL) de toda chamada de tool.
- **Auth multi-modo**: API Key, Session Token, Instance Principal, Resource Principal.
- **Streaming**: HTTP Streamable + SSE para logs.

### Quickstart

Veja a seção [Quickstart (Windows)](#quickstart-windows) acima — os comandos são os mesmos.

### Modelo de segurança

Veja a tabela de [Safety Model](#safety-model-read-this) acima. Resumo: tools de leitura sempre OK; escritas com `dryRun=true` por padrão; operações destrutivas exigem `OCI_MCP_ALLOW_DESTRUCTIVE=true` + `confirm` literal; mutações em recursos não criados pelo MCP exigem `OCI_MCP_ALLOW_THIRD_PARTY_MUTATION=true` + confirmação humana.

### Como configurar nos clientes MCP

Use o gerador `scripts/generate-mcp-config.mjs --client <cursor|claude|opencode>` ou veja [Wire it into your MCP client](#wire-it-into-your-mcp-client) acima.

### Licença

UPL-1.0 — veja [LICENSE](LICENSE). Inspirado em e compatível com [oracle/mcp](https://github.com/oracle/mcp).
