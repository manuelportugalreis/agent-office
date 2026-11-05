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

## Backlog (prioridade)

1. Rua: faixa de rodagem em cubos de granito, passeios em calçada branca com lancil, carris embutidos, largo com
   desenho de ondas mais discreto, maqueta com corte de terreno.
2. Eléctrico 28 remodelado (perfil arredondado, janelas, portas, trólei, letreiro) e animação com paragem.
3. Iluminação: noite real (ambiente desligado, candeeiros), sombras a cobrir a rua, exposição, sol quente.
4. Pastelaria com esplanada, candeeiros lisboetas, placas toponímicas, números de polícia, sarjetas, árvores,
   manjericos e arraial discreto.
5. Vida: peões, roupa e bandeirolas a ondular, pombos.
6. Desempenho: instanciar peças repetidas da rua, rever passagens de pós-processamento.
