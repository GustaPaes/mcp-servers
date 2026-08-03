[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ServerArgs
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "azure-version.ps1")

$command = Get-AzureMcpCommand
& $command server start @ServerArgs
exit $LASTEXITCODE
