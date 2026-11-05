import { AGENTS } from "../data/agents";
import { MAX_X, MAX_Z, MIN_X, MIN_Z, type Rect } from "./collision";
import { buildLocations, type Pt } from "./locations";

/** Disposição do mobiliário (modo editar): lógica pura, sem Three.js, para poder ser testada. */

export interface Placement {
  readonly x: number;
  readonly z: number;
  /** Quartos de volta a somar à rotação de origem (0 a 3). */
  readonly turns: number;
}

export type Layout = Readonly<Record<string, Placement>>;

export const LAYOUT_KEY = "agent-office-layout";
export const SNAP = 0.1;
const MAX_ENTRIES = 200;

/** Zonas onde não se pode pousar nada: o corredor e a entrada das portas (os agentes passam por aqui). */
export const RESTRICTED: readonly Rect[] = [
  { x0: 0, z0: 4.9, x1: 24, z1: 7.1 },
  { x0: 1.5, z0: 7, x1: 5.5, z1: 8.7 },
  { x0: 8, z0: 7, x1: 11, z1: 8.7 },
  { x0: 14, z0: 7, x1: 17, z1: 8.7 },
  { x0: 20, z0: 7, x1: 23, z1: 8.7 },
];

const PATH_WIDTH = 0.5;
const SPOT_SIZE = 0.7;

const segment = (a: Pt, b: Pt): Rect => ({
  x0: Math.min(a.x, b.x) - PATH_WIDTH / 2,
  z0: Math.min(a.z, b.z) - PATH_WIDTH / 2,
  x1: Math.max(a.x, b.x) + PATH_WIDTH / 2,
  z1: Math.max(a.z, b.z) + PATH_WIDTH / 2,
});

/**
 * Onde as pessoas ficam e por onde passam (não consultam as colisões, seguem sempre estes pontos). Reserva todos os lugares
 * e os caminhos habituais. Os caminhos das visitas ficam de fora: são tantos que não sobraria chão onde pousar nada.
 */
export function reservedAreas(): Rect[] {
  const out: Rect[] = [];
  for (const loc of Object.values(buildLocations(AGENTS))) {
    const end = loc.pts[loc.pts.length - 1];
    out.push({ x0: end.x - SPOT_SIZE / 2, z0: end.z - SPOT_SIZE / 2, x1: end.x + SPOT_SIZE / 2, z1: end.z + SPOT_SIZE / 2 });
    if (loc.key.startsWith("visit-")) continue;
    for (let i = 1; i < loc.pts.length; i++) out.push(segment(loc.pts[i - 1], loc.pts[i]));
  }
  return out;
}

const RESERVED = reservedAreas();

export const snap = (v: number, step = SNAP): number => Math.round(v / step) * step;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Lê o que está guardado; ignora tudo o que não for válido (nunca deita o escritório abaixo). */
export function parseLayout(raw: string | null): Layout {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const out: Record<string, Placement> = {};
  for (const [id, value] of Object.entries(data).slice(0, MAX_ENTRIES)) {
    if (typeof value !== "object" || value === null) continue;
    const { x, z, turns } = value as Record<string, unknown>;
    if (!isNum(x) || !isNum(z) || x < MIN_X || x > MAX_X || z < MIN_Z || z > MAX_Z) continue;
    const t = isNum(turns) ? ((Math.round(turns) % 4) + 4) % 4 : 0;
    out[id] = { x, z, turns: t };
  }
  return out;
}

/**
 * Aplica uma lista por passagens: uma peça pode caber só depois de outra sair do sítio dela.
 * Devolve o que nunca coube (fica na posição de origem).
 */
export function applyWhilePossible<T>(items: readonly T[], tryApply: (item: T) => boolean): T[] {
  let pending = [...items];
  for (;;) {
    const left = pending.filter((item) => !tryApply(item));
    if (left.length === pending.length) return left;
    pending = left;
  }
}

/** O retângulo que uma peça ocupa: roda um quarto de volta troca a largura pela profundidade. */
export function footprint(x: number, z: number, w: number, d: number, turns: number): Rect {
  const [fw, fd] = turns % 2 === 0 ? [w, d] : [d, w];
  return { x0: x - fw / 2, z0: z - fd / 2, x1: x + fw / 2, z1: z + fd / 2 };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

/** Pode-se pousar a peça aqui? Dentro do edifício, fora das zonas de passagem e sem pisar outras peças. */
export function canPlace(rect: Rect, solids: readonly Rect[], ignore: number): boolean {
  if (rect.x0 < MIN_X - 0.2 || rect.x1 > MAX_X + 0.2 || rect.z0 < MIN_Z - 0.2 || rect.z1 > MAX_Z + 0.2) return false;
  if (RESTRICTED.some((r) => overlaps(rect, r)) || RESERVED.some((r) => overlaps(rect, r))) return false;
  return !solids.some((s, i) => i !== ignore && overlaps(rect, s));
}
