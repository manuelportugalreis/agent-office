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

export const ROOMS: readonly RoomDef[] = [
  { id: "pesquisa", name: "Pesquisa", x0: 0, z0: 0, hue: 210, floor: ["carpet", "#6f8fb0", "#4f6f92"] },
  { id: "search", name: "Job Search", x0: 6, z0: 0, hue: 145, floor: ["wood", "#c9a97c", "#a5835a"] },
  { id: "apply", name: "Job Application", x0: 12, z0: 0, hue: 25, floor: ["carpet", "#b9a28c", "#8f7860"] },
  { id: "masters", name: "Masters", x0: 0, z0: 7, hue: 270, floor: ["carpet", "#8b80a6", "#6c628a"], gap: [1.5, 5.5] },
  { id: "gestao", name: "Gestão", x0: 6, z0: 7, hue: 48, floor: ["wood", "#7a553b", "#573a26"], gap: [8, 11] },
  { id: "wc", name: "Casa de banho", x0: 18, z0: 0, hue: 195, floor: ["tile", "#a9cdd9", "#86b4c4"] },
  { id: "games", name: "Sala de jogos", x0: 18, z0: 7, hue: 100, floor: ["carpet", "#6f9a7a", "#527a5f"], gap: [20, 23] },
  { id: "rest", name: "Descanso", x0: 12, z0: 7, hue: 340, floor: ["wood", "#d6b98f", "#b4966a"], gap: [14, 17] },
];
