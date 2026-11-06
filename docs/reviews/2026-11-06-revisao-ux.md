# Revisão de UX, acesso e Lisboa (ramo `ordens-reais`)

O que se viu na demonstração publicada, o que se corrigiu e como se verificou na app a correr (porta separada, agentes
reais, vault descartável em `%TEMP%`, base de dados e pastas próprias).

## Problemas vistos e correções

| Problema                                                                             | Correção                                                                                                                                                                                      | Verificado                                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Clicar numa pessoa na cena não abria o painel (só o picker funcionava)               | As malhas realistas não tinham o id do agente: o raycast procura-o nos antepassados; ignora o que está escondido; perto de uma figura pequena, ganha a mais próxima no ecrã (`scene/pick.ts`) | Clique no tronco de cada pessoa: 2/11 antes, 11/11 depois (sentadas e a andar) |
| No modo andar não se via para onde se ia nem quando se chegava                       | Aviso "A ir ter com…" / "Chegaste: a conversa com … está aberta" e etiqueta 🚶 na pessoa (`ui/walk-status.ts`)                                                                                | Clique numa pessoa em modo andar: aviso, chegada e painel aberto               |
| Demo: chat desativado mas com sugestões, "Enviar ao CEO" ativo, dossier a convidar   | Na demo: aviso no chat com "Ver um exemplo de ordem" e "Instalar no meu computador"; barra de ordens passa a "▶ Ver exemplo"; formulário do dossier desativado com o mesmo caminho            | Exemplo corre na demo (a Mira anda mesmo; os passos ficam ✓)                   |
| Barra de cima a competir pela atenção                                                | À frente: a próxima ação (dossier) e "👥 Falar com…"; vista e preferências no menu "⚙ Vista"; aprovações dentro de "🔔 Precisa de ti"                                                         | Capturas da barra e do menu                                                    |
| Painel lateral vazio a ocupar espaço                                                 | Só aparece com alguém escolhido; × e Esc fecham-no                                                                                                                                            | Esc fecha o painel; o escritório usa a largura toda                            |
| Nome e função repetidos três vezes                                                   | O cabeçalho do painel tem nome e função; o chat mostra "Agora: tarefa"; as boas-vindas mostram o que pedir                                                                                    | Captura do chat                                                                |
| Fechar o dossier nem sempre devolvia o foco                                          | Volta ao botão que o abriu; se já não se vê, ao escritório                                                                                                                                    | Foco no botão depois de fechar                                                 |
| De dia, fachadas e brancos saturados roubavam o olhar                                | Cidade com menos saturação e brilho (`lisbon/grade.ts`; azulejos e letreiros iguais); paredes e divisórias em branco-pérola mate                                                              | Capturas de dia antes/depois                                                   |
| Ordem "…Pede à Lena para os acrescentar e à Nina para verificar" ia toda para a Mira | O leitor divide os pedidos a colegas em passos deles, por ordem; as tarefas depois de abrir uma nota recebem essa nota (o servidor resolve-a e confere a edição)                              | Ao vivo: Mira → Lena (4 linhas, frontmatter intacto) → Nina (só leitura)       |
| Nota já aberta no Obsidian dava "não consegui confirmar"                             | Se já era a nota ativa com o Obsidian aberto, conta como à vista ("já estava aberta")                                                                                                         | Teste unitário                                                                 |
| Ressalvas encadeadas cresciam passo a passo e ficavam ilegíveis                      | Cada passo mostra só a ressalva do anterior                                                                                                                                                   | Teste ao vivo                                                                  |
| Passo bloqueado sem caminho para seguir                                              | O cartão diz como seguir e tem "Repetir a ordem" (só ordens do Atlas; o cartão só sai se o envio funcionar)                                                                                   | Revisão                                                                        |
| `office.config.json` gravado com BOM (Bloco de Notas) fazia o servidor falhar        | O BOM é ignorado                                                                                                                                                                              | Teste unitário                                                                 |

