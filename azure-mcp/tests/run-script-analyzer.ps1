[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$analyzer = Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue
if (-not $analyzer) {
    Write-Warning "PSScriptAnalyzer nao esta instalado; a validacao de sintaxe permanece coberta por npm test. Instale com: Install-Module PSScriptAnalyzer -Scope CurrentUser"
    exit 0
}

$acceptedRules = @(
    # Estes scripts sao CLIs interativos; cores e mensagens imediatas fazem
    # parte da experiencia de uso, portanto Write-Host e intencional.
    'PSAvoidUsingWriteHost',
    # O repositorio adota UTF-8 sem BOM para manter os scripts portaveis.
    'PSUseBOMForUnicodeEncodedFile'
)
$results = @(
    Invoke-ScriptAnalyzer `
        -Path (Join-Path $projectRoot 'scripts') `
        -Recurse `
        -Severity Error,Warning `
        -ExcludeRule $acceptedRules
)
if ($results.Count -gt 0) {
    $results | Format-Table -AutoSize
    throw "PSScriptAnalyzer encontrou $($results.Count) problema(s)."
}
Write-Host "[OK] PSScriptAnalyzer sem problemas." -ForegroundColor Green
