# Lisboa: renovação visual do exterior

Registo do trabalho para transformar o exterior do Agent Office numa maqueta de Lisboa (Chiado/Baixa). Só cena 3D:
agentes, servidor, navegação e interface não mudam.

## Como verificar

- `npm run dev` (ou `npx vite --port 5174` em `app/`) e depois `node scripts/lisbon-shots.mjs <pasta>`: abre o Chromium
  (Playwright, GPU via ANGLE/D3D11), tira 7 capturas (dia, rua com zoom, dois ângulos rodados, vizinhos, noite, rua à
  noite) e mede FPS e chamadas de desenho por fotograma (contando `drawElements`/`drawArrays`, todas as passagens
  incluídas: sombras, GTAO, bloom).
- `npm run check` (typecheck, lint, prettier, testes unitários do app e do servidor, build).

Os FPS do script são de um Chromium sem ecrã e servem só para comparar iterações entre si, não como valor absoluto.

## Linha de base (antes)

Capturas em `docs/img/lisbon/baseline/`. Qualidade "alta", 1600×900.

| Métrica          | Dia  | Noite |
| ---------------- | ---- | ----- |
| Draw calls/frame | 4189 | 4169  |
| FPS (headless)   | 14,2 | 17,3  |

Problemas encontrados:

1. **Vizinhos gigantes**: a altura era calculada a partir de y = 0 (piso do escritório) e não da rua, por isso os
   prédios tinham ~27 m e esmagavam o escritório.
2. Prédios-caixa com janelas planas em grelha uniforme, sem cantaria, cornijas nem varandas; dois cobertos de azulejo
   de alto a baixo; telhados em pirâmide (cone de 4 lados).
3. Calçada com ondas pretas de alto contraste em toda a cena (rua, passeios e largo iguais), sem faixa de rodagem,
   lancis nem passeios; os carris passam colados à fachada.
4. Eléctrico em caixas, tejadilho cinzento plano.
5. Noite quase igual ao dia: o mapa de ambiente (PMREM) continua a iluminar tudo; nada acende na cidade.
6. Cada caixa é uma malha: milhares de chamadas de desenho.

## Iterações

### 1. Arquitetura do quarteirão (feito)

- Novo módulo `app/src/scene/lisbon/`:
  - `batch.ts`: lote de geometria estática fundida por material (`mergeGeometries`) e caixas com UVs à escala do
    mundo.
  - `textures.ts`: texturas procedimentais sem emenda (reboco, telha de canudo, portadas de lâminas, azulejo,
    letreiros).
  - `materials.ts`: materiais partilhados com cache; vidros com variantes que acendem à noite (`setCityNight`).
  - `facade.ts`: fachada parametrizada (embasamento e cunhais de cantaria, frisos, janelas de sacada com varanda de
    ferro forjado e mísulas, varanda corrida, grade de peito, janelas de peito, cortinas de renda, portadas
    abertas/fechadas/entreabertas, portas de duas folhas com bandeira, montras, janelas gradeadas, letreiros).
  - `houses.ts`: prédio completo (corpo, fachada, telhado de duas águas ou mansarda com trapeiras, chaminés).
  - `city.ts`: dados do quarteirão (5 prédios a poente, 4 na travessa a nascente, 7 tardozes com estendais) e as duas
    fachadas do próprio prédio do escritório (9 + 5 vãos, ocre pombalino, portadas verdes).
  - `layout.ts`: planta comum (nível da rua, ruas, limites).
- Alturas corrigidas: 3 a 5 pisos acima da rua; o escritório volta a ser o centro.
- `stage.ts`: chama `setCityNight(n)` junto com a luz cozida.

Resultado (`docs/img/lisbon/it1/`): draw calls 4189 → 3322 com muitíssimo mais detalhe; FPS 14 → 20.

### 2. A rua e o outro lado da travessa (feito)

