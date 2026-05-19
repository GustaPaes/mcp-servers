# Padrões de Pipeline e Release no TFS on-prem — ExampleProject

Este documento define os padrões técnicos e armadilhas conhecidas para criar,
editar e acionar Build Pipelines (YAML) e Classic Release Definitions no
TFS on-prem (`tfs.example.com`, collection `ExampleCollection`).

Referência de correção end-to-end validada: esteira `exampleCargoWebhooks`
(Builds 347/348, Releases **45/46**), branch `gl/26735` — fluxo completo
GitOps + Release por tag rodou com sucesso com CD trigger automático.

---

## 1. Autenticação e endpoints

- Usar PAT do Gustavo: `TFS_PAT_GUSTA` em `C:\Workspace\MCP Servers\tfs-mcp\.env`.
  É o único com acesso a Release Management, ACL e hooks.
- Base URL das APIs REST:
  - Build/YAML: `https://tfs.example.com/ExampleCollection/{project}/_apis/build/...`
  - Release: `https://tfs.example.com/ExampleCollection/{project}/_apis/release/...?api-version=6.0`
  - Hooks: `https://tfs.example.com/ExampleCollection/_apis/hooks/subscriptions`
- O MCP server **não expõe ferramentas de Release Management** — sempre chamar REST direto.

### IDs de referência

| Nome | ID |
|------|----|
| Collection `ExampleCollection` | `<collection-id>` |
| Project `ExampleProject` | `<project-id>` |
| Repo `exampleCargoWebhooks` | `<build-repo-id>` |
| Repo `example-app-argocd` | `<gitops-repo-id>` |
| Pool `ExampleProject New Release Agent Pool` | queueId `214` |
| Gustavo | `<approver-id>` |

---

## 2. Regras operacionais

- **Pushes em `master` são SEMPRE manuais pelo Gustavo.** Pode-se fazer push
  em branches de desenvolvimento (ex: `gl/26735`) para validação de pipeline.
- **Approvals manuais são apenas do Gustavo** (todas as stages gated).
- Branches que disparam build GitOps: `master`, `versao*`, `dev*`, `pbi*`.
- Tags semânticas (`x.y.z`) disparam o pipeline de Release (não o GitOps).
- PR pipeline (`azure-pipelines.yml`) deve usar `trigger: none` e só rodar em PR.

---

## 3. Publicação de artifacts — ARMADILHA CRÍTICA

**TFS on-prem NÃO suporta `PublishPipelineArtifact@1`.**
O build falha com `Pipeline Artifact Task is not supported in on-premises`.

### Correto

```yaml
- task: PublishBuildArtifacts@1
  inputs:
    PathtoPublish: $(Build.ArtifactStagingDirectory)
    ArtifactName: drop
    publishLocation: Container
```

O `ArtifactName` é cosmético para o trigger CD — o que importa é que **algum**
artifact seja publicado. O CD trigger mapeia pelo `definitionId` do build,
não pelo nome do artifact.

---

## 4. Instalação de ferramentas CLI na pipeline

### Linux (bash)

PATH propagado via `##vso[task.prependpath]` só vale a partir da **próxima** task.
Se precisar usar o binário na mesma task em que instala, exportar PATH inline:

```yaml
- bash: |
    curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b $(Agent.ToolsDirectory)/syft
    export PATH="$(Agent.ToolsDirectory)/syft:$PATH"
    syft version
```

### Windows (PowerShell)

Mesma regra, mas PowerShell não tem `export`. Chamar pelo **caminho absoluto**:

```powershell
$exePath = "$(Agent.ToolsDirectory)\syft\syft.exe"
Invoke-WebRequest -Uri "..." -OutFile $exePath
& $exePath version
Write-Host "##vso[task.prependpath]$(Agent.ToolsDirectory)\syft"
```

---

## 5. Build `partiallySucceeded` x CD trigger — CORREÇÃO IMPORTANTE

