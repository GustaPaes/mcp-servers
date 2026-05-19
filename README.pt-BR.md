# MCP Servers por GustaPaes

> Colecao curada de servidores [Model Context Protocol](https://modelcontextprotocol.io) e ferramentas de automacao com IA que uso no dia a dia.

Cada pasta e um projeto independente, com README, dependencias, configuracao e modelo operacional proprios. A colecao e intencionalmente pratica: foca em fluxos que realmente uso para cloud, TFS/Azure DevOps Server, automacao de browser, carreira e provisionamento Windows.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.x-6f42c1)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)

Idioma: [English](./README.en.md) | [Portugues](./README.pt-BR.md)

## Por Que Este Repositorio Existe

A maioria das listas publicas de MCP e um catalogo de servidores de proposito unico mantidos por vendors. Este repositorio e diferente: e uma caixa de ferramentas pessoal, testada em uso real, para resolver problemas de engenharia diretamente a partir de um cliente de IA.

Ele ajuda a:

- Operar **Azure Cloud** com seguranca a partir do chat.
- Operar **Oracle Cloud Infrastructure** com guardrails extras em OKE, Vault e Functions.
- Gerenciar **TFS / Azure DevOps Server**: work items, PRs, sprints, wiki e prontidao de entrega.
- Controlar **Playwright multi-sessao** com screenshots, HAR, video e traces.
- Gerenciar **PDIs, metas, evidencias e conversas de carreira** com dados estruturados.
- Preencher o gerador de `autounattend.xml` do Windows com um preset conservador e documentado de Windows 11.

## Matriz de Projetos

| Pasta | Tipo | O Que Faz | Stack | Status |
|---|---|---|---|---|
| [`azure-mcp`](./azure-mcp) | Wrapper MCP | Opera recursos Azure usando o servidor oficial `@azure/mcp` da Microsoft e adiciona scripts locais + politica de seguranca para LLM. | `npx`, Azure CLI, PowerShell | Estavel |
| [`tfs-mcp`](./tfs-mcp) | MCP server | Work items, PRs, code review, refinamento, release readiness, delivery risk e templates de escrita para TFS / Azure DevOps Server. | Node 20, ESM, MCP SDK | Estavel |
| [`oci-mcp`](./oci-mcp) | Toolkit MCP | Combina servidores oficiais da Oracle com `oci-extras-mcp` para OKE, Vault/Secrets, Kubernetes, Functions e streaming de logs. | Node 20, OCI SDK, `uvx` | Estavel |
| [`playwright-mcp`](./playwright-mcp) | MCP server | Automacao de browser multi-sessao com Chromium/Firefox/WebKit, Chrome/Edge nativos, HAR, video, traces, PDF, rotas e stealth leve. | TypeScript, Node 20, Playwright | Estavel |
| [`career-development-mcp`](./career-development-mcp) | MCP server | PDIs, metas SMART, competencias, evidencias, prontidao de carreira, preparo de 1:1 e importacao opcional de evidencias do TFS. | Node 20, ESM, JSON local | Beta |
| [`unattend-autofill`](./unattend-autofill) | Ferramenta de automacao | Script Playwright standalone para preencher `schneegans.de/windows/unattend-generator/`. Nao e MCP server, mas faz parte da mesma toolbox. | Node 20, Playwright, PowerShell | Estavel |

## Layout do Repositorio

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
├── tfs-mcp/
├── oci-mcp/
│   └── oci-extras-mcp/
├── playwright-mcp/
├── career-development-mcp/
└── unattend-autofill/
```

## Requisitos

Requisitos gerais:

- Node.js 20 ou superior.
- npm 10 ou superior.
- Um cliente compativel com MCP, como OpenCode, Claude Code, Claude Desktop, Cursor, Cline, Codex CLI, Continue ou VS Code Copilot Agent mode.

Requisitos por projeto:

- `azure-mcp`: Azure CLI e sessao autenticada com `az login`.
- `oci-mcp`: OCI CLI / OCI config, `uv` ou `uvx`, e `kubectl` opcional para fluxos Kubernetes.
- `playwright-mcp`: browsers do Playwright instalados com `npx playwright install chromium` ou pela tool `browser_install`.
- `unattend-autofill`: Windows recomendado, pois a saida gerada e para instalacoes unattended do Windows.

## Instalar a Colecao

Clone o repositorio:

```bash
git clone https://github.com/GustaPaes/mcp-servers.git
cd mcp-servers
```

Instale apenas o que for usar:

```bash
cd tfs-mcp && npm install && cd ..
cd career-development-mcp && npm install && cd ..
cd playwright-mcp && npm install && npm run build && cd ..
cd unattend-autofill && npm install && npx playwright install chromium && cd ..
```

Para `azure-mcp`, nao ha instalacao local porque ele usa `npx -y @azure/mcp@latest server start`.

Para `oci-mcp`, siga [`oci-mcp/docs/01-installation.md`](./oci-mcp/docs/01-installation.md), pois ele combina Node, OCI CLI e servidores MCP Python da Oracle.

## Configurar Variaveis de Ambiente

Cada projeto que precisa de segredos tem um `.env.example`. Copie para `.env` e preencha localmente:

```bash
cp tfs-mcp/.env.example tfs-mcp/.env
cp career-development-mcp/.env.example career-development-mcp/.env
cp oci-mcp/.env.example oci-mcp/.env
```

Nunca commite arquivos `.env` reais. O `.gitignore` raiz e os `.gitignore` dos projetos ignoram esses arquivos.

## Instalar no OpenCode

O OpenCode le MCP servers de `~/.config/opencode/opencode.json` no Linux/macOS e `%USERPROFILE%\.config\opencode\opencode.json` no Windows.

Use [`config/opencode.example.json`](./config/opencode.example.json) como ponto de partida completo, ou adicione apenas os servidores que quiser:

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
      "command": ["npx", "-y", "@azure/mcp@latest", "server", "start"],
      "enabled": true
    }
  }
}
```

