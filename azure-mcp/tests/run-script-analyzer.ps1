[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$analyzer = Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue
if (-not $analyzer) {
    Write-Warning "PSScriptAnalyzer nao esta instalado; a validacao de sintaxe permanece coberta por npm test. Instale com: Install-Module PSScriptAnalyzer -Scope CurrentUser"
    exit 0
}

$results = @(Invoke-ScriptAnalyzer -Path (Join-Path $projectRoot 'scripts') -Recurse -Severity Error,Warning)
if ($results.Count -gt 0) {
    $results | Format-Table -AutoSize
    throw "PSScriptAnalyzer encontrou $($results.Count) problema(s)."
}
Write-Host "[OK] PSScriptAnalyzer sem problemas." -ForegroundColor Green
