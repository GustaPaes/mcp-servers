function Get-AzureMcpProjectRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
}

function Get-AzureMcpManifest {
    $manifestPath = Join-Path (Get-AzureMcpProjectRoot) "server-version.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Manifesto de versao nao encontrado: $manifestPath"
    }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if (-not $manifest.package -or -not $manifest.version) {
        throw "server-version.json deve conter package e version."
    }
    if ($manifest.package -ne "@azure/mcp") {
        throw "server-version.json deve referenciar exclusivamente o pacote oficial @azure/mcp."
    }
    if ([string]($manifest.version) -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
        throw "Versao invalida em server-version.json: $($manifest.version)"
    }
    return $manifest
}

function Get-AzureMcpPackage {
    $manifest = Get-AzureMcpManifest
    return "$($manifest.package)@$($manifest.version)"
}

function Get-AzureMcpVersion {
    return (Get-AzureMcpManifest).version
}

function Get-AzureMcpNodeEntryPoint {
    $projectRoot = Get-AzureMcpProjectRoot
    $entryPoint = Join-Path $projectRoot "node_modules\@azure\mcp\index.js"
    if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
        throw "Azure MCP local nao instalado. Execute 'npm ci --workspaces=false' em '$projectRoot'."
    }
    return [System.IO.Path]::GetFullPath($entryPoint)
}
