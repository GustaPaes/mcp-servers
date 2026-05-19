# Padrões de Criação de Work Items no TFS — ExampleProject

Este documento define os padrões técnicos para criação e manipulação de Work Items
no TFS do ExampleProject via API, incluindo campos obrigatórios e convenções.

---

## 1. Autenticação

- Usar sempre o alias `gusta` para o PAT do TFS.
- O alias é passado via `runWithRequestContext({ authAlias: "gusta" }, fn)`.

---

## 2. Scripts de execução

- Scripts de execução em `.mjs` na raiz do MCP server (`C:\Workspace\MCP Servers\tfs-mcp\`).
- Usar imports ESM: `import { ... } from "./src/tfs-client.js"`.
- Convenção de nome: `create-*.mjs`, `update-*.mjs`, `fix-*.mjs`, `read-*.mjs`, `check-*.mjs`.

---

## 3. Criação de User Story

### Endpoint

```js
tfsJsonPatch("POST", "/wit/workitems/$User%20Story", ops)
```

### Campos obrigatórios

| Campo | Valor |
|-------|-------|
| `System.Title` | `"US-{NN}: {Repo} — {Descrição}"` |
| `System.AssignedTo` | `"ExampleOrgIGITAL\\example.owner"` |
| `System.AreaPath` | `"ExampleProject\\House Of Cargo"` |
| `System.IterationPath` | `"ExampleProject\\Produtos\\2026-Q2"` |
| `example.TipoDemanda` | `"Planejada no plano de produto"` |
| `Example.Quarter` | `"2026 Q2"` |
| `Example.Bloqueio` | `"Não está bloqueado"` |
| `Microsoft.VSTS.Common.Priority` | `1` |
| `example.DefinicoesDeNegocio` | HTML gerado por `buildBusinessTemplate()` |
| `example.DefinicoesTecnicas` | HTML gerado por `buildTechnicalTemplate()` |

### Link ao PBI pai

Após criar a US, vincular ao PBI:

```js
tfsJsonPatch("PATCH", `/wit/workitems/${usId}`, [{
  op: "add",
  path: "/relations/-",
  value: {
    rel: "System.LinkTypes.Hierarchy-Reverse",
    url: `https://tfs.example.com/ExampleCollection/_apis/wit/workitems/${PBI_ID}`
  },
}]);
```

---

## 4. Criação de PBI (Product Backlog Item Desenvolvimento)

### Endpoint

```js
tfsJsonPatch("POST", "/wit/workitems/$Product%20Backlog%20Item%20Desenvolvimento", ops)
```

### Campos extras obrigatórios

| Campo | Valor (exemplo) |
|-------|-----------------|
| `ExampleOrg.ClassificacaoIniciativaPBI` | `"Backlog na CAPTAÇÃO"` (campo required com allowed values limitados por estado) |
| `System.AssignedTo` | `"ExampleOrgIGITAL\\example.reviewer"` (PBI owner, diferente do dev das USs) |
| `ExampleOrg.Discovery*`, `ExampleOrg.Sorting*` | Campos obrigatórios — preencher com valores genéricos regulatórios |

---

## 4.1. tfs_work_item_create — defaults aplicados automaticamente

A partir de 2026-04, a tool `tfs_work_item_create` aplica defaults automaticamente
para reduzir erros de validação do TFS:

### Para todos os tipos `User Story`, `Sprint Task`, `Product Backlog Item` e `Product Backlog Item Desenvolvimento`:
- Negócio é gravado em `example.DefinicoesDeNegocio` (não em `System.Description`)
- Técnica é gravada em `example.DefinicoesTecnicas` (não em `Microsoft.VSTS.Common.AcceptanceCriteria`)

### Para `User Story` e `Sprint Task` (defaults se não passados):
- `example.TipoDemanda` = `"Planejada no plano de produto"`
- `Example.Quarter` = `"2026 Q2"`
- `Example.Bloqueio` = `"Não está bloqueado"`

### Para `Product Backlog Item` e `Product Backlog Item Desenvolvimento` (defaults se não passados):
- `ExampleOrg.RequestClassification` = `"Melhoria"`
- `ExampleOrg.ClassificacaoIniciativaPBI` = `"Backlog na CAPTAÇÃO"`

Para `Bug` e `Feature` continuam usando `System.Description` / `Microsoft.VSTS.Common.AcceptanceCriteria` (campos padrão TFS).

---

## 5. Atualização de Work Items

### Atualizar definição de negócio

```js
tfsJsonPatch("PATCH", `/wit/workitems/${wiId}`, [
  { op: "replace", path: "/fields/example.DefinicoesDeNegocio", value: biz.html },
]);
```

### Atualizar título

```js
tfsJsonPatch("PATCH", `/wit/workitems/${wiId}`, [
  { op: "replace", path: "/fields/System.Title", value: "Novo título" },
]);
```

### Adicionar histórico/comentário

```js
tfsJsonPatch("PATCH", `/wit/workitems/${wiId}`, [
  { op: "add", path: "/fields/System.History", value: "Texto do comentário" },
]);
```

---

## 6. Remoção de Work Items

O TFS ExampleProject **não suporta** o estado "Removed" para User Story. Para remover:

1. Mudar estado para `"Closed"`.
2. Prefixar título com `"[REMOVIDA]"`.
3. Adicionar comentário no `System.History` explicando a razão.

```js
await tfsJsonPatch("PATCH", `/wit/workitems/${wiId}`, [
  { op: "add", path: "/fields/System.State", value: "Closed" },
  { op: "add", path: "/fields/System.Title", value: "[REMOVIDA] US-09: ..." },
  { op: "add", path: "/fields/System.History", value: "Fechada e substituída por..." },
]);
```

### Estados válidos para User Story

```
Active, Analysis, Awaiting Analysis, Awaiting Code Review, Awaiting Review,
Awaiting Test, Closed, Code Review, In Development, In Test, New, 
Ready for Dev, Released, Resolved, Review
```

---

## 7. Leitura de Work Items com relações

```js
const wi = await tfsGet("/wit/workitems/{id}", { "$expand": "relations" });
const children = (wi.relations || [])
  .filter(r => r.rel === "System.LinkTypes.Hierarchy-Forward");
```

Nota: O `$expand` deve ser passado como query param object, não inline na URL
(o `$` é tratado incorretamente se inline).

---

## 8. Convenções de código nos scripts

```js
// Padrão: COMMON_FIELDS como constante
const COMMON_FIELDS = [
  { op: "add", path: "/fields/System.AssignedTo", value: "ExampleOrgIGITAL\\example.owner" },
  // ...
];

// Padrão: helper createUS para consistência
async function createUS(title, bizInput, techInput) {
  const biz = buildBusinessTemplate(bizInput);
  const tech = buildTechnicalTemplate({ ...techInput, detailLevel: "specific" });
  // ...
}

// Padrão: helper updateBizDef para atualização parcial
async function updateBizDef(wiId, usLabel, bizInput) {
  const biz = buildBusinessTemplate(bizInput);
  await tfsJsonPatch("PATCH", `/wit/workitems/${wiId}`, [
    { op: "replace", path: "/fields/example.DefinicoesDeNegocio", value: biz.html },
  ]);
}
```

---

## 9. Tabelas SQL afetadas (referência)

| Tabela | Coluna(s) | Tipo atual |
|--------|-----------|------------|
| tbPessoaFisicaJuridica | cpf, cnpj | bigint NULL |
| tbPessoaJuridicaResponsavel | cpf | bigint NULL |
| tbCredencialViaFacil | cnpj | bigint NOT NULL |
| tbContaBancaria | cpfCnpjFavorecido | bigint |
| TBPEDAGIOPAGO | CpfPortador | bigint |
| tbPedagioPago | cnpjPontoCredenciado | bigint NOT NULL |
| TBCARTAOFAVORECIDO | cpfCnpj | VARCHAR(14) ← já string |
| cnpjPosto | - | varchar(14) ← já string |

---

## 10. Repositórios e contagem de arquivos impactados

| Repositório | Arquivos | Escaneado localmente? |
|-------------|----------|----------------------|
| ExampleProject/server | ~317 (Domain 42, Infra.Data 26, Infra 5, Application ~197, API 10, DCI 3, Mobile 34) | Sim |
| ExampleProject/ms | ~58 (24 projetos) | Sim |
| ExampleProject/client | ~313 (43 features + shared) | Sim |
| exampleCargoMobile | ~59 (models 20, screens 17, services 11, components 5) | Sim |
| exampleCargoPortal | 1 detectado | Sim |
| exampleCargo_Utils | ? | Não (NuGet) |
| exampleCargoCore | ? | Não |
| exampleCargoAgente | ? | Não |
| exampleCargoFleet | ? | Não |
| exampleCargoLandingPage | ? | Não |
| exampleCargoIntegration | ? | Não |
