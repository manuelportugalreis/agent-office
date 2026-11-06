import { GESTAO_SPLIT_X } from "../data/rooms";
import { isBlocked } from "./collision";
import { LANE, type Loc, type LocMap, type Pt } from "./locations";

/**
 * Lugares de pé extra em cada sala, para quando vai muita gente ao mesmo sítio ("toda a gente para a sala de jogos").
 * Ficam junto à entrada, fora da mobília (as mesmas colisões do modo andar), com um caminho livre desde o corredor.
 */

interface Area {
  readonly x0: number;
  readonly x1: number;
  /** Filas onde se fica de pé (z), da mais perto da porta para dentro. */
  readonly rows: readonly number[];
  /** Porta na parede do corredor (intervalo em x), ou null se a sala é aberta para o corredor. */
  readonly door: readonly [number, number] | null;
  /** Para onde as pessoas ficam viradas (o meio da sala). */
  readonly center: Pt;
}

const TOP_ROWS = [4.35, 3.75];
const BOTTOM_ROWS = [7.7, 8.3];

const AREAS: Readonly<Record<string, Area>> = {
  pesquisa: { x0: 0.5, x1: 5.5, rows: TOP_ROWS, door: null, center: { x: 3, z: 2.5 } },
  search: { x0: 6.5, x1: 11.5, rows: TOP_ROWS, door: null, center: { x: 9, z: 2.5 } },
  servers: { x0: 6.5, x1: 11.5, rows: TOP_ROWS, door: null, center: { x: 10.9, z: 1.5 } },
  apply: { x0: 12.5, x1: 17.5, rows: TOP_ROWS, door: null, center: { x: 15, z: 2.5 } },
  wc: { x0: 18.5, x1: 23.5, rows: TOP_ROWS, door: [20, 22], center: { x: 21, z: 2.5 } },
  masters: { x0: 0.5, x1: 5.5, rows: BOTTOM_ROWS, door: [1.5, 5.5], center: { x: 3, z: 9.5 } },
  "ceo-office": { x0: 6.5, x1: GESTAO_SPLIT_X - 0.4, rows: BOTTOM_ROWS, door: [8, GESTAO_SPLIT_X - 0.3], center: { x: 7.4, z: 10 } },
  gestao: { x0: GESTAO_SPLIT_X + 0.4, x1: 11.8, rows: BOTTOM_ROWS, door: [GESTAO_SPLIT_X + 0.3, 11], center: { x: 10.8, z: 9.5 } },
  rest: { x0: 12.5, x1: 17.5, rows: BOTTOM_ROWS, door: [14, 17], center: { x: 15, z: 10 } },
  games: { x0: 18.5, x1: 23.5, rows: BOTTOM_ROWS, door: [20, 23], center: { x: 21, z: 9.5 } },
  gym: { x0: 18.5, x1: 23.5, rows: BOTTOM_ROWS, door: [20, 23], center: { x: 21, z: 10.5 } },
};

const STEP = 0.65;
/** Distância mínima a um lugar que já existe (cadeiras, sítios de visita). */
const SPACING = 0.55;

/** O caminho está livre (amostras a cada 15 cm). */
function clear(a: Pt, b: Pt): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (isBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/** Caminho do corredor até ao lugar: pela porta (se houver) e depois ao longo da fila. */
function routeTo(area: Area, spot: Pt, row: number): Pt[] | null {
  if (!area.door) {
    const path = [{ x: spot.x, z: LANE }, spot];
    return clear(path[0], path[1]) ? path : null;
  }
  const doorX = Math.min(Math.max(spot.x, area.door[0] + 0.3), area.door[1] - 0.3);
  const enter = { x: doorX, z: row };
  const path = [{ x: doorX, z: LANE }, enter, spot];
  if (!clear(path[0], path[1]) || !clear(path[1], path[2])) return null;
  return path;
}

const cache = new Map<string, Loc[]>();

/** Os lugares de pé de um sítio (criados uma vez e juntos ao mapa de lugares). */
export function crowdLocs(place: string, locs: LocMap): Loc[] {
  const hit = cache.get(place);
  if (hit) return hit;
  const area = AREAS[place];
  if (!area) return [];
  const taken = Object.values(locs).map((l) => l.pts[l.pts.length - 1]);
  const out: Loc[] = [];
  for (const z of area.rows)
    for (let x = area.x0; x <= area.x1 + 1e-6; x += STEP) {
      const spot = { x: Math.round(x * 100) / 100, z };
      if (isBlocked(spot.x, spot.z)) continue;
      if ([...taken, ...out.map((l) => l.pts[l.pts.length - 1])].some((p) => Math.hypot(p.x - spot.x, p.z - spot.z) < SPACING)) continue;
      const pts = routeTo(area, spot, z);
      if (!pts) continue;
      const loc: Loc = {
        key: `crowd-${place}-${out.length}`,
        pts,
        yaw: Math.atan2(area.center.x - spot.x, area.center.z - spot.z),
        sit: 0,
        owner: null,
      };
      locs[loc.key] = loc;
      out.push(loc);
    }
  cache.set(place, out);
  return out;
}
