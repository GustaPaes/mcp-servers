<#
.SYNOPSIS
    Atualiza o cache do @azure/mcp e baixa a versao validada ou informada.

.DESCRIPTION
    - Limpa o cache do npx para forcar re-download.
    - Baixa a versao pinada do @azure/mcp e mostra a versao instalada.
    - Opcionalmente, instala globalmente para acelerar cold starts.

.PARAMETER Global
    Tambem instala globalmente (`npm install -g @azure/mcp@<versao>`).

.PARAMETER Pin
    Versao especifica a fixar. Default: versao validada no workspace.

.EXAMPLE
    .\update-server.ps1
    .\update-server.ps1 -Global
    .\update-server.ps1 -Pin "2.0.0"
#>

[CmdletBinding()]
param(
    [switch] $Global,
    [string] $Pin = ""
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "azure-version.ps1")
if ([string]::IsNullOrWhiteSpace($Pin)) {
    $Pin = Get-AzureMcpVersion
}

function Write-Info($t) { Write-Host "[i] $t" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "[OK] $t" -ForegroundColor Green }
function Write-Warn($t) { Write-Host "[!! ] $t" -ForegroundColor Yellow }

$pkg = "@azure/mcp@$Pin"

Write-Info "Limpando cache npx..."
$npxCache = Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
if (Test-Path $npxCache) {
    Get-ChildItem $npxCache -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $hit = Get-ChildItem $_.FullName -Recurse -Filter "package.json" -ErrorAction SilentlyContinue |
               Where-Object {
                   try {
                       $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
                       $j.name -eq "@azure/mcp"
                   } catch { $false }
               }
        if ($hit) {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Ok "Removido cache: $($_.Name)"
        }
    }
} else {
    Write-Warn "Pasta de cache do npx nao encontrada (sera criada na proxima execucao)."
}

Write-Info "Baixando $pkg via npx..."
$out = & npx -y $pkg --version 2>&1
Write-Host $out

if ($Global) {
    Write-Info "Instalando $pkg globalmente..."
    npm install -g $pkg
    Write-Ok "Instalado globalmente. Voce pode editar mcp.json para usar 'command: azmcp'."
}

Write-Ok "Update concluido."
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1. Recarregue o VS Code (Ctrl+Shift+P > 'Developer: Reload Window')."
Write-Host "  2. No Copilot Agent mode, clique no botao refresh de tools."
Write-Host "  3. Rode .\verify-auth.ps1 para validar."
