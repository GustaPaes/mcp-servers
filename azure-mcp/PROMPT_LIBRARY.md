# Prompt Library — azure-mcp

Curadoria de prompts práticos em português para usar com as tools `azmcp_*` do Azure MCP Server.

> Use os prompts abaixo no **GitHub Copilot Chat (Agent mode)**. O agente seguirá a política de [`AGENTS.md`](./AGENTS.md), pedindo confirmação antes de operações mutativas/destrutivas.

---

## Índice por serviço

- [Contexto / bootstrap](#contexto--bootstrap)
- [Subscriptions e Resource Groups](#subscriptions-e-resource-groups)
- [Storage (Blob, Queue, Table, File)](#storage-blob-queue-table-file)
- [Key Vault](#key-vault)
- [Cosmos DB](#cosmos-db)
- [SQL Database / MySQL / PostgreSQL](#sql-database--mysql--postgresql)
- [App Service](#app-service)
- [Container Apps / AKS / ACR](#container-apps--aks--acr)
- [Azure Functions](#azure-functions)
- [Compute (VM / Disk / VMSS)](#compute-vm--disk--vmss)
- [Monitor / Log Analytics / Application Insights](#monitor--log-analytics--application-insights)
- [Service Bus / Event Hubs / Event Grid](#service-bus--event-hubs--event-grid)
- [Redis Cache](#redis-cache)
- [AI Search](#ai-search)
- [Microsoft Foundry / AI Services](#microsoft-foundry--ai-services)
- [Backup e Recovery Services](#backup-e-recovery-services)
- [RBAC / Roles](#rbac--roles)
- [Cost Management e Advisor](#cost-management-e-advisor)
- [Networking](#networking)
- [Diagnóstico e troubleshooting](#diagnóstico-e-troubleshooting)

---

## Contexto / bootstrap

```text
Mostre meu contexto Azure atual: tenant, subscription, usuario logado e cloud.
```

```text
Liste todas as subscriptions que tenho acesso, organizadas por tenant.
```

```text
Mude o contexto para a subscription "example-dev" e confirme.
```

---

## Subscriptions e Resource Groups

```text
Liste todos os resource groups da subscription atual com suas localizacoes e tags.
```

```text
Quais resource groups nao tem tag "owner"? Liste e proponha um plano para corrigir.
```

```text
Mostre todos os recursos do resource group "rg-example-app-dev" agrupados por tipo.
```

```text
Crie um novo resource group "rg-example-poc-mcp" em "brazilsouth" com tags owner=platform, env=poc.
```

---

## Storage (Blob, Queue, Table, File)

```text
Liste todas as storage accounts da subscription "example-dev" e mostre o tier de cada uma.
```

```text
Liste os containers da storage account "stexamplelogs" e seu nivel de acesso publico.
```

```text
Liste os ultimos 50 blobs do container "uploads" da storage account "stexampleapp".
```

```text
Verifique se alguma storage account tem "Allow public blob access" habilitado e me alerte.
```

```text
Liste os nomes das connection strings da storage account "stexampleappdev" e mostre valores mascarados. Se eu pedir o valor real depois, exija justificativa e confirme o contexto Azure antes.
```

```text
Habilite soft-delete em blobs com retention de 7 dias na storage account "stexampleappdev".
```

---

## Key Vault

```text
Liste todos os Key Vaults da subscription atual com soft-delete e purge protection.
```

```text
Liste os secrets do vault "kv-example-app-dev" (apenas nomes, sem valores).
```

```text
Verifique se o secret "DbConnectionString" existe no vault "kv-example-app-dev" sem revelar o valor. Se eu pedir o valor real depois, exija justificativa explícita e mascare ao resumir.
```

```text
Quais Key Vaults tem soft-delete DESABILITADO? Liste e proponha plano de remediacao.
```

```text
Liste as policies de acesso do vault "kv-example-app-prod" e me mostre quem tem permissao de delete.
```

---

## Cosmos DB

```text
Liste minhas contas Cosmos DB e mostre throughput/consistency level de cada uma.
```

```text
Liste os databases e containers da conta "cosmos-example-app-dev".
```

```text
Mostre as 10 ultimas particoes mais quentes do container "events" no database "cargo".
```

```text
Execute esta query no Cosmos: SELECT TOP 5 * FROM c WHERE c.tipo = 'pedido'
```

---

## SQL Database / MySQL / PostgreSQL

```text
Liste meus servidores SQL e o tier de cada database.
```

```text
Mostre as regras de firewall do servidor SQL "sql-example-app-dev".
```

```text
Tem alguma regra de firewall com 0.0.0.0/0? Quais servidores?
```

```text
Liste os databases PostgreSQL da subscription e a versao do engine.
```

---

## App Service

```text
Liste todos os web apps da subscription com status, runtime e plan.
```

```text
Mostre as application settings do web app "app-example-api-dev" (mascarando secrets).
```

```text
Adicione a app setting "LogLevel=DEBUG" no web app "app-example-api-dev".
```

```text
Liste os ultimos 10 deployments do web app "app-example-api-dev".
```

```text
Reinicie o web app "app-example-api-dev" depois de me confirmar o impacto.
```

---

## Container Apps / AKS / ACR

```text
Liste meus container apps e mostre replica count e revision atual.
```

```text
Liste meus AKS clusters, versao do Kubernetes e node pools.
```

```text
Liste meus container registries (ACR) e os repositorios de cada um.
```

```text
Mostre as tags da imagem "example-api" no ACR "acrexampleapp".
```

```text
Quais imagens no ACR "acrexampleapp" nao foram puxadas nos ultimos 90 dias?
```

---

## Azure Functions

```text
Liste minhas Function Apps e o estado de cada uma.
```

```text
Mostre as funcoes da Function App "func-example-jobs" e o gatilho de cada uma.
```

---

## Compute (VM / Disk / VMSS)

```text
Liste todas as VMs da subscription com size, OS, power state.
```

```text
Para a VM "build-agent-01", mostre tenant, subscription, resource group e power state atual. Se eu confirmar, use o padrao do workspace para ligar ou desligar com deallocate.
```

```text
Quero agendar a VM "build-agent-01" para ligar as 08:00 no horario local e desligar com menor custo as 18:00. Use o padrao do workspace: Scheduled Task local para start e Azure auto-shutdown para stop, e me mostre o plano antes de aplicar.
```

```text
Quais VMs estao paradas (deallocated) ha mais de 30 dias?
```

```text
Liste os managed disks que nao estao anexados a nenhuma VM (orphan disks) e o custo mensal estimado.
```

```text
Mostre as VMs sem backup configurado.
```

---

## Monitor / Log Analytics / Application Insights

```text
Liste meus Log Analytics workspaces e o retention de cada um.
```

```text
Execute esta query KQL no workspace "law-example-app": AzureActivity | where TimeGenerated > ago(1h) | take 50
```

```text
Quais erros 5xx aconteceram no Application Insights "appi-example-api" nas ultimas 6h?
```

```text
Liste os alerts configurados na subscription e quais estao em estado "Fired".
```

```text
Mostre as activity logs de DELETE feitas na subscription nas ultimas 24h e por quem.
```

---

## Service Bus / Event Hubs / Event Grid

```text
Liste meus Service Bus namespaces, queues e topics.
```

```text
Quantas mensagens estao na DLQ da queue "pedidos-pendentes" no namespace "sb-example-app"?
```

```text
Liste meus Event Hubs e a particao count de cada um.
```

```text
Liste os topicos do Event Grid e as subscriptions de cada um.
```

---

## Redis Cache

```text
Liste minhas instancias Redis e o tier/sku de cada uma.
```

```text
Mostre o uso de memoria do Redis "redis-example-app-prod" nas ultimas 24h.
```

---

## AI Search

```text
Liste meus servicos Azure AI Search e os indexes de cada um.
```

```text
Mostre o schema do index "produtos" no servico "srch-example-app".
```

```text
Faca uma busca por "frete urgente" no index "pedidos" do servico "srch-example-app".
```

---

## Microsoft Foundry / AI Services

```text
Liste os modelos disponiveis no Microsoft Foundry e os deployments ativos.
```

```text
Liste meus agents do Foundry e a configuracao de cada um.
```

```text
Crie um deployment do modelo "gpt-4.1" com 10 TPM no projeto Foundry "foundry-example-poc".
```

---

## Backup e Recovery Services

```text
Liste meus Recovery Services Vaults e politicas de backup.
```

```text
Quais recursos da subscription "example-prod" estao SEM backup?
```

```text
Mostre os recovery points do item de backup "vm-example-api" no vault "rsv-example-app".
```

```text
Habilite cross-region restore no vault "rsv-example-app-prod".
```

---

## RBAC / Roles

```text
Quem tem role "Owner" na subscription atual? Liste com tipo (User/Group/SP) e ultimo login (se possivel).
```

```text
Liste todos os role assignments do resource group "rg-example-app-prod".
```

```text
Quais Service Principals tem permissao de "Contributor" em qualquer escopo da subscription?
```

```text
Atribua a role "Reader" para o usuario owner@example.com no resource group "rg-example-app-poc".
```

---

## Cost Management e Advisor

```text
Liste minhas recomendacoes do Azure Advisor agrupadas por categoria (cost, security, reliability, performance).
```

```text
Mostre as 10 recomendacoes de COST com maior economia potencial.
```

```text
Quais sao os 10 recursos que mais gastaram no mes passado nesta subscription?
```

---

## Networking

```text
Liste minhas Virtual Networks e os subnets de cada uma.
```

```text
Mostre as NSG rules da subnet "snet-app" da vnet "vnet-example-app-prod".
```

```text
Tem alguma NSG rule permitindo SSH (porta 22) de "Internet" / "Any"? Liste.
```

```text
Liste meus Public IPs e a quais recursos estao associados.
```

---

## Diagnóstico e troubleshooting

```text
Use o Azure App Lens para diagnosticar problemas no web app "app-example-api-prod".
```

```text
Mostre os health events ativos da subscription (Resource Health).
```

```text
Por que a VM "vm-example-jobs" reiniciou nas ultimas 24h? Verifique activity log e metricas.
```

```text
Gere o comando az CLI equivalente para criar um App Service Plan B2 em "brazilsouth".
```

---

## Combos com tfs-mcp

Como os dois MCPs convivem, dá para fazer fluxos cruzados:

```text
1) No TFS, busque o PBI 12345 (use tfs-mcp).
2) Liste no Azure os recursos relacionados ao servico mencionado no PBI.
3) Verifique se ha alertas ativos no Application Insights desse servico.
4) Resuma o estado e proponha proximos passos.
```

```text
Pegue o ultimo PR mergeado do repo X (tfs-mcp) e verifique se o deploy correspondente
no Azure (app service / container app) esta com a mesma versao em produçao.
```

