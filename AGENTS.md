# AGENTS.md — Diretrizes para os MCP Servers

Estas instruções se aplicam a todo o workspace. Um `AGENTS.md` dentro de um
servidor pode acrescentar regras operacionais e de segurança do domínio, mas
não pode reduzir as exigências deste arquivo.

## Regra central

Todo conteúdo versionado deve ser genérico, configurável e reutilizável fora do
ambiente em que foi criado. Uma necessidade local só deve virar código
rastreado quando representar uma capacidade útil para outros usuários do mesmo
domínio.

- Não codifique regras, nomes ou fluxos que só façam sentido para uma empresa,
  cliente, equipe ou pessoa.
- Modele variações legítimas por configuração, variável de ambiente, perfil,
  adaptador ou argumento documentado.
- Mantenha o comportamento padrão neutro, seguro e funcional com dados de
  exemplo.
- Prefira nomes canônicos no formato `<dominio>-mcp`. Nomes de pacotes,
  servidores, tools e descrições devem comunicar a capacidade técnica, sem
  referências ao contexto que originou a implementação.

## Limite entre conteúdo versionado e local

Nunca versione segredos ou identificadores reais, incluindo tokens, senhas,
cookies, e-mails, URLs internas, tenants, subscriptions, compartments, OCIDs,
contas, projetos, repositórios, work items, campos de processos privados,
topologias, payloads exportados ou caminhos absolutos pessoais.

- Use `.env` para credenciais e segredos. Mantenha somente `.env.example` com
  valores fictícios e explicações seguras.
- Use `local-private/` para configurações, adaptadores, scripts, runbooks,
  testes, relatórios e automações específicos de uma organização. O diretório é
  ignorado pelo Git e pode ser subdividido em `config/`, `docs/`, `runbooks/`,
  `scripts/`, `tests/` e outras pastas necessárias.
- Dados e artefatos gerados em execução devem ficar nos diretórios ignorados
  definidos por cada servidor, como `data/`, `output/` ou `local-private/`.
- Quando uma automação tiver uma parte reutilizável e outra local, mantenha no
  código rastreado apenas o núcleo parametrizado. A configuração ou o wrapper
  específico deve ficar em `local-private/`.
- Não use `git add -f` para contornar essas proteções.

Exemplos rastreados devem usar valores inequivocamente fictícios, como
`example.com`, `ExampleProject`, `example-repo`, `user@example.com` e IDs sem
relação com ambientes reais.

## Requisitos para novas capacidades

Antes de adicionar ou alterar uma tool, confirme que ela resolve um problema do
domínio e permanece útil sem acesso ao ambiente de origem.

- Defina entradas e saídas com contratos explícitos, validação estrita e erros
  acionáveis. Rejeite campos desconhecidos quando isso não prejudicar evolução
  compatível do contrato.
- Exponha diferenças de provedor, processo ou instalação como configuração em
  vez de ramificações com nomes ou valores locais.
- Para operações mutativas, implemente prévia ou `dry_run`, confirmação
  explícita, auditoria e proteção adicional para alvos de alto impacto.
- Aplique limites de paginação, tamanho, concorrência e tempo de execução;
  redija segredos em logs e respostas.
- Restrinja leitura e escrita de arquivos a raízes permitidas pelo servidor.
- Evite dependências ou abstrações novas quando a capacidade puder ser entregue
  de forma simples com os padrões já adotados no projeto.

## Contrato canônico das tools

Cada servidor deve manter uma única fonte de verdade, em código ou manifesto,
para nome, descrição, schemas, annotations, handler e classe de risco de cada
tool. Inventários em documentação ou em `AGENTS.md` devem ser gerados ou
validados por teste contra esse contrato; listas manuais não podem ser a única
proteção contra divergência.

- Classifique cada tool explicitamente como `READ`, `LOCAL_STATE`, `EXECUTION`,
  `REMOTE_WRITE`, `DESTRUCTIVE` ou `SECRET_READ`. Não deduza a classe pela
  ausência em outra lista.
- Faça `readOnlyHint`, `destructiveHint`, `idempotentHint` e `openWorldHint`
  refletirem o comportamento real. Annotations são dicas para clientes, não
  substituem validações e proteções no servidor.
- Rejeite propriedades desconhecidas nas entradas públicas, exceto quando o
  contrato documentar intencionalmente um mapa extensível.
- Para respostas estáveis, exponha `outputSchema` e valide `structuredContent`.
  Prefira o envelope `data`, `meta`, `warnings` e `nextCursor`, omitindo campos
  que não se apliquem.
- Mudanças incompatíveis de nome ou schema exigem versão nova ou período de
  depreciação documentado e testado.

## Risco, confirmação e idempotência

- Confirme pelo impacto real, não apenas pelo fato de existir escrita. Leituras,
  estado local reversível e execuções explicitamente solicitadas podem seguir
  sem confirmação adicional quando não alterarem definição, permissão, custo
  configurado ou dados duráveis de terceiros.
