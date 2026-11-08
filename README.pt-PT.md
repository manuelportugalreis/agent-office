# Agent Office

[![CI](https://github.com/manuelportugalreis/agent-office/actions/workflows/ci.yml/badge.svg)](https://github.com/manuelportugalreis/agent-office/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-3D-000000?logo=threedotjs&logoColor=white)
![Node 24](https://img.shields.io/badge/Node-24-5fa04e?logo=nodedotjs&logoColor=white)

> Um escritório 3D isométrico onde **cada pessoa é um agente [Claude Code](https://docs.claude.com/en/docs/claude-code)**. Clica numa personagem para falar com ela, dá ordens ao CEO e vê a equipa a andar, a sentar-se, a pesquisar e a escrever.

[English](README.md) · **[Demonstração](https://manuelportugalreis.com/agent-office/)** (só o escritório e a cidade: os agentes trabalham no teu computador, vê abaixo)

![O escritório](docs/img/office.png)

O Agent Office transforma uma equipa de agentes de IA em algo que se vê. Onze agentes, cada um com função, personalidade, pasta e memória próprias, trabalham num pequeno escritório. Falas com eles num chat que parece o do Claude, ou dás uma só ordem ao CEO, que planeia o trabalho e o distribui.

Tudo corre **no teu computador**, através da ferramenta `claude` e do teu próprio login do Claude. Não há serviço na nuvem, nem chave de API para colar, nem conta para criar.

**Feito com** TypeScript (strict) de ponta a ponta: Three.js e Vite na cena, um servidor Node 24 (WebSocket, `node:sqlite`), node-pty e xterm.js para os terminais dentro da app, e mais de 500 testes Vitest que a CI corre em cada push, além de testes de browser com Playwright.

> **Estado:** inicial (0.x). Foi pensado para procura de emprego e estudo, mas o escritório são só dados e prompts: faz um fork e muda a equipa.

<p align="center"><img src="docs/img/chat.png" alt="O chat" width="380"></p>

## Funcionalidades

- **Um escritório vivo.** Cena 3D isométrica (Three.js) com ciclo dia/noite. As personagens (com rosto, cabelo e crachá) sentam-se, lavam as mãos, jogam ténis de mesa, conversam no corredor, fazem reuniões, entregam um papel a um colega quando o CEO delega e acenam quando precisam da tua aprovação. Só quem está livre passeia; quem tem uma tarefa real fica na secretária.
- **Uma carta em que podes confiar.** Abre um dossier de candidatura (📁 Dossier). A Mira encontra o anúncio original (ou usa o teu link) e entrega um resumo de pesquisa validado: cargo, empresa, URL do anúncio, data em que o viu, requisitos obrigatórios e desejáveis, cada facto ligado à sua fonte e a lista do que não conseguiu confirmar. Se a vaga é ambígua ou não existe, pergunta-te em vez de adivinhar. A Lena escreve a partir desse resumo, do teu perfil partilhado e dos factos que acrescentares, e deixa as perguntas dela fora da carta. A Nina, revisora independente, verifica a carta contra a mesma pesquisa e a mesma evidência (uma afirmação sem sustento, como «liderei» onde o perfil diz «contribuí», bloqueia; sugestões de estilo não), devolve-a uma vez à Lena com correções exatas e só depois ela chega à tua bandeja. A pasta viaja pelo escritório; clica nela, ou no quadro da sala de Gestão, para ver de onde vêm os factos, o que a Nina verificou e que perguntas precisam da tua resposta. Aprova ou devolve à Lena com uma nota. O quadro da sala de Gestão mostra de relance quem a tem e se precisas de agir («À tua espera»). Nada é enviado. Sobrevive a recarregar a página e a reiniciar o servidor.
- **Ordens do dia a dia que acontecem mesmo.** «Mira, vai ao meu gabinete», «vai toda a gente para a sala de jogos», «os chefes à sala de reuniões», «cada um para o seu gabinete», «Abre a nota Planeamento no Obsidian», «Atlas, manda a Mira ao meu gabinete e, quando chegar, pede-lhe para ler Planeamento e propor três próximos passos». O servidor leva as pessoas até lá e espera que a cena confirme a chegada, abre a nota no teu Obsidian e confirma-o pelo próprio Obsidian, e só faz o trabalho seguinte depois do passo anterior. Cada ordem mostra os passos com evidência (✓ feito, ~ com ressalvas, ✗ bloqueado e porquê). As notas encontram-se pelo título, alias, `[[link]]` ou caminho; se houver duas, pergunta qual. As edições são conferidas no disco (frontmatter intacto, conteúdo anterior mantido).
- **Gabinetes e papéis.** Projetos (Rhea, Mira), Job Search (Vera, Scout), Candidaturas e Outreach (Nina, Lena, Theo), Mestrado (Dean, Ada, Turing), o gabinete do Atlas e a sala de reuniões dos chefes. Cada agente sabe onde trabalha e com quem. Escolhe qual é «o teu gabinete» em 📍.
- **Instruções que controlas.** O separador **Instruções** de cada agente mostra o papel, a forma de ser, o playbook (método e definição de concluído) e o gabinete, e deixa-te escrever instruções tuas para esse agente e regras para toda a equipa. Só tu as editas; os agentes leem-nas em cada tarefa.
- **Notificações (🔔).** Tudo o que precisa de ti num só sítio: perguntas dos agentes, pedidos de autorização (permites ou recusas ali mesmo), rascunhos para aprovar, passos bloqueados, o dossier à tua espera e as ideias da equipa.
- **Iniciativa.** Os agentes propõem ideias por conta própria (a cada 30 min com a app aberta e a equipa livre, ou no fim de qualquer resposta). Carregas em **Avançar** e o Atlas organiza a equipa para a fazer; nada acontece sem o teu sim.
- **Anda pelo escritório.** Carrega em `W` (ou no botão 🚶) para teres o teu avatar: setas ao longo do corredor, clica no chão ou numa pessoa para ires à secretária dela (a conversa abre quando chegas) e `F` liga ou desliga a câmara que te segue.
- **Chat como o do Claude.** Respostas em streaming, Markdown, editar e regenerar a última mensagem, parar, anexos (`.md`, PDF, imagens, `.docx`), conversa nova quando quiseres, `Ctrl+K` para ir ter com qualquer um e `@nome` para passar a conversa a outro agente.
- **Agentes a sério.** Cada um é um processo do Claude Code com prompt, ferramentas, pasta e memória (`CLAUDE.md`) próprios.
- **O Claude Code verdadeiro em cada painel.** O separador «Claude Code» de cada agente é a própria CLI interativa (node-pty e xterm.js), com as teclas que já conheces: Shift+Enter para mudar de linha, copiar e colar, colar uma imagem ou largar um ficheiro para lho passar, links clicáveis e ecrã inteiro. A conversa sobrevive a um reinício do servidor, e uma ordem do CEO espera enquanto tens uma mensagem por enviar na caixa.
- **Qualidade dos agentes que se mede.** `npm run eval` dá tarefas fixas aos agentes reais e avalia as respostas e os ficheiros em disco: fontes citadas, nada inventado sobre ti, uma nota editada sem estragos, quem escreve depois de quem pesquisa. Cada agente tem um playbook com a definição de concluído. O motivo que dás ao rejeitar um rascunho passa a lição que o agente lê na tarefa seguinte. A pesquisa que segue para um colega tem de terminar com o que ficou por confirmar e as fontes. As revisões independentes da Nina correm num modelo diferente do de quem escreveu.
- **Um CEO que delega.** Uma ordem vira um plano validado de até três tarefas (mais deslocações da equipa toda), com dependências: quem tem de ir a algum lado só começa quando chega, e quem escreve espera pela investigadora e recebe o resultado dela. No fim, o CEO resume o que a equipa fez de facto.
- **Tu decides.** Os rascunhos vão para uma fila de aprovações. Nada é enviado sem ti. Com `vaultDir` definido e a pasta `01 Candidaturas/00 Aprovações` presente, aprovar um rascunho guarda-o também aí como nota (`enviado: não`); o servidor nunca cria pastas no teu vault.
- **Persistente.** Conversas, registos, aprovações e sessões sobrevivem a reinícios (SQLite).
- **Sincronização do Canvas, só de leitura (opcional).** Um agente lê o painel da tua plataforma de ensino pelo teu Chrome, só quando carregas, e só no único domínio que configurares.
- **As tuas notas, opcional.** Define `vaultDir` com um vault do Obsidian e os agentes com ficheiros podem ler, criar e editar notas lá.
- **Defesa em profundidade.** Os guardas são testados no arranque (o servidor recusa-se a arrancar se algum falhar aberto), sandbox de ficheiros por agente, guarda de URLs para a web, lista de domínios permitidos no browser, servidor só local. Ver [SECURITY.md](SECURITY.md).

## Como funciona

O servidor nunca fala com uma API de modelos. Lança `claude -p --output-format stream-json` por tarefa, envia os eventos para o browser e guarda o resultado. O diagrama e os detalhes estão em [docs/architecture.md](docs/architecture.md).

## Requisitos

- **Node.js 24 ou mais recente** (usa `node:sqlite` e executa TypeScript diretamente).
- **Claude Code**, instalado e com sessão iniciada: corre `claude` uma vez num terminal. Ver a [documentação oficial](https://docs.claude.com/en/docs/claude-code).
- Um plano do Claude que permita o Claude Code. Os agentes gastam a quota do teu plano (o CEO usa Opus, os outros Sonnet).
- _Opcional:_ Chrome com a extensão Claude in Chrome, só para a sincronização do Canvas.

## Começar

```bash
git clone https://github.com/manuelportugalreis/agent-office.git
cd agent-office
npm install
npm run doctor      # verifica Node, Claude Code, configuração e porta
npm start           # compila a interface e serve tudo em http://127.0.0.1:8787
```

Para desenvolver (recarregamento automático em http://127.0.0.1:5174):

```bash
npm run dev
```

Clica numa pessoa do escritório, ou carrega em `Ctrl+K`, e começa a falar.

### Para os teus amigos

A demonstração no GitHub Pages mostra o escritório, mas os agentes não trabalham lá: correm no Claude Code de quem tem
o servidor ligado. Para usarem a sério, cada um instala no seu computador (precisa de Node 24 e do Claude Code com a
sua própria conta):

```bash
git clone https://github.com/manuelportugalreis/agent-office.git
cd agent-office
npm install
npm start           # abre http://127.0.0.1:8787
```

No Windows, `npm run app:install` cria um ícone **Agent Office** no ambiente de trabalho e no menu Iniciar: abre o
escritório numa janela própria (sem browser à vista), arranca o servidor sozinho e desliga-o quando fechas a janela.

Para os agentes trabalharem num projeto e no Obsidian como no terminal, vê [o modo Claude Code local](docs/claude-code-local.md).

## Configuração

Copia o exemplo e edita-o. O ficheiro verdadeiro é ignorado pelo Git, por isso o teu nome e as tuas disciplinas nunca saem do teu computador.

```bash
cp office.config.example.json office.config.json
```

| Chave          | O que faz                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `userName`     | Como os agentes te tratam e a saudação do chat. Vazio significa "o utilizador".                                           |
| `port`         | Porta do servidor (predefinição `8787`). Também `AGENT_OFFICE_PORT`.                                                      |
| `vaultDir`     | Pasta opcional (ex.: um vault do Obsidian) onde os agentes com ficheiros também podem ler e escrever. Vazio = sem acesso. |
| `canvasHost`   | O **único** domínio que quem lê o Canvas (Dean, Ada, Turing) pode abrir no teu browser.                                   |
| `canvasOrigin` | Só para testes: um Canvas de ensaio local (`http://127.0.0.1:<porta>`, ver `scripts/canvas-fixture.mjs`). Não o ponhas.   |
| `courses`      | Que agente trata de que disciplina (`agent`, `code`, `title`). O código tem de coincidir com o Canvas.                    |
| `extraOrigins` | Origens extra aceites pelo servidor (por exemplo, um proxy). Normalmente fica vazio.                                      |

Edita `server/workspaces/_company/perfil.md` (criado à primeira execução) para dizer a todos os agentes quem és. Os agentes só o leem.

### Canvas sem a extensão do Chrome (calendário)

Se a extensão Claude in Chrome não está disponível (há universidades que a desligam), liga o calendário do Canvas. No Canvas, abre **Calendar › Calendar Feed**, copia o link e guarda-o numa variável de ambiente, no teu terminal (nunca no chat):

```powershell
setx AGENT_OFFICE_CANVAS_FEED "https://<o teu canvas>/feeds/calendars/user_....ics"
```

Reinicia o escritório. O servidor lê o calendário diretamente, sem browser nem agentes: o painel do Dean e «Faz-me o trabalho de casa que tenho para entregar hoje» passam a saber os prazos e a descrição de cada entrega. O calendário não traz rubricas, anexos nem o que já submeteste. Por isso, para cada entrega de hoje o escritório abre a página no teu browser e uma pasta; guardas lá a página em PDF e os ficheiros e respondes «feito» (ou «segue», para avançar só com a descrição). O link é um segredo (dá o teu calendário sem login): tem de ser do teu `canvasHost`, nunca aparece no chat nem nos registos e, se o renovares no Canvas, basta trocar a variável. Antes, confirma as regras da tua universidade sobre dados e IA.

## Usar

| Faz isto                    | Para isto                                                      |
| --------------------------- | -------------------------------------------------------------- |
| Clicar numa pessoa          | Abrir o chat dela (e os separadores Resumo e Log)              |
| `Ctrl+K`                    | Procurar e ir ter com qualquer agente                          |
| `@lena escreve o email`     | Passar a conversa à Lena, com a última resposta como contexto  |
| Escrever na barra de baixo  | Dar uma ordem ao CEO: ele planeia, delega e a equipa trabalha  |
| «toda a gente para a copa»  | Mover a equipa toda (ou «os chefes», «o gabinete de Projetos») |
| 🔔 Notificações             | Responder, permitir/recusar, ver bloqueios, avançar com ideias |
| Separador **Instruções**    | Ver o papel de um agente e escrever instruções tuas para ele   |
| 📍 O meu gabinete           | Escolher qual é o teu gabinete                                 |
| Botão Aprovações            | Rever, copiar, aprovar ou rejeitar rascunhos                   |
| **+ Nova conversa**         | Começar um chat novo. O agente mantém o ficheiro de memória    |
| Arrastar a margem do painel | Alargar o chat                                                 |

No modo escritório (o normal) ninguém tem terminal. No [modo local](docs/claude-code-local.md) cada agente só tem o acesso que lhe dás no perfil, e a app mostra-o. Ninguém pode enviar email. Para mudar a equipa vê [docs/architecture.md](docs/architecture.md#adding-or-changing-an-agent).

## Docker

```bash
docker compose up --build -d
docker compose exec office claude   # inicia sessão uma vez (fica guardada num volume)
```

Abre http://127.0.0.1:8787. A porta só fica aberta nesta máquina, porque o servidor não tem login. Para usar o teu vault do Obsidian, tira o comentário dos volumes em `docker-compose.yml`. A sincronização do Canvas precisa do teu Chrome, por isso não funciona a partir do contentor. A configuração Docker ainda não foi testada: usa a instalação normal se algo falhar.

## Desenvolvimento

```bash
npm run check        # typecheck + lint + formatação + testes + build
npm test
npm run typecheck
npm run lint
npm run format
```

## Limitações

- **Aprovar não envia nada.** Não há integração de email, de propósito. Podes copiar o rascunho.
- **Editar e regenerar só funcionam na última troca.** O Claude Code não consegue recuar numa sessão, por isso a conversa é repetida numa sessão nova.
- **Os agentes com web podem ser enganados por páginas hostis.** A guarda de URLs reduz a fuga de dados mas não a elimina. Não ponhas segredos nas pastas deles. Ver [SECURITY.md](SECURITY.md).
- **A interface e os agentes falam português (pt-PT)** por predefinição. Traduzir implica editar os prompts em `server/src/agents.ts` e os textos da interface; ainda não há camada de i18n.
- A sincronização do Canvas usa a sessão do teu browser e gasta mais quota do que um chat normal.
- Só local. Não há autenticação porque o servidor só escuta em `127.0.0.1`.

## Aviso

O Agent Office é um projeto independente. **Não é afiliado, apoiado nem patrocinado pela Anthropic.** "Claude" e "Claude Code" são marcas da Anthropic. Precisas do teu próprio acesso ao Claude e és responsável por usar o Claude Code de acordo com os [termos e políticas de utilização da Anthropic](https://www.anthropic.com/legal).

## Licença

[MIT](LICENSE). Feito com [Three.js](https://threejs.org), [React](https://react.dev), [assistant-ui](https://www.assistant-ui.com), [Vite](https://vitejs.dev), [ws](https://github.com/websockets/ws) e [Mammoth](https://github.com/mwilliamson/mammoth.js). A fonte serifada é a [Source Serif 4](https://github.com/adobe-fonts/source-serif) (SIL Open Font License).
