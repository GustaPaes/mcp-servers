<#
.SYNOPSIS
  Refreshes an OCI session token (security_token_file auth).

.PARAMETER Profile
  OCI config profile to refresh. Defaults to env:OCI_CONFIG_PROFILE or DEFAULT.

.PARAMETER Region
  OCI region. Defaults to env:OCI_REGION or sa-saopaulo-1.
#>
[CmdletBinding()]
param(
    [string]$Profile = $(if ($env:OCI_CONFIG_PROFILE) { $env:OCI_CONFIG_PROFILE } else { 'DEFAULT' }),
    [string]$Region  = $(if ($env:OCI_REGION) { $env:OCI_REGION } else { 'sa-saopaulo-1' })
)

$ErrorActionPreference = 'Stop'

Write-Host "Refreshing OCI session: profile=$Profile region=$Region" -ForegroundColor Cyan

# Try refresh first
$exit = 0
oci session refresh --profile $Profile 2>&1 | ForEach-Object {
    if ($_ -match 'expired|not found|missing|cannot') { $exit = 1 }
    $_
}

if ($exit -ne 0) {
    Write-Host "→ Session expired or missing. Authenticating fresh..." -ForegroundColor Yellow
    oci session authenticate --region $Region --profile-name $Profile
}

Write-Host "✓ Session active for profile $Profile" -ForegroundColor Green