- Edição remota deve apresentar alvo e resumo `antes/depois`; exclusão deve
  apresentar identidade e alcance exatos. A confirmação deve vincular-se à
  prévia exibida e expirar quando o contexto mudar.
- Proteções de alto impacto devem existir no servidor. Instruções ao agente não
  são um mecanismo de autorização.
- Operações não idempotentes não devem receber retry automático sem chave de
  idempotência, deduplicação ou comprovação de que a solicitação não chegou ao
  provedor.
- Use `expectedRevision`, ETag ou equivalente quando duas execuções puderem
  sobrescrever o mesmo estado. Leitura-modificação-gravação local deve ser
  serializada ou transacional.

## Limites, rede e observabilidade

- Toda chamada externa deve ter timeout, cancelamento e orçamento total de
  retries. Respeite `Retry-After`, aplique jitter e limite concorrência por
  provedor ou conta.
- Toda coleção, texto, payload e artefato deve ter padrão e máximo explícitos.
  Use paginação ou truncamento sinalizado; nunca carregue ou devolva conteúdo
  potencialmente ilimitado por padrão.
- Ao encaminhar credenciais, restrinja protocolo, host e origem. Servidores que
  navegam ou buscam URLs devem considerar redes privadas, metadata de nuvem,
  redirecionamentos e DNS rebinding em sua política de egress.
- Valide raízes de arquivos depois de resolver links simbólicos. Uploads e
  artefatos devem usar diretórios dedicados, quotas e retenção; negue arquivos
  de segredo mesmo quando estiverem dentro de uma raiz permitida.
- Centralize auditoria, correlation ID, duração e normalização de erros. Redija
  segredos antes de persistir ou responder. Se a auditoria de uma mutação
  crítica falhar, aborte a operação ou devolva falha explícita conforme a
  política documentada.
- Transporte HTTP deve iniciar em loopback, autenticar exposição remota, limitar
  corpo e sessões, renovar TTL por atividade e encerrar servidor e transports
  graciosamente.

## Documentação, exemplos e testes

- Documente a finalidade técnica, instalação, configuração, segurança e uso do
  servidor com linguagem neutra.
- Não descreva casos internos reais. Converta-os em cenários genéricos e
  sanitizados que ensinem a capacidade sem revelar sua origem.
- Testes e fixtures devem ser determinísticos e usar dados sintéticos. Nunca
  copie respostas reais de APIs, telas, tickets ou infraestrutura para o Git.
- Mantenha o `AGENTS.md` do servidor atualizado quando houver novas tools,
  classes de risco, requisitos de confirmação ou diretórios de dados privados.
- Evite repetir neste arquivo local as diretrizes globais; registre apenas as
  regras adicionais do servidor.
- Mantenha testes de contrato que enumerem todas as tools e verifiquem schema
  estrito, annotations, handler, classe de risco e contrato de saída.
- Cubra caminhos negativos de segurança, concorrência, timeout, retry,
  idempotência, confinamento de arquivos, redação e encerramento HTTP.
- Valide na inicialização números, enums e caminhos de configuração. Mantenha um
  teste de paridade entre variáveis consumidas e `.env.example`, avisando sobre
  chaves desconhecidas para detectar erros de digitação.

## Verificação antes do commit

1. Confirme que uma instalação nova consegue entender e configurar a capacidade
   sem conhecimento do ambiente de origem.
2. Revise arquivos staged e histórico recente em busca de segredos,
   identificadores, nomes internos, dados pessoais e caminhos locais.
3. Confirme com `git check-ignore` que dados específicos estão realmente
   protegidos antes de criá-los.
4. Execute os testes, lint, build e validações relevantes do servidor.
5. Execute `npm run doctor`, `npm run validate` e `git diff --check` na raiz
   quando os comandos estiverem disponíveis e forem aplicáveis à mudança.

## Pull requests e limpeza de branches

- Entregue mudanças em uma branch de trabalho por pull request para `main`;
  não envie commits diretamente para a branch padrão.
- Depois de abrir uma pull request pronta, habilite o auto-merge assim que os
  checks obrigatórios e as aprovações exigidas forem concluídos. Não ignore
  falhas, conflitos, revisões pendentes ou proteções da branch.
- Preserve commits separados com merge commit quando a divisão fizer parte da
  entrega. Respeite outro método de merge solicitado explicitamente pelo
  usuário ou exigido pelo repositório.
- Considere a entrega concluída somente após confirmar o merge em `main`, salvo
  quando o usuário pedir expressamente apenas a abertura da pull request.
- Mantenha habilitada no repositório a exclusão automática da branch de origem
  após o merge. Se a plataforma não a remover, exclua a branch remota e a branch
  local somente depois de comprovar que seu conteúdo está integrado em `main`.
- Após o merge, atualize `main` com fast-forward e remova referências remotas
  obsoletas com `git fetch --prune`.
- Nunca exclua `main`, branches com pull request aberta, branches não mergeadas,
  branches usadas por outro worktree ou branches cuja integração não possa ser
  comprovada.

Se uma implementação não atender a estes critérios, generalize-a antes de
versionar ou mantenha-a integralmente em `local-private/`.
