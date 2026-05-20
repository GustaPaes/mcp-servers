# Painel Web Administrativo — Arquitetura (opcional)

Este documento descreve a arquitetura do painel web administrativo que
complementa o MCP Server. O painel **não substitui** o Meta Ads Manager: ele
é uma camada de visualização, configuração e aprovação de recomendações
geradas pelo MCP Server.

## 1. Stack

- **Next.js 14+** (App Router) — SSR para páginas autenticadas, streaming.
- **TypeScript estrito**, compartilhando os mesmos schemas Zod do MCP Server
  via pacote `@meta-ads-mcp/shared-schemas` (workspace local).
- **TailwindCSS** + **shadcn/ui** — design system consistente e acessível.
- **TanStack Query v5** — cache, retries, invalidação por tag.
- **Recharts** — gráficos (linhas para tendência, barras para comparação, etc.).
- **NextAuth.js** — autenticação inicial (Email magic link, Google OAuth).
- **RBAC simples**: papéis `viewer`, `analyst`, `approver`, `admin`.
- **Zustand** para estado leve (filtros de período, conta selecionada).
- **Zod** para validar formulários (mesma fonte de verdade do backend).

## 2. Modelo de integração

O painel **não fala diretamente com a Graph API**. Ele consome uma API
interna (`/api/*`, Next.js Route Handlers) que por sua vez chama:

1. **O MCP Server**, via um cliente Node interno usando `@modelcontextprotocol/sdk/client/index.js`
   e `StdioClientTransport` (process spawn) ou um transporte HTTP custom.
2. **Storage compartilhado** (mesmo `STORAGE_PATH` / banco) para drafts e
   auditoria, somente leitura para a maior parte do painel.

Vantagens:
- Tokens nunca chegam ao browser.
- Toda mutação passa pela mesma chain de validação / auditoria do MCP.
- Reuso 100% dos engines de otimização.

```
[Browser] --HTTPS--> [Next.js API routes] --stdio/MCP--> [meta-ads-mcp]
                                                |
                                                +--> Meta Graph API
                                                +--> audit.log / storage.json
```

## 3. Estrutura de pastas sugerida

```
web-panel/
  app/
    (auth)/login/page.tsx
    (app)/
      layout.tsx
      accounts/page.tsx              # 1. seleção de conta
      [accountId]/
        page.tsx                     # 2. dashboard
        campaigns/page.tsx           # 3. lista de campanhas
        campaigns/[id]/page.tsx      # 4. detalhe da campanha
        recommendations/page.tsx     # 5. central de recomendações
        creatives/analyze/page.tsx   # 6. análise de criativo
        settings/page.tsx            # 7. configuração da conta
        audit/page.tsx               # 8. auditoria
  components/
    ui/                              # shadcn
    charts/
    forms/
    recommendations/RecommendationCard.tsx
    dryrun/DryRunBadge.tsx
  lib/
    mcp/client.ts                    # wrapper do MCP Client SDK
    auth.ts
    rbac.ts                          # checagem de papéis
    queries.ts                       # hooks TanStack Query
  schemas/                           # re-export do package compartilhado
  middleware.ts                      # redirect para /login se não autenticado
  next.config.mjs
  package.json
  tailwind.config.ts
```

## 4. Telas e componentes

### 4.1 Seleção de conta (`/accounts`)
- Lista cartões com nome, status de conexão, moeda, nicho, objetivo e badge
  do modo efetivo (`read-only` / `dry-run` / `write-enabled`).
- Botão "Trocar para esta conta" salva em cookie + Zustand.

### 4.2 Dashboard (`/[accountId]`)
- KPIs: Spend, Impressões, Alcance, Cliques, CTR, CPC, CPM, Conversões,
  CPA, ROAS, Frequência.
- Gráfico de linha — Spend x Conversões (últimos 30 dias).
- Cards de "Campanhas ativas" e "Campanhas com alerta".
- Tudo via `generate_performance_report` + `find_wasted_spend`.

