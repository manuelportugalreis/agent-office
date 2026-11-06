export type FloorKind = "wood" | "carpet" | "tile";

export interface RoomDef {
  readonly id: string;
  readonly name: string;
  readonly x0: number;
  readonly z0: number;
  readonly hue: number;
  readonly floor: readonly [kind: FloorKind, base: string, accent: string];
  /** Intervalo em x da abertura (porta) na divisória z=7, só nas salas de baixo. */
  readonly gap?: readonly [number, number];
}

export const ROOM_W = 6;
export const ROOM_D = 5;
/** A sala de Gestão está dividida por uma divisória de vidro: a poente o gabinete do Atlas, a nascente a sala de reuniões dos chefes. */
export const GESTAO_SPLIT_X = 9;

export const ROOMS: readonly RoomDef[] = [
  { id: "pesquisa", name: "Projetos", x0: 0, z0: 0, hue: 210, floor: ["carpet", "#8497ab", "#6b7f94"] },
  { id: "search", name: "Job Search", x0: 6, z0: 0, hue: 145, floor: ["wood", "#c9a97c", "#a5835a"] },
  { id: "apply", name: "Candidaturas e Outreach", x0: 12, z0: 0, hue: 25, floor: ["carpet", "#bba995", "#9a8872"] },
  { id: "masters", name: "Mestrado", x0: 0, z0: 7, hue: 270, floor: ["carpet", "#958da6", "#7a7391"], gap: [1.5, 5.5] },
  {
    id: "gestao",
    name: "Gabinete do Atlas e sala de reuniões",
    x0: 6,
    z0: 7,
    hue: 48,
    floor: ["wood", "#8a6a52", "#6a4e3a"],
    gap: [8, 11],
  },
  { id: "wc", name: "Casa de banho", x0: 18, z0: 0, hue: 195, floor: ["tile", "#b4cbd2", "#97b3bc"] },
  { id: "games", name: "Sala de jogos", x0: 18, z0: 7, hue: 100, floor: ["carpet", "#7f9c88", "#648270"], gap: [20, 23] },
  { id: "rest", name: "Descanso", x0: 12, z0: 7, hue: 340, floor: ["wood", "#d6b98f", "#b4966a"], gap: [14, 17] },
];
