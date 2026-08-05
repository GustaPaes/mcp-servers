[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ServerArgs
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "azure-version.ps1")

$entryPoint = Get-AzureMcpNodeEntryPoint
& node $entryPoint server start @ServerArgs
exit $LASTEXITCODE
