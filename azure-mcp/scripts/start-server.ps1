[CmdletBinding()]
param(
    [switch] $EnableWrites,
    [string[]] $Namespace,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ServerArgs
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "azure-version.ps1")

$entryPoint = Get-AzureMcpNodeEntryPoint
$safeArgs = @('--mode', 'namespace')
if (-not $EnableWrites) { $safeArgs += '--read-only' }
foreach ($name in $Namespace) {
    if ($name -notmatch '^[a-z][a-z0-9-]*$') { throw "Namespace inválido: $name" }
    $safeArgs += @('--namespace', $name)
}
& node $entryPoint server start @safeArgs @ServerArgs
exit $LASTEXITCODE
