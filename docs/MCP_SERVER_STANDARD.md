# Padrão de engenharia para MCP Servers

Este documento complementa o `AGENTS.md` com decisões técnicas reutilizáveis.
Regras de segurança específicas de um domínio continuam no `AGENTS.md` do
respectivo servidor.

## Fluxo de uma invocação

Uma tool deve atravessar, nesta ordem:

1. validação estrita e normalização limitada da entrada;
2. resolução de contexto, identidade e configuração;
3. classificação de risco e guardas de autorização/confirmação;
4. execução com timeout, cancelamento, limite de concorrência e retry seguro;
5. validação e limitação da saída;
6. auditoria estruturada e redigida;
7. resposta MCP com erro acionável ou `structuredContent` validado.

Guardas compartilhadas devem envolver o handler no registro da tool. Evite
depender de cada handler lembrar de aplicar auditoria, timeout ou redação.

## Contrato e risco

Use o manifesto canônico e os helpers de `@gustapaes/mcp-runtime` sempre que a
stack permitir.

| Classe | Efeito típico | Confirmação padrão |
|---|---|---|
| `READ` | Consulta sem segredo | Não |
| `LOCAL_STATE` | Estado local reversível | Não, se solicitado |
| `EXECUTION` | Dispara execução sem editar definição | Não, se alvo e intenção estiverem explícitos |
| `REMOTE_WRITE` | Cria ou altera estado de terceiro | Prévia proporcional ao impacto |
| `DESTRUCTIVE` | Exclui, revoga ou sobrescreve | Sim, vinculada ao alvo exato |
| `SECRET_READ` | Retorna credencial ou material sensível | Sim e com resposta minimizada |

Uma tool pode exigir proteção maior conforme ambiente, alcance ou custo. Nunca
reduza uma classe de risco usando apenas o nome da operação.

## Limites mínimos

Cada servidor define valores adequados ao provedor, mas deve possuir:

- máximo de caracteres por string e de itens por array;
- paginação com limite padrão e máximo;
- timeout por chamada e orçamento total de retry;
- máximo de bytes da resposta e indicação de truncamento;
- limite de corpo e de sessões no transporte HTTP;
- limite de concorrência por identidade ou provedor;
- quota, duração e retenção para artefatos persistidos.

Não faça retry automático de criação, publicação, fila ou comentário sem
idempotência. Para `429` e falhas transitórias seguras, respeite `Retry-After` e
use backoff exponencial com jitter.

## Arquivos, rede e credenciais

- Resolva caminhos contra raízes permitidas e valide o caminho físico após
  symlinks. Use uma raiz dedicada para uploads.
- Bloqueie `.env`, chaves privadas, storage state, cookies, perfis e outros
  nomes sensíveis mesmo dentro da raiz permitida.
- Restrinja egress por protocolo e host ao encaminhar tokens. Revalide
  redirecionamentos e resolução DNS; bloqueie metadata de nuvem e redes privadas
  quando elas não forem parte explícita da capacidade.
- Retorne segredo somente pelo menor tempo e alcance possíveis. Nunca grave o
  valor em auditoria, erro, cache ou resposta de diagnóstico.

## Estado e auditoria

Gravações JSON devem ser atômicas. Uma sequência leitura-modificação-gravação
também precisa de fila serial, transação ou revisão otimista; gravação atômica
isolada não impede perda de atualização.

Registros de auditoria devem incluir correlation ID, tool, classe de risco,
identidade lógica, alvo sanitizado, duração, resultado e motivo da falha. A
política do servidor define retenção e se uma mutação crítica falha fechada
quando a auditoria não puder ser persistida.

## Testes de contrato

Além dos testes de domínio, valide automaticamente:

- correspondência exata entre tools, handlers e políticas;
- rejeição de campos desconhecidos e limites máximos;
- annotations derivadas da classe de risco;
- conformidade de `structuredContent` com `outputSchema`;
- dry-run, confirmação e expiração da prévia;
- timeout, cancelamento, retry e idempotência;
- concorrência de armazenamento e revisão obsoleta;
- traversal, symlink, SSRF, redirect e redação;
- autenticação, TTL e encerramento do transporte HTTP.

Use dados sintéticos e provedores simulados. Testes não devem depender de uma
conta, tenant, assinatura, projeto ou browser profile real.

## Critério de entrega

Durante a implementação, execute `npm run validate:fast` na raiz. Antes da pull
request, execute `npm run validate`, o smoke test do transporte aplicável,
`git diff --check` e a varredura de segredos. Uma tool nova só está concluída
quando contrato, risco, documentação e testes evoluem juntos.
