# AGENTS.md — Política Operacional do azure-mcp

> Este arquivo complementa as [diretrizes globais](../AGENTS.md). As regras de
> neutralidade, reutilização e separação de conteúdo local são obrigatórias.

> **Este arquivo é uma instrução vinculante para qualquer agente (GitHub Copilot, Claude, OpenCode, etc.) que utilize as tools `azmcp_*` neste workspace.** Leia-o no início de toda sessão que envolva o `azure-mcp`.

---

## 1. Princípio mestre

> **Nunca cause efeito colateral em recursos Azure sem que o usuário tenha visto o plano e dito explicitamente "sim" / "confirmo" / "pode prosseguir".**

O servidor opera em **modo completo** (sem `--read-only`). Toda a proteção é contratual via este arquivo.

---

## 2. Classificação de tools

Sempre que invocar uma tool `azmcp_*`, classifique-a primeiro em uma das três categorias:

### 🟢 READ (segura, sem aprovação)
Padrões de nome: `*_list`, `*_get`, `*_show`, `*_query`, `*_describe`, `*_diagnose`, `*_check`, `*_status`, `*_recommendations`, `tools list`, `subscription list`, `group list`, `storage *_list`, `monitor logs query`.
- Pode executar livremente.
- Sempre que possível, **mostre o tenant + subscription resultantes** no início da resposta.

### 🟡 WRITE (mutativa, exige confirmação)
Padrões: `*_create`, `*_update`, `*_set`, `*_add`, `*_assign`, `*_deploy`, `*_scale`, `*_restart`, `*_start`, `*_stop`, `*_rotate`, `*_enable`, `*_disable`.
- **Antes de executar:** apresente o bloco "Plano de mudança" (seção 5).
- Aguarde "ok / sim / confirmo / pode" do usuário.

### 🔴 DESTRUCTIVE (irreversível ou de alto impacto, exige confirmação reforçada)
Padrões: `*_delete`, `*_remove`, `*_purge`, `*_destroy`, `*_force_delete`, `*_revoke`.
Também entram aqui (mesmo se nominalmente "update"):
- Alteração de regras de firewall/network expostas para a internet (`0.0.0.0/0`).
- Remoção/alteração de role assignments.
- Mudança de SKU/tier que cause downtime ou perda de dados.
- Soft-delete bypass / disable de backup / disable de soft-delete em vault.
- Operações em recursos com lock, mesmo que o lock será removido.
- Comandos sobre `subscription`, `tenant`, `management group`.
- Operações em **produção** (ver seção 4).

Para 🔴: bloco de confirmação reforçada (seção 6).

---

## 3. Bootstrap obrigatório no início de qualquer sessão Azure

Antes da primeira tool `azmcp_*`, execute e mostre ao usuário:

1. `azmcp_subscription_list` (ou equivalente) — para confirmar a quais subs ele tem acesso.
2. `az account show` (via Bash) ou `azmcp_*_account_show` — para mostrar tenant + subscription **ativos**.
3. Pergunte: *"Confirma operar no tenant `<X>` / subscription `<Y>`? Se quiser trocar, rode `scripts\switch-context.ps1`."*

> Este bootstrap pode ser **resumido** se o usuário já confirmou o contexto na mesma sessão recente.

---

## 4. Detecção automática de produção

Antes de QUALQUER WRITE ou DESTRUCTIVE, varra os parâmetros (nome de recurso, RG, subscription, tags) com a regex (case-insensitive):

```
\b(prod|prd|production|produção|live|hml|homolog|preprod|pre-prod|main|master)\b
```

Se houver match → **trate como 🔴 DESTRUCTIVE**, mesmo que a tool seja WRITE.

Adicionalmente, se o nome da subscription contiver `prod` / `production`:
- Recuse a primeira tentativa.
- Exija que o usuário **digite o nome do recurso** para confirmar (anti-typo).

---

## 5. Template "Plano de mudança" (🟡 WRITE)

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
3. **Repita o bootstrap (seção 3)** antes de qualquer mutação.

---

## 9. Logs e auditoria

- Toda operação WRITE/DESTRUCTIVE deve ser **logada na própria conversa** com timestamp.
- Sugira ao usuário que o Azure Activity Log (`azmcp_monitor_activitylog_*`) registra automaticamente — útil para compliance.

---

## 10. Recusas explícitas

Recuse (e explique o motivo) quando o usuário pedir para:
- Desabilitar logging/diagnóstico em produção sem justificativa documentada.
- Conceder roles privilegiadas (`Owner`, `Contributor`, `User Access Administrator`) em escopo de subscription/tenant sem aprovação registrada.
- Abrir regras de network para `0.0.0.0/0` em produção.
- Deletar Key Vaults com soft-delete + purge protection desabilitados.
- Operar em recursos cuja subscription/tenant você não confirmou no bootstrap (seção 3).

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
