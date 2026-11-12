# Grafana MCP

Servidor MCP genérico de leitura para analisar dashboards locais ou remotos e
sugerir candidatos a alertas. Retorna metadados limitados; queries, configurações
de datasource e credenciais não fazem parte do resultado.

## Instalação

Requer Node.js >=20.19.0. Nesta pasta:

```sh
npm ci --workspaces=false
cp .env.example .env
npm test
npm start
```

No PowerShell, use `Copy-Item .env.example .env`. Cadastre no cliente MCP um
comando `node` com o caminho absoluto de `grafana-mcp/index.js`. O `.env` é
carregado a partir da pasta do servidor, independentemente do diretório do cliente.
Não passe tokens em argumentos. Mantenha a credencial em um arquivo local privado.

## Configuração e segurança

`GRAFANA_URL` é a raiz do Grafana, incluindo eventual subpath. Use HTTPS;
HTTP é aceito somente em loopback para desenvolvimento. `GRAFANA_TOKEN` deve
ser uma credencial com acesso mínimo de leitura aos dashboards necessários.
Saúde pública não comprova autenticação. A tool remota por UID verifica o acesso
ao dashboard solicitado. Somente duas rotas GET fixas são permitidas; redirects
são rejeitados e não há retries automáticos. Cada requisição tem timeout
configurável de 100 a 30000 ms e resposta máxima de 2 MB. Uma chamada é atendida
por vez; concorrência retorna `BUSY_RETRY_LATER`.

Para análise local, URL e token são opcionais. Crie `local-private/exports/` e
coloque os JSONs ali, ou defina outra raiz dedicada em `GRAFANA_EXPORT_ROOT`.
Use somente nomes relativos à raiz. Caminhos que escapam da raiz, inclusive por
symlink, e nomes de arquivos de segredo/configuração são recusados. Documento
acima de 2 MB, dashboard com mais de 200 painéis, 20 targets por painel ou dez
níveis falha explicitamente. Não coloque credenciais na raiz de exports.

Resultados podem conter títulos de dashboards e painéis: são dados privados do
ambiente em execução. Não os publique automaticamente. O servidor não grava
payloads, tokens ou argumentos em logs. Auditoria em stderr contém somente nome
da tool, classe de risco, correlation ID, duração e status. Erros retornam códigos sem mensagens do
provedor. `GRAFANA_URL_REQUIRED` e `GRAFANA_TOKEN_REQUIRED` indicam configuração
ausente; `GRAFANA_HTTP_401/403` indicam revisão da credencial/permissão;
`GRAFANA_OPERATION_FAILED` exige conferir formato e disponibilidade do export.

## Contrato

| Tool | Entrada | Resultado |
| --- | --- | --- |
| `grafana_health` | `{}` | Versão e estado do banco reportados pela API pública |
| `analyze_remote_grafana_dashboard` | `uid` | Resumo do dashboard remoto |
| `analyze_grafana_dashboard_export` | `file` | Resumo de export local |
| `suggest_grafana_alert_candidates` | `file` | Candidatos, bloqueios e avisos |

As entradas são estritas. Saídas usam `data` e `meta`, com schema validado antes
da resposta. Todas as tools são `READ`, idempotentes e não destrutivas. As
sugestões exigem revisão humana e preview no Grafana antes de criar uma regra.

## Migração

Este é um servidor novo e genérico. Não substitua automaticamente servidores
privados que tenham tools de investigação específicas. Os quatro nomes de
análise de dashboards foram preservados, mas o resultado usa o envelope
`data/meta` e projeção limitada. Perfis SQL, topologias, runbooks, instaladores
e configurações de organizações devem permanecer em `local-private/`.
