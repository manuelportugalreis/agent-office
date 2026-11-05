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

## Backlog (prioridade)

1. Pastelaria com esplanada, candeeiros lisboetas, placas toponímicas, números de polícia, sarjetas, árvores,
   manjericos e arraial discreto.
2. Vida: peões, roupa e bandeirolas a ondular, pombos.
3. Desempenho: instanciar peças repetidas da rua, rever passagens de pós-processamento.
