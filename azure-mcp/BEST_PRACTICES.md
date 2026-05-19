# Best Practices — azure-mcp

Boas práticas operacionais, de segurança, custo e performance para o uso do Azure MCP Server neste workspace.

> Ver também: [`AGENTS.md`](./AGENTS.md) (política de uso pelo agente) e [`PROMPT_LIBRARY.md`](./PROMPT_LIBRARY.md).

---

## Sumário

1. [Autenticação](#1-autenticação)
2. [Multi-tenant / multi-subscription](#2-multi-tenant--multi-subscription)
3. [Segurança e secrets](#3-segurança-e-secrets)
4. [Controle de blast radius](#4-controle-de-blast-radius)
5. [Custos](#5-custos)
6. [Sovereign clouds](#6-sovereign-clouds)
7. [Performance e startup](#7-performance-e-startup)
8. [Observabilidade e debug](#8-observabilidade-e-debug)
9. [CI/CD e ambientes não interativos](#9-cicd-e-ambientes-não-interativos)
10. [Versionamento do servidor](#10-versionamento-do-servidor)

---

## 1. Autenticação

O Azure MCP Server usa **`DefaultAzureCredential`** do SDK Azure. Ordem de tentativa:

1. **Variáveis de ambiente** (`AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` ou cert).
2. **Workload Identity** (em AKS/AzureContainerApps).
3. **Managed Identity** (em VMs/App Service Azure).
4. **Visual Studio / Visual Studio Code** (signed-in account).
5. **Azure CLI** (`az login`) ← **forma recomendada localmente**.
6. **Azure PowerShell** (`Connect-AzAccount`).
7. **Interactive browser** (fallback).

### Recomendado para uso local
```powershell
az login                       # interativo, usa o tenant default
az login --tenant <tenant-id>  # forca tenant especifico
az account set --subscription "<sub-name-ou-id>"
```

### NÃO recomendado para uso local
- Service Principal com client secret no `.env` → vetor de vazamento.
- Usar `--use-device-code` quando o login interativo basta.

### Forçar tenant específico mesmo via CLI
Defina apenas `AZURE_TENANT_ID` no `.env` (sem client/secret) — o `DefaultAzureCredential` vai exigir que o token CLI seja desse tenant.

---

## 2. Multi-tenant / multi-subscription

Você opera com múltiplos tenants. Use o script:

```powershell
& "C:\Workspace\MCP Servers\azure-mcp\scripts\switch-context.ps1" -Subscription "<nome ou id>"
& "C:\Workspace\MCP Servers\azure-mcp\scripts\switch-context.ps1" -Tenant "<tenant-id>"
```

Boas práticas:

- **Sempre confirme o contexto antes de mutar.** O agente é instruído a fazer isso (ver `AGENTS.md` §3).
- Use **nomes descritivos** ao logar (`az account list --output table` ajuda a visualizar).
- Considere criar **aliases** PowerShell para cenários frequentes:

```powershell
function azProd  { az account set --subscription "example-prod"  ; az account show --output table }
function azDev   { az account set --subscription "example-dev"   ; az account show --output table }
function azHomol { az account set --subscription "example-hml"   ; az account show --output table }
```

- O `azure-mcp` **não exige restart** ao trocar de sub via `az account set` — a próxima tool já pega o novo contexto.

---

## 3. Segurança e secrets

### `.env`
- O arquivo `.env` real **não deve ser commitado** (já está no `.gitignore`).
- `.env.example` documenta as chaves — preencha localmente apenas se necessário.
- Em geral, deixe o `.env` **vazio** e dependa do `az login`.

### Secrets em Key Vault
Quando o agente precisar de strings de conexão, prefira:
```
azmcp_keyvault_secret_get  → leia o secret via Key Vault
```
em vez de pedir ao usuário para colar a string em texto puro.

### Service Principals (quando necessário)
- Use **Workload Identity Federation** (sem secrets) para CI/CD.
- Se precisar de SPN local: **rotacione a cada 90 dias** e armazene no Windows Credential Manager, não em `.env`.

### Princípio de menor privilégio
- Para queries diárias: role **Reader** + **Monitoring Reader** já cobre 80%.
- Para deploys: role específica do recurso (`Storage Account Contributor`, `AKS Cluster Admin`), nunca **Owner** em sub.
- Audite com: `azmcp_role_assignment_list`.

---

## 4. Controle de blast radius

Mesmo sem `--read-only`, reduza risco:

| Prática | Como |
|---|---|
| Confirmar contexto antes de mutar | Política em `AGENTS.md` §3 |
| Detectar produção via regex | Política em `AGENTS.md` §4 |
| Locks em recursos críticos | `az lock create --lock-type CanNotDelete --name guard --resource-group <rg>` |
| Soft-delete em Key Vault, Storage, Cosmos | Habilitar via portal/IaC |
| Backup vault com immutability | Em RG de produção |
| Azure Policy "deny delete" em prod | Aplicado em management group de produção |

---

## 5. Custos

### Operações que podem gerar custo
- `azmcp_monitor_logs_query` em workspaces grandes (Log Analytics cobra por GB scaneado).
- `azmcp_storage_blob_list` em containers com milhões de blobs (custo de transação).
- Deploy de recursos (`*_create`) — sempre revise SKU antes.
- `azmcp_loadtesting_*` — load tests cobram por VUH.

### Boas práticas
- Filtre listagens por RG sempre que possível (`--resource-group` ou via prompt).
- Em queries KQL: limite `| take 100` em exploração.
- Use `azmcp_costmanagement_*` (quando disponível) para revisar gastos.
- Remova recursos órfãos (`azmcp_compute_disk_list` para discos não anexados).

---

## 6. Sovereign clouds

Default: Azure Public Cloud. Para outros:

```powershell
# Via env var
$env:AZURE_CLOUD = "AzureUSGovernment"

# Ou inline na CLI
azmcp server start --cloud AzureChinaCloud
```

Aliases aceitos: `AzureCloud`, `AzurePublicCloud`, `AzureChinaCloud`, `AzureUSGovernment` (case-insensitive).

Antes, autentique no cloud alvo:
```powershell
az cloud set --name AzureChinaCloud
az login
```

Doc: <https://github.com/microsoft/mcp/blob/main/docs/sovereign-clouds.md>

---

## 7. Performance e startup

### Startup lento (`npx` baixando o pacote)
Solução A — instalar global:
```powershell
npm install -g @azure/mcp@latest
```
Edite `mcp.json`:
```json
"command": "azmcp",
"args": ["server", "start"]
```

Solução B — pinar versão no `mcp.json`:
```json
"args": ["-y", "@azure/mcp@2.0.0", "server", "start"]
```

### Cold start típico
- `npx -y @latest`: 3–8 s (primeira vez), 1–2 s (cacheado)
- Global instalado: <1 s
- Docker: 5–10 s

### Limpar cache npx
```powershell
& "C:\Workspace\MCP Servers\azure-mcp\scripts\update-server.ps1"
```

---

## 8. Observabilidade e debug

### Logs do server
- Windows: `%LOCALAPPDATA%\azmcp\logs\`
- macOS/Linux: `~/.azmcp/logs/`

### Modo debug
Adicione `--debug` em `args` no `mcp.json`:
```json
"args": ["-y", "@azure/mcp@latest", "server", "start", "--debug"]
```

### Listar tools disponíveis
```powershell
npx -y @azure/mcp@latest tools list
```

### Diagnóstico end-to-end
```powershell
& "C:\Workspace\MCP Servers\azure-mcp\scripts\verify-auth.ps1"
```

---

## 9. CI/CD e ambientes não interativos

### GitHub Actions (recomendado: OIDC sem secrets)
```yaml
- uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- run: npm install -g @azure/mcp@latest
- run: azmcp <comando>
```

### Azure DevOps (TFS hospedado pela ExampleOrg)
> Para o **TFS on-prem** (`tfs.example.com`) use o `tfs-mcp` MCP separado. Para pipelines no Azure DevOps **Services** que precisam falar com o Azure Cloud, use service connection com Workload Identity.

### Docker (CI sem Node)
```bash
docker run --rm \
  -e AZURE_TENANT_ID=$AZURE_TENANT_ID \
  -e AZURE_CLIENT_ID=$AZURE_CLIENT_ID \
  -e AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET \
  mcr.microsoft.com/azure-sdk/azure-mcp:latest <comando>
```

---

## 10. Versionamento do servidor

| Estratégia | Quando usar | Pro | Contra |
|---|---|---|---|
| `@latest` (atual) | Dev individual | Sempre atualizado, novas tools | Pode quebrar ao rodar `npx` se houver breaking change |
| `@x.y.z` (pinado) | Times, CI | Reprodutível | Update manual |
| Global install | Dev frequente | Cold start rápido | Update manual |
| Docker tag fixa | CI/CD | Imutável, isolado | Latência maior |

**Recomendação para você (dev local, multi-tenant):** `@latest` agora; pinar a primeira versão estável que validou se começar a notar breaking changes.

Releases: <https://github.com/microsoft/mcp/releases?q=Azure.Mcp.Server->
