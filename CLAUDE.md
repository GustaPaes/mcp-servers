# Instruções para Claude Code

Leia `AGENTS.md` antes de alterar este repositório e siga suas regras de
configuração local, segurança, validação, pull requests e branches.

Ao concluir uma mudança de configuração ou dependência:

1. Verifique os clientes MCP instalados e escolhidos pelo usuário. Atualize suas
   configurações locais ignoradas pelo Git e teste a conexão e as tools afetadas.
2. Revise todos os PRs e branches existentes. Integre mudanças úteis após
   validação, encerre PRs obsoletos com motivo e remova branches sem trabalho
   pendente, respeitando as proteções descritas em `AGENTS.md`.
3. Confirme `main` atualizado, refs remotas limpas e nenhum dado local no Git.

Não presuma que um servidor disponível no repositório deve ser habilitado em
todos os clientes. Nunca publique credenciais ou identificadores locais.
