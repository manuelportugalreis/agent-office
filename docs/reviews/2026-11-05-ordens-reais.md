# Revisões: ordens reais (ramo `ordens-reais`)

Duas revisões independentes, só de leitura, do código das ordens (intent, motor de passos, vault, cena):
um subagente revisor do Claude Code e o Codex (`codex exec --sandbox read-only`). Cada achado e o que foi feito.

## Subagente revisor (Claude Code) — 12 achados, nenhum crítico

| #   | Gravidade | Achado                                                                                       | Resolução                                                                                                                 |
| --- | --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Alta      | Mensagens normais desviadas pelo leitor ("Volta às candidaturas de ontem…" virava movimento) | Depois de andar/abrir a oração tem de acabar; salas com nomes de trabalho só com "sala de …" (testes em `intent.test.ts`) |
| 2   | Média     | Vault inteiro lido a cada mensagem                                                           | Índice em cache (5 s) em `vault.ts`                                                                                       |
| 3   | Média     | Nota em falta ignorada em silêncio                                                           | Passo fica "com ressalvas" e o agente é avisado                                                                           |
| 4   | Média     | Pedido de edição sem a nota mudar aparecia como feito                                        | Fica "com ressalvas" ("pediste uma alteração, mas a nota está igual em disco")                                            |
| 5   | Média     | Respostas pendentes apanhavam mensagens não relacionadas ("às 3")                            | Só respostas curtas contam; "esquece" cancela; resposta curta mal escrita pede para repetir                               |
| 6   | Média     | Duas perguntas na mesma conversa cancelavam-se                                               | Fila de perguntas por conversa; "qual é o teu gabinete?" uma só vez                                                       |
| 7   | Média     | A primeira resposta `arrived` (mesmo falhada, de outro separador) ganhava                    | Falha só conta se nenhum separador confirmar a chegada logo a seguir                                                      |
| 8   | Média     | Ordem de movimento substituída nunca era respondida                                          | A cena responde "substituída por outra ordem"                                                                             |
| 9   | Baixa     | Ids de ordens repetidos depois de reiniciar                                                  | Ids a partir da hora                                                                                                      |
| 10  | Baixa     | Regenerar não passava pelas ordens                                                           | Regenerar/editar uma ordem volta a executá-la                                                                             |
| 11  | Baixa     | Opção sem uso e listas de agentes repetidas                                                  | Removida; `AGENT_NAMES` num só sítio                                                                                      |
| 12  | Baixa     | Funções longas                                                                               | Verificação da tarefa extraída para `taskEvidence`                                                                        |

## Codex (só de leitura) — 9 achados

| #   | Gravidade | Achado                                               | Resolução                                                           |
| --- | --------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Alta      | Ordem do chat à espera podia correr com outro perfil | Perfil congelado no momento da ordem                                |
| 2   | Alta      | Nova conversa deixava perguntas antigas respondíveis | `newChat` cancela as perguntas do agente                            |
| 3   | Alta      | Erro de ficheiro numa ordem do chat sem tratamento   | Erros bloqueiam o passo com o motivo; `.catch` no chat              |
| 4   | Média     | Andar primeiro perdia o resultado dos colegas        | A tarefa depende do movimento e dos colegas                         |
| 5   | Média     | Ler outro ficheiro contava como ler a nota           | Só conta a leitura deste ficheiro; sem leitura fica "com ressalvas" |
| 6   | Média     | Estado antigo do Obsidian contava como confirmação   | Só confirma se o workspace for gravado depois de abrir              |
| 7   | Média     | Escolher o gabinete no menu não retomava a ordem     | O menu responde à pergunta pendente                                 |
| 8   | Média     | Regenerar não executava ordens                       | Ver subagente #10                                                   |
| 9   | Média     | "e" dentro de títulos de notas partia a ordem        | Títulos com "e", entre aspas ou `[[link]]` ficam inteiros           |

Ainda: um passo a seguir a outro com ressalvas corre avisado e não aparece como limpo.

## Verificação ao vivo (instância isolada, vault descartável, agentes reais)

- "Mira, vai ao meu gabinete." — pergunta o gabinete, anda, chegada confirmada pela cena.
- "Abre a nota Planeamento no Obsidian." — aberta e confirmada pelo workspace do Obsidian.
- "Atlas, manda a Mira ao meu gabinete e, quando chegar, pede-lhe para ler Planeamento e propor três próximos passos." — anda, depois lê (leitura registada) e propõe.
- "Pede à Lena para acrescentar esses passos à nota e à Nina para verificar a alteração." — nota alterada em disco (só linhas novas, frontmatter intacto); a Nina revê só a ler.
- Nota ambígua, destino em falta, escrita recusada (fora do vault e com vault só de leitura), autorização pedida na app (perfil local), dossier completo até à bandeja.
- Cena comparada com a versão anterior (`08150e9`): 1,02% dos píxeis diferentes, todos nas personagens e no rótulo do dossier.
- Repetido sobre o código final (`9a56cd5`, base de dados nova): as quatro ordens, nota ambígua, destino em falta, escrita recusada, painel do Dean e o dossier até à bandeja (Atlas → Mira → Lena → Nina, com uma devolução automática).

