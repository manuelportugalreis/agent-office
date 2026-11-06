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
