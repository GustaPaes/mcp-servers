<#
.SYNOPSIS
    Alterna o contexto Azure (tenant e/ou subscription) usado pelo azure-mcp.

.DESCRIPTION
    O azure-mcp herda o contexto da Azure CLI (DefaultAzureCredential).
    Este script:
      - Lista subscriptions/tenants (modo sem parametros).
      - Troca para a subscription informada (-Subscription).
      - Faz `az login --tenant` se -Tenant for informado.
      - Ao final, mostra o contexto resultante.

    Nao precisa reiniciar o azure-mcp apos trocar; a proxima tool ja
    pega o novo contexto.

.PARAMETER Subscription
    Nome ou ID da subscription alvo.

.PARAMETER Tenant
    GUID do tenant alvo (forca novo login).

.PARAMETER List
    Apenas lista subscriptions e sai.

.EXAMPLE
    .\switch-context.ps1
    .\switch-context.ps1 -List
    .\switch-context.ps1 -Subscription "example-app-dev"
    .\switch-context.ps1 -Tenant "00000000-0000-0000-0000-000000000000"
    .\switch-context.ps1 -Tenant "..." -Subscription "example-app-prod"
#>

[CmdletBinding()]
param(
    [string] $Subscription,
    [string] $Tenant,
    [switch] $List
)

$ErrorActionPreference = 'Stop'

function Write-Info($t) { Write-Host "[i] $t" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "[OK] $t" -ForegroundColor Green }
function Write-Warn($t) { Write-Host "[!! ] $t" -ForegroundColor Yellow }
function Write-Err($t)  { Write-Host "[ERR] $t" -ForegroundColor Red }

function Show-Current {
    try {
        $a = az account show --output json | ConvertFrom-Json
        Write-Host ""
        Write-Host "Contexto atual:" -ForegroundColor Cyan
        Write-Host ("  Tenant       : {0}" -f $a.tenantId)
        Write-Host ("  Subscription : {0}" -f $a.name)
        Write-Host ("  Sub ID       : {0}" -f $a.id)
        Write-Host ("  Usuario      : {0}" -f $a.user.name)
        Write-Host ("  Cloud        : {0}" -f $a.environmentName)
        Write-Host ""
    } catch {
        Write-Warn "Nenhuma sessao az ativa. Rode: az login"
    }
}

function Show-SubscriptionList {
    try {
        $subs = az account list --output json | ConvertFrom-Json
        Write-Host ""
        Write-Host "Subscriptions disponiveis:" -ForegroundColor Cyan
        $subs | Sort-Object tenantId, name | ForEach-Object {
            $marker = if ($_.isDefault) { '*' } else { ' ' }
            Write-Host ("  {0} {1,-45}  {2}  tenant:{3}" -f $marker, $_.name, $_.id, $_.tenantId)
        }
        Write-Host ""
        Write-Host "  (* = ativa)" -ForegroundColor DarkGray
    } catch {
        Write-Warn "Nao foi possivel listar subscriptions."
    }
}

# --- modo somente listar ---
if ($List -or (-not $Subscription -and -not $Tenant)) {
    Show-Current
    Show-SubscriptionList
    if (-not $List) {
        Write-Host ""
        Write-Info "Para trocar, rode com -Subscription <nome> ou -Tenant <guid>."
    }
    exit 0
}

# --- trocar tenant (login) ---
if ($Tenant) {
    Write-Info "Fazendo login no tenant $Tenant ..."
    az login --tenant $Tenant --output none
    Write-Ok "Login no tenant concluido."
}

# --- trocar subscription ---
if ($Subscription) {
    Write-Info "Definindo subscription = $Subscription ..."
    try {
        az account set --subscription $Subscription
        Write-Ok "Subscription definida."
    } catch {
        Write-Err "Falha ao definir subscription. Verifique se o nome/ID existe e voce tem acesso."
        Show-SubscriptionList
        exit 1
    }
}

Show-Current
Write-Ok "Pronto. O azure-mcp ja vai usar este contexto na proxima tool."