## Acesso dos agentes (Claude Code local)

- Perfis com pasta de trabalho, outras pastas, Obsidian, terminal, integrações MCP e, agora, **skills** (as de
  `~/.claude/skills` e as do projeto; tirá-las no perfil retira a ferramenta `Skill`). Perfis antigos ficam com skills.
- **Acesso amplo** preenche o perfil para trabalho de confiança (Obsidian com escrita, terminal, todas as MCP, skills,
  edições sem perguntar); o terminal continua sujeito às tuas regras de permissão.
- **Retirar acesso** devolve o agente ao modo escritório (sem projeto, terminal nem MCP).

## Agente do escritório vs. Claude Code interativo na mesma pasta

| No terminal (`claude` na pasta do projeto) | Agente em modo local (perfil)                                                                     | Agente em modo escritório                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| O teu login e as tuas definições           | Os mesmos (`--setting-sources user,project,local`, o mesmo `claude` instalado)                    | Só as do projeto; sem as tuas MCP                 |
| Pastas: a do terminal e as `--add-dir`     | A pasta do perfil e as que lá puseres (lidas ou escritas), vigiadas pelo `local-guard`            | A pasta própria; as dos colegas só leitura; vault |
| Comandos de terminal com as tuas regras    | Se o perfil os permitir; o que no terminal perguntaria aparece na app (permitir/recusar)          | Nunca                                             |
| MCP e skills                               | As escolhidas no perfil (ou todas); skills sim, salvo se as tirares                               | Nenhuma MCP                                       |
| Perguntas de permissão no ecrã             | Na app; ou "Continuar no terminal" abre a mesma sessão, com o mesmo perfil, e perguntam lá        | Não há: só o que os guards deixam                 |
| Comandos `/` e ecrã interativo             | Não existem no chat da app (usa "Continuar no terminal")                                          | Não existem                                       |
| O que fizeste fica no teu ecrã             | Rasto da última tarefa no painel; ordens com passos, evidência e motivo de bloqueio               | Igual                                             |
| Edições conferidas por ti                  | Notas conferidas em disco antes/depois pelo servidor; outros ficheiros pelo rasto das ferramentas | Igual                                             |
| Continuidade                               | A sessão é retomada; perguntas pendentes perdem-se se o servidor reiniciar                        | Igual                                             |

### Comparação ao vivo (mesma pasta, mesma pergunta)

Pasta de projeto descartável; a pergunta pede, sem usar ferramentas, a pasta, o terminal, as MCP, as skills e se as
edições precisam de autorização.

- `claude -p` no terminal: a pasta do projeto; PowerShell e Bash; MCP Claude Docs, `vercel` (a pedir autorização) e
  `voicestudio` (falhou a ligar); skills do utilizador; edições conforme o modo de permissões.
- Mira em modo local, perfil criado na app com **Acesso amplo**: a mesma pasta e o vault; PowerShell e Bash sujeitos às
  regras; as mesmas MCP (mais `office-vault`); as skills do utilizador; edições aceites sem perguntar, como o perfil diz.
- A secção de acesso efetivo mostrou exatamente o perfil; **Retirar acesso** voltou ao modo escritório (sem terminal
  nem MCP), confirmado no painel.

## Revisões independentes

- Subagente (Claude Code): nenhum crítico. Médios corrigidos: Esc fechava o painel junto com outras janelas; repetir
  ordens de outros donos reenviava um título; o exemplo da demo podia ficar preso sem limite de tempo. Baixos corrigidos:
  texto antigo "📁 Dossier", `#empty` sem uso, estado duplicado no modo andar.
- Codex (`codex exec --sandbox read-only`): médios corrigidos: Esc do dossier fechava também o painel; as malhas
  realistas sem id (a causa do clique falhado). Baixo corrigido: "Repetir" apagava o cartão mesmo sem conseguir enviar.
  Sem defeitos no campo `skills` (o browser não alarga o acesso guardado), no BOM e no foco.
