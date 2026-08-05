<#
.SYNOPSIS
    Valida pin, lockfile, instalação local e, opcionalmente, o inventário de tools.
#>

[CmdletBinding()]
param(
    [switch] $CheckTools,
    [switch] $SkipInstalledBinary
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
. (Join-Path $PSScriptRoot 'azure-version.ps1')

$projectRoot = Get-AzureMcpProjectRoot
$manifest = Get-AzureMcpManifest
$packageJsonPath = Join-Path $projectRoot 'package.json'
$lockPath = Join-Path $projectRoot 'package-lock.json'
$inventoryPath = Join-Path $projectRoot 'tool-inventory.json'

if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) { throw "package.json ausente." }
if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { throw "package-lock.json ausente." }

$packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
$declaredVersion = $packageJson.dependencies.'@azure/mcp'
$lockedVersion = & node -e "const fs=require('fs');const lock=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(lock.packages['node_modules/@azure/mcp']?.version??'');" $lockPath
if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel ler package-lock.json com Node.js." }

if ($declaredVersion -ne $manifest.version) {
    throw "Pin divergente: server-version.json=$($manifest.version), package.json=$declaredVersion."
}
if ($lockedVersion -ne $manifest.version) {
    throw "Lockfile divergente: server-version.json=$($manifest.version), package-lock.json=$lockedVersion."
}

Write-Host "[OK] Pin e lockfile consistentes: $($manifest.package)@$($manifest.version)" -ForegroundColor Green
if ($SkipInstalledBinary) { exit 0 }

$entryPoint = Get-AzureMcpNodeEntryPoint
$versionOutput = & node $entryPoint --version 2>&1
if ($LASTEXITCODE -ne 0) { throw "Falha ao executar 'node $entryPoint --version': $versionOutput" }
if ([string]$versionOutput -notmatch "^$([regex]::Escape($manifest.version))(?:\+|$)") {
    throw "Binario local respondeu '$versionOutput', mas o pin esperado e $($manifest.version)."
}
Write-Host "[OK] Modulo Node local: $entryPoint" -ForegroundColor Green

if (-not $CheckTools) { exit 0 }

$rawOutput = & node $entryPoint tools list 2>&1
if ($LASTEXITCODE -ne 0) { throw "Falha ao listar tools: $rawOutput" }
$parsed = $rawOutput | ConvertFrom-Json
$tools = @($parsed.results)
$toolCommands = @($tools | ForEach-Object { [string]$_.command } | Where-Object { $_ } | Sort-Object -Unique)
if ($toolCommands.Count -eq 0) { throw "O comando respondeu sem um inventario de tools reconhecivel." }
if ($toolCommands.Count -ne $tools.Count) { throw "O inventario contem comandos vazios ou duplicados." }
$unclassified = @($tools | Where-Object {
    $null -eq $_.metadata.readOnly.value -or
    $null -eq $_.metadata.destructive.value -or
    $null -eq $_.metadata.idempotent.value -or
    $null -eq $_.metadata.secret.value
})
if ($unclassified.Count -gt 0) { throw "$($unclassified.Count) tools sem metadados de risco completos." }

$inventory = Get-Content -Raw -LiteralPath $inventoryPath | ConvertFrom-Json
if ($inventory.packageVersion -ne $manifest.version) {
    throw "tool-inventory.json foi gerado para $($inventory.packageVersion), mas o pin atual e $($manifest.version)."
}
if ($toolCommands.Count -lt [int]$inventory.minimumToolCount) {
    throw "Regressao no inventario: $($toolCommands.Count) tools, minimo esperado $($inventory.minimumToolCount)."
}
if ($toolCommands.Count -ne [int]$inventory.snapshotToolCount) {
    throw "Inventario divergente para o mesmo pin: $($toolCommands.Count) tools, snapshot esperado $($inventory.snapshotToolCount)."
}
$riskCounts = @{
    readOnly = @($tools | Where-Object { $_.metadata.readOnly.value -eq $true }).Count
    mutating = @($tools | Where-Object { $_.metadata.readOnly.value -eq $false }).Count
    destructive = @($tools | Where-Object { $_.metadata.destructive.value -eq $true }).Count
    secret = @($tools | Where-Object { $_.metadata.secret.value -eq $true }).Count
}
foreach ($riskName in @('readOnly', 'mutating', 'destructive', 'secret')) {
    if ([int]$riskCounts[$riskName] -ne [int]$inventory.riskSnapshot.$riskName) {
        throw "Classificacao '$riskName' divergente: $($riskCounts[$riskName]), snapshot esperado $($inventory.riskSnapshot.$riskName)."
    }
}
$missingRequired = @($inventory.requiredCommands | Where-Object { $_ -notin $toolCommands })
if ($missingRequired.Count -gt 0) {
    throw "Tools essenciais ausentes: $($missingRequired -join ', ')."
}
Write-Host "[OK] Inventario compativel: $($toolCommands.Count) tools; $($inventory.requiredCommands.Count) comandos essenciais presentes." -ForegroundColor Green
