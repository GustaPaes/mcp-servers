<#
.SYNOPSIS
    Verifica autenticacao Azure e conectividade do azure-mcp server.

.DESCRIPTION
    1. Confirma az login (tenant, subscription, usuario).
    2. Lista subscriptions disponiveis.
    3. Executa `npx -y @azure/mcp@latest tools list` para validar o server.
    4. Retorna exit code != 0 se algo falhar.

.EXAMPLE
    .\verify-auth.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Section($text) {
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor Cyan
}

function Write-Ok($text)   { Write-Host "[OK] $text"   -ForegroundColor Green }
function Write-Warn($text) { Write-Host "[!! ] $text"  -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "[ERR] $text"  -ForegroundColor Red }

$exitCode = 0

# ---------- 1. Pre-requisitos ----------
Write-Section "1/4  Pre-requisitos"

try {
    $node = node --version 2>$null
    Write-Ok "Node.js: $node"
} catch {
    Write-Err "Node.js nao encontrado. Instale Node 20 LTS+."
    exit 1
}

try {
    $npm = npm --version 2>$null
    Write-Ok "npm: $npm"
} catch {
    Write-Err "npm nao encontrado."
    exit 1
}

try {
    $azv = az version --output json 2>$null | ConvertFrom-Json
    Write-Ok "Azure CLI: $($azv.'azure-cli')"
} catch {
    Write-Err "Azure CLI nao encontrado. Instale: https://aka.ms/installazurecliwindows"
    exit 1
}

# ---------- 2. Sessao Azure ----------
Write-Section "2/4  Sessao Azure (az account show)"

try {
    $acct = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $acct) { throw "Nenhuma sessao ativa." }
    Write-Ok "Tenant      : $($acct.tenantId)"
    Write-Ok "Subscription: $($acct.name) ($($acct.id))"
    Write-Ok "Usuario     : $($acct.user.name) [$($acct.user.type)]"
    Write-Ok "Cloud       : $($acct.environmentName)"
} catch {
    Write-Err "Sem sessao Azure ativa. Rode: az login"
    exit 1
}

# ---------- 3. Subscriptions disponiveis ----------
Write-Section "3/4  Subscriptions disponiveis"

try {
    $subs = az account list --output json | ConvertFrom-Json
    Write-Ok "Total: $($subs.Count) subscription(s)"
    $subs | ForEach-Object {
        $marker = if ($_.isDefault) { '*' } else { ' ' }
        Write-Host ("  {0} {1,-40}  {2}  [{3}]" -f $marker, $_.name, $_.id, $_.tenantId)
    }
    Write-Host ""
    Write-Host "  (* = subscription ativa; use scripts\switch-context.ps1 para trocar)" -ForegroundColor DarkGray
} catch {
    Write-Warn "Nao foi possivel listar subscriptions."
}

# ---------- 4. Azure MCP Server ----------
Write-Section "4/4  Azure MCP Server (npx @azure/mcp tools list)"
Write-Host "  (na primeira execucao pode demorar 5-10s para baixar o pacote)" -ForegroundColor DarkGray
Write-Host ""

try {
    $output = & npx -y "@azure/mcp@latest" tools list 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Falha ao executar `npx @azure/mcp tools list`."
        Write-Host $output
        $exitCode = 1
    } else {
        # tenta parsear como JSON, mas tolera texto puro
        try {
            $tools = $output | ConvertFrom-Json
            if ($tools.tools) {
                Write-Ok "Tools carregadas: $($tools.tools.Count)"
                $sample = $tools.tools | Select-Object -First 5 -ExpandProperty name
                Write-Host "  Exemplos: $($sample -join ', ')..." -ForegroundColor DarkGray
            } else {
                Write-Ok "Servidor respondeu (formato textual)."
                $output | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            }
        } catch {
            Write-Ok "Servidor respondeu (output nao-JSON)."
            $output | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        }
    }
} catch {
    Write-Err "Erro ao iniciar o azure-mcp: $_"
    $exitCode = 1
}

# ---------- Resumo ----------
Write-Section "Resumo"
if ($exitCode -eq 0) {
    Write-Ok "Tudo pronto. Recarregue o VS Code e use Copilot Agent mode com tools azmcp_*."
} else {
    Write-Err "Houve falhas. Revise os passos acima."
}

exit $exitCode
