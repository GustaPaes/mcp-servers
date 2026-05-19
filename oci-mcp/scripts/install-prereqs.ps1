<#
.SYNOPSIS
  Installs prerequisites for the OCI MCP toolkit on Windows.

.DESCRIPTION
  Installs (idempotently) Node.js LTS, Python 3.12+, uv (uvx), OCI CLI and
  kubectl using winget when available, falling back to vendor installers.

  Run from an elevated PowerShell.
#>
[CmdletBinding()]
param(
    [switch]$SkipNode,
    [switch]$SkipPython,
    [switch]$SkipOciCli,
    [switch]$SkipKubectl
)

$ErrorActionPreference = 'Stop'

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-Winget($id, $label) {
    Write-Host "→ Installing $label ($id) via winget..." -ForegroundColor Cyan
    winget install --id $id -e --accept-package-agreements --accept-source-agreements --silent
}

if (-not (Test-Command winget)) {
    Write-Warning "winget not found. Install 'App Installer' from Microsoft Store first."
    exit 1
}

if (-not $SkipNode) {
    if (Test-Command node) {
        $v = (node -v)
        Write-Host "✓ Node already installed: $v" -ForegroundColor Green
    } else {
        Install-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    }
}

if (-not $SkipPython) {
    if (Test-Command python) {
        Write-Host "✓ Python already installed: $(python --version)" -ForegroundColor Green
    } else {
        Install-Winget 'Python.Python.3.12' 'Python 3.12'
    }
    if (-not (Test-Command uvx)) {
        Write-Host "→ Installing uv (uvx)..." -ForegroundColor Cyan
        Install-Winget 'astral-sh.uv' 'uv'
    } else {
        Write-Host "✓ uv already installed" -ForegroundColor Green
    }
}

if (-not $SkipOciCli) {
    if (Test-Command oci) {
        Write-Host "✓ OCI CLI already installed: $(oci --version)" -ForegroundColor Green
    } else {
        Install-Winget 'Oracle.OCICLI' 'OCI CLI'
    }
}

if (-not $SkipKubectl) {
    if (Test-Command kubectl) {
        Write-Host "✓ kubectl already installed" -ForegroundColor Green
    } else {
        Install-Winget 'Kubernetes.kubectl' 'kubectl'
    }
}

Write-Host ""
Write-Host "All prerequisites checked. Restart your shell so PATH updates are picked up." -ForegroundColor Yellow
Write-Host "Next: run scripts\verify-setup.ps1" -ForegroundColor Yellow
