<#
.SYNOPSIS
    Restaura ou promove de forma controlada a versão local do Azure MCP.

.DESCRIPTION
    Sem -Promote, executa npm ci a partir do lockfile versionado. Não remove
    caches compartilhados do npm/npx. Com -Promote, atualiza package.json,
    package-lock.json e server-version.json após confirmação PowerShell.

.PARAMETER Global
    Instala também o mesmo pin globalmente. O launcher continua usando a cópia
    local para preservar reprodutibilidade.

.PARAMETER Pin
    Versão semver/prerelease do pacote oficial. Deve ser usada com -Promote
    quando divergir do pin atual.

.PARAMETER Promote
    Promove -Pin para os manifestos versionados. Revise o diff e execute
    validate-installation.ps1 -CheckTools antes de commitar.
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [switch] $Global,
    [string] $Pin = "",
    [switch] $Promote
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
. (Join-Path $PSScriptRoot 'azure-version.ps1')

function Write-Info($text) { Write-Host "[i] $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "[OK] $text" -ForegroundColor Green }

$projectRoot = Get-AzureMcpProjectRoot
$currentVersion = Get-AzureMcpVersion
if ([string]::IsNullOrWhiteSpace($Pin)) { $Pin = $currentVersion }
if ($Pin -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "Versao invalida: '$Pin'."
}
if ($Pin -ne $currentVersion -and -not $Promote) {
    throw "O pin informado diverge de server-version.json. Use -Promote para atualizar os manifestos conscientemente."
}
if ($Promote -and $Pin -eq $currentVersion) {
    Write-Info "O pin $Pin ja esta promovido; restaurando a instalacao travada."
    $Promote = $false
}

Push-Location $projectRoot
try {
    if ($Promote) {
        $target = "@azure/mcp@$Pin"
        if ($PSCmdlet.ShouldProcess($target, 'Update package.json and package-lock.json with an exact pin')) {
            Write-Info "Atualizando dependencia local para $target..."
            & npm install --save-exact $target --workspaces=false
            if ($LASTEXITCODE -ne 0) { throw "npm install falhou com exit code $LASTEXITCODE." }

            $manifestPath = Join-Path $projectRoot 'server-version.json'
            $manifest = [ordered]@{ package = '@azure/mcp'; version = $Pin }
            $temporary = "$manifestPath.tmp-$PID"
            try {
                $manifest | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
                Move-Item -LiteralPath $temporary -Destination $manifestPath -Force
            } finally {
                if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
            }
            Write-Ok "Pin promovido. Revise package.json, package-lock.json, server-version.json e tool-inventory.json."
        }
    } elseif ($PSCmdlet.ShouldProcess("$projectRoot\node_modules", 'Restore exact dependencies from package-lock.json')) {
        Write-Info "Restaurando instalacao local a partir do lockfile..."
        & npm ci --workspaces=false
        if ($LASTEXITCODE -ne 0) { throw "npm ci falhou com exit code $LASTEXITCODE." }
        Write-Ok "Dependencias locais restauradas."
    }

    if ($Global -and $PSCmdlet.ShouldProcess("@azure/mcp@$Pin", 'Install global compatibility copy')) {
        & npm install --global "@azure/mcp@$Pin"
        if ($LASTEXITCODE -ne 0) { throw "npm install --global falhou com exit code $LASTEXITCODE." }
        Write-Ok "Copia global instalada; o launcher permanece preso a node_modules local."
    }
} finally {
    Pop-Location
}

Write-Host "Proximo passo: npm run verify:tools" -ForegroundColor Cyan
