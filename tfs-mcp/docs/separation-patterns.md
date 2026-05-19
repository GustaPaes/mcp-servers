# Padrões de Separação de User Stories — ExampleProject

Este documento define como dividir trabalho em User Stories no TFS do ExampleProject,
garantindo que cada US entregue valor independente, buildável e testável.

---

## 1. Princípio Fundamental

> **Cada US deve ser uma entrega independente com valor de negócio,
> que builda sem erros e pode ser testada isoladamente.**

---

## 2. Critérios de separação

### Separar POR repositório/projeto

Cada repositório = pelo menos 1 US. Nunca agrupar repositórios diferentes
na mesma US, a menos que sejam genuinamente inseparáveis (ex: core + agente
que compartilham schemas).

| Situação | Decisão |
|----------|---------|
| 1 repo com escopo claro | 1 US |
| 1 repo com sub-projetos independentes (ex: server + mobile API) | 1 US por sub-projeto |
| 2+ repos acoplados por schemas/contratos | 1 US (agrupado) |
| 3 repos independentes (ex: Portal + Fleet + LandingPage) | 3 USs separadas |

### Separar POR camada quando o repo é muito grande

Se um repositório tem > 100 arquivos impactados, considerar separar por camada
ou sub-domínio. Porém, manter o valor de negócio em cada fatia.

### NÃO separar POR tipo de tarefa técnica

Ruim: "US: Alterar mapeamentos EF" / "US: Alterar DTOs" / "US: Alterar controllers"
Bom: "US: Backend legado — suporte completo a CNPJ alfanumérico"

---

## 3. Fases e dependências

Organizar USs em fases que permitam **máximo paralelismo**:

```
FASE 0 (sem dependência):
  US de infraestrutura (SQL, banco de dados)

FASE 1 (dependem da fase 0, paralelas entre si):
  US de backend / bibliotecas / APIs / integrações

FASE 2 (dependem da fase 1, paralelas entre si):
  US de frontend / mobile / portais
```

### Regras de dependência

- SQL sempre é FASE 0 (todo o restante depende).
- Pacotes NuGet compartilhados são FASE 1 mas devem ser priorizados (outros dependem).
- Backends são FASE 1 (frontends dependem deles).
- Frontends são FASE 2 (dependem dos backends).
- Dentro da mesma fase, USs são paralelas entre si.

---

## 4. Nomenclatura

### Título da US

```
US-{NN}: {Repositório/Projeto} — {Descrição do escopo de negócio}
```

Exemplos:
- `US-01: SQL — Migração de banco de dados para suporte alfanumérico`
- `US-07: ExampleProject/client — Portal Contratante (frontend AngularJS)`
- `US-09: exampleCargoPortal — Portal do Contratante (Vue.js)`

### Numeração

- Sequencial: US-01, US-02, ... US-12.
- Se uma US é removida, renumerar as seguintes ou marcar como [REMOVIDA].
- Se uma US é subdividida, adicionar novas ao final da sequência.

---

## 5. Quando NÃO criar uma US separada

- Escopo muito pequeno (< 5 arquivos, < 1 dia de trabalho) → agregar com outra US relacionada.
- Não entrega valor testável isoladamente → é uma tarefa dentro de outra US.
- Depende 100% de outra US para ser validada → considerar mergear.

---

## 6. Checklist antes de criar

- [ ] A US pode ser buildada independentemente?
- [ ] A US entrega algo testável (mesmo que parcialmente)?
- [ ] O escopo é de um repositório/projeto?
- [ ] O ator é um usuário de negócio?
- [ ] As dependências estão explícitas?
- [ ] O volume de trabalho justifica uma US separada (> 5 arquivos ou > 1 dia)?

---

## 7. Exemplo real — PBI 26123 (CNPJ Alfanumérico)

```
Primeiro (sozinha):
  US-01 (27388): SQL — Migração de banco de dados

Paralelas (até 6 devs):
  US-02 (27389): exampleCargo_Utils (NuGet)
  US-03 (27390): ExampleProject/server — Backend legado
  US-04 (27391): ExampleProject/server — API Mobile
  US-05 (27392): ExampleProject/ms — Microserviços
  US-06 (27393): exampleCargoCore + exampleCargoAgente
  US-12 (27397): exampleCargoIntegration

Paralelas (até 5 devs, dependem dos backends acima):
  US-07 (27394): ExampleProject/client — Portal Contratante AngularJS
  US-08 (27395): exampleCargoMobile — App React Native
  US-09 (27403): exampleCargoPortal — Portal Vue.js
  US-10 (27404): exampleCargoFleet — Gestão de Frota Vue.js
  US-11 (27405): exampleCargoLandingPage — Landing Page pública
```

Total: 12 USs ativas, máximo paralelismo de 6 devs no backend + 5 devs no frontend.
