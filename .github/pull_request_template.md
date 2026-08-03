## Objetivo

<!-- Descreva a capacidade genérica entregue e o motivo técnico. -->

## Validação

- [ ] Executei os testes focados do servidor alterado.
- [ ] Executei `npm run validate:fast` na raiz.
- [ ] Executei build, lint, typecheck e smoke test aplicáveis.
- [ ] Executei `git diff --check` e a varredura de segredos disponível.

## Contrato e segurança

- [ ] Tools, handlers, políticas de risco e documentação permanecem sincronizados.
- [ ] Entradas, saídas, timeouts, paginação e artefatos possuem limites explícitos.
- [ ] Mutações possuem dry-run, prévia, idempotência e confirmação proporcionais ao impacto.
- [ ] Logs, erros, auditoria e exemplos não expõem credenciais ou identificadores reais.
- [ ] Conteúdo específico de uma organização permanece em `local-private/`.
- [ ] Alterações incompatíveis possuem migração ou depreciação documentada.

## Riscos remanescentes

<!-- Informe riscos objetivos ou escreva "Nenhum conhecido". -->