## Diferenças em relação ao Claude Code no terminal (verificado)

Argumentos que o servidor passa ao `claude` (gerados por `buildLocalArgs` e `buildArgs`, Claude Code 2.1.319):

- **Modo local (perfil):** `--setting-sources user,project,local` (as tuas definições, hooks, plugins e regras de permissão contam), `--permission-prompt-tool stdio` (as perguntas do terminal chegam à app), `--permission-mode default|acceptEdits`, `--mcp-config` (o MCP do vault mais os teus, ou todos com `*`), `--add-dir` com as pastas do perfil, o hook `local-guard.mjs` por cima.
- **Modo escritório:** `--setting-sources local,project`, `--strict-mcp-config` (sem MCP), `--tools Read,Write,Edit,Glob,Grep` (+ WebSearch/WebFetch para quem tem web), `--permission-mode dontAsk`, hooks `fs-guard`/`web-guard`.

| No terminal                      | Na app                                                                                           | Evidência                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Login e definições do utilizador | Igual no modo local (mesmo `claude` e login; `user,project,local`)                               | Argumentos acima; sessões locais testadas ao vivo                        |
| Perguntas de permissão           | No modo local aparecem na app (permitir/recusar); no escritório não há perguntas, só os guards   | Teste ao vivo: edição do README pediu autorização e foi permitida na app |
| Terminal (Bash/PowerShell)       | Só com perfil que o permita; no escritório nunca                                                 | `--disallowedTools Bash,PowerShell` quando o perfil não tem terminal     |
| Integrações MCP                  | Só no modo local (escolhidas ou todas); no escritório nenhuma                                    | `--strict-mcp-config` no escritório                                      |
| Comandos `/` e ecrã interativo   | Não existem no chat da app; "Continuar no terminal" abre a mesma sessão no terminal              | `terminal.ts` (`claude --resume` com o mesmo perfil)                     |
| Interpretar ordens               | O servidor executa sozinho só andar e abrir notas; o resto é o agente                            | `intent.ts`                                                              |
| Conferir edições                 | Notas conferidas em disco (antes/depois); outros ficheiros só pelo rasto das ferramentas         | `taskEvidence` em `orders.ts`                                            |
| Continuidade                     | Perguntas pendentes perdem-se ao reiniciar o servidor; o resultado da última ordem fica guardado | `lastOrderResults` em `settings`                                         |

## Relatório do subagente revisor (tal como foi entregue)

> **HIGH**
>
> 1. Normal chat messages hijacked by the parser — server/src/intent.ts. In an agent's own chat no vocative is needed (`who = self`) and domain words are place aliases ("pesquisa", "estudos", "candidaturas", "mestrado", "reunioes", "cafe", "bar", "jogos", "pausa"). Scenario: in Lena's chat, "Volta às candidaturas de ontem e revê o email" parses as move(Lena → apply room) and the task becomes the leftover "de ontem e revê o email". Fix: require an explicit movement phrase … or pass the original text intact when the move is not the whole message.
>
> **MEDIUM** 2. Vault indexed on every chat message — chat.ts (`findNoteMention`) → vault.ts (`indexVault`): every message walks the vault and reads every .md file synchronously. Fix: cache the index. 3. Missing note is dropped silently — orders.ts: when the plan's `s.note` resolves to `none`, the task still runs and `found.error` is discarded; the summary says "✓ … terminou". Fix: add the error to the evidence and mark the step partial. 4. Edit task reported "done" without evidence — orders.ts: if the note is unchanged and no write step was logged, the state stays "done". Fix: when the task is an edit and the file is unchanged, mark partial. 5. Pending question swallows unrelated messages — `pickOption`: `\b(\d)\b` and `includes("quinta"/"sexta"/"primeira")` match any text; a failed parse cancels the question and blocks the step. Fix: accept only a bare number or ordinal, re-ask once on a parse failure. 6. `ask()` cancels a sibling's question — two parallel steps for the same owner cancel each other. Fix: queue questions per owner or memoise the office choice. 7. First `arrived` wins, from any client — a stale tab's `ok:false` can beat the tab that succeeds. Fix: prefer `ok:true` with a grace period. 8. Superseded move is never answered — main.ts `beginMove`: the old id never gets `arrived`; the server waits 120 s. Fix: send `arrived{ok:false, reason:"substituída"}`.
>
> **LOW** 9. Order-card id collision after restart (counters restart at 1). 10. Redo bypasses the order path. 11. Dead option (`conversational`), duplicated agent lists, identical `nameOf`/`names`, stacked JSDoc blocks. 12. Function length (`run` ~150 lines, `runTask` ~65, `placeAt` 4 nested loops).
>
> **Checked and fine:** path traversal (`walk`, `findNoteMention`, `openInObsidian` with realpath + `vaultFor`); URI launch (`encodeURIComponent`, no shell, vault id from obsidian.json); `parseClientMsg` validation of `arrived`/`set-office`; dependency propagation.