### 4.3 Lista de campanhas (`/.../campaigns`)
- Tabela ordenável: Nome, Status, Objetivo, Orçamento, Gasto, Resultado
  principal, CPA, ROAS, Frequência, **Score de eficiência** (calculado no
  front a partir das metas), Alertas (badges).
- Filtros por status e período.

### 4.4 Detalhe da campanha (`/.../campaigns/[id]`)
- Aba **Métricas**: gráficos por período (Recharts).
- Aba **Conjuntos** e **Anúncios**: navegação drill-down.
- Aba **Recomendações** (consome `recommend_campaign_optimizations`).
- Aba **Histórico**: lê o `audit.log` filtrado pelo `campaignId`.
- Aba **Riscos**: `validate_meta_policy_risk`.

### 4.5 Central de recomendações (`/.../recommendations`)
- Lista cards com: título, categoria, impacto, confiança, risco, motivo,
  métricas que justificam.
- Botões por card:
  - **Aprovar (dry-run)** — chama a tool de mutação com `dryRun: true`.
  - **Aplicar** — abre modal exigindo `reason` e nome do `requestedBy`,
    confirma e chama com `dryRun: false`.
  - **Rejeitar** — registra em auditoria como `recommendation.rejected`.
  - **Simular impacto** — projeção heurística client-side.

### 4.6 Análise de criativo (`/.../creatives/analyze`)
- Form com headline, primaryText, CTA, productOrOffer, landingPageUrl,
  **descrição da imagem ou alt text** (sempre opcional, mas recomendado).
- Submit chama `analyze_ad_creative` + `predict_best_audience_for_ad`.
- Renderiza: clarityScore, público provável/a evitar, riscos de política,
  sugestões de copy/criativo, plano A/B, plano D+3/D+7/D+14.

### 4.7 Configuração da conta (`/.../settings`)
- Formulário com persona, restrições, limites de orçamento, eventos,
  forbiddenWords, tom de comunicação. Submit chama `update_account_profile`.
- Campos `tokenEnvVar` e `adAccountId` são read-only (mudança requer deploy).
- Banner persistente com o **modo efetivo** e botão "Solicitar mudança de modo"
  (cria entrada em auditoria; mudança real é por env/redeploy).

### 4.8 Auditoria (`/.../audit`)
- Tabela paginada do `audit.log` (lida pelo backend, nunca pelo browser).
- Filtros por: ação, requestedBy, contaId, ferramenta, intervalo.
- Cada linha expande para mostrar `before` / `after` (já redacted).

## 5. Regras de segurança do painel

| Regra | Como é garantida |
|------|------------------|
| Painel começa em **read-only** | `READ_ONLY=true` no env do MCP; painel mostra banner amarelo. |
| Tokens nunca chegam ao browser | API routes nunca devolvem `tokenEnvVar`/tokens; `redactSecrets` é aplicado também na resposta JSON do painel. |
| Mutação exige confirmação humana | Toda mutação passa por modal com `reason` + segunda confirmação; backend exige `confirm=true` + `dryRun=false`. |
| Diferenciação "recomendação vs. mudança real" | Componente `MutationBadge` (`DRY-RUN`, `APPLIED`, `BLOCKED`) sempre visível. |
| RBAC | Apenas `approver`/`admin` veem o botão **Aplicar**; `viewer`/`analyst` veem apenas dry-run. |
| Logs do painel | Próprio painel registra ação no `audit.log` antes de chamar o MCP (camada extra de rastreabilidade). |

## 6. Próximos passos opcionais

- Implementar transporte HTTP no MCP (Streamable HTTP) para que o painel
  consuma sem precisar do stdio spawn.
- Substituir `FileStorage` por Postgres + Prisma (compartilhado entre MCP e painel).
- Webhooks da Meta para invalidar cache do TanStack Query em tempo real.
- Integração com SSO corporativo (SAML/OIDC).