- `street.ts`: faixa de rodagem em cubos de granito (textura procedimental em fiadas desencontradas), passeios de
  calçada branca de calcário (pedras irregulares de ~6 cm com juntas de areia), lancis de granito, carris embutidos com
  caleira, largo com o "mar largo" do Rossio em tom suave, logradouros em terra e relva, base da maqueta em corte.
- Pilaretes de ferro fundido, sarjetas e tampas, postes da catenária com candeeiro de braço e fio de suspensão até à
  fachada, catenária sobre os carris, candeeiro de esquina no prédio do escritório, placas toponímicas
  ("RUA DO LORETO", "TRAV. DA QUEIMADA").
- Lanternas lisboetas de seis faces com vidro que acende à noite e 5 luzes pontuais (só acesas à noite).
- `city.ts`: outro lado da travessa (2 prédios para a rua do eléctrico, de 3 pisos para não taparem o escritório, e 3
  virados para a travessa).
- Removidos: plano de calçada de 120 m, relva verde, bandeirolas penduradas ao longo da rua, carris e fio antigos.

Resultado (`docs/img/lisbon/it2/`): 3241 draw calls (dia), FPS 22 (headless).

### 3. O eléctrico 28 (feito)

- `tram.ts`: "remodelado" com caixa de cantos arredondados (planta extrudida), amarelo com faixas creme, janelas
  com pilares, portas do lado do passeio com degrau, salva-vidas, faróis (acendem à noite), caixas de destino
  "28 PRAZERES" iluminadas, número "566", tejadilho e pantógrafo de braço único a tocar na catenária. Fundido em ~10
  malhas que se movem em grupo.
- Animação: velocidade de cruzeiro, travagem e arranque com aceleração constante, paragem de 7 s junto ao
  escritório (poste "PARAGEM" no largo), ligeiro balanço e trepidação em andamento, recorte nas bordas da maqueta
  (planos de recorte, também nas sombras: `renderer.localClippingEnabled`).
- Ao abrir a app o eléctrico está parado na paragem.
- Depuração: `?debug` expõe `__office.tramPosition()`; o script de capturas segue o eléctrico.
- E2E Playwright: 7/7 passam.

### 4. Luz de Lisboa, de dia e de noite (feito)

- Novo `app/src/scene/lighting.ts` (a luz saiu do `stage.ts`, que fica só com câmara e controlos):
  - Sol com trajetória (nasce a nascente, passa a sul, põe-se a poente); o modo "Dia" usa as 15h30, com o sol a
    sudoeste: fachadas a sul ao sol e fachadas a nascente na sombra, o que dá volume ao quarteirão. Cor mais quente
    quando o sol está baixo.
  - Céu azulado frio a encher as sombras contra o sol quente; menos luz de céu (mais contraste).
  - Caixa de sombras a cobrir a maqueta inteira (±44 m, sol a 80 m), 4096² em "alta" e 2048² em "normal"
    (`setShadowQuality` quando se muda a qualidade).
  - Neblina suave (só se nota no fundo da maqueta) com a cor do fundo, dia e noite.
  - Noite: luar azulado e fraco, céu escuro azul, fundo azul-noite, reflexos do ambiente reduzidos a 20%; a cidade
    acende-se (janelas, montras, candeeiros, faróis do eléctrico) e o escritório iluminado fica o centro da cena.
- Custo: FPS headless ~22 → ~18 (sombras 4096² e área maior). A rever na iteração de desempenho.

### 5. Pastelaria, largo e arraial (feito)

- `pastelaria.ts` ("PASTELARIA LORETO", nos dois vãos reservados da fachada do escritório): caixilharia de madeira
  verde-escura, lambril de azulejo azul (o único azulejo do prédio), montra com tabuleiros de pastéis de nata, porta
  envidraçada, toldo de lona com o nome pintado e sanefa "PASTÉIS DE NATA · CAFÉ", esplanada com três mesas de tampo
  de mármore, cadeiras de bistrô e chávenas, lousa de cavalete com preços em pt-PT.