**Build `partiallySucceeded` NÃO dispara CD trigger no TFS 2020 on-prem.**
(Esta afirmação corrige a versão anterior deste documento que afirmava o
contrário.)

Validação empírica: builds que terminaram como `partiallySucceeded` por causa
de tasks com `continueOnError: true` (ex: upload DefectDojo/Dependency-Track)
**nunca** dispararam release automática, mesmo com toda a config correta.
Somente builds `Succeeded` (totalmente verdes) disparam CD trigger.

### Padrão correto para tasks opcionais/externas

Não usar `continueOnError: true`. Em vez disso, garantir que o próprio shell
script retorne exit 0 quando a falha for aceitável:

```yaml
- bash: |
    curl -X POST ... "$DEFECTDOJO_URL" || echo "DefectDojo upload falhou (ignorado)"
  displayName: 'Upload to DefectDojo (non-blocking)'
```

O `|| echo "..."` força o exit code 0, a task vira `Succeeded` e o build
inteiro termina `Succeeded`, disparando o CD trigger.

---

## 6. Classic Release Definition — CD trigger (ARMADILHAS CRÍTICAS)

**Descoberto e validado em 17/04/2026** após múltiplos ciclos de debug.
Existem **QUATRO bugs/armadilhas distintas** que precisam ser corrigidos para
que o CD trigger dispare automaticamente. Qualquer um faltando = silêncio
total (o build completa, mas nenhum release é criado).

### 6.1 `source: "userInterface"` é OBRIGATÓRIO no POST

Release Definitions criadas via REST API **recebem `source: "restApi"` por
default**. Definições com esse source **NÃO registram a subscription interna
de CD trigger** do TFS on-prem — o build completa mas nenhum release é criado.

**Não é possível alterar `source` via PUT**: o TFS ignora o campo em updates.
Se uma def está com `source: restApi`, é preciso **deletar e recriar** com
`source: "userInterface"` explícito no payload POST.

### 6.2 `properties` obrigatórias

Incluir no payload POST:

```json
"properties": {
  "DefinitionCreationSource":             { "$type": "System.String", "$value": "ReleaseNew" },
  "System.EnvironmentRankLogicVersion":   { "$type": "System.String", "$value": "2" },
  "IntegrateBoardsWorkItems":             { "$type": "System.String", "$value": "False" }
}
```

### 6.3 Git artifact — `branches.id` SEM prefixo `refs/heads/`

Quando a definition usa um artifact `type: "Git"` (ex: repo GitOps argocd),
o `defaultVersionType` só aceita `latestFromBranchType`, `specificVersionType`
ou `selectDuringReleaseCreationType`. Com `latestFromBranchType`, o TFS tenta
resolver "Latest from default branch" — e **falha silenciosamente** com
`ArtifactVersionUnavailableException` se `branches.id = "refs/heads/main"`.

**Use `branches.id = "main"` (nome puro, sem prefix).** Esse foi o bug que
impediu o CD trigger de disparar por 4 builds consecutivos no fluxo de debug.

```json
{
  "type": "Git",
  "alias": "_example-cargo-argocd",
  "definitionReference": {
    "branches":           { "id": "main", "name": "main" },
    "defaultVersionType": { "id": "latestFromBranchType", "name": "Latest from default branch" },
    "definition":         { "id": "<gitops-repo-id>", "name": "example-app-argocd" },
    "project":            { "id": "<project-id>", "name": "ExampleProject" }
  }
}
```

### 6.4 `triggerConditions` NÃO pode ser array vazio

```json
"triggers": [{
  "triggerType": "artifactSource",
  "artifactAlias": "_buildArtifacts",
  "triggerConditions": []   // ← BUG: nada dispara
}]
```

No TFS 2020 on-prem, `triggerConditions: []` é interpretado como **"CD trigger
desabilitado"**, não como "qualquer branch". O build completa mas nada acontece.

