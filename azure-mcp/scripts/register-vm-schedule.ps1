<#
.SYNOPSIS
    Registra um padrao de agendamento diario para ligar e desligar uma Azure VM.

.DESCRIPTION
    Implementa o padrao recomendado de menor custo para VMs avulsas:
      1. Start diario via Scheduled Task local chamando vm-power.ps1.
      2. Auto-shutdown diario no proprio Azure.

    Isso evita manter um processo local aguardando horario de desligamento,
    usa o Azure para desligar automaticamente e garante que o desligamento
    seja feito por deallocate, reduzindo custo de compute.

    Observacao: auto-shutdown do Azure usa horario UTC.

.EXAMPLE
    .\register-vm-schedule.ps1 `
      -Subscription <sub-id> `
      -ResourceGroup BuildPullRequest01 `
      -Name BuildPullRequest01 `
      -StartTimeLocal 08:00 `
      -ShutdownTimeUtc 2100

.EXAMPLE
    .\register-vm-schedule.ps1 `
      -Subscription <sub-id> `
      -ResourceGroup BuildPullRequest01 `
      -Name BuildPullRequest01 `
      -StartTimeLocal 08:30 `
      -ShutdownTimeUtc 2130 `
      -StartDays Monday,Tuesday,Wednesday,Thursday,Friday
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [string] $Subscription,

    [Parameter(Mandatory)]
    [string] $ResourceGroup,

    [Parameter(Mandatory)]
    [string] $Name,

    [Parameter(Mandatory)]
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
    [string] $StartTimeLocal,

    [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
    [string[]] $StartDays = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),

    [Parameter(Mandatory)]
    [ValidatePattern('^([01]\d|2[0-3])[0-5]\d$')]
    [string] $ShutdownTimeUtc,

    [string] $TaskName,

    [string] $NotificationEmail,

    [switch] $SkipAzureShutdown
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

if (-not $TaskName) {
    $TaskName = "AzureVmStart-$Name"
}

$scriptPath = Join-Path $PSScriptRoot 'vm-power.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Script nao encontrado: $scriptPath"
}

$schtasksDays = @{
    Monday = 'MON'
    Tuesday = 'TUE'
    Wednesday = 'WED'
    Thursday = 'THU'
    Friday = 'FRI'
    Saturday = 'SAT'
    Sunday = 'SUN'
}

$daysArg = ($StartDays | ForEach-Object { $schtasksDays[$_] }) -join ','

$taskCommand = "pwsh.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Action Start -Subscription `"$Subscription`" -ResourceGroup `"$ResourceGroup`" -Name `"$Name`""
$changedSomething = $false

if (-not $SkipAzureShutdown) {
    Write-Host "[i] Configurando auto-shutdown no Azure para a VM '$Name' as $ShutdownTimeUtc UTC..." -ForegroundColor Cyan

    if ($PSCmdlet.ShouldProcess("VM '$Name' in resource group '$ResourceGroup'", "Configure Azure VM auto-shutdown at $ShutdownTimeUtc UTC")) {
        $shutdownArgs = @(
            'vm', 'auto-shutdown',
            '--subscription', $Subscription,
            '--resource-group', $ResourceGroup,
            '--name', $Name,
            '--time', $ShutdownTimeUtc,
            '--output', 'json'
        )

        if ($NotificationEmail) {
            $shutdownArgs += @('--email', $NotificationEmail)
        }

        az @shutdownArgs | Out-Null
        $changedSomething = $true
    }
}
else {
    Write-Host "[i] Pulando configuracao do auto-shutdown no Azure por solicitacao." -ForegroundColor Yellow
}

Write-Host "[i] Registrando Scheduled Task '$TaskName' para start diario as $StartTimeLocal (hora local do Windows)..." -ForegroundColor Cyan

if ($PSCmdlet.ShouldProcess("Scheduled Task '$TaskName'", "Create or replace local Azure VM start schedule")) {
    schtasks.exe /Create `
        /TN $TaskName `
        /TR $taskCommand `
        /SC WEEKLY `
        /D $daysArg `
        /ST $StartTimeLocal `
        /RU $env:USERNAME `
        /IT `
        /F | Out-Null
    $changedSomething = $true
}

if ($changedSomething) {
    Write-Host "[OK] Agendamento criado/atualizado." -ForegroundColor Green
} else {
    Write-Host "[OK] Nenhuma mudanca aplicada." -ForegroundColor Green
}
Write-Host "[OK] Start local : $StartTimeLocal" -ForegroundColor Green
Write-Host "[OK] Dias start  : $($StartDays -join ', ')" -ForegroundColor Green
if (-not $SkipAzureShutdown) {
    Write-Host "[OK] Shutdown Azure (UTC): $ShutdownTimeUtc" -ForegroundColor Green
}
Write-Host "[OK] Task name    : $TaskName" -ForegroundColor Green