- `largo.ts`: cinco jacarandás em flor (copa em guarda-chuva com tufos lilás e alguma folha, flores caídas na
  calçada, caldeira de pedra), quiosque octogonal de ferro verde com cúpula de zinco, balcão, toldo e letreiro
  "QUIOSQUE · REFRESCOS" (vidros acesos à noite), bancos de jardim, mesas do quiosque, e um arraial discreto dos
  Santos Populares só no largo (bandeirinhas de papel e balões que brilham à noite).
- `facade.ts`: vasos de barro com sardinheiras/manjericos em ~metade das varandas (determinístico).
- O "mar largo" do largo ficou mais suave (cinzento médio em vez de negro, bandas mais estreitas e maiores).
- Removidos: toldo às riscas, letreiro azul colado à varanda, bandeira nacional e mesas antigas (`lisbon.ts` passou a
  só orquestrar os módulos).

Resultado: 3400 draw calls (dia).

### 6. Vida no bairro (feito)

- `life.ts`:
  - Peões em seis percursos (os dois passeios da rua do eléctrico, dois caminhos no largo e dois que descem a
    travessa e atravessam a rua até ao largo); cada parte do corpo é um `InstancedMesh` (tronco, cabeça, cabelo,
    pernas, braços), com cores de roupa, pele e cabelo variadas, passo com balanço de braços e pernas. Os percursos
    começam e acabam fora da maqueta e são recortados nas bordas, por isso o regresso ao início não se vê.
  - Quatro clientes sentados na esplanada da pastelaria (a acenar ligeiramente a cabeça e a mexer o braço).
  - Nove pombos no largo a debicar e a dar uns passos.
  - Vento no vertex shader (posições do mundo das malhas fundidas): copas dos jacarandás, bandeirinhas, balões e
    roupa estendida (`clothMat` novo, para o vento não mexer nas fachadas).
- `materials.ts`: as janelas "de televisão" cintilam devagar à noite.
- `street.ts`: passadeira na boca da travessa (por onde os peões atravessam).
- Nada disto é clicável nem entra nos raios de seleção (`pickAgent`/`pickObject` só olham para agentes e mobília).

Resultado: 3423 draw calls (dia), FPS headless ~22.

### 7. Desempenho (feito)

- Um só lote estático para todo o bairro (`lisbon.ts` cria o `Batch`, os módulos `city`, `street`, `pastelaria` e
  `largo` só acrescentam peças): os materiais partilhados (reboco, cantaria, ferro, vidros...) deixam de ter uma malha
  por módulo.
- As 5 luzes pontuais da rua foram substituídas por "poças de luz": quadrados com gradiente radial em mistura aditiva
  (no chão debaixo de cada candeeiro e nas duas fachadas da esquina), com opacidade ligada à noite. Cada luz pontual
  pesava no shader de todos os materiais, também de dia; agora há poças nos 7 postes em vez de 4 luzes.
- O fundo deixou de ser clonado em cada fotograma.
- Novo `scripts/lisbon-perf.mjs` (mediana de 3 medições de 4 s, qualidade alta e normal, dia e noite).

Medição com o mesmo script (`docs/img/lisbon/perf.json`):

| Qualidade / hora | Base: FPS | Base: draws | Agora: FPS | Agora: draws |
| ---------------- | --------- | ----------- | ---------- | ------------ |
| Alta, dia        | 17,9      | 4194        | 21,4       | 3403         |
| Alta, noite      | 17,6      | 4177        | 19,5       | 3369         |
| Normal, dia      | 32,6      | 2103        | 34,0       | 1709         |
| Normal, noite    | 31,5      | 2095        | 32,9       | 1704         |

Com muito mais geometria, a cena ficou mais leve do que a original em todas as combinações. O tempo até ao primeiro
fotograma subiu (~3,5 s → ~7 s no Chromium sem ecrã, servidor de desenvolvimento) por causa da geração das texturas
procedimentais e da fusão da geometria no arranque; ver "Problemas restantes".

## Backlog (prioridade)

1. Desempenho do arranque: gerar as texturas grandes (calçada, cubos) num worker ou a 512² na qualidade normal.