Reinicie o OpenCode depois de editar o arquivo. Ele nao recarrega configuracao MCP automaticamente.

## Instalar no Claude Code

Use `claude mcp add`:

```bash
claude mcp add playwright node "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"
claude mcp add azure -- npx -y @azure/mcp@latest server start
claude mcp list
```

Para um server com variaveis de ambiente:

```bash
claude mcp add tfs-mcp node "C:/Workspace/MCP Servers/tfs-mcp/index.js" \
  --env TFS_URL=https://tfs.example.com \
  --env TFS_PAT=your-pat
```

## Instalar no Claude Desktop

Edite `%APPDATA%\Claude\claude_desktop_config.json` no Windows ou `~/Library/Application Support/Claude/claude_desktop_config.json` no macOS:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]
    },
    "azure": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"]
    }
  }
}
```

Reinicie o Claude Desktop completamente depois de editar o arquivo.

## Instalar no Cursor ou Cline

Cursor e Cline usam formato parecido com Claude Desktop. Exemplo:

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

No Cline, adicione `"type": "stdio"`, `"disabled": false` e opcionalmente `"timeout": 60` se seu setup local precisar.

## Instalar no Codex CLI

Edite `~/.codex/config.toml`:

```toml
[mcp_servers.playwright]
command = "node"
args = ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]

[mcp_servers.azure]
command = "npx"
args = ["-y", "@azure/mcp@latest", "server", "start"]
```

## Instalar no Continue

Edite `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: playwright
    command: node
    args:
      - "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"
```

## Instalar no VS Code Copilot Agent Mode

Adicione `.vscode/mcp.json` ao workspace:

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

## Modelo de Seguranca

Os servers que tocam cloud e gestao de trabalho sao conservadores por design.

Regras operacionais comuns:

- Tools de leitura como `list`, `get`, `show`, `query` e `status` podem rodar sem confirmacao.
- Tools de escrita como `create`, `update`, `set`, `deploy`, `scale` e `comment` devem mostrar um plano e aguardar confirmacao explicita.
- Tools destrutivas como `delete`, `purge`, `remove`, `terminate` e `revoke` exigem confirmacao reforcada.
- Nomes com cara de producao, como `prod`, `prd`, `production`, `live`, `hml`, `homolog` e `preprod`, sao tratados como alto risco.
- Artefatos de runtime como HAR, storage state, perfis de browser, logs e capturas do external career platform nao devem ser commitados.

Documentos de seguranca por projeto:

- [`azure-mcp/AGENTS.md`](./azure-mcp/AGENTS.md)
- [`playwright-mcp/AGENTS.md`](./playwright-mcp/AGENTS.md)
- [`oci-mcp/BEST_PRACTICES.md`](./oci-mcp/BEST_PRACTICES.md)
- [`oci-mcp/docs/07-security-checklist.md`](./oci-mcp/docs/07-security-checklist.md)

## O Que Commitar

Commite:

- Codigo-fonte.
- READMEs e docs.
- Arquivos `.env.example`.
- `package.json` e lockfiles.
- Politicas de seguranca e exemplos.

Nao commite:

- Arquivos `.env`.
- PATs, API keys, chaves privadas OCI ou secrets de service principal Azure.
- `node_modules`.
- `dist`, exceto se algum projeto documentar explicitamente que precisa ser commitado.
- Output de runtime (`output`, `logs`, HAR, videos, traces, screenshots, browser storage state).
- Arquivos locais de sprint/ad-hoc.

## Notas por Projeto

### azure-mcp

Esta pasta envelopa o servidor Azure MCP oficial da Microsoft com documentacao local, regras de seguranca e scripts auxiliares. Por padrao usa seu login da Azure CLI.

### tfs-mcp

Este e o server mais especifico do repositorio. Ele cobre fluxos de TFS / Azure DevOps Server: work items, PRs, review, release readiness, wiki e delivery risk. Troque os defaults especificos da ExampleOrg no `.env.example` ao adaptar para outra empresa.

### oci-mcp

E um meta-toolkit. Use os servidores oficiais da Oracle para APIs OCI genericas e `oci-extras-mcp` para os fluxos operacionais faltantes em OKE, Vault, Secrets, Functions e streaming de logs.

### playwright-mcp

Este servidor e intencionalmente diferente do Playwright MCP da Microsoft. Ele foca sessoes paralelas, artefatos e primitivas de automacao de browser em nivel mais baixo.

### career-development-mcp

Este server armazena dados de desenvolvimento de carreira localmente e pode importar work items do TFS como evidencias.

### unattend-autofill

Nao e MCP server. E uma automacao Playwright mantida aqui porque pertence a mesma caixa de ferramentas de automacao assistida por IA.

## Licenca

MIT para os materiais no nivel do repositorio. Alguns subprojetos possuem notas de licenca proprias, especialmente `oci-mcp` (UPL-1.0). Ferramentas de terceiros preservam suas licencas originais.