Use `sourceBranch: "*"` (wildcard) para aceitar qualquer branch do build:

```json
"triggers": [{
  "triggerType": "artifactSource",
  "artifactAlias": "_buildArtifacts",
  "triggerConditions": [{
    "sourceBranch": "*",
    "tags": [],
    "tagFilter": null,
    "useBuildDefinitionBranch": false,
    "createReleaseOnBuildTagging": false
  }]
}]
```

Os filtros de branch reais são feitos no CI trigger do YAML do build, não aqui.

### 6.5 Build artifact — campos dummy obrigatórios

Mesmo após aplicar 6.1–6.4, o `definitionReference` do artifact `type: "Build"`
precisa conter os campos dummy abaixo (alguns deles não fazem sentido mas
são validados pelo schema interno):

```json
"definitionReference": {
  "project":                { "id": "...", "name": "ExampleProject" },
  "definition":             { "id": "347", "name": "exampleCargoWebhooks - GitOps" },
  "defaultVersionType":     { "id": "latestType", "name": "Latest" },
  "defaultVersionBranch":   { "id": "", "name": "" },
  "defaultVersionSpecific": { "id": "", "name": "" },
  "defaultVersionTags":     { "id": "", "name": "" },
  "definitions":            { "id": "", "name": "" },
  "repository":             { "id": "", "name": "" },
  "IsMultiDefinitionType":  { "id": "False", "name": "False" },
  "artifactSourceDefinitionUrl": {
    "id": "https://tfs.example.com/_permalink/_build/index?collectionId={colId}&projectId={projId}&definitionId={buildDefId}",
    "name": ""
  }
}
```

### 6.6 ⚠️ ÚLTIMO PASSO: salvar via UI pelo menos uma vez

**Após criar via REST com tudo acima correto, o CD trigger AINDA não dispara.**
É preciso abrir a Release Definition no browser, clicar **Edit** e depois
**Save** sem alterar nada. Esse save registra a subscription interna do
`BuildCompletedEvent` no TFS.

URL: `https://tfs.example.com/ExampleCollection/{project}/_release?definitionId={id}`

Sem esse passo manual, nenhum dos itens anteriores funciona. Após o primeiro
save-via-UI, releases automáticos passam a ser criados com `reason: continuousIntegration`.

**Este passo é manual por design** — não há endpoint REST conhecido que
registre a subscription.

---

## 7. Subscriptions de CD não aparecem em hooks

CD trigger em Classic Release é uma **subscription interna** do TFS, NÃO
aparece em `GET /_apis/hooks/subscriptions` nem em
`GET /_apis/notification/subscriptions`.

Para diagnosticar CD trigger, inspecionar:
- `release/definitions/{id}` → `source`, `triggers[]`, `artifacts[]`.
- `release/releases?definitionId={id}&$top=5` → ver `reason=continuousIntegration` no último release.
- **Criar release manualmente via POST** `release/releases` — se der
  `ArtifactVersionUnavailableException`, é o bug 6.3 (Git artifact).

---

## 8. Permissões para deploy GitOps no repo argocd

Stages de release que fazem `git push` no repo `example-app-argocd`:

1. Conta usada pelo agent: **Project Collection Build Service (ExampleCollection)**.
2. Garantir `Contribute = Allow (4)` via ACL API no token
   `repoV2/{projectId}/{argocdRepoId}/`.
3. Repo argocd atual **não tem branch policies** — não precisa de exemption.
4. Na task de git push, configurar identity:
   ```bash
   git config user.email "pipelines@example.com"
   git config user.name "Azure Pipelines Bot"
   git commit -m "chore(dev): bump webhooks to $(Build.BuildId) [skip ci]"
   ```
   O `[skip ci]` evita loop infinito.

---

## 9. Convenção de triggers por pipeline

