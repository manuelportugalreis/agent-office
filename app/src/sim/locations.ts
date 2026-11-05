import type { AgentDef } from "../data/agents";

export interface Pt {
  readonly x: number;
  readonly z: number;
}

/** Um sítio onde um agente pode estar. `pts` vai do corredor (primeiro ponto) até ao lugar (último ponto). */
export interface Loc {
  readonly key: string;
  readonly pts: readonly Pt[];
  readonly yaw: number;
  readonly sit: 0 | 1;
  owner: string | null;
}

export type LocMap = Record<string, Loc>;

export const LANE = 6;
const DOOR_Z = 8.3;
const FACE_NORTH = Math.PI;
const FACE_SOUTH = 0;
const FACE_EAST = Math.PI / 2;
const FACE_WEST = -Math.PI / 2;
const CHAT_Z = 5.45;
/** Onde se fica em pé em frente aos bastidores dos servidores. */
const SERVER_X = 10.6;
/** Identificador do lugar junto à bandeja de revisão (usado como destino de uma entrega: `visit-tray`). */
export const TRAY_ID = "tray";
const TRAY_VISIT_KEY = `visit-${TRAY_ID}`;

const make = (key: string, pts: Pt[], yaw: number, sit: 0 | 1): Loc => ({ key, pts, yaw, sit, owner: null });

export function deskLoc(def: AgentDef): Loc {
  const pts: Pt[] = def.bottom
    ? (() => {
        const ex = def.exitX ?? def.x;
        return [
          { x: ex, z: LANE },
          { x: ex, z: DOOR_Z },
          { x: ex, z: def.z },
          { x: def.x, z: def.z },
        ];
      })()
    : [
        { x: def.x, z: LANE },
        { x: def.x, z: def.z },
      ];
  return make(`desk-${def.id}`, pts, FACE_NORTH, 1);
}

/** Lado de onde se chega a uma secretária: pelo lado livre (nunca por cima da cadeira do vizinho do canto). */
export const visitSide = (def: AgentDef): 1 | -1 => (def.x % 6 > 4.5 ? -1 : 1);

/** Onde se fica em pé ao lado da secretária de alguém (para lhe entregar um papel), a olhar para essa pessoa. */
export function visitLoc(def: AgentDef): Loc {
  const dir = visitSide(def);
  const vx = def.x + 0.9 * dir;
  const vz = def.bottom ? def.z : def.z + 0.65;
  const ex = def.exitX ?? def.x;
  const pts: Pt[] = def.bottom
    ? [
        { x: ex, z: LANE },
        { x: ex, z: DOOR_Z },
        { x: ex, z: def.z },
        { x: vx, z: def.z },
      ]
    : [
        { x: vx, z: LANE },
        { x: vx, z: vz },
      ];
  return make(`visit-${def.id}`, pts, dir === 1 ? FACE_WEST : FACE_EAST, 0);
}

