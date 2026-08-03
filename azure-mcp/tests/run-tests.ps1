[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scriptsRoot = Join-Path $projectRoot 'scripts'
$failures = [System.Collections.Generic.List[string]]::new()

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { $failures.Add($Message) }
}

Get-ChildItem -LiteralPath $scriptsRoot -Filter '*.ps1' -File | ForEach-Object {
    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors)
    Assert-True ($parseErrors.Count -eq 0) "$($_.Name) possui erro(s) de sintaxe: $($parseErrors.Message -join '; ')"
}

. (Join-Path $scriptsRoot 'azure-version.ps1')
$manifest = Get-AzureMcpManifest
Assert-True ($manifest.package -eq '@azure/mcp') 'O manifesto deve apontar para @azure/mcp.'
Assert-True ((Get-AzureMcpPackage) -eq "@azure/mcp@$($manifest.version)") 'Get-AzureMcpPackage diverge do manifesto.'

$validator = Join-Path $scriptsRoot 'validate-installation.ps1'
& powershell -NoProfile -File $validator -SkipInstalledBinary
Assert-True ($LASTEXITCODE -eq 0) 'A validação offline de pin/lockfile falhou.'

$updateScript = Join-Path $scriptsRoot 'update-server.ps1'
$updateContent = Get-Content -Raw -LiteralPath $updateScript
Assert-True ($updateContent -notmatch 'npm-cache\\_npx') 'update-server.ps1 não deve apagar cache npx compartilhado.'
Assert-True ($updateContent -notmatch 'Remove-Item\s+\$_.FullName\s+-Recurse') 'update-server.ps1 não deve executar exclusão recursiva descoberta dinamicamente.'
& powershell -NoProfile -File $updateScript -WhatIf
Assert-True ($LASTEXITCODE -eq 0) 'update-server.ps1 -WhatIf falhou.'

$startContent = Get-Content -Raw -LiteralPath (Join-Path $scriptsRoot 'start-server.ps1')
Assert-True ($startContent -notmatch '\bnpx\b') 'O launcher deve usar apenas a instalação local travada.'
Assert-True ($startContent -match 'Get-AzureMcpCommand') 'O launcher não usa o resolvedor local canônico.'

& powershell -NoProfile -File (Join-Path $scriptsRoot 'vm-power.ps1') `
    -Action Start -Subscription '00000000-0000-0000-0000-000000000000' `
    -ResourceGroup 'ExampleGroup' -Name 'example-vm' -WhatIf
Assert-True ($LASTEXITCODE -eq 0) 'vm-power.ps1 -WhatIf falhou.'

& powershell -NoProfile -File (Join-Path $scriptsRoot 'register-vm-schedule.ps1') `
    -Subscription '00000000-0000-0000-0000-000000000000' `
    -ResourceGroup 'ExampleGroup' -Name 'example-vm' `
    -StartTimeLocal '08:00' -ShutdownTimeUtc '2100' -WhatIf
Assert-True ($LASTEXITCODE -eq 0) 'register-vm-schedule.ps1 -WhatIf falhou.'

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host "[OK] Testes PowerShell do azure-mcp concluidos." -ForegroundColor Green
