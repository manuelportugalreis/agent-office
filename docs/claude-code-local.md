# Modo "Claude Code local"

Os agentes do escritório podem trabalhar como o Claude Code no teu terminal: na pasta do projeto, com as tuas
definições, hooks, regras de permissão, ferramentas e integrações MCP e com o teu Obsidian. Fazem-no dentro de um
**perfil de acesso** que defines por projeto. O servidor continua local (127.0.0.1).

## 1. Auditoria: o que o escritório fazia e o que muda

Claude Code instalado: **2.1.318**. A comparação foi feita com uma sessão de terminal aberta na mesma pasta.

| Capacidade                      | Terminal (`claude` na pasta)       | Escritório antes                                                   | Modo Claude Code local                                                                                                                              |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pasta de trabalho               | a do projeto                       | `server/workspaces/<agente>`                                       | a do perfil                                                                                                                                         |
| Tuas definições, hooks, plugins | sim (`user,project,local`)         | não (`local,project` da pasta do agente)                           | sim (`user,project,local`)                                                                                                                          |
| Regras de permissão             | as tuas, com perguntas interativas | `dontAsk`: o que não estava na lista era recusado sem te perguntar | as tuas; as perguntas aparecem na app (`--permission-prompt-tool stdio`)                                                                            |
| Terminal (Bash/PowerShell)      | sim                                | não                                                                | conforme o perfil                                                                                                                                   |
| MCP                             | todas as configuradas              | nenhuma (`--strict-mcp-config`)                                    | as escolhidas no perfil, ou todas                                                                                                                   |
| Ficheiros                       | onde o Claude Code deixar          | só a pasta do agente e o vault (fs-guard)                          | pastas de leitura/escrita do perfil (local-guard)                                                                                                   |
| Obsidian                        | como ficheiros                     | leitura e escrita do vault inteiro, sem salvaguardas               | encontrar por título/alias, links resolvidos, escrita só nas pastas autorizadas, frontmatter e links protegidos, reescritas grandes mostradas antes |
| Sessões                         | `--resume`                         | uma por agente                                                     | uma por agente **e** por perfil; continuar no terminal com o mesmo perfil                                                                           |
| Atlas a delegar                 | n/a                                | cada agente com as suas ferramentas                                | a equipa herda exatamente o perfil da ordem (cópia congelada)                                                                                       |

O que exigia outra integração (e foi feito):

- **Perguntas de permissão.** No modo `-p`, sem um "host" que responda, tudo o que pediria autorização é recusado.
  Isto confirmou-se no terminal: o agente pediu três vezes para correr os testes e foi recusado. A integração usa o
  protocolo de controlo do Claude Code: `--input-format stream-json`, `--permission-prompt-tool stdio` e pedidos
  `can_use_tool` respondidos por ti na app.
- **Terminal interativo.** "Continuar no terminal" gera um script de PowerShell com os mesmos argumentos do perfil e
  `--resume <sessão>`, e abre-o numa janela nova.

## 2. Como usar

1. Num agente (Resumo → **Modo de trabalho**), carrega em **Perfis…** e cria um perfil com:
   - a pasta de trabalho (onde abririas o terminal);
   - pastas extra de leitura e de escrita;
   - o Obsidian (sem acesso, só leitura, ou leitura e escrita nas pastas que indicares);
   - comandos de terminal (sim ou não);
   - aceitar edições sem perguntar;
   - as MCP a usar.
2. Escolhe **Claude Code local** e o perfil. O painel mostra a pasta efetiva e o acesso.
3. Fala com o agente no chat, ou dá uma ordem ao Atlas na barra de baixo. Se o Atlas estiver em modo local, a ordem
   corre no perfil dele e a equipa herda esse acesso e só esse.
4. Quando o Claude Code pediria autorização, aparece um cartão **Pedidos de autorização**. Mostra o comando completo,
   ou as diferenças da nota ou do ficheiro, e tens **Permitir** e **Recusar**. Sem resposta em 15 minutos é recusado.
   **Parar tarefa** recusa o que estiver pendente.
5. No fim de cada tarefa local, o painel mostra o rasto registado pelo servidor: ficheiros alterados, comandos e
   recusas. **Continuar no terminal** abre a sessão no PowerShell com o mesmo perfil.