export function buildLocations(defs: readonly AgentDef[]): LocMap {
  const locs: LocMap = {};
  const add = (l: Loc): void => {
    locs[l.key] = l;
  };
  defs.forEach((d) => add(deskLoc(d)));
  defs.forEach((d) => add(visitLoc(d)));

  // Sala de descanso: 3 lugares no sofá + 2 em pé junto à cafetaria.
  const door = 16.6;
  (
    [
      [14, 10.95],
      [15, 10.95],
      [16, 10.95],
    ] as const
  ).forEach(([x, z], i) =>
    add(
      make(
        `rest${i}`,
        [
          { x: door, z: LANE },
          { x: door, z: 8.4 },
          { x: door, z: 10.4 },
          { x, z: 10.4 },
          { x, z },
        ],
        FACE_NORTH,
        1,
      ),
    ),
  );
  (
    [
      [13.0, 8.1],
      [13.9, 8.1],
    ] as const
  ).forEach(([x, z], i) =>
    add(
      make(
        `rest${3 + i}`,
        [
          { x: door, z: LANE },
          { x: door, z: 8.1 },
          { x, z },
        ],
        FACE_NORTH,
        0,
      ),
    ),
  );

  // Mesa de reuniões (Gestão): 2 lugares a norte e 2 a sul.
  add(
    make(
      "meet0",
      [
        { x: 10.2, z: LANE },
        { x: 10.2, z: 8.45 },
      ],
      FACE_SOUTH,
      1,
    ),
  );
  add(
    make(
      "meet1",
      [
        { x: 10.6, z: LANE },
        { x: 10.6, z: 7.9 },
        { x: 11, z: 7.9 },
        { x: 11, z: 8.45 },
      ],
      FACE_SOUTH,
      1,
    ),
  );
  add(
    make(
      "meet2",
      [
        { x: 8.95, z: LANE },
        { x: 8.95, z: 10.55 },
        { x: 10.2, z: 10.55 },
      ],
      FACE_NORTH,
      1,
    ),
  );
  add(
    make(
      "meet3",
      [
        { x: 8.95, z: LANE },
        { x: 8.95, z: 10.55 },
        { x: 11, z: 10.55 },
      ],
      FACE_NORTH,
      1,
    ),
  );

  // Conversas no corredor: três pares de lugares frente a frente (chat0 com chat1, chat2 com chat3, chat4 com chat5).
  (
    [
      [3.0, 4.2],
      [7.0, 8.2],
      [13.2, 14.4],
    ] as const
  ).forEach(([left, right], i) => {
    add(
      make(
        `chat${i * 2}`,
        [
          { x: left, z: LANE },
          { x: left, z: CHAT_Z },
        ],
        FACE_EAST,
        0,
      ),
    );
    add(
      make(
        `chat${i * 2 + 1}`,
        [
          { x: right, z: LANE },
          { x: right, z: CHAT_Z },
        ],
        FACE_WEST,
        0,
      ),
    );
  });
  // Casa de banho (ala nova): dois lavatórios junto à parede nascente, porta virada para o corredor.
  const wcDoor = 21;
  [1.6, 2.8].forEach((z, i) =>
    add(
      make(
        `wc${i}`,
        [
          { x: wcDoor, z: LANE },
          { x: wcDoor, z: 3.8 },
          { x: 23.0, z: 3.8 },
          { x: 23.0, z },
        ],
        FACE_EAST,
        0,
      ),
    ),
  );

  // Sala de jogos: ténis de mesa, um jogador em cada ponta da mesa.
  const playDoor = 21.5;
  (
    [
      [19.3, FACE_EAST],
      [22.7, FACE_WEST],
    ] as const
  ).forEach(([x, yaw], i) =>
    add(
      make(
        `play${i}`,
        [
          { x: playDoor, z: LANE },
          { x: playDoor, z: 8.0 },
          { x, z: 8.0 },
          { x, z: 9.5 },
        ],
        yaw,
        0,
      ),
    ),
  );
  // Ginásio (sul da sala de jogos): passadeira, pesos e tapete. Os caminhos contornam a mesa de ténis de mesa.
  const gymRoute = (via: readonly Pt[], end: Pt): Pt[] => [{ x: playDoor, z: LANE }, { x: playDoor, z: 8.0 }, ...via, end];
  add(
    make(
      "gym0",
      gymRoute(
        [
          { x: 19.0, z: 8.0 },
          { x: 19.0, z: 10.4 },
        ],
        { x: 19.3, z: 10.95 },
      ),
      FACE_NORTH,
      0,
    ),
  );
  add(
    make(
      "gym1",
      gymRoute(
        [
          { x: 22.6, z: 8.0 },
          { x: 22.6, z: 10.5 },
          { x: 20.6, z: 10.5 },
        ],
        { x: 20.6, z: 11.05 },
      ),
      FACE_SOUTH,
      0,
    ),
  );
  add(
    make(
      "gym2",
      gymRoute(
        [
          { x: 22.6, z: 8.0 },
          { x: 22.6, z: 10.5 },
        ],
        { x: 22.2, z: 11.0 },
      ),
      FACE_NORTH,
      0,
    ),
  );

  // Sala de servidores (canto nascente da sala Job Search): dois sítios em frente aos bastidores.
  [1.7, 2.8].forEach((z, i) =>
    add(
      make(
        `srv${i}`,
        [
          { x: SERVER_X, z: LANE },
          { x: SERVER_X, z },
        ],
        FACE_EAST,
        0,
      ),
    ),
  );
  // Bandeja de revisão (no fim do corredor): quem leva o dossier para o utilizador rever pára aqui, virado para ela.
  add(make(TRAY_VISIT_KEY, [{ x: 1.45, z: LANE }], FACE_WEST, 0));
  return locs;
}

/** Caminho de um sítio para outro: sai de `from` até ao corredor e entra em `to`. */
export function routeBetween(from: Loc, to: Loc): Pt[] {
  return [...from.pts.slice(0, -1).reverse(), ...to.pts];
}

export function freeLoc(locs: LocMap, prefix: string): Loc | undefined {
  return Object.values(locs).find((l) => l.key.startsWith(prefix) && l.owner === null);
}
