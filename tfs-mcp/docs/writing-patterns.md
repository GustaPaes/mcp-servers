# Writing Patterns for TFS User Stories

This document describes the writing style enforced by the MCP for business and
technical criteria. It is intentionally generic and safe to publish.

## Business block

Prefer the classic structure:

```text
**Enquanto** ...
**eu quero** ...
**para que eu** ...
```

Guidelines:

- Write for the person who benefits from the behavior.
- State the intent before the implementation.
- Keep the outcome observable.

## Acceptance criteria

Business and technical criteria should be explicit and testable:

```text
**Critérios de Aceite de Negócio:**
**Deve** registrar quem aprovou a mudança.
**Deve** permitir consulta do histórico de aprovações.

**Critérios de Aceite Técnico:**
**Deve** persistir eventos de aprovação com timestamp.
**Deve** expor os eventos em endpoint autenticado.
```

Rules:

- Start each acceptance criterion with `**Deve**`.
- Avoid vague verbs such as "improve", "optimize" or "support" without
  observable behavior.
- Reference evidence or validation when rollout risk matters.

## Technical support blocks

Use these sections when relevant:

- `**Definições Visuais:**`
- `**Dependências Técnicas:**`
- `**Locais Afetados:**`

These blocks help specialist reviews stay concrete without bloating the main
story statement.

## Anti-patterns

- Mixing business language with low-level implementation details in the first
  three lines.
- Acceptance criteria that are actually tasks.
- Long unstructured paragraphs instead of grouped bullets or short blocks.
- Missing affected locations when the change spans multiple services.

## Example

```text
**Enquanto** responsável por release
**eu quero** ver o histórico de aprovações de uma implantação
**para que eu** consiga auditar decisões e investigar bloqueios

**Critérios de Aceite de Negócio:**
**Deve** exibir aprovador, data e decisão por etapa.
**Deve** permitir leitura do histórico sem acesso direto ao banco.

**Dependências Técnicas:** serviço de orquestração de release e banco de auditoria.

**Critérios de Aceite Técnico:**
**Deve** persistir eventos de aprovação com timezone consistente.
**Deve** expor endpoint autenticado para leitura paginada do histórico.

**Locais Afetados:**
- services/release-orchestrator
- api/release-history
- web/release-approvals
```
