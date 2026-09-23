# AGENTS.md — Política Operacional do azure-mcp

> Este arquivo complementa as [diretrizes globais](../AGENTS.md). As regras de
> neutralidade, reutilização e separação de conteúdo local são obrigatórias.

O launcher e os exemplos públicos iniciam em `--mode namespace --read-only`.
Selecione apenas os namespaces necessários na configuração local do cliente.
Escrita exige remover `--read-only` nessa configuração local ou usar
`scripts/start-server.ps1 -EnableWrites`, com identidade de privilégio mínimo.

> **Este arquivo é uma instrução vinculante para qualquer agente (GitHub Copilot, Claude, OpenCode, etc.) que utilize as tools `azmcp_*` neste workspace.** Leia-o no início de toda sessão que envolva o `azure-mcp`.

---

## 1. Princípio mestre

> **Aplique confirmação proporcional ao impacto. Não repita uma confirmação para
> uma ação operacional reversível que o usuário acabou de pedir explicitamente,
> mas nunca execute alteração estrutural, exposição de segredo ou ação destrutiva
> sem contexto e prévia suficientes.**

O servidor oficial opera em modo completo. Estas instruções orientam o agente,
mas não substituem controles técnicos: use RBAC mínimo, Azure Policy, locks,
soft-delete e identidades separadas para limitar o impacto.

---

## 2. Classificação de tools

Classifique cada comando/tool pela consequência real, usando a taxonomia global.
Metadados do servidor são dicas e devem ser confrontados com comando, parâmetros,
escopo e alvo.

### 🟢 READ (segura, sem aprovação)
Padrões de nome: `*_list`, `*_get`, `*_show`, `*_query`, `*_describe`, `*_diagnose`, `*_check`, `*_status`, `*_recommendations`, `tools list`, `subscription list`, `group list`, `storage *_list`, `monitor logs query`.
- Pode executar livremente.
- Sempre que possível, **mostre o tenant + subscription resultantes** no início da resposta.

### 🔵 EXECUTION (operacional e reversível)
Padrões: `*_start`, `*_restart`, execução de diagnóstico, disparo pontual de job
e outras ações sem alteração estrutural persistente.

- Se o pedido atual já nomeia ação, escopo e alvo, ele serve como autorização;
  mostre o contexto e execute sem pedir um segundo “sim”.
- Se alvo, contexto ou impacto estiver ambíguo, apresente um plano curto e peça a
  informação ausente.
- `stop`/`deallocate`, failover, restart em massa ou ação que cause indisponibilidade
  vira `REMOTE_WRITE` ou `DESTRUCTIVE`, conforme o impacto.

### 🟡 REMOTE_WRITE (alteração persistente)
Padrões: `*_create`, `*_update`, `*_set`, `*_add`, `*_assign`, `*_deploy`,
`*_scale`, `*_rotate`, `*_enable` e `*_disable`.

- Mostre o bloco “Plano de mudança” e a diferença esperada antes/depois.
- Exija confirmação quando houver custo, acesso, rede, configuração persistente,
  indisponibilidade ou quando o pedido não especificar exatamente a mudança.
- Para uma alteração reversível já descrita de forma exata no pedido atual, uma
  prévia curta seguida da execução é suficiente fora de produção.

### 🔴 DESTRUCTIVE (irreversível ou de alto impacto, exige confirmação reforçada)
Padrões: `*_delete`, `*_remove`, `*_purge`, `*_destroy`, `*_force_delete`, `*_revoke`.
Também entram aqui (mesmo se nominalmente "update"):
- Alteração de regras de firewall/network expostas para a internet (`0.0.0.0/0`).
- Remoção/alteração de role assignments.
- Mudança de SKU/tier que cause downtime ou perda de dados.
- Soft-delete bypass / disable de backup / disable de soft-delete em vault.
- Operações em recursos com lock, mesmo que o lock será removido.
- Comandos sobre `subscription`, `tenant`, `management group`.
- Operações destrutivas ou com risco de perda/downtime em **produção** (ver seção 4).

Para 🔴, sempre use o bloco de confirmação reforçada da seção 6.

### 🟣 SECRET_READ
Listar nomes, versões ou metadados sem o valor é `READ`. Revelar valor de secret,
connection string, chave ou token é `SECRET_READ`: confirme contexto, exija pedido
explícito pelo valor, retorne somente o necessário e nunca replique o segredo em
logs, arquivos, commits ou resumos posteriores.

---

## 3. Contexto Azure com cache de sessão

Antes da primeira operação Azure da sessão, obtenha tenant, subscription e cloud
ativos. Liste todas as subscriptions somente quando o usuário pedir, quando for
necessário escolher uma ou quando o contexto atual não corresponder ao alvo.

1. Use `az account show` ou a tool equivalente.
2. Mostre tenant/subscription/cloud de forma concisa; masque IDs e identidade em
   qualquer saída que possa ser compartilhada.
3. Para `READ`, prossiga sem pedir confirmação do contexto.
4. Para `EXECUTION`, o pedido explícito atual autoriza a ação após mostrar o
   contexto, desde que o alvo seja inequívoco.
5. Para `REMOTE_WRITE`, `DESTRUCTIVE` ou `SECRET_READ`, confirme o contexto se ele
   ainda não tiver sido confirmado na sessão.

Considere o contexto confirmado por até 30 minutos na mesma conversa. Invalide o
cache após troca de tenant/subscription/cloud, autenticação renovada, divergência
entre parâmetros e contexto ou qualquer sinal de sessão diferente. Nunca armazene
tenant/subscription reais em arquivos rastreados para implementar esse cache.

---

## 4. Detecção automática de produção

Antes de `EXECUTION`, `REMOTE_WRITE` ou `DESTRUCTIVE`, varra nome de recurso, RG,
subscription e tags com a regex case-insensitive:

