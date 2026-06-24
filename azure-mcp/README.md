# Azure MCP Server (portal.azure.com)

[![Azure](https://img.shields.io/badge/Azure-MCP%20GA%201.0-0078D4?logo=microsoftazure&logoColor=white)](https://aka.ms/azmcp/announcement/ga)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

🇺🇸 [English overview](#english-overview) · 🇧🇷 **Português** (default abaixo)

> This folder is a thin **wrapper + safety policy** around the official Microsoft Azure MCP server (`@azure/mcp`, GA 1.0). It pins the configuration, ships a strict `AGENTS.md` operating policy, and provides PowerShell helpers (`switch-context.ps1`, `verify-auth.ps1`, `update-server.ps1`). For the bilingual ecosystem README see [`../README.md`](../README.md).

---

## English overview

- **Server**: `microsoft/mcp` → `Azure.Mcp.Server` (GA 1.0)
- **Distribution**: NPM `@azure/mcp@3.0.0-beta.18` via `npx` (pinned for reproducibility)
- **Auth**: `DefaultAzureCredential` — inherits the Azure CLI session you already have
- **Multi-tenant / multi-subscription**: `scripts/switch-context.ps1`
- **Safety policy** (mandatory reading for any LLM driving this MCP): [`AGENTS.md`](./AGENTS.md)
- **Curated prompts**: [`PROMPT_LIBRARY.md`](./PROMPT_LIBRARY.md)
- **Deeper best practices**: [`BEST_PRACTICES.md`](./BEST_PRACTICES.md)
- **VM scheduling pattern**: [`docs/vm-scheduling-pattern.md`](./docs/vm-scheduling-pattern.md)

### Quick install (any MCP client)

```jsonc
// OpenCode → ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "azure": {
      "type": "local",
      "command": ["npx", "-y", "@azure/mcp@3.0.0-beta.18", "server", "start"],
      "enabled": true
    }
  }
}
```

```jsonc
// Claude Desktop → %APPDATA%\Claude\claude_desktop_config.json
{
  "mcpServers": {
    "azure-mcp": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@3.0.0-beta.18", "server", "start"]
    }
  }
}
```

```bash
# Claude Code (CLI)
claude mcp add azure -- npx -y @azure/mcp@3.0.0-beta.18 server start
```

For Cursor / Cline / Codex CLI / Continue snippets, see the [root README](../README.md#%EF%B8%8F-install-in-your-mcp-client).

---

## Português (escopo do MCP)

> **Escopo:** este MCP Server expõe ferramentas para operar recursos do **Azure Portal** (`https://portal.azure.com`) — Storage, AKS, Key Vault, Cosmos DB, App Service, Monitor/Log Analytics, RBAC, Foundry, etc. **Não** é o mesmo que um MCP voltado para TFS / Azure DevOps Server on-prem.

| Item | Valor |
|---|---|
| Servidor | [`microsoft/mcp` → `servers/Azure.Mcp.Server`](https://github.com/microsoft/mcp/tree/main/servers/Azure.Mcp.Server) |
| Distribuição usada | NPM `@azure/mcp@3.0.0-beta.18` via `npx` |
| Status do produto | **GA 1.0** ([anúncio](https://aka.ms/azmcp/announcement/ga)) |
| Mantenedor | Microsoft (Azure SDK Team) |
| Licença | MIT |
| Doc oficial | <https://learn.microsoft.com/azure/developer/azure-mcp-server/> |

> ⚠️ O repositório histórico [`Azure/azure-mcp`](https://github.com/Azure/azure-mcp) foi **arquivado em 25/ago/2025**. Toda a evolução acontece em `microsoft/mcp`.

---

## Índice

- [Complementaridade com o tfs-mcp](#complementaridade-com-o-tfs-mcp)
- [Pré-requisitos](#pré-requisitos)
- [Instalação no workspace](#instalação-no-workspace)
- [Como o VS Code carrega o servidor](#como-o-vs-code-carrega-o-servidor)
- [Verificação rápida](#verificação-rápida)
- [Multi-tenant / multi-subscription](#multi-tenant--multi-subscription)
- [Política de uso seguro pelo agente](#política-de-uso-seguro-pelo-agente)
- [Atualização](#atualização)
- [Padrão para ligar/desligar VM](#padrão-para-ligardesligar-vm)
- [Troubleshooting](#troubleshooting)
- [Referências](#referências)

---

## Complementaridade com o tfs-mcp

Os dois MCP Servers vivem juntos no workspace e **se complementam**:

| MCP Server | URL alvo | Domínio | Uso típico |
|---|---|---|---|
| `tfs-mcp` | `https://tfs.example.com` | TFS / Azure DevOps Server on-prem | Work items (PBI/US/Bug), PRs, sprints, wiki, pipelines on-prem |
| `azure-mcp` | `https://portal.azure.com` | Azure Cloud (público) | Recursos cloud: Storage, AKS, Key Vault, App Service, Monitor, etc. |

> Use o MCP de TFS para **planejamento e código** (work items, revisão de PR, refinamento). Use o `azure-mcp` para **infraestrutura e runtime cloud** (deploy, diagnóstico, custo, segurança).

---

## Pré-requisitos

Validados no ambiente atual:

- **Node.js** ≥ 20 LTS (instalado: `v20.18.0`)
- **npm** ≥ 10 (instalado: `10.8.2`)
- **Azure CLI** ≥ 2.70 (instalado: `2.85.0`)
- Sessão Azure ativa (`az login` realizado — perfil em `%USERPROFILE%\.azure\`)
- **VS Code** + extensão **GitHub Copilot Chat** (modo Agent)

Opcional (recomendado para performance):
- `npm install -g @azure/mcp@3.0.0-beta.18` para evitar download via `npx` em cada start.

---

## Instalação no workspace

A instalação **já está feita** neste repositório:

1. Pasta dedicada: `C:\Workspace\MCP Servers\azure-mcp\`
2. Registro em `C:\Workspace\.vscode\mcp.json` (server `azure-mcp`)
3. Documentação, política de uso e scripts incluídos

Se precisar reinstalar do zero, basta garantir o bloco no `mcp.json` do workspace:

```json
{
  "servers": {
    "azure-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure/mcp@3.0.0-beta.18", "server", "start"],
      "envFile": "C:\\Workspace\\MCP Servers\\azure-mcp\\.env"
    }
  }
}
```

---

## Como o VS Code carrega o servidor

1. VS Code lê `C:\Workspace\.vscode\mcp.json` ao abrir o workspace.
2. Para cada server `stdio`, faz spawn do `command + args`.
3. O `azure-mcp` chama `npx -y @azure/mcp@3.0.0-beta.18 server start`, que baixa (na primeira vez) e inicia o servidor.
4. As variáveis de `.env` (se existir) são injetadas no processo.
5. As tools `azmcp_*` ficam disponíveis em **GitHub Copilot → Agent mode → 🛠 (refresh)**.

---

## Verificação rápida

```powershell
# Validar autenticação Azure + listar tools do MCP
& "C:\Workspace\MCP Servers\azure-mcp\scripts\verify-auth.ps1"
```

O script:
- Roda `az account show` (confirma tenant/subscription ativos)
- Lista as subscriptions disponíveis
- Executa `npx -y @azure/mcp@3.0.0-beta.18 tools list` e mostra a contagem de tools carregadas

---

## Multi-tenant / multi-subscription

Você opera com **múltiplos tenants/subscriptions**. Para alternar contexto:

```powershell
# Ver tenants/subs disponíveis
az account list --output table

# Trocar de subscription
& "C:\Workspace\MCP Servers\azure-mcp\scripts\switch-context.ps1" -Subscription "MinhaSubProd"

# Trocar de tenant (forca novo login no tenant alvo)
& "C:\Workspace\MCP Servers\azure-mcp\scripts\switch-context.ps1" -Tenant "<tenant-guid>"
```

> **Importante:** o `azure-mcp` usa `DefaultAzureCredential`, que herda o contexto da Azure CLI. Trocar com `az account set` reflete no MCP **na próxima chamada de tool** — não precisa reiniciar o server.

---

## Política de uso seguro pelo agente

⚠️ **Leitura obrigatória:** [`AGENTS.md`](./AGENTS.md)

Resumo das regras críticas:

1. Operações **destrutivas** (delete, purge) → confirmação textual explícita.
2. Operações **mutativas** (update, create, deploy, scale) → mostrar plano + pedir OK.
3. Detecção automática de **produção** (regex em nome/tag) → dupla confirmação.
4. Sempre exibir **tenant + subscription** ativos antes de mutar recursos.
5. Operações em **massa** → quebrar em batches confirmáveis.

---

## Atualização

```powershell
& "C:\Workspace\MCP Servers\azure-mcp\scripts\update-server.ps1"
```

O script limpa o cache do `npx` e força o download da última versão de `@azure/mcp`.

> Para testar uma versão nova em sandbox, edite `mcp.json` substituindo o pin por `@latest` ou por outra versão específica. Só promova para uso diário depois de rodar `scripts\verify-auth.ps1 -Version "<versao>"`.

---

## Padrão para ligar/desligar VM

Para pedidos futuros de operar VMs com simplicidade e menor custo possivel, este workspace adota o seguinte padrao:

- Consultar, ligar e desligar via `scripts\vm-power.ps1`
- Simular qualquer mudança com `-WhatIf` antes de aplicar; os scripts suportam confirmação PowerShell nativa (`-Confirm`)
- Desligamento padrao por **deallocate** para interromper custo de compute
- Agendamento diario por:
  - **Scheduled Task local** para `start`
  - **Azure VM Auto-shutdown** para `shutdown`

Arquivos:

- `docs\vm-scheduling-pattern.md`
- `scripts\vm-power.ps1`
- `scripts\register-vm-schedule.ps1`

Exemplo de uso manual:

```powershell
& "C:\Workspace\MCP Servers\azure-mcp\scripts\vm-power.ps1" `
  -Action Deallocate `
  -Subscription "<sub-id>" `
  -ResourceGroup "<rg>" `
  -Name "<vm>"
```

Exemplo de agendamento:

```powershell
& "C:\Workspace\MCP Servers\azure-mcp\scripts\register-vm-schedule.ps1" `
  -Subscription "<sub-id>" `
  -ResourceGroup "<rg>" `
  -Name "<vm>" `
  -StartTimeLocal "08:00" `
  -ShutdownTimeUtc "2100"
```

---

## Troubleshooting

### "Failed to authenticate" / token expirado
```powershell
az logout
az login --tenant <seu-tenant-guid>
```

### Proxy corporativo bloqueando NPM
Configure proxy do npm:
```powershell
npm config set proxy http://<proxy>:<porta>
npm config set https-proxy http://<proxy>:<porta>
```

### Erro TLS / certificado corporativo
Adicione o cert da empresa ao truststore do Node:
```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\caminho\para\corp-ca.pem"
```

### npx lento no startup
Instale globalmente para eliminar o download em cada start:
```powershell
npm install -g @azure/mcp@3.0.0-beta.18
```
E altere `mcp.json` para `"command": "azmcp"`, `"args": ["server", "start"]`.

### Logs do server
- Windows: `%LOCALAPPDATA%\azmcp\logs\`
- Flag de debug: adicione `"--debug"` em `args` no `mcp.json`.

### Lista oficial de troubleshooting
<https://github.com/microsoft/mcp/blob/main/servers/Azure.Mcp.Server/TROUBLESHOOTING.md>

---

## Referências

- Repo oficial: <https://github.com/microsoft/mcp>
- README do server: <https://github.com/microsoft/mcp/blob/main/servers/Azure.Mcp.Server/README.md>
- Doc Microsoft Learn: <https://learn.microsoft.com/azure/developer/azure-mcp-server/>
- Authentication guide: <https://github.com/microsoft/mcp/blob/main/docs/Authentication.md>
- Sovereign clouds: <https://github.com/microsoft/mcp/blob/main/docs/sovereign-clouds.md>
- MCP Specification: <https://modelcontextprotocol.io>
- Pacote NPM: <https://www.npmjs.com/package/@azure/mcp>
- Releases: <https://github.com/microsoft/mcp/releases?q=Azure.Mcp.Server->
