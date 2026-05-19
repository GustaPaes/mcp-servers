# Padrões de Escrita — User Stories ExampleProject TFS

Este documento define os padrões obrigatórios para criação e manutenção de User Stories
no TFS do projeto ExampleProject, incluindo definições de negócio e técnicas.

---

## 1. Definições de Negócio (`example.DefinicoesDeNegocio`)

### Template obrigatório

```
Enquanto <ator>,
eu quero <intenção>,
para que eu <resultado/valor de negócio>

Critérios de Aceite de Negócio:
- Deve <critério 1>
- Deve <critério 2>
...

Definições Visuais:
- <definição visual 1>
- <definição visual 2>
```

### Regras

| Regra | Detalhe |
|-------|---------|
| **Ator** | Sempre um **usuário de negócio** (contratante, motorista, gestor de frota, parceiro externo, transportador, operador). NUNCA um papel técnico (desenvolvedor, DBA). |
| **Intenção** | O que o usuário quer **fazer** no sistema — cadastrar, buscar, visualizar, operar, transmitir dados. |
| **Resultado** | O **valor de negócio** entregue — por que isso importa para o usuário. |
| **Critérios de aceite** | Comportamento **observável pelo usuário** — o que ele vai perceber. Cada critério começa com verbo no **infinitivo** (aceitar, exibir, permitir, manter, validar, buildar). |
| **"Deve" prefix** | Todo critério é renderizado com `<b>Deve</b>` em negrito antes do texto. NÃO duplicar o "Deve" no texto. |
| **Definições visuais** | Descrição do comportamento visual esperado. Quando não há interface visual, usar "Não há — camada de [tipo]." |
| **HTML interno** | Labels em `<b>`. Listas usam `<ul><li>`. |

### Exemplo concreto (bom)

```
Enquanto contratante que utiliza o Portal Contratante para gerenciar transportadores,
eu quero cadastrar, buscar e visualizar transportadores utilizando CNPJ alfanumérico,
para que eu possa operar normalmente mesmo quando meus parceiros possuírem CNPJ alfanumérico

Critérios de Aceite de Negócio:
- Deve aceitar entrada de CNPJ/CPF alfanumérico em todos os campos de documento
- Deve exibir documentos alfanuméricos corretamente em listagens e detalhes
- Deve manter formatação padrão para CNPJs numéricos legados
- Deve buildar o frontend sem erros
```

### Exemplo concreto (ruim — NÃO fazer)

```
Enquanto desenvolvedor frontend do portal contratante,    ← ator técnico
eu quero ajustar filtros e diretivas AngularJS,           ← tarefa técnica
para que eu possa garantir build sem erros                ← sem valor de negócio

Critérios de Aceite de Negócio:
- Deve Handlers devem aceitar alfanuméricos    ← "Deve" duplicado + sujeito técnico
- Deve refatorar person-formatter.service.js   ← tarefa técnica, não comportamento
```

---

## 2. Definições Técnicas (`example.DefinicoesTecnicas`)

### Template obrigatório

```
Dependências Técnicas:
- <dependência 1>
- <dependência 2>

Critérios de Aceite Técnico:
- Deve <critério técnico 1>
- Deve <critério técnico 2>

Locais Afetados:
- <caminho/arquivo 1>
- <caminho/arquivo 2>
```

### Regras

| Regra | Detalhe |
|-------|---------|
| **Dependências** | Listar USs que precisam estar prontas antes. Incluir fase e possibilidades de paralelismo. |
| **Critérios técnicos** | Tarefas técnicas específicas: refatorar, ajustar, revisar, migrar. Verbo no infinitivo. |
| **Locais afetados** | Caminhos reais de repositório/pasta/arquivo. Quando possível, incluir contagem (~N arquivos). |
| **"Deve" prefix** | Mesmo padrão: `<b>Deve</b>` + verbo infinitivo. |
| **detailLevel** | Sempre usar `"specific"` para gerar conteúdo completo (não resumido). |

---

## 3. HTML Rendering

Todas as seções internas usam **bulleted lists** (`<ul><li>`):

```html
<b>Critérios de Aceite de Negócio:</b>
<ul>
  <li><b>Deve</b> aceitar CNPJ alfanumérico nos campos de cadastro.</li>
  <li><b>Deve</b> exibir documento formatado nas listagens.</li>
</ul>
```

Labels de seção são sempre `<b>Label:</b>`.

---

## 4. Template API (activity-template.js)

### buildBusinessTemplate(input)

```js
buildBusinessTemplate({
  actor: "contratante que utiliza o Portal...",
  intent: "cadastrar transportadores com CNPJ alfanumérico...",
  outcome: "possa operar normalmente...",
  businessAcceptanceCriteria: [
    "aceitar CNPJ/CPF alfanumérico nos campos de cadastro.",
    "exibir documentos corretamente nas listagens.",
  ],
  visualDefinitions: [
    "Campos devem aceitar digitação alfanumérica.",
  ],
  // ou: visualDefinitions: "Não há — camada de backend."
})
```

### buildTechnicalTemplate(input)

```js
buildTechnicalTemplate({
  detailLevel: "specific",  // SEMPRE specific
  technicalDependencies: [
    "Depende da US-01 (SQL). Pode executar em paralelo com US-03.",
  ],
  technicalAcceptanceCriteria: [
    "refatorar DocumentHelper para aceitar alfanuméricos.",
    "ajustar mapeamentos Entity Framework de long para string.",
  ],
  affectedLocations: [
    "ExampleProject/server/src/Domain/ValueObjects/ (~42 arquivos)",
    "ExampleProject/server/src/Infra.Data/Mappings/ (~26 arquivos)",
  ],
})
```

---

## 5. Checklist de validação

Antes de criar/atualizar uma US, validar:

- [ ] Ator é um usuário de negócio (não técnico)?
- [ ] Intenção descreve o que o usuário quer fazer (não uma tarefa de código)?
- [ ] Resultado descreve valor para o negócio?
- [ ] Critérios de aceite descrevem comportamento observável?
- [ ] Critérios começam com verbo no infinitivo (sem "Deve" no texto, o template adiciona)?
- [ ] Definições visuais descrevem UX quando aplicável?
- [ ] Parte técnica tem dependências, critérios e locais afetados?
- [ ] detailLevel é "specific"?
