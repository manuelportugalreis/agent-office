import { AGENTS } from "../data/agents";
import { ROOM_D, ROOM_W, ROOMS } from "../data/rooms";

/** Onde se pode andar a pé no escritório: paredes, divisórias de vidro e mobília grande. Tudo em metros no plano (x, z). */

export interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

export const WALK_RADIUS = 0.26;
const WALL = 0.07;

const box = (cx: number, cz: number, w: number, d: number): Rect => ({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });
const wallX = (x: number, z0: number, z1: number): Rect => ({ x0: x - WALL, z0, x1: x + WALL, z1 });
const wallZ = (z: number, x0: number, x1: number): Rect => ({ x0, z0: z - WALL, x1, z1: z + WALL });

function buildSolids(): Rect[] {
  const out: Rect[] = [];
  // Paredes de fora (menos o corredor, aberto nas pontas) e divisórias entre salas.
  for (const z0 of [0, ROOM_D + 2]) {
    out.push(wallX(0, z0, z0 + ROOM_D), wallX(24, z0, z0 + ROOM_D));
    for (const x of [6, 12, 18]) out.push(wallX(x, z0, z0 + ROOM_D));
  }
  out.push(wallZ(0, 0, 24), wallZ(12, 0, 24));
  // Salas de baixo: parede para o corredor com a porta (gap).
  for (const r of ROOMS) {
    if (!r.gap) continue;
    out.push(wallZ(7, r.x0, r.gap[0]), wallZ(7, r.gap[1], r.x0 + ROOM_W));
  }
  // Casa de banho: parede para o corredor com a porta entre x = 20 e 22.
  out.push(wallZ(5, 18, 20), wallZ(5, 22, 24));
  // Secretárias.
  for (const a of AGENTS) {
    const d = a.desk ?? ([a.x, 1.4, 1.4] as const);
    out.push(box(d[0], d[1], d[2], 0.8));
  }
  for (const roomX of [0]) out.push(box(roomX + 1.2 + 2 * 1.8, 1.4, 1.4, 0.8));
  // Mobília grande.
  out.push(
    box(10.8, 9.5, 2.4, 1.0), // mesa de reuniões
    box(15, 11.3, 3.2, 0.95), // sofá
    box(21, 9.5, 2.4, 1.3), // ténis de mesa
    box(23.4, 11.4, 0.9, 0.7), // máquina de venda
    box(0.3, 3.6, 0.5, 1.4), // estantes
    box(0.3, 8.2, 0.5, 1.5),
    box(6.5, 4.5, 0.5, 0.6), // arquivos
    box(7.15, 4.5, 0.5, 0.6),
    box(12.8, 4.4, 0.6, 0.5), // impressora
    box(19.3, 11.0, 0.8, 1.7), // passadeira
    box(20.6, 11.72, 1.1, 0.4), // pesos
    box(13.2, 7.55, 0.9, 0.5), // café
    box(22.7, 5.35, 1.3, 0.5), // receção
    box(23.25, 6.35, 0.5, 0.5), // segurança
  );
  // Sala de servidores: quatro bastidores encostados à parede nascente.
  for (const z of [1.0, 1.7, 2.4, 3.1]) out.push(box(11.55, z, 0.9, 0.65));
  // Casa de banho: sanitas, cabines e lavatórios.
  for (const x of [18.9, 20.1]) out.push(box(x, 0.7, 0.45, 0.6), box(x + 0.55, 1.0, 0.1, 1.8));
  for (const z of [1.6, 2.8]) out.push(box(23.55, z, 0.5, 0.7));
  return out;
}

export const SOLIDS: readonly Rect[] = buildSolids();

/** Distância de (x, z) ao retângulo (0 se estiver lá dentro). */
function distance(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

export const MIN_X = 0.3;
export const MAX_X = 23.7;
export const MIN_Z = 0.35;
export const MAX_Z = 11.65;

export function isBlocked(x: number, z: number, solids: readonly Rect[] = SOLIDS): boolean {
  if (x < MIN_X || x > MAX_X || z < MIN_Z || z > MAX_Z) return true;
  return solids.some((r) => distance(x, z, r) < WALK_RADIUS);
}

/** Dá um passo de (x, z) na direção (dx, dz); se bater, desliza ao longo do obstáculo (primeiro em x, depois em z). */
export function slide(x: number, z: number, dx: number, dz: number, solids: readonly Rect[] = SOLIDS): { x: number; z: number } {
  let nx = x;
  let nz = z;
  if (!isBlocked(x + dx, z, solids)) nx = x + dx;
  if (!isBlocked(nx, z + dz, solids)) nz = z + dz;
  return { x: nx, z: nz };
}
