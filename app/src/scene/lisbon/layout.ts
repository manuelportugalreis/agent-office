/**
 * Planta do bairro (em metros, eixos da cena): o escritório ocupa o último piso de um prédio de gaveto, com a rua
 * do eléctrico a sul (+z) e uma travessa a nascente (+x). Os vizinhos encostam-se a poente e a norte.
 */

export const FLOOR_H = 3;
export const OFFICE_FLOORS = 3;
/** Nível da rua. */
export const BASE_Y = -0.4 - OFFICE_FLOORS * FLOOR_H;

/** Prédio do escritório. */
export const OFFICE = { x0: -0.4, x1: 24.4, z0: -0.4, z1: 12.4 } as const;

/** Rua do eléctrico (sul): passeio junto ao prédio, faixa de rodagem com carris e passeio do largo. */
export const SOUTH = {
  walk0: OFFICE.z1,
  curb0: OFFICE.z1 + 2.4,
  curb1: OFFICE.z1 + 9.2,
  walk1: OFFICE.z1 + 11.4,
} as const;
export const TRAM_Z = (SOUTH.curb0 + SOUTH.curb1) / 2;

/** Travessa (nascente). */
export const EAST = {
  walk0: OFFICE.x1,
  curb0: OFFICE.x1 + 2.2,
  curb1: OFFICE.x1 + 8.2,
  walk1: OFFICE.x1 + 10.4,
} as const;

/** Limites da maqueta. */
export const WORLD = { x0: -36, x1: 50, z0: -31, z1: 40 } as const;
