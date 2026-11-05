import type { AgentDef } from "../data/agents";
import { createAgent, interruptedRoute, type Agent } from "./agent";
import { slide } from "./collision";
import { LANE, routeBetween, type Loc, type LocMap, type Pt } from "./locations";

/** O avatar do utilizador: anda pelos corredores e vai até à secretária de qualquer pessoa. Não faz parte da equipa. */

export const PLAYER_DEF: AgentDef = {
  id: "player",
  name: "Tu",
  role: "Visitante",
  emoji: "🙂",
  hue: 200,
  hair: "#2b2118",
  hairStyle: "short",
  skin: "#d9a577",
  x: 1.5,
  z: LANE,
  boss: "",
  screen: "doc",
};

/** Limites do corredor onde se pode andar com as setas (de ponta a ponta do edifício). */
export const CORRIDOR_MIN_X = 0.9;
export const CORRIDOR_MAX_X = 23.1;
const CORRIDOR_Z_TOLERANCE = 0.35;
const FACE_EAST = Math.PI / 2;
const FACE_WEST = -Math.PI / 2;
/** Distância máxima a que um clique no chão de uma sala "agarra" a secretária de alguém. */
const DESK_PICK_RADIUS = 2.4;

const clampX = (x: number): number => Math.min(CORRIDOR_MAX_X, Math.max(CORRIDOR_MIN_X, x));

/** Um sítio qualquer do corredor, a olhar para o lado para onde se vai. */
export function corridorSpot(x: number, facing: "east" | "west" = "east"): Loc {
  const cx = clampX(x);
  return {
    key: `player-corridor-${facing}-${cx.toFixed(2)}`,
    pts: [{ x: cx, z: LANE }],
    yaw: facing === "east" ? FACE_EAST : FACE_WEST,
    sit: 0,
    owner: null,
  };
}

export function createPlayer(): Agent {
  const player = createAgent(PLAYER_DEF, corridorSpot(PLAYER_DEF.x));
  player.task = "";
  return player;
}

export const isInCorridor = (p: Agent): boolean => Math.abs(p.z - LANE) < CORRIDOR_Z_TOLERANCE;

/** Põe o avatar a caminho de `loc` (sem mexer nos donos dos lugares: o avatar não ocupa lugares da equipa). */
export function walkTo(p: Agent, loc: Loc): void {
  p.route = interruptedRoute(p, loc) ?? routeBetween(p.loc, loc);
  p.dest = loc;
}

/** Anda ao longo do corredor para o lado pedido (-1 oeste, 1 este). Chamar sempre que a tecla está carregada. */
export function walkAlongCorridor(p: Agent, direction: -1 | 1): void {
  const end = direction === 1 ? CORRIDOR_MAX_X : CORRIDOR_MIN_X;
  const facing = direction === 1 ? "east" : "west";
  if (p.dest?.key === corridorSpot(end, facing).key) return;
  walkTo(p, corridorSpot(end, facing));
}

/** Largou-se a tecla: pára onde está (se estiver a sair de uma sala, termina a saída até ao corredor). */
export function stopWalking(p: Agent): void {
  const spot = corridorSpot(p.x, p.dest && p.dest.pts[0].x < p.x ? "west" : "east");
  if (isInCorridor(p)) {
    p.route = [];
    p.loc = spot;
    p.dest = null;
    p.yawTarget = spot.yaw;
    return;
  }
  walkTo(p, spot);
}

/** Vai até ao lugar onde se fica em pé ao lado da secretária de `agentId`. Devolve falso se o agente não existe. */
export function goToDesk(p: Agent, locs: LocMap, agentId: string): boolean {
  const spot = locs[`visit-${agentId}`];
  if (!spot) return false;
  walkTo(p, spot);
  return true;
}

/** Chegou ao lugar de visita de alguém: devolve o id dessa pessoa (para abrir a conversa e a pessoa olhar para o visitante). */
export function arrivedAtDesk(p: Agent): string | null {
  if (p.route.length > 0 || p.dest === null || p.loc !== p.dest) return null;
  return /^visit-(.+)$/.exec(p.loc.key)?.[1] ?? null;
}

/** A pessoa cuja secretária está mais perto de (x, z), se estiver dentro do raio. */
export function nearestDesk<T extends { readonly def: { readonly id: string; readonly x: number; readonly z: number } }>(
  agents: readonly T[],
  at: Pt,
): T | null {
  let best: T | null = null;
  let bestDistance = DESK_PICK_RADIUS;
  for (const a of agents) {
    const d = Math.hypot(a.def.x - at.x, a.def.z - at.z);
    if (d < bestDistance) {
      best = a;
      bestDistance = d;
    }
  }
  return best;
}

/** Um clique no corredor leva o avatar até lá. Devolve falso se o ponto não é corredor. */
export function clickCorridor(p: Agent, at: Pt): boolean {
  if (Math.abs(at.z - LANE) > 1 || at.x < CORRIDOR_MIN_X - 0.5 || at.x > CORRIDOR_MAX_X + 0.5) return false;
  walkTo(p, corridorSpot(at.x, at.x >= p.x ? "east" : "west"));
  return true;
}

const FREE_SPEED = 1.9;
const FREE_LOC: Loc = { key: "player-free", pts: [{ x: 0, z: LANE }], yaw: 0, sit: 0, owner: null };

/** Anda a pé em qualquer direção, com colisões e a deslizar ao longo das paredes. `dir` já vem relativo ao mundo. Devolve falso se não houve movimento. */
export function freeWalk(p: Agent, dirX: number, dirZ: number, dt: number): boolean {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0) return false;
  const step = FREE_SPEED * dt;
  const next = slide(p.x, p.z, (dirX / len) * step, (dirZ / len) * step);
  p.route = [];
  p.dest = null;
  p.loc = FREE_LOC;
  p.sit = 0;
  p.sitTarget = 0;
  p.x = next.x;
  p.z = next.z;
  p.yawTarget = Math.atan2(dirX, dirZ);
  p.walk = 1;
  p.phase += dt * 8;
  return true;
}
