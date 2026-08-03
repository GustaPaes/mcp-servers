# Padrao de Agendamento de VM

Padrao recomendado para pedidos futuros de ligar e desligar VM com o menor custo possivel usando o `azure-mcp`.

## Objetivo

Padronizar operacoes de VM em dois cenarios:

1. Operacao manual simples: consultar, ligar, desligar.
2. Operacao agendada: ligar e desligar em horarios fixos diarios.

## Padrao adotado

### 1. Desligamento sempre por deallocate

Para reduzir custo, o desligamento padrao deve ser **deallocate**, nao apenas `stop`.

Motivo:

- `stop` pode manter alocacao de compute.
- `deallocate` libera compute e interrompe cobranca de CPU/RAM da VM.
- Ainda permanecem custos de disco, backup, IP publico estatico e outros recursos anexos.

### 2. Agendamento hibrido de menor custo

Para uma VM individual, o padrao mais barato e simples e:

- `start` por **Scheduled Task local** no Windows, chamando Azure CLI.
- `shutdown` por **Azure VM Auto-shutdown**.

Motivo:

- Nao cria recurso extra pago para automacao.
- Nao exige Automation Account, Logic App, Function ou Runbook.
- Reaproveita a sessao Azure CLI local ja existente.
- O desligamento fica do lado Azure, mais resiliente se o PC estiver offline no horario de shutdown.

## Scripts padrao

- `scripts/vm-power.ps1`
  - `-Action Status`
  - `-Action Start`
  - `-Action Deallocate`
- `scripts/register-vm-schedule.ps1`
  - cria o auto-shutdown no Azure
  - registra a Scheduled Task local para start diario

## Premissas do padrao local

- O computador local precisa estar ligado no horario do `start`.
- Com a configuracao atual, o usuario precisa estar com sessao Windows ativa para a task interativa disparar.
- Se isso nao for aceitavel, o proximo nivel e migrar o `start` para Azure Automation, Function ou Logic App.

## Uso manual

```powershell
& ".\scripts\vm-power.ps1" `
  -Action Status `
  -Subscription "<sub-id>" `
  -ResourceGroup "<rg>" `
  -Name "<vm>"
```

```powershell
& ".\scripts\vm-power.ps1" `
  -Action Start `
  -Subscription "<sub-id>" `
  -ResourceGroup "<rg>" `
  -Name "<vm>"
```

```powershell
& ".\scripts\vm-power.ps1" `
  -Action Deallocate `
  -Subscription "<sub-id>" `
  -ResourceGroup "<rg>" `
  -Name "<vm>"
```

## Uso agendado

```powershell
& ".\scripts\register-vm-schedule.ps1" `
  -Subscription "<sub-id>" `
  -ResourceGroup "<rg>" `
  -Name "<vm>" `
  -StartTimeLocal "08:00" `
  -StartDays Monday,Tuesday,Wednesday,Thursday,Friday `
  -ShutdownTimeUtc "2100"
```

Para ligar apenas em dias uteis, use `-StartDays Monday,Tuesday,Wednesday,Thursday,Friday`.

## Observacoes de custo

- Compute: reduzido quando a VM estiver `Stopped (deallocated)`.
- Discos: continuam cobrando normalmente.
- IP publico estatico: continua cobrando se existir.
- Backup/monitoramento: continuam conforme configuracao.

## Fluxo padrao para o agente

1. Confirmar tenant e subscription ativas.
2. Confirmar RG e nome da VM.
3. Em operacoes mutativas, apresentar plano de mudanca.
4. Para desligar visando custo, usar `deallocate`.
5. Para pedido de agendamento, preferir:
   - start local por Scheduled Task
   - shutdown Azure por auto-shutdown

## Quando NAO usar este padrao

Nao usar Scheduled Task local quando:

- o PC do operador pode estar desligado no horario de start
- o agendamento precisa ser centralizado para varias VMs
- o processo precisa ser corporativo/auditavel no Azure

Nesses casos, evoluir para Azure Automation, Function ou Logic App.
