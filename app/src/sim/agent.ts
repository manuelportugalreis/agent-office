import type { AgentDef, AgentState, Deadline } from "../data/agents";
import { routeBetween, type Loc, type Pt } from "./locations";

/** Onde o agente está ou para onde vai: à secretária, no descanso, em reunião, a conversar ou a entregar um papel. */
/** `go`: foi a um sítio porque lhe pediste, e fica lá até lhe pedires outra coisa (a vida de ambiente não o tira de lá). */
export type Kind = "desk" | "rest" | "meet" | "chat" | "visit" | "wc" | "play" | "gym" | "server" | "clean" | "go";
export type DisplayState = AgentState | Exclude<Kind, "desk">;
export type LogLine = readonly [time: string, text: string];

/** Pequenos gestos à secretária (só aparência, sem significado para o trabalho). */
export type FidgetKind = "stretch" | "look" | "sip";

const WALK_SPEED = 1.45;
const STAND_UP_THRESHOLD = 0.12;
const TURN_RATE = 8;
const SIT_RATE = 5;
const WALK_BLEND_RATE = 8;

/** Estado mutável de simulação de um agente (a vista 3D só lê). */
export interface Agent {
  readonly def: AgentDef;
  /** Função mostrada (por defeito a do agente; o servidor pode trocá-la, ex.: nome da disciplina). */
  role: string;
  /** Código da disciplina no Canvas (só agentes de disciplina; vem da configuração do servidor). */
  course: string | null;
  x: number;
  z: number;
  yaw: number;
  yawTarget: number;
  /** 0 = em pé, 1 = sentado (interpolado). */
  sit: number;
  sitTarget: number;
  phase: number;
  walk: number;
  route: Pt[];
  loc: Loc;
  dest: Loc | null;
  kind: Kind;
  state: AgentState;
  /** Prende o agente à secretária (tarefa real em curso). */
  pinned: boolean;
  task: string;
  /** Entregas do Canvas (vazio até à primeira sincronização real). */
  deadlines: readonly Deadline[];
  syncedAt: string | null;
  logs: LogLine[];
  /** Quando deve voltar à secretária (ms), se estiver fora dela por vontade própria (descanso, conversa). */
  dwellUntil: number;
  /** A levar um papel na mão (a entregar uma tarefa). */
  carrying: boolean;
  /** Agentes a quem ainda tem de levar um papel, por ordem. */
  visitQueue: string[];
  fidget: { kind: FidgetKind; until: number } | null;
  /** Último erro da tarefa deste agente (para o painel mostrar o motivo verdadeiro). */
  lastError: string | null;
  /** Quanto tempo fica onde foi (ms), contado a partir da chegada, não da partida. */
  dwellFor: number;
  /** Uso desde que abriste a página: tarefas concluídas, falhadas e custo equivalente (o plano é Enterprise, não pagas por tarefa). */
  usage: { done: number; failed: number; costUsd: number };
  /** Para onde está a olhar (o colega com quem fala, quem lhe traz um papel). */
  lookAt: { x: number; z: number; until: number } | null;
  /** Até quando fica onde lhe pediste (ms, relógio de performance.now): sem passeios nem café entretanto. */
  holdUntil: number;
}

export function createAgent(def: AgentDef, home: Loc): Agent {
  const seat = home.pts[home.pts.length - 1];
  home.owner = def.id;
  return {
    def,
    role: def.role,
    course: null,
    x: seat.x,
    z: seat.z,
    yaw: home.yaw,
    yawTarget: home.yaw,
    sit: home.sit,
    sitTarget: home.sit,
    phase: 0,
    walk: 0,
    route: [],
    loc: home,
    dest: null,
    kind: "desk",
    state: "idle",
    pinned: false,
    task: "Sem tarefa neste momento.",
    deadlines: [],
    syncedAt: null,
    logs: [],
    dwellUntil: 0,
    carrying: false,
    visitQueue: [],
    fidget: null,
    lastError: null,
    dwellFor: 0,
    lookAt: null,
    holdUntil: 0,
    usage: { done: 0, failed: 0, costUsd: 0 },
  };
}

/** No sítio para onde o mandaste, o que conta é o que está a fazer (a pensar, a trabalhar); parado, mostra que foi lá. */
export const stateOf = (a: Agent): DisplayState => (a.kind === "desk" || (a.kind === "go" && a.state !== "idle") ? a.state : a.kind);

export function teleport(a: Agent, loc: Loc, kind: Kind): void {
  a.loc.owner = null;
  a.loc = loc;
  loc.owner = a.def.id;
  const seat = loc.pts[loc.pts.length - 1];
  a.x = seat.x;
  a.z = seat.z;
  a.yaw = a.yawTarget = loc.yaw;
  a.sit = a.sitTarget = loc.sit;
  a.kind = kind;
}

/**
 * Caminho para `to` quando o agente ainda vai a meio de outro percurso (`a.route` termina nos pontos do destino abandonado).
 * Se ainda está a sair do sítio de partida, termina essa saída; se já entrou no destino, volta pelos mesmos pontos até ao corredor.
 */
export function interruptedRoute(a: Agent, to: Loc): Pt[] | null {
  if (!a.dest || a.route.length === 0) return null;
  const left = a.route.length;
  const entry = a.dest.pts.length;
  if (left > entry) return [...a.route.slice(0, left - entry), ...to.pts];
  return [...a.dest.pts.slice(0, entry - left).reverse(), ...to.pts];
}

export function sendTo(a: Agent, loc: Loc, kind: Kind): void {
  // Se ainda ia a caminho de outro sítio, esse lugar reservado fica livre.
  if (a.dest && a.dest !== loc && a.dest.owner === a.def.id) a.dest.owner = null;
  if (a.loc.owner === a.def.id) a.loc.owner = null;
  loc.owner = a.def.id;
  a.route = interruptedRoute(a, loc) ?? routeBetween(a.loc, loc);
  a.dest = loc;
  a.kind = kind;
}

/** Está parado num sítio (sem caminho por fazer). */
export const isSettled = (a: Agent): boolean => a.route.length === 0;

const approach = (value: number, target: number, rate: number, dt: number): number => value + (target - value) * Math.min(1, dt * rate);

export function stepAgent(a: Agent, dt: number): void {
  a.sit = approach(a.sit, a.sitTarget, SIT_RATE, dt);
  if (a.route.length > 0) {
    advance(a, dt);
  } else {
    a.walk = approach(a.walk, 0, WALK_BLEND_RATE, dt);
  }
  const turn = Math.atan2(Math.sin(a.yawTarget - a.yaw), Math.cos(a.yawTarget - a.yaw));
  a.yaw += turn * Math.min(1, dt * TURN_RATE);
}

function advance(a: Agent, dt: number): void {
  a.walk = approach(a.walk, 1, WALK_BLEND_RATE, dt);
  if (a.sit > STAND_UP_THRESHOLD) {
    a.sitTarget = 0;
    a.walk = 0;
    return;
  }
  const p = a.route[0];
  const dx = p.x - a.x;
  const dz = p.z - a.z;
  const dist = Math.hypot(dx, dz);
  const stepLen = WALK_SPEED * dt;
  a.yawTarget = Math.atan2(dx, dz);
  a.phase += dt * 8;
  if (dist > stepLen) {
    a.x += (dx / dist) * stepLen;
    a.z += (dz / dist) * stepLen;
    return;
  }
  a.x = p.x;
  a.z = p.z;
  a.route.shift();
  if (a.route.length === 0 && a.dest) {
    a.loc = a.dest;
    a.sitTarget = a.dest.sit;
    a.yawTarget = a.dest.yaw;
  }
}