## 3. Limites que o perfil impõe (e quem os impõe)

- `server/hooks/local-guard.mjs` é um hook PreToolUse com uma política escrita pelo servidor. Faz o seguinte:
  - ficheiros só nas pastas do perfil;
  - nunca `.claude*`, `.git`, `.obsidian`, `.mcp.json` nem `CLAUDE.local.md`;
  - comandos que falem com a porta do Agent Office são bloqueados;
  - nas notas do vault, não se apaga o frontmatter nem os seus campos;
  - tirar links (wiki e Markdown), secções, aliases ou tags, reordenar secções, ou mudar mais de 35% das linhas da
    nota original (somando as edições da corrida) obriga a uma pergunta com as alterações propostas;
  - qualquer erro no guard bloqueia.
- `server/hooks/vault-mcp.mjs` é um MCP só de leitura. `find_note` procura por título ou alias (sem acentos nem
  maiúsculas); `read_note` devolve o frontmatter, as secções, os links resolvidos para caminhos e as notas que apontam
  para esta. Fica confinado ao vault real e fora de pastas escondidas.
- `server/src/profiles.ts` valida os perfis. As pastas têm de existir. Não são aceites:
  - a raiz do disco;
  - a pasta pessoal inteira;
  - `~/.claude`;
  - a pasta do Agent Office;
  - a pasta temporária das corridas;
  - pastas do vault que, por atalho, apontem para fora dele.

  As MCP vêm só da tua configuração em `~/.claude.json`, nunca do `.mcp.json` do projeto (que o agente poderia
  escrever).

- O conteúdo de ficheiros, notas, páginas, anexos e respostas de colegas é sempre dado e nunca instrução. O acesso vem
  só do servidor: o plano do Atlas não tem campos de acesso, e a corrida usa uma cópia congelada do perfil.

## 4. Diferenças que ficam em relação ao terminal

Ver o registo de verificação abaixo (secção 6) para o que foi testado com agentes reais.

- **Comandos de terminal não ficam presos às pastas do perfil.** No Windows não há sandbox do Claude Code para o Bash.
  Cada comando passa pelas tuas regras e, se não estiver autorizado por elas, pela pergunta na app, com o comando
  completo como título. Se as tuas definições já autorizam comandos amplos (ex.: `Bash(*)`), o perfil não os impede.
  Um agente com terminal tem os teus privilégios de utilizador, como no terminal.
- **O servidor confia em qualquer ligação local com a origem certa.** Um processo local pode falsificar os cabeçalhos
  Origin e Host. O guard bloqueia comandos que mencionem a porta do escritório, e cada comando passa pela tua
  aprovação, mas um comando ofuscado que tu aproves pode contornar isto. Recusa comandos que não percebas.
- **Definições do projeto.** Com `user,project,local`, o `.claude/settings.json` do projeto conta, como no terminal.
  No modo `-p` não há o diálogo de confiança de pastas novas: usa perfis só em pastas tuas.
- **Diferenças de interface.** No modo local não há:
  - comandos de barra (`/`) nem atalhos do terminal;
  - os pedidos `AskUserQuestion` interativos;
  - escolher "permitir sempre" a partir do cartão: as regras permanentes continuam a ser as das tuas definições.
- **No terminal (continuar)** valem as perguntas do próprio terminal; as aprovações da app deixam de se aplicar a
  essa janela.

## 5. Playbooks dos papéis

O método, a evidência, a entrega e a definição de concluído de cada papel estão em `server/src/agents.ts`
(`PLAYBOOKS`). Valem no modo escritório e no modo local.

- **Atlas:** define o resultado e o critério de conclusão e delega com contexto concreto e com o acesso da ordem.
  Quando há ficheiros alterados pede sempre a revisão da Nina; o orquestrador garante-a, mesmo que o plano a esqueça.
  O resumo é escrito a partir do rasto registado pelo servidor e organizado em Feito e verificado / Por verificar ou
  falhou / Precisa da tua decisão.
- **Mira:** procura a fonte primária e cita cada facto. Entrega um brief com Factos confirmados, Indícios, Por
  confirmar e Fontes.
- **Lena:** escreve um rascunho utilizável a partir de fontes verificadas e marca os factos em falta com
  `[PREENCHER: …]`. Quando lhe pedem, atualiza a nota com Edit e diz o caminho.
