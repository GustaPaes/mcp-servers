# Mapa de Work Items — PBI 26123 (CNPJ Alfanumérico)

> Última atualização: 28/04/2026

---

## PBI

| Campo | Valor |
|-------|-------|
| **WI ID** | 26123 |
| **Título** | Adequação do sistema para suporte a CNPJ Alfanumérico |
| **Tipo** | Product Backlog Item Desenvolvimento |
| **Iteration** | ExampleProject\Produtos\2026-Q2 |
| **Area** | ExampleProject\House Of Cargo |

---

## User Stories ativas (13)

### FASE 0 — Infraestrutura (sem dependência)

| US | WI ID | Repositório | Escopo | Dev |
|----|-------|-------------|--------|-----|
| US-01 | **27388** | SQL | Migração de 6 tabelas bigint→varchar, views, triggers, índices, rollback | example.owner |

### FASE 1 — Backend / Bibliotecas / Integrações (dependem da fase 0, paralelas entre si)

| US | WI ID | Repositório | Escopo | Dev |
|----|-------|-------------|--------|-----|
| US-02 | **27389** | exampleCargo_Utils | DocumentHelper, validadores, formatadores, Pix — publish NuGet | example.owner |
| US-03 | **27390** | ExampleProject/server | Backend legado completo: Domain+Infra+Application+API (~283 arquivos) | example.owner |
| US-04 | **27391** | ExampleProject/server (Mobile) | ExampleProductMobile.Application + ExampleProductMobile.API (~34 arquivos) | example.owner |
| US-05 | **27392** | ExampleProject/ms | Microserviços + Integrações (~58 arquivos, 24 projetos) | example.owner |
| US-06 | **27393** | exampleCargoAgente | Schemas XSD versionados (47), Bridges/Conversores/Verificadores nas 15 versões (v4140 a v42120), VOs Integracao*.cs (~200) | example.owner |
| US-13 | **27831** | exampleCargo_Core | WS ASMX/REST, DAOs, VOs (~146), Reports (Crystal+XSD), processadores Datacenter, agendadores/workflows e integrações externas (Receita Federal, ANTT, ViaFacil, ConectCar, BPP, Pix, Nexxera) | example.owner |
| US-12 | **27397** | exampleCargoIntegration | Integração legada C#: helpers, conversores, DTOs | example.owner |

### FASE 2 — Frontend / Mobile / Portais (dependem da fase 1, paralelas entre si)

| US | WI ID | Repositório | Escopo | Dev |
|----|-------|-------------|--------|-----|
| US-07 | **27394** | ExampleProject/client | Portal Contratante AngularJS (~313 arquivos, 43 features) | example.owner |
| US-08 | **27395** | exampleCargoMobile | App React Native (~59 arquivos) | example.owner |
| US-09 | **27403** | exampleCargoPortal | Portal do Contratante Vue.js | example.owner |
| US-10 | **27404** | exampleCargoFleet | Gestão de Frota Vue.js | example.owner |
| US-11 | **27405** | exampleCargoLandingPage | Página pública de cadastro | example.owner |

---

## Outros Work Items no PBI (preservados)

| WI ID | Tipo | Estado | Título |
|-------|------|--------|--------|
| 26795 | Spike | Closed | Levantamento de Atividades - CPF/CNPJ em texto |
| 27075 | Sprint Task | New | Criar TestCase - PBI 26123 |
| 27272 | Sprint Task | In Development | Escrita Técnica do PBI 26123 |

---

## PBI auxiliar (sem filhos)

| Campo | Valor |
|-------|-------|
| **WI ID** | 27387 |
| **Título** | Implementação CNPJ Alfanumérico — Desenvolvimento |
| **Status** | Vazio (todas as USs foram movidas para o PBI 26123) |

---

## Grafo de paralelismo (quem pode puxar o quê)

```
US-01 (SQL)  ← PRIMEIRO, sozinha. Ninguém começa sem ela.
  │
  │  Quando US-01 terminar, TODOS podem começar ao mesmo tempo (até 7 devs):
  │
  ├── US-02 (Utils NuGet)
  ├── US-03 (Backend server)
  ├── US-04 (Mobile API)
  ├── US-05 (Microserviços)
  ├── US-06 (exampleCargoAgente — schemas + bridges)
  ├── US-13 (exampleCargo_Core — WS + integrações externas)
  └── US-12 (Integration)
        │
        │  Quando os backends terminarem, os frontends podem começar:
        │
        │  US-03 pronta ──────────────────→ US-07 (Portal AngularJS)
        │  US-04 pronta ──────────────────→ US-08 (App Mobile)
        │  US-02 + US-03 + US-05 prontas ─→ US-09 (Portal Vue.js)
        │  US-02 + US-03 + US-05 prontas ─→ US-10 (Fleet Vue.js)
        │  US-03 + US-05 prontas ─────────→ US-11 (LandingPage)
```

---

## USs deletadas (referência histórica)

- **27396** (US-09 antiga) — agrupava Portal+Fleet+LandingPage, substituída por US-09/10/11 individuais.
- **27044-27070, 27273, 27286** — 27 USs antigas do PBI 26123, deletadas permanentemente e substituídas pelas 12 USs atuais.

---

## Histórico de evolução do escopo

- **28/04/2026** — US-06 desmembrada em duas USs testáveis isoladamente:
  - **US-06 (27393)** ficou com exampleCargoAgente apenas (schemas XSD + Bridges + VOs versionados). Testável via fixtures XML processadas pelo Bridge sem necessidade do Core rodando.
  - **US-13 (27831)** criada para exampleCargo_Core completo (WS ASMX/REST + DAOs + Reports + integrações externas: Receita Federal, ANTT, ViaFacil, ConectCar, BPP, Pix, Nexxera). Testável via chamadas diretas aos endpoints WS/REST com payloads contendo CNPJ alfanumérico.
  - Critério da separação: ambos compilam e rodam independentemente, têm pontos de entrada distintos (XML vs WS) e podem ter testes de aceitação separados — atendendo à diretriz de "separar somente se testável separadamente".
