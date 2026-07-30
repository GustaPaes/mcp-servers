[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ServerArgs
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "azure-version.ps1")

$package = Get-AzureMcpPackage
& npx -y $package server start @ServerArgs
exit $LASTEXITCODE
