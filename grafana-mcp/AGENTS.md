# Grafana MCP

- O manifesto em `src/server.js` é a fonte de nomes, schemas, handlers, risco e annotations.
- Todas as tools são `READ`; este servidor usa somente stdio e não executa SQL,
  consultas de datasource, alterações de dashboards ou criação de alertas.
- Credenciais ficam em `.env`. Exports e configuração de instalações ficam em
  `local-private/`; use somente fixtures sintéticas nos testes.
- Autenticação só é encaminhada para as rotas fixas da URL configurada. Não
  permita redirecionamentos ou URLs fornecidas por argumentos de tools.
- Mantenha os limites de 2 MB por documento, 200 painéis, 20 targets por painel
  e dez níveis de painéis. Excesso deve falhar explicitamente.
- Valide com `npm test` e `npm run lint`; o teste de protocolo é offline.