O relatório do Codex está completo na secção acima (os 9 achados, tal como numerados por ele).

## Segunda ronda (sobre o commit final, `2736f2d`)

Subagente: nenhum crítico; 2 altos/médios a corrigir antes de juntar. Codex: nenhum grave; 5 médios. Todos corrigidos:

- "para a copa" respondia como cancelar → a resposta é lida antes de procurar "esquece/cancela".
- Uma ordem nova ("vai à copa") era tomada como resposta a "qual é o teu gabinete?" → ordens novas não respondem; só palavras de ligação antes do sítio.
- Nova conversa: pergunta seguinte aparecia e o resumo da ordem antiga também; passos por começar ainda corriam → fila esvaziada antes, passos por começar ficam "não começou", resumo suprimido.
- Regenerar uma ordem retomava a sessão antiga → sessão nova com o histórico; mensagens que só mencionam uma nota seguem o caminho normal.
- "no"/"na" + título desviavam mensagens normais → só "nota", "ler", "abre", "edita", "atualiza".
- Ler `Pessoal/Planeamento.md` contava como ler `Trabalho/Planeamento.md` → compara o caminho relativo inteiro.
- O resumo do Atlas não recebia as ressalvas das tarefas → recebe o estado verificado de todos os passos.
- Ordens diretas que alteram ficheiros não tinham revisão da Nina → passam pela mesma revisão independente.
- "Mostra-me a nota X" abria o Obsidian → só com "no Obsidian"; prefixos "que"/"para" já não cortam a tarefa.

## Terceira ronda (sobre `fbe3027`: gabinetes e Instruções)

Subagente: nenhum crítico/alto; 3 médios, 3 baixos. Codex: 1 alto, 4 médios. Corrigidos:

- **Alto (Codex):** revisão só de leitura no modo local mantinha o terminal → só de leitura tira também Bash/PowerShell.
- As tuas instruções estavam no `CLAUDE.md` que o próprio agente escreve (um texto lido na web podia passar por instrução tua) → passam para `_company/instrucoes/<agente>.md`, que os agentes só leem; vão em cada pedido (também nas conversas retomadas e no modo local). O `CLAUDE.md` fica como memória do agente, mostrada só para ler.
- Regras da equipa cortadas por instruções longas → orçamento separado, regras da equipa primeiro.
- Guardar reescrevia sempre as regras da equipa → só vão se mudaram; ficheiro temporário único.
- Tarefa à espera de vaga corria depois de recomeçar a conversa → já não corre.
- Perfil sem vault: o servidor ainda procurava/lia notas pela tarefa → deixa de o fazer.
- Revisão final da Nina dispensada mesmo quando ela reviu antes de quem escreveu → só se dispensa se reviu, com sucesso, depois de todos os que alteraram ficheiros.
- Gabinete guardado com o id antigo "gestao" → verificado: a base de dados real não tem nenhum guardado.

## Quarta ronda (sobre `cea0463`)

Subagente e Codex confirmaram as correções anteriores (incluindo que os agentes leem mas não escrevem `_company/instrucoes/`, verificado contra o `fs-guard.mjs`). Nenhum crítico/alto. Médios corrigidos:

- Perfil sem vault: o chat ainda procurava notas nas mensagens → deixa de procurar.
- A revisão final da Nina era dispensada com base no processo ter terminado, mesmo com a revisão dela "com ressalvas" (ex.: leitura recusada) → só se dispensa se o passo dela ficou feito sem ressalvas.
- "Continuar no terminal" não levava as tuas instruções → vão no prompt do terminal.
- Baixo, aceite: o agente continua a escrever a sua memória (`CLAUDE.md`), mostrada só para ler; as tuas instruções antigas no `CLAUDE.md` não migram (o separador é novo e a base real não tinha nenhuma).

## Quinta ronda (ordens de grupo, notificações e iniciativa)

Subagente: aprovado (nenhum crítico/alto; 3 médios, 3 baixos). Codex: 2 altos, 2 médios. Todos corrigidos:

- **Alto:** uma ideia da Lena/Theo passava pelas aprovações e substituía um rascunho à espera → as corridas de ideias não passam pelas aprovações.
- **Alto:** em modo local, uma corrida de ideia podia usar integrações MCP com escrita → as ideias correm sempre no modo escritório, só de leitura (sem terminal nem MCP).
- Num plano "toda a gente à sala e depois a Mira…", a tarefa não esperava pela chegada → espera.
- Regenerar uma ordem de grupo não a executava → executa.
- "Visto" num dossier voltava a acender → o que fechaste não volta com a mesma chave.
- Dispensar fechava autorizações/perguntas ainda por decidir → só se dispensam bloqueios, dossier e ideias.
- O texto de uma ideia (escrito por um agente) entrava na ordem ao Atlas como se fosse teu → vai marcado como proposta, numa linha cada parte.
- "Pedir uma ideia agora" sem limite diário → respeita o máximo do dia e uma de cada vez; ideias dispensadas há muito não voltam; ao arrancar, as notificações acertam-se com o estado real (aprovações, dossier).
