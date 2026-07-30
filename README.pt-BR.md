# MCP Servers por GustaPaes

> Colecao curada de servidores [Model Context Protocol](https://modelcontextprotocol.io) que uso no dia a dia.

Cada pasta e um projeto independente, com README, dependencias, configuracao e modelo operacional proprios. A colecao e intencionalmente pratica: foca em fluxos que realmente uso para cloud, TFS/Azure DevOps Server, automacao de browser e carreira.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.x-6f42c1)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)

Idioma: [English](./README.en.md) | [Portugues](./README.pt-BR.md)

## Por Que Este Repositorio Existe

A maioria das listas publicas de MCP e um catalogo de servidores de proposito unico mantidos por vendors. Este repositorio e diferente: e uma caixa de ferramentas pessoal, testada em uso real, para resolver problemas de engenharia diretamente a partir de um cliente de IA.

Alguns servers nasceram de fluxos reais de uso interno e depois foram generalizados para uso publico. Quando necessario, a documentacao e os exemplos usam placeholders em vez de valores especificos de ambiente.

Ele ajuda a:

- Operar **Azure Cloud** com seguranca a partir do chat.
- Operar **Oracle Cloud Infrastructure** com guardrails extras em OKE, Vault e Functions.
- Operar **Facebook / Instagram Ads** (Meta Marketing API) multi-conta com dry-run, auditoria e tetos de orcamento.
- Gerenciar **TFS / Azure DevOps Server**: work items, PRs, sprints, wiki e prontidao de entrega.
- Controlar **Playwright multi-sessao** com screenshots, HAR, video e traces.
- Gerenciar **PDIs, metas, evidencias e conversas de carreira** com dados estruturados.

## Matriz de Projetos

| Pasta | Tipo | O Que Faz | Stack | Status |
|---|---|---|---|---|
| [`azure-mcp`](./azure-mcp) | Wrapper MCP | Opera recursos Azure usando o servidor oficial `@azure/mcp` da Microsoft e adiciona scripts locais + politica de seguranca para LLM. | `npx`, Azure CLI, PowerShell | Estavel |
| [`meta-ads-mcp`](./meta-ads-mcp) | MCP server | Servidor multi-conta para Meta Marketing API (Facebook Ads / Instagram Ads) com separacao estrita recomendar ↔ executar, dry-run, gate de mutacao, teto triplo de orcamento, auditoria e bloqueio de targeting por atributos protegidos. | TypeScript, Node 20, MCP SDK, undici, Zod | Beta |
| [`tfs-mcp`](./tfs-mcp) | MCP server | Work items padrão e customizados, perfis de processo configuráveis, PRs, review, refinamento, release readiness e roteamento por especialistas para TFS / Azure DevOps Server. | Node 20, ESM, MCP SDK | Estável |
| [`oci-mcp`](./oci-mcp) | Toolkit MCP | Combina servidores oficiais da Oracle com `oci-extras-mcp` para OKE, Vault/Secrets, Kubernetes, Functions e streaming de logs. | Node 20, OCI SDK, `uvx` | Estavel |
| [`playwright-mcp`](./playwright-mcp) | MCP server | Automacao de browser multi-sessao com Chromium/Firefox/WebKit, Chrome/Edge nativos, HAR, video, traces, PDF, rotas e stealth leve. | TypeScript, Node 20, Playwright | Estavel |
| [`career-development-mcp`](./career-development-mcp) | MCP server | PDIs, metas SMART, competencias, evidencias, prontidao de carreira, preparo de 1:1 e importacao opcional de evidencias do TFS. | Node 20, ESM, JSON local | Beta |

## Baseline de Qualidade e Seguranca

- Tools expõem JSON schemas explicitos e rejeitam campos desconhecidos sempre que pratico.
- Respostas estruturadas retornam `structuredContent` quando o server controla o formato da resposta MCP.
- Tools mutativas e destrutivas usam annotations MCP e politicas operacionais documentadas.
- Estado local, perfis de browser, logs, artefatos de output e arquivos `.env` ficam fora do Git.
- Tools de cloud priorizam dry-run, auditoria, menor privilegio e confirmacao explicita para acoes de alto impacto.
- READMEs por projeto incluem snippets de clientes e comandos de verificacao para testar cada server isoladamente.

## Layout do Repositorio

