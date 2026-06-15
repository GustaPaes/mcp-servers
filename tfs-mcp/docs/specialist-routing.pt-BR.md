# Padrao De Roteamento Por Especialistas

Este MCP aplica rubricas de especialistas para melhorar escrita de negócio, escrita técnica, refinamento, revisão de PR e raciocínio de pipeline/release.

A intenção não é fingir que existe um humano especialista respondendo. A intenção é fazer o MCP aplicar, de forma consistente, as perguntas e critérios que bons especialistas fariam antes de escrever ou revisar artefatos no TFS.

## Quando Roda

O roteamento por especialistas está embutido em:

- `tfs_generate_activity_template`
- `tfs_generate_activity_template_from_items`
- `tfs_prepare_refinement`
- `tfs_work_item_handoff`
- `tfs_prepare_pr_review`
- `tfs_review_pr`
- `tfs_release_readiness`
- `tfs_delivery_risk_report`
- `tfs_pipeline_status`

Use `tfs_specialist_review` diretamente apenas quando quiser somente a análise por especialistas ou quando outro fluxo precisar reutilizar o bloco de recomendações.

No uso normal do MCP, o agente não deve esperar o usuário mencionar especialistas. Se o usuário pedir para usar o `tfs-mcp` para escrita de atividade, refinamento, revisão de PR, release readiness, risco de entrega ou status de pipeline, escolha o fluxo embutido correspondente acima e consuma o bloco `specialistReview` automaticamente.

## Catálogo De Especialistas

| Especialista | Sinais de ativação | Saída principal |
|---|---|---|
| Business Analyst / Product Owner | Qualquer escrita/refinamento de atividade | Persona, valor, escopo, critérios de negócio |
| Tech Lead | Qualquer trabalho técnico | Desenho técnico, dependências, riscos, rollout |
| QA / Test Specialist | Qualquer atividade/PR/release | Cenários de teste, evidências, regressão |
| Azure DevOps / Pipeline Specialist | Pipeline YAML, release, build, deploy, Docker, ambiente/config | Gates de pipeline, variáveis, artefatos, rollback |
| Security Specialist | Auth, token, secret, certificado, TLS, permissão, RBAC | Segredos, acessos, dados sensíveis, logs seguros |
| Backend Specialist | C#, API, service, worker, fila, consumer | Contratos de API, regras de negócio, tratamento de erro |
| Frontend / UX Specialist | TSX/JSX/HTML/CSS/client/UI | Estados de UI, acessibilidade, responsividade |
| Database / Persistence Specialist | SQL, migrations, repository, DAO, Redis, Mongo/cache | Compatibilidade de dados, índices, migrations, rollback |
| Architecture / Integration Specialist | Contratos, SOAP/XML, integração, compatibilidade | Fronteiras, dependências externas, breaking changes |
| Observability / Support Specialist | Logs, métricas, traces, alertas, suporte, rollback | Diagnóstico, runbooks, sinais pós-release |

## Contrato De Saída

O bloco padrão `specialistReview` contém:

- `detectedAreas`
- `specialistsUsed`
- `signals.fileSummary`
- `signals.criticalAreas`
- `businessWriting`
- `technicalWriting`
- `qaChecklist`
- `pipelineRecommendations`
- `risks`
- `suggestedBusinessCriteria`
- `suggestedTechnicalCriteria`
- `recommendedNextActions`

Agentes devem usar `specialistsUsed` como evidência de quais lentes foram aplicadas. Se o fluxo precisar de uma lente faltante, passe mais contexto com `focus`, `affected_locations`, `pr_id` ou `work_item_id`, em vez de inventar recomendações fora do retorno do MCP.

## Padrão De Prompt Recomendado

```text
Use o tfs-mcp para revisar a US 12345. Quero a escrita de negócio, critérios técnicos, riscos de pipeline/release e checklist de QA.
```

O agente deve usar um fluxo que já embute especialistas, como `tfs_prepare_refinement` ou `tfs_generate_activity_template_from_items`. A camada de especialistas roda automaticamente e retorna `specialistReview`.

Para PRs:

```text
Use o tfs-mcp para preparar a revisão do PR 456 no repo X.
```

O agente deve chamar `tfs_prepare_pr_review`, que usa os arquivos alterados para rotear especialistas.

Para release/pipeline:

```text
Use o tfs-mcp para avaliar o risco da entrega na branch release/2026.06.
```

O agente deve chamar `tfs_delivery_risk_report`, `tfs_release_readiness` ou `tfs_pipeline_status`, conforme o escopo. Cada fluxo retorna recomendações de especialistas sem exigir uma chamada separada para `tfs_specialist_review`.