| Pipeline | YAML | Trigger CI | Trigger PR |
|----------|------|------------|------------|
| PR / Validação | `azure-pipelines.yml` | `none` | `*` (todas as branches) |
| GitOps (dev deploy) | `pipelines/azure-pipelines-gitops.yml` | `master`, `versao*`, `dev*`, `pbi*` | `none` |
| Release (tag) | `pipelines/azure-pipelines-release.yml` | tags `refs/tags/*` | `none` |

⚠️ **No TFS on-prem, trigger por tag via YAML pode não ser registrado
automaticamente.** Builds não são disparados automaticamente por tag em alguns
casos — se isso acontecer, fazer queue manual via REST:

```
POST /_apis/build/builds
{ "definition": { "id": 348 }, "sourceBranch": "refs/tags/0.0.7" }
```

---

## 10. Estrutura de stages das Releases (referência exampleCargoWebhooks)

### Release 45 — `exampleCargoWebhooks - Deploy Dev` (CD automático)

- Disparada por build 347 (`azure-pipelines-gitops.yml`) em qualquer branch
  permitido pelo CI trigger.
- 1 stage `Testes` com approval `isAutomated: true` (sem intervenção).
- Tasks: download artifact → install kustomize → `kustomize edit set image`
  em `example-app-argocd/dev` → `git commit && push`.
- ArgoCD observa o repo e faz sync para o AKS dev.

### Release 46 — `exampleCargoWebhooks - Release` (tag → Testes/Homolog/Prod)

- Disparada por build 348 (`azure-pipelines-release.yml`) quando uma tag
  `x.y.z` é criada.
- 3 stages (`Testes`, `Homolog`, `Prod`) com ranks 1/2/3.
- Stage Testes roda automaticamente; Homolog e Prod exigem approval manual
  do Gustavo (`approver.id = <approver-id>`).
- Cada stage atualiza seu próprio overlay kustomize (`dev/homolog/main`).

---

## 11. Scripts de criação de Release Definition

Scripts canônicos em `C:\Workspace\Scripts do TFS\Create Release Webhook\`:

- `create-release-definition-deploy-dev.ps1` — cria def 45 (Deploy Dev).
- `create-release-definition.ps1` — cria def 46 (Release com 3 stages).

Ambos já contemplam todas as armadilhas da seção 6 (source=userInterface,
properties, branches sem prefix, triggerConditions com `*`, dummies).

Payloads auxiliares em `C:\Workspace\*.json`:
- `rel36-working.json` — referência de def funcional (exampleCargoIntegration-Homolog).
- `release-def-payload.json`, `release-def-deploy-dev-payload.json` — últimos
  snapshots gerados pelos scripts.

---

## 12. Checklist pra diagnosticar "build passou mas release não disparou"

1. Build terminou com `result = succeeded`? `partiallySucceeded` **não dispara** (seção 5).
2. Build publicou algum artifact (`PublishBuildArtifacts@1` executou ok)?
3. Release definition tem `source: "userInterface"` (seção 6.1)?
4. `properties` contém os 3 campos da seção 6.2?
5. Git artifact (se houver) tem `branches.id = "main"` sem prefix (seção 6.3)?
6. `triggers[0].triggerConditions` tem pelo menos 1 condition não-vazia (seção 6.4)?
7. Build artifact tem todos os campos dummy do `definitionReference` (seção 6.5)?
8. A definition foi salva via UI (Edit → Save) pelo menos uma vez após a
   criação/modificação via REST (seção 6.6)?
9. Conta do release agent tem permissão nos repos/serviços alvo?
10. Pool `ExampleProject New Release Agent Pool` tem agente online?

Se 1–7 OK mas release não dispara: **99% dos casos é 6.3 ou 6.6**.
Teste rápido: `POST release/releases` com o build mais recente e sem informar
o git artifact — se o erro for `ArtifactVersionUnavailableException`, é 6.3.
Se criar a release manualmente funciona mas auto-trigger não, é 6.6.
