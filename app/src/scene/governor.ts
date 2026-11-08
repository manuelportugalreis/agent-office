/**
 * Regulador de desempenho: mede os fps e, se a cena estiver lenta, alivia-a por passos: primeiro a qualidade alta
 * (oclusão, brilho), depois a resolução (100% → 75% → 50%). Nunca sobe sozinho: quem quiser mais volta a ligar em Vista.
 * Puro (sem three.js) para se testar; o palco aplica as ações.
 */

export type GovernorAction = { readonly kind: "quality" } | { readonly kind: "scale"; readonly scale: number };

export interface GovernorOptions {
  /** Abaixo disto a cena está lenta. */
  readonly minFps?: number;
  /** Segundos de cada medição. */
  readonly windowS?: number;
  /** Segundos ignorados no arranque (compilação de shaders, modelos a carregar). */
  readonly warmupS?: number;
  /** Escalas de resolução por ordem. */
  readonly scales?: readonly number[];
}

export interface Governor {
  /** Um frame com `dt` segundos. Devolve a ação a aplicar quando uma medição acaba lenta. */
  frame(dt: number, state: { readonly highQuality: boolean; readonly scale: number }): GovernorAction | null;
}

const MIN_FPS = 25;
/**
 * Abaixo disto não é a cena a ser pesada: é o browser a abrandar uma janela tapada ou em segundo plano (até uma página
 * só com texto fica a ~1 fps). Nesses casos não se mexe em nada.
 */
const THROTTLED_FPS = 4;
const WINDOW_S = 3;
const WARMUP_S = 3;
const SCALES = [1, 0.75, 0.5];
/** Um frame com mais do que isto (separador escondido, depurador) não conta: não é a cena a ser lenta. */
const MAX_DT_S = 3;

export function createGovernor(opts: GovernorOptions = {}): Governor {
  const minFps = opts.minFps ?? MIN_FPS;
  const windowS = opts.windowS ?? WINDOW_S;
  const scales = opts.scales ?? SCALES;
  let warmup = opts.warmupS ?? WARMUP_S;
  let elapsed = 0;
  let frames = 0;
  return {
    frame(dt, state) {
      if (dt <= 0 || dt > MAX_DT_S) return null;
      if (warmup > 0) {
        warmup -= dt;
        return null;
      }
      elapsed += dt;
      frames++;
      if (elapsed < windowS) return null;
      const fps = frames / elapsed;
      elapsed = 0;
      frames = 0;
      if (fps >= minFps || fps < THROTTLED_FPS) return null;
      // Depois de cada passo, uma nova medição (com um pequeno arranque para a mudança assentar).
      warmup = 1;
      if (state.highQuality) return { kind: "quality" };
      const next = scales.find((s) => s < state.scale - 1e-6);
      return next === undefined ? null : { kind: "scale", scale: next };
    },
  };
}
