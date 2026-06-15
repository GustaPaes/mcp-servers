<#
.SYNOPSIS
    Consulta ou altera o estado de energia de uma Azure VM.

.DESCRIPTION
    Wrapper simples sobre Azure CLI para padronizar as operacoes mais comuns
    de VM neste workspace:
      - Status (inclui power state)
      - Start
      - Stop com deallocate para reduzir custo de compute

    O script aceita subscription por nome ou ID, evitando depender do contexto
    global da Azure CLI em automacoes agendadas.

.EXAMPLE
    .\vm-power.ps1 -Action Status -Subscription <sub-id> -ResourceGroup rg -Name vm01

.EXAMPLE
    .\vm-power.ps1 -Action Start -Subscription <sub-id> -ResourceGroup rg -Name vm01

.EXAMPLE
    .\vm-power.ps1 -Action Deallocate -Subscription <sub-id> -ResourceGroup rg -Name vm01
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Status', 'Start', 'Deallocate')]
    [string] $Action,

    [Parameter(Mandatory)]
    [string] $Subscription,

    [Parameter(Mandatory)]
    [string] $ResourceGroup,

    [Parameter(Mandatory)]
    [string] $Name
)

$ErrorActionPreference = 'Stop'

function Write-Info($text) { Write-Host "[i] $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "[OK] $text" -ForegroundColor Green }

function Get-VmStatus {
    az vm get-instance-view `
        --subscription $Subscription `
        --resource-group $ResourceGroup `
        --name $Name `
        --query "{name:name,location:location,vmSize:hardwareProfile.vmSize,powerState:instanceView.statuses[?starts_with(code, 'PowerState/')].displayStatus | [0],provisioningState:provisioningState}" `
        --output json
}

switch ($Action) {
    'Status' {
        Write-Info "Consultando status da VM '$Name'..."
        Get-VmStatus
    }

    'Start' {
        if ($PSCmdlet.ShouldProcess("VM '$Name' in resource group '$ResourceGroup'", "Start Azure VM")) {
            Write-Info "Iniciando VM '$Name'..."
            az vm start `
                --subscription $Subscription `
                --resource-group $ResourceGroup `
                --name $Name `
                --only-show-errors `
                --output json

            Write-Ok "Start solicitado. Estado atual:"
            Get-VmStatus
        }
    }

    'Deallocate' {
        if ($PSCmdlet.ShouldProcess("VM '$Name' in resource group '$ResourceGroup'", "Deallocate Azure VM")) {
            Write-Info "Desalocando VM '$Name' para minimizar custo de compute..."
            az vm deallocate `
                --subscription $Subscription `
                --resource-group $ResourceGroup `
                --name $Name `
                --only-show-errors `
                --output json

            Write-Ok "Deallocate solicitado. Estado atual:"
            Get-VmStatus
        }
    }
}