```text
mcp-servers/
├── README.md
├── README.en.md
├── README.pt-BR.md
├── LICENSE
├── .gitignore
├── package.json
├── packages/
│   ├── config-kit/
│   └── mcp-runtime/
├── scripts/
│   └── portfolio-doctor.mjs
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

## Requisitos

Requisitos gerais:

- Node.js 20 ou superior.
- npm 10 ou superior.
- Um cliente compativel com MCP, como OpenCode, Claude Code, Claude Desktop, Cursor, Cline, Codex CLI, Continue ou VS Code Copilot Agent mode.

Requisitos por projeto:

- `azure-mcp`: Azure CLI e sessao autenticada com `az login`.
- `oci-mcp`: OCI CLI / OCI config, `uv` ou `uvx`, e `kubectl` opcional para fluxos Kubernetes.
- `playwright-mcp`: browsers do Playwright instalados com `npx playwright install chromium` ou pela tool `browser_install`.

## Instalar a Colecao

Clone o repositorio:

```bash
git clone https://github.com/GustaPaes/mcp-servers.git
cd mcp-servers
```

Instale a coleção pelo workspace raiz:

```bash
npm install
npm run validate
```

Também é possível instalar e validar apenas um projeto pela própria pasta. Para
`azure-mcp`, não há dependências locais: `scripts/start-server.ps1` lê a versão
fixada em `server-version.json` e inicia o pacote oficial.

Para `oci-mcp`, siga [`oci-mcp/docs/01-installation.md`](./oci-mcp/docs/01-installation.md), pois ele combina Node, OCI CLI e servidores MCP Python da Oracle.

## Configurar Variaveis de Ambiente

Cada projeto que precisa de segredos tem um `.env.example`. Copie para `.env` e preencha localmente:

```bash
cp tfs-mcp/.env.example tfs-mcp/.env
cp career-development-mcp/.env.example career-development-mcp/.env
cp oci-mcp/.env.example oci-mcp/.env
```

Nunca commite arquivos `.env` reais. O `.gitignore` raiz e os `.gitignore` dos projetos ignoram esses arquivos.

Use `local-private/` dentro de cada projeto para adaptadores, runbooks, perfis,
exports e configurações específicos da organização. Essa pasta é ignorada pelo
Git. Exemplos públicos devem permanecer neutros e reproduzíveis.

Antes de publicar, execute `npm run doctor`. O doctor inspeciona arquivos
rastreados e novos não ignorados, e falha ao encontrar segredos, caminhos pessoais ou
identificadores internos conhecidos.

## Instalar no OpenCode

O OpenCode le MCP servers de `~/.config/opencode/opencode.json` no Linux/macOS e `%USERPROFILE%\.config\opencode\opencode.json` no Windows.

Use [`config/opencode.example.json`](./config/opencode.example.json) como ponto de partida completo, ou adicione apenas os servidores que quiser:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright-mcp": {
      "type": "local",
      "command": ["node", "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"],
      "enabled": true
    },
    "azure-mcp": {
      "type": "local",
      "command": ["powershell", "-NoProfile", "-File", "C:/Workspace/MCP Servers/azure-mcp/scripts/start-server.ps1"],
      "enabled": true
    }
  }
}
```

Reinicie o OpenCode depois de editar o arquivo. Ele nao recarrega configuracao MCP automaticamente.

## Instalar no Claude Code

Use `claude mcp add`:

```bash
claude mcp add playwright-mcp node "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"
claude mcp add azure-mcp -- powershell -NoProfile -File "C:/Workspace/MCP Servers/azure-mcp/scripts/start-server.ps1"
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
    "playwright-mcp": {
      "command": "node",
      "args": ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]
    },
    "azure-mcp": {
      "command": "powershell",
      "args": ["-NoProfile", "-File", "C:/Workspace/MCP Servers/azure-mcp/scripts/start-server.ps1"]
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
    "playwright-mcp": {
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
[mcp_servers.playwright-mcp]
command = "node"
args = ["C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"]

[mcp_servers.azure-mcp]
command = "powershell"
args = ["-NoProfile", "-File", "C:/Workspace/MCP Servers/azure-mcp/scripts/start-server.ps1"]
```

## Instalar no Continue

Edite `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: playwright-mcp
    command: node
    args:
      - "C:/Workspace/MCP Servers/playwright-mcp/dist/index.js"
```

## Instalar no VS Code Copilot Agent Mode

Adicione `.vscode/mcp.json` ao workspace:

```json
{
  "servers": {
    "playwright-mcp": {
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
- [`meta-ads-mcp/AGENTS.md`](./meta-ads-mcp/AGENTS.md)
- [`meta-ads-mcp/BEST_PRACTICES.md`](./meta-ads-mcp/BEST_PRACTICES.md)
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
- Qualquer conteúdo dentro de `local-private/`.

## Notas por Projeto

### azure-mcp

Esta pasta envelopa o servidor Azure MCP oficial da Microsoft com documentacao local, regras de seguranca e scripts auxiliares. Por padrao usa seu login da Azure CLI.

### meta-ads-mcp

MCP em TypeScript escrito do zero para a Meta Marketing API. Multi-conta por design: cada conta tem seu proprio modo (`read-only` / `dry-run` / `write-enabled`) e tetos de orcamento. Mutacoes exigem um contrato de confirmacao de quatro campos por cima do modo da conta E dos switches globais `READ_ONLY` / `DRY_RUN`. Engines (Optimization, Budget, Creative, Audience, PolicyRisk) sao deterministicas e nunca chamam a API; so a camada de tools chama. Targeting por atributos protegidos e rejeitado. Dois transportes (stdio + Streamable HTTP) saem do mesmo builder.

### tfs-mcp

Este servidor genérico cobre fluxos de TFS / Azure DevOps Server: work items padrão e customizados, PRs, review, release readiness, wiki, delivery risk e roteamento automático por especialistas. Campos obrigatórios e mapeamentos de rich text de processos específicos de cada organização ficam em `local-private/config/tfs.json`, ou em variáveis de ambiente; o código e os exemplos versionados permanecem neutros.

### oci-mcp

E um meta-toolkit. Use os servidores oficiais da Oracle para APIs OCI genericas e `oci-extras-mcp` para os fluxos operacionais faltantes em OKE, Vault, Secrets, Functions e streaming de logs.

### playwright-mcp

Este servidor e intencionalmente diferente do Playwright MCP da Microsoft. Ele foca sessoes paralelas, artefatos e primitivas de automacao de browser em nivel mais baixo.

### career-development-mcp

Este server armazena dados de desenvolvimento de carreira localmente e pode importar work items do TFS como evidencias.

## Licenca

MIT para os materiais no nivel do repositorio. Alguns subprojetos possuem notas de licenca proprias, especialmente `oci-mcp` (UPL-1.0). Ferramentas de terceiros preservam suas licencas originais.
