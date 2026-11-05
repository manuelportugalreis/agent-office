import type { AgentDef } from "../data/agents";
import { createAgent, isSettled, sendTo, type Agent } from "./agent";
import type { Loc, LocMap } from "./locations";

/**
 * O Joaquim da limpeza. Não faz parte da equipa e não trabalha para o espetáculo: só sai do sítio quando uma conversa foi
 * mesmo limpa ("Nova conversa"), vai à secretária desse agente, passa a esfregona e volta.
 */
export const JANITOR_DEF: AgentDef = {
  id: "janitor",
  name: "Joaquim",
  role: "Limpeza",
  emoji: "🧹",
  hue: 185,
  hair: "#8a8a8a",
  hairStyle: "short",
  skin: "#d9a679",
  x: 4.4,
  z: 6.55,
  boss: "",
  screen: "doc",
};

export const CLEAN_MS = 4000;
const FACE_EAST = Math.PI / 2;
const HOME: Loc = { key: "janitor-home", pts: [{ x: 4.4, z: 6.55 }], yaw: FACE_EAST, sit: 0, owner: null };

export interface Janitor {
  readonly agent: Agent;
  readonly queue: string[];
  /** Quando acaba de limpar o sítio atual (0 = ainda a caminho ou sem trabalho). */
  until: number;
  working: boolean;
}

export function createJanitor(): Janitor {
  const agent = createAgent(JANITOR_DEF, HOME);
  agent.task = "";
  return { agent, queue: [], until: 0, working: false };
}

/** Lugar próprio junto à secretária: os mesmos pontos da visita, sem ocupar o lugar de quem vem entregar um papel. */
function cleanLoc(locs: LocMap, agentId: string): Loc | null {
  const visit = locs[`visit-${agentId}`];
  return visit ? { ...visit, key: `clean-${agentId}`, owner: null } : null;
}

/** Pede para limpar junto à secretária de um agente. Pedidos repetidos para o mesmo agente contam uma vez. */
export function requestCleaning(j: Janitor, agentId: string): void {
  if (!j.queue.includes(agentId)) j.queue.push(agentId);
}

/** Avança o trabalho (chamar várias vezes por segundo). */
export function janitorUpdate(j: Janitor, locs: LocMap, now: number): void {
  const a = j.agent;
  if (!isSettled(a)) return;
  if (j.working) {
    if (j.until === 0) {
      j.until = now + CLEAN_MS;
      return;
    }
    if (now < j.until) return;
    j.working = false;
    j.until = 0;
  }
  const next = j.queue.shift();
  const loc = next ? cleanLoc(locs, next) : null;
  if (loc) {
    sendTo(a, loc, "clean");
    j.working = true;
    return;
  }
  if (a.loc !== HOME) sendTo(a, HOME, "desk");
}
