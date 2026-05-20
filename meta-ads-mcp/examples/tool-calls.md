# Exemplos de chamadas das tools (formato MCP)

Todas as chamadas abaixo são feitas pelo cliente MCP (Claude Desktop, Cursor,
ChatGPT Desktop com MCP, etc.). O cliente envia o nome da tool e os argumentos
como JSON; o servidor valida com Zod e responde com um envelope:

```json
{ "ok": true, "data": { ... }, "warnings": [...], "errors": [...] }
```

## 1. list_ad_accounts

**Input:** `{}`

**Output (resumido):**
```json
{
  "ok": true,
  "data": {
    "count": 2,
    "accounts": [
      { "id": "acme-fashion", "name": "ACME Fashion BR", "currency": "BRL",
        "configuredMode": "dry-run", "effectiveMode": "read-only", "hasToken": true }
    ]
  }
}
```

## 2. analyze_ad_creative (cenário do brief: loja de vestidos)

**Input:**
```json
{
  "accountId": "acme-fashion",
  "headline": "Vestido longo para casamento — elegância que dura a noite toda",
  "primaryText": "Tecidos nobres, caimento impecável e parcelamento em até 6x sem juros. Frete grátis para todo Brasil em compras acima de R$ 499.",
  "cta": "SHOP_NOW",
  "landingPageUrl": "https://exemplo.com/vestido-casamento",
  "productOrOffer": "Vestido longo bordado para casamento",
  "imageDescription": "Mulher usando vestido longo bordado dourado em ambiente externo elegante"
}
```

**Output (resumido):**
```json
{
  "ok": true,
  "data": {
    "productCategory": "Fashion / Apparel",
    "intent": "purchase",
    "funnelStage": "decision",
    "audienceProbable": ["mulheres 25-45 ...", "..."],
    "audienceToAvoid": ["Atributos protegidos ...", "Menores de 18 ..."],
    "recommendedObjective": "OUTCOME_SALES",
    "recommendedCta": "SHOP_NOW",
    "recommendedPlacements": ["facebook:feed", "instagram:feed", "instagram:reels"],
    "copySuggestions": ["...", "...", "..."],
    "abTestPlan": ["..."],
    "metricsToWatch": ["CTR", "CPM", "Frequency", "CPA (Purchase)", "ROAS"],
    "optimizationPlan": { "after3Days": [...], "after7Days": [...], "after14Days": [...] },
    "policyBlocked": false,
    "disclaimer": "These suggestions are heuristic..."
  }
}
```

## 3. recommend_campaign_optimizations (gera apenas plano)

**Input:**
```json
{
  "accountId": "acme-fashion",
  "campaignId": "23851234567890",
  "currentDailyBudget": 100,
  "metrics": {
    "spend": 720, "impressions": 50000, "reach": 35000, "clicks": 800,
    "ctr": 0.016, "cpc": 0.9, "cpm": 14.4, "frequency": 2.6, "conversions": 8, "cpa": 90
  },
  "goals": { "maxCpa": 60, "minRoas": 2.5, "minCtr": 1.2, "maxFrequency": 3 }
}
```

**Output (resumido):** lista de `Recommendation` com `requiresApproval: true` para qualquer mudança de orçamento.

## 4. apply_budget_change (mutação real — exige confirmação)

```json
{
  "accountId": "acme-fashion",
  "adSetId": "23859876543210",
  "currentDailyBudget": 100,
  "newDailyBudget": 85,
  "confirm": true,
  "reason": "CPA 50% acima da meta há 5 dias consecutivos, sem sinal de recuperação",
  "requestedBy": "user:operator",
  "dryRun": false
}
```

Sem `confirm=true` + `dryRun=false`, retorna apenas o `plan` sem chamar a API:

```json
{ "ok": true, "data": { "dryRun": true, "plan": { "from": 100, "to": 85, "changePct": -15 } } }
```

## 5. publish_campaign (sempre cria com status PAUSED)

```json
{
  "accountId": "acme-fashion",
  "draftId": "cdraft_xxxxxxxx",
  "confirm": true,
  "reason": "Aprovado pela equipe — lançamento da coleção primavera",
  "requestedBy": "user:operator",
  "dryRun": false
}
```

## 6. validate_meta_policy_risk

```json
{
  "accountId": "acme-fashion",
  "copy": "Garantia de resultado em 7 dias! Empréstimo aprovado na hora.",
  "targeting": {
    "geoLocations": { "countries": ["BR"] },
    "interests": [{ "id": "60001", "name": "religion: catholic" }]
  }
}
```

Resposta: `blocked: true` (targeting em atributo protegido) + findings explicando.
