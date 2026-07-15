# Padrão de análise de Issues

Use `tfs_update_issue_analysis` para preencher os campos de análise de uma
Issue. A tool só aceita o tipo de work item `Issue` e preserva os controles de
segurança de escrita do MCP: primeiro execute com `dry_run: true`; para gravar,
envie `dry_run: false`, `confirm: true`, `reason` e `requestedBy`.

## Campos atualizados

| Campo no TFS | Variável de ambiente | Regra |
| --- | --- | --- |
| Campo de análise da Issue | `TFS_ISSUE_ANALYSIS_FIELD` | Obrigatório para habilitar a tool e em toda chamada. |
| Campo de correção e impactos | `TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD` | Opcional; se não for configurado ou enviado, o valor existente é preservado. |

Configure os reference names do processo do TFS no `.env`. O MCP não assume
campos personalizados de uma coleção, projeto ou organização específica.

## Padrão para Análise do Time de Desenvolvimento

Escreva para pessoas de negócio, suporte e operação. Explique o que aconteceu,
por que afetou o usuário e o que é confirmado pelos registros. Não trate uma
hipótese como causa comprovada e não exponha documentos, e-mails, telefones,
tokens ou conteúdo de requisições.

Estruture o texto em blocos curtos:

```html
<div><b>Contexto e impacto:</b> descreva a etapa do processo afetada e a consequência percebida.</div>
<div><br></div>
<div><b>Motivo identificado:</b> explique a causa confirmada em linguagem simples.</div>
<div><br></div>
<div><b>Limites da evidência:</b> registre o que o log não permite concluir e o que precisa ser validado.</div>
<div><br></div>
<div><b>Escopo:</b> indique se há outros sintomas que não são explicados pelos registros analisados.</div>
```

Use termos técnicos apenas quando ajudam a explicar a causa. Prefira “a
aplicação tentou acessar uma informação já encerrada” a nomes de classes ou
pilhas de erro. Cite um componente técnico somente quando ele torna o ponto de
correção inequívoco.

## Padrão para Correção e Impactos

Este campo é técnico, mas deve ser objetivo e verificável. Informe a correção
proposta ou aplicada, o impacto esperado, como será validada e qualquer
pendência que impeça uma conclusão definitiva.

```html
<div><b>Correção:</b> componente, comportamento a alterar e cuidado de compatibilidade.</div>
<div><br></div>
<div><b>Impactos e validação:</b> serviços afetados, riscos, testes e evidências de validação.</div>
<div><br></div>
<div><b>Pendências:</b> informação, aprovação ou evidência ainda necessária.</div>
```

Não invente uma alteração de banco, código ou infraestrutura se a evidência
ainda não identifica a causa raiz. Nesse caso, registre a ação de diagnóstico
necessária e o critério para decidir a correção.

## Exemplo de chamada

```json
{
  "id": 12345,
  "development_analysis": "<div><b>Contexto e impacto:</b> ...</div><div><br></div><div><b>Motivo identificado:</b> ...</div>",
  "correction_and_impacts": "<div><b>Correção:</b> ...</div><div><br></div><div><b>Impactos e validação:</b> ...</div>",
  "dry_run": true,
  "reason": "Registrar análise da issue",
  "requestedBy": "nome ou identificador do solicitante"
}
```
