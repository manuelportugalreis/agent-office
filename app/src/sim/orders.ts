import { AGENT_ROOM, deskOwner } from "../../../shared/places";
import { cancelAmbient } from "./life";
import { crowdLocs } from "./crowd";
import { sendTo, type Agent } from "./agent";
import type { Loc, LocMap } from "./locations";

/**
 * Ordens de movimento vindas do servidor: "a Mira vai para a sala de Gestão". Traduz o sítio em lugares reais do
 * mapa, leva a personagem até lá (e deixa-a ficar) e diz ao servidor quando ela chegou, pelo estado da cena.
 */

/** Quanto tempo quem recebeu uma ordem de movimento fica onde lhe pediste (sem a vida de ambiente o levar). */
export const HOLD_MS = 15 * 60_000;

/** Lugares de cada sala onde alguém pode ficar de pé ou sentado (sem roubar a secretária de ninguém). */
const ROOM_LOCS: Readonly<Record<string, readonly string[]>> = {
  pesquisa: ["visit-rhea", "visit-mira"],
  search: ["visit-vera", "visit-scout"],
  apply: ["visit-nina", "visit-lena", "visit-theo"],
  masters: ["visit-dean", "visit-ada", "visit-turing"],
  gestao: ["meet0", "meet1", "meet2", "meet3"],
  "ceo-office": ["visit-ceo"],
  rest: ["rest0", "rest1", "rest2", "rest3", "rest4"],
  wc: ["wc0", "wc1"],
  games: ["play0", "play1"],
  gym: ["gym0", "gym1", "gym2"],
  servers: ["srv0", "srv1"],
  tray: ["visit-tray"],
};

/** Lugares possíveis para `agent` num sítio, por ordem de preferência. */
export function candidateLocs(place: string, agentId: string): string[] {
  const owner = deskOwner(place);
  if (owner) return owner === agentId ? [`desk-${agentId}`] : [`visit-${owner}`];
  // Quem trabalha nessa sala vai para a própria secretária.
  if (AGENT_ROOM[agentId] === place) return [`desk-${agentId}`];
  return [...(ROOM_LOCS[place] ?? [])];
}

/**
 * Escolhe um lugar livre (ou o que já é dele). Quando os lugares da sala acabam, usa os lugares de pé extra
 * (muita gente no mesmo sítio); se mesmo esses estiverem todos ocupados, o primeiro.
 */
export function pickLoc(locs: LocMap, place: string, agentId: string): Loc | null {
  const own = candidateLocs(place, agentId);
  const extra = own.length === 1 && own[0] === `desk-${agentId}` ? [] : crowdLocs(place, locs).map((l) => l.key);
  const keys = [...own, ...extra].filter((k) => locs[k]);
  if (keys.length === 0) return null;
  const free = keys.find((k) => locs[k].owner === null || locs[k].owner === agentId);
  return locs[free ?? keys[0]];
}

export interface PendingMove {
  readonly id: number;
  readonly agent: Agent;
  readonly loc: Loc;
}

/** Leva o agente até ao sítio. Devolve a deslocação a acompanhar, ou um motivo se não há lugar para isso. */
export function startMove(agent: Agent, place: string, locs: LocMap, id: number, now = 0): PendingMove | { error: string } {
  const loc = pickLoc(locs, place, agent.def.id);
  if (!loc) return { error: `não há lugar para ${agent.def.name} em "${place}" no mapa` };
  cancelAmbient(agent);
  // Fica onde lhe pediste: sem café nem passeios durante um bom bocado (ou até à próxima ordem).
  agent.holdUntil = now + HOLD_MS;
  const kind = loc.key === `desk-${agent.def.id}` ? "desk" : "go";
  // Já lá está, parado: não sai e volta a entrar.
  if (agent.loc === loc && agent.route.length === 0) agent.kind = kind;
  else sendTo(agent, loc, kind);
  return { id, agent, loc };
}

/** Chegou ao lugar (parado lá), foi desviado para outro sítio, ou ainda vai a caminho. */
export function moveStatus(m: PendingMove): "arrived" | "diverted" | "walking" {
  if (m.agent.dest !== m.loc && m.agent.loc !== m.loc) return "diverted";
  if (m.agent.route.length === 0 && m.agent.loc === m.loc) return "arrived";
  return "walking";
}

/** Resposta à cena sobre uma ordem de movimento (chegou, ou porquê que não). */
export interface Arrival {
  readonly id: number;
  readonly ok: boolean;
  readonly reason?: string;
}

export interface MoveQueueDeps {
  readonly find: (agentId: string) => Agent | undefined;
  readonly locs: LocMap;
  /** Responde ao servidor (chegou ou não). */
  readonly reply: (a: Arrival) => void;
  /** A pessoa começou a andar para `place` (para mostrar "a caminho"). */
  readonly started: (agent: Agent, place: string) => void;
  readonly now: () => number;
}

/**
 * Ordens de movimento do servidor: leva a pessoa ao sítio e responde quando chega (ou se foi desviada). Uma ordem nova
 * para a mesma pessoa substitui a anterior, que fica respondida (senão o servidor esperava por ela até desistir).
 */
export function createMoveQueue(d: MoveQueueDeps) {
  let pending: PendingMove[] = [];
  return {
    begin(id: number, agentId: string, place: string): void {
      const a = d.find(agentId);
      if (!a) return d.reply({ id, ok: false, reason: "essa pessoa não existe na cena" });
      const started = startMove(a, place, d.locs, id, d.now());
      if ("error" in started) return d.reply({ id, ok: false, reason: started.error });
      for (const old of pending.filter((m) => m.agent === a))
        d.reply({ id: old.id, ok: false, reason: "substituída por outra ordem de movimento" });
      pending = [...pending.filter((m) => m.agent !== a), started];
      d.started(a, place);
    },
    /** Vê quem já chegou (ou foi desviado) e responde por cada um. */
    check(): void {
      const done = pending.filter((m) => moveStatus(m) !== "walking");
      pending = pending.filter((m) => moveStatus(m) === "walking");
      for (const m of done)
        d.reply(
          moveStatus(m) === "arrived"
            ? { id: m.id, ok: true }
            : { id: m.id, ok: false, reason: "foi desviada para outro sítio antes de chegar" },
        );
    },
  };
}