- **Nina:** revê o ficheiro em disco, corre a verificação local quando a há, e cita cada defeito com a correção. O
  veredicto é aprovado ou precisa de correção.

## 6. Registo de verificação (2026-11-05/06)

Ambiente descartável em `C:\Users\manue\agent-office-e2e`: projeto `projeto-calc` com `npm test`, vault com
`Projetos/Calc brief.md`, uma nota de injeção e uma pasta `fora`. Instância isolada do servidor na porta 8797, com base
de dados, áreas de trabalho e configuração próprias. A tua instância e o teu vault não foram tocados. A interface foi
conduzida pelo browser (`scripts/local-e2e.mjs`) e todas as mensagens do servidor foram registadas.

| Cenário                                                        | Como                                          | Resultado                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Perfil, modos e painel                                         | interface real                                | perfil criado no editor; Atlas, Mira, Lena e Nina em modo local; o painel mostra a pasta e o acesso; a barra de ordens indica o perfil                                                                                                                                                                    |
| Perfil numa pasta proibida                                     | interface real                                | recusado: "a pasta de configuração do Claude Code não pode ser usada" (`~/.claude`)                                                                                                                                                                                                                       |
| Tarefa ponta a ponta: ordem ao Atlas                           | **agentes reais**                             | Atlas delegou à Rhea com o acesso do perfil; pedidos reais na app (`npm test` e a edição da nota com o diff) permitidos; só a secção Estado mudou; a Nina reviu a nota em disco, voltou a correr `npm test` e aprovou; o resumo do Atlas baseia-se no rasto                                               |
| A mesma tarefa no terminal (`claude -p` na pasta)              | agente real                                   | sem quem aprove, os pedidos são recusados e o agente não verificou nada (disse-o); com as ferramentas autorizadas, resultado equivalente ao do escritório (31 a 33 s e 0,09 USD no terminal; cerca de 1,5 min e 0,67 USD no escritório, com plano, revisão independente e resumo)                         |
| Nota a pedir mais acesso, ordem a pedir escrita fora do perfil | **agentes reais** (interrompido)              | a Rhea recusou os dois pedidos da nota e disse-o; o plano do Atlas não delegou a escrita fora do perfil; a pasta `fora` ficou vazia; a revisão da Nina ficou a meio quando o sistema parou os processos por falta de memória                                                                              |
| Recusa de uma autorização                                      | testes + sonda do protocolo                   | `git log` não pede autorização (o Claude Code trata comandos só de leitura como seguros), por isso a recusa não foi exercida com agente real. A recusa por stdio foi verificada na sonda inicial (Write recusado, o agente reportou-o), e o hub tem testes para recusar, para o tempo-limite e para parar |
| Recarregar com uma autorização pendente e retomar a sessão     | **por fazer com agente real**                 | coberto por testes: pedidos pendentes reenviados ao ligar, uma sessão por agente e perfil, `--resume` com os mesmos argumentos do perfil. Os perfis e os modos sobreviveram a reinícios do servidor de teste                                                                                              |
| Guards, MCP do vault, perfis, delegação                        | testes unitários (`server/src/local.test.ts`) | 21 testes, incluindo todas as correções das revisões                                                                                                                                                                                                                                                      |
| `npm run check`                                                |                                               | passa (118 + 211 testes, lint, prettier, build)                                                                                                                                                                                                                                                           |

Revisões independentes: dois subagentes do Claude Code (segurança do runner; fluxo do Obsidian) e o Codex 0.160.1, em
modo só de leitura. Corrigido a seguir:

- diff truncado;
- BOM no frontmatter;
- links Markdown e contagens de links;
- ordem das secções;
- reescritas feitas em várias edições pequenas;
- symlinks no vault;
- `.mcp.json` do projeto (deixou de ser lido e passou a estar protegido);
- guard a falhar fechado;
- nomes protegidos com pontos no fim;
- pasta temporária das corridas fora dos perfis;
- `claude.exe` resolvido só pelo PATH;
- título dos pedidos = comando completo;
- terminal retomado com o mesmo perfil;
- sessões da interface por perfil.

Ficou documentado como limite (secção 4): comandos de terminal com os teus privilégios e confiança em ligações locais.
