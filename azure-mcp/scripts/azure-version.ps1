function Get-AzureMcpPackage {
    $manifestPath = Join-Path $PSScriptRoot "..\server-version.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Manifesto de versao nao encontrado: $manifestPath"
    }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if (-not $manifest.package -or -not $manifest.version) {
        throw "server-version.json deve conter package e version."
    }
    return "$($manifest.package)@$($manifest.version)"
}

function Get-AzureMcpVersion {
    return (Get-AzureMcpPackage).Split('@')[-1]
}