```
\b(prod|prd|production|produção|live)\b
```

Se houver match, eleve `REMOTE_WRITE` para alto impacto. `EXECUTION` em produção
exige uma prévia de disponibilidade, mas não deve ser chamado de irreversível se
for apenas um start/restart explicitamente solicitado.

Adicionalmente, se o nome da subscription contiver `prod` / `production`:
- Para ação destrutiva, exija que o usuário digite exatamente o nome do recurso.
- Para restart/deploy/failover, exija confirmação da janela ou aceite a declaração
  explícita do usuário de que a indisponibilidade é esperada.

---

## 5. Template "Plano de mudança" (🟡 REMOTE_WRITE)

Use este template quando a política acima exigir confirmação; para alteração
reversível já autorizada de forma exata, registre os mesmos campos em formato
resumido sem inserir uma pergunta redundante.

```
🟡 PLANO DE MUDANÇA

Tool:           azmcp_<area>_<acao>
Tenant:         <tenant-name> (<tenant-guid>)
Subscription:   <sub-name> (<sub-id>)
Resource Group: <rg>
Recurso:        <nome> (tipo: <Microsoft.X/Y>)
Operação:       <descricao curta>

Parâmetros:
  - chave1: valor1
  - chave2: valor2

Efeito esperado: <1-2 linhas explicando o impacto>
Reversibilidade: <Sim/Não — como reverter, se aplicavel>
Custo estimado: <se relevante>

Posso prosseguir? (responda: sim / não / ajustar)
```

---

## 6. Template "Confirmação reforçada" (🔴 DESTRUCTIVE)

```
🔴 OPERAÇÃO DESTRUTIVA / ALTO IMPACTO

Tool:           azmcp_<area>_<acao>
Tenant:         <tenant-name>
Subscription:   <sub-name>   ⚠ contem padrao de PRODUCAO: <match>
Resource Group: <rg>
Recurso:        <nome>
Operação:       <descricao>

⚠ ESTA AÇÃO É IRREVERSÍVEL (ou: causa downtime / perda de dados / remove acesso).

Antes de prosseguir:
  1. Você fez backup/snapshot? (S/N)
  2. Há janela de manutenção aprovada? (S/N)
  3. Confirme digitando exatamente o nome do recurso: <nome>

Aguardando confirmação textual.
```

Só prossiga após o usuário **digitar o nome correto do recurso** (anti-typo) **e** responder afirmativamente às 3 perguntas (ou explicitar que aceita o risco).

---

## 7. Operações em massa

Se a intenção do usuário levar a >3 mutações na mesma execução:

1. Apresente um **plano consolidado** (lista numerada das operações).
2. Pergunte se quer:
   - (a) confirmar uma a uma,
   - (b) confirmar o batch inteiro,
   - (c) gerar um script PowerShell/Bash para revisão e execução manual.
3. Default → opção (a) se algum item match produção.

---

## 8. Alternância de contexto

Sempre que o usuário disser "muda para a sub X" / "vai pro tenant Y":
1. Rode `scripts\switch-context.ps1` (ou `az account set`).
2. Confirme com `az account show`.
3. **Invalide o cache e obtenha novamente o contexto (seção 3)** antes de qualquer mutação.

---

## 9. Logs e auditoria

- Toda operação `EXECUTION`, `REMOTE_WRITE` ou `DESTRUCTIVE` deve ser resumida na
  própria conversa com timestamp, alvo e resultado, sem valores secretos.
- Sugira ao usuário que o Azure Activity Log (`azmcp_monitor_activitylog_*`) registra automaticamente — útil para compliance.

---

## 10. Recusas explícitas

Recuse (e explique o motivo) quando o usuário pedir para:
- Desabilitar logging/diagnóstico em produção sem justificativa documentada.
- Conceder roles privilegiadas (`Owner`, `Contributor`, `User Access Administrator`) em escopo de subscription/tenant sem aprovação registrada.
- Abrir regras de network para `0.0.0.0/0` em produção.
- Deletar Key Vaults com soft-delete + purge protection desabilitados.
- Executar mutações em recursos cujo tenant/subscription não foi identificado e
  validado conforme a seção 3.

Em todos os casos: explique a regra desta política e ofereça uma alternativa segura.

---

## 11. O que NÃO está coberto aqui

Esta política não substitui:
- RBAC/ABAC do próprio Azure.
- Azure Policy / Blueprints / Locks.
- Processos internos de change management da sua organizacao.

Ela é uma **camada adicional** de defesa, executada pelo agente.

---

## 12. Referência cruzada

- Documentação geral: [`README.md`](./README.md)
- Boas práticas técnicas: [`BEST_PRACTICES.md`](./BEST_PRACTICES.md)
- Biblioteca de prompts: [`PROMPT_LIBRARY.md`](./PROMPT_LIBRARY.md)
- MCP irmão (TFS / Azure DevOps Server): `..\tfs-mcp\`

---

## 13. Conteúdo corporativo e privado

Este repositório é reutilizável e pode ser publicado. Não salve em pastas
rastreadas nomes de tenants, subscriptions, resource groups, domínios internos,
e-mails, identificadores, topologias, inventários, runbooks operacionais ou
scripts específicos de uma empresa.

- Use `local-private/` para qualquer material específico de cliente ou empresa.
- Organize, quando necessário, em `local-private/config`, `local-private/docs`,
  `local-private/runbooks`, `local-private/scripts` e `local-private/tests`.
- `local-private/` é ignorada pelo Git e deve permanecer apenas na máquina local.
- Exemplos públicos devem usar valores fictícios e parâmetros de ambiente.
- Antes de commitar, confirme que nenhum arquivo privado foi adicionado com
  `git add -f`.
