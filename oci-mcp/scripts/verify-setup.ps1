<#
.SYNOPSIS
  Verifies that the local environment is ready to run the OCI MCP toolkit.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$failures = @()

function Check([string]$name, [scriptblock]$block) {
    Write-Host "Checking $name... " -NoNewline
    try {
        $result = & $block
        Write-Host "OK" -ForegroundColor Green
        if ($result) { Write-Host "  $result" -ForegroundColor DarkGray }
    } catch {
        Write-Host "FAIL" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkRed
        $script:failures += $name
    }
}

Check 'Node.js >= 20' {
    $v = (node -v) -replace 'v',''
    $major = [int]($v.Split('.')[0])
    if ($major -lt 20) { throw "Node $v is too old, need >= 20" }
    "Node $v"
}

Check 'uvx (uv tool runner)' {
    $v = uvx --version
    "$v"
}

Check 'OCI CLI' {
    $v = oci --version
    "OCI CLI $v"
}

Check 'kubectl' {
    $v = (kubectl version --client=true --output=json 2>$null | ConvertFrom-Json).clientVersion.gitVersion
    "kubectl $v"
}

Check 'OCI config (~/.oci/config)' {
    $cfg = Join-Path $HOME '.oci\config'
    if (-not (Test-Path $cfg)) { throw "Missing $cfg — run 'oci setup config'" }
    "Found $cfg"
}

Check 'oci-extras-mcp dependencies' {
    $pkg = Join-Path $PSScriptRoot '..\oci-extras-mcp\node_modules'
    if (-not (Test-Path $pkg)) { throw "node_modules missing — run 'npm install' inside oci-extras-mcp" }
    "Installed"
}

Write-Host ""
if ($failures.Count -eq 0) {
    Write-Host "All checks passed ✓" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  - $f" -ForegroundColor Red }
    exit 1
}
