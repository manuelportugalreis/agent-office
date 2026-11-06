import { AGENT_ROOM, deskPlace, fold } from "../../shared/places.ts";
import { parsePlaceText, type AgentName, type PlaceRef } from "./intent.ts";

/**
 * Ordens de grupo: "vai toda a gente para a sala de jogos", "os chefes à sala de reuniões", "o gabinete de Projetos
 * vai ao meu gabinete", "a Mira e a Lena venham à copa", "cada um para o seu gabinete", "voltem aos vossos lugares".
 * Sem limite de pessoas (o plano do Atlas só tem 3 tarefas; andar não é uma tarefa).
 */

export interface GroupMove {
  readonly agents: readonly string[];
  /** Um sítio para todos, ou "own": cada um para a sua secretária. */
  readonly to: PlaceRef | "own";
}

/** Os chefes (reúnem na sala de reuniões). */
export const CHIEF_IDS = ["ceo", "rhea", "vera", "nina", "dean"];

const EVERYONE = [
  "toda a gente",
  "todos",
  "todas",
  "toda a equipa",
  "a equipa toda",
  "a equipa",
  "equipa",
  "o pessoal",
  "pessoal",
  "a malta",
  "malta",
  "todo o escritorio",
  "toda a empresa",
];
const CHIEFS = ["os chefes", "chefes", "as chefias", "chefias", "todos os chefes"];
/** Verbos de movimento no plural e no singular ("vão", "voltem", "vai toda a gente"). */
const VERBS = [
  "vao",
  "vai",
  "va",
  "vamos",
  "ide",
  "ir",
  "voltem",
  "volta",
  "voltam",
  "venham",
  "vem",
  "passem",
  "passa",
  "sigam",
  "regressem",
  "regressa",
  "corram",
  "dirijam se",
  "desloquem se",
  "juntem se",
  "reunam se",
  "aparecam",
];
const SENDERS = ["manda", "mande", "envia", "leva", "diz a", "diz", "pede a", "pede"];
const PREPS = ["ate ao", "ate a", "para o", "para a", "para os", "para as", "para", "ao", "aos", "a", "as", "na", "no", "pro", "pra"];
/** "O seu gabinete", "os vossos lugares", "as secretárias": cada um para o seu sítio. */
const OWN = [
  "o seu gabinete",
  "seu gabinete",
  "os seus gabinetes",
  "seus gabinetes",
  "os vossos gabinetes",
  "vossos gabinetes",
  "o vosso gabinete",
  "a sua secretaria",
  "sua secretaria",
  "as suas secretarias",
  "suas secretarias",
  "as vossas secretarias",
  "vossas secretarias",
  "o seu lugar",
  "seu lugar",
  "os seus lugares",
  "seus lugares",
  "os vossos lugares",
  "vossos lugares",
  "os lugares",
  "lugares",
  "as secretarias",
  "secretarias",
  "o seu posto",
  "os vossos postos",
  "postos",
  "o trabalho",
  "ao trabalho",
  "trabalho",
];

const words = (text: string): string[] => fold(text).split(" ").filter(Boolean);
/** Comprimento da frase da lista que começa em `at` (a mais longa). */
function phrase(ws: readonly string[], at: number, list: readonly string[]): number {
  let best = 0;
  for (const p of list) {
    const n = p.split(" ").length;
    if (n > best && ws.slice(at, at + n).join(" ") === p) best = n;
  }
  return best;
}

/** O grupo que começa em `at`: todos, os chefes, um gabinete ("o gabinete de Projetos") ou nomes ("a Mira e a Lena"). */
function groupAt(ws: readonly string[], at: number, agents: readonly AgentName[]): { ids: string[]; used: number } | null {
  const all = phrase(ws, at, EVERYONE);
  if (all) return { ids: agents.map((a) => a.id), used: all };
  const chiefs = phrase(ws, at, CHIEFS);
  if (chiefs) return { ids: CHIEF_IDS.filter((id) => agents.some((a) => a.id === id)), used: chiefs };
  // "o gabinete de Projetos", "a sala do Mestrado", "os de Job Search": quem lá trabalha.
  for (let n = 6; n >= 2; n--) {
    const ref = parsePlaceText(ws.slice(at, at + n).join(" "), agents, null);
    if (ref?.kind === "place" && Object.values(AGENT_ROOM).includes(ref.id)) {
      const ids = agents.filter((a) => AGENT_ROOM[a.id] === ref.id).map((a) => a.id);
      if (ids.length > 1) return { ids, used: n };
    }
  }
  // Nomes: "a Mira e a Lena", "Mira, Lena e Scout" (pelo menos dois).
  const ids: string[] = [];
  let i = at;
  for (;;) {
    while (["a", "o", "e"].includes(ws[i] ?? "")) i++;
    const a = agents.find((x) => fold(x.name) === ws[i] || x.id === ws[i]);
    if (!a) break;
    ids.push(a.id);
    i++;
  }
  return ids.length >= 2 ? { ids, used: i - at } : null;
}

/** O destino que começa em `at` e vai até ao fim da ordem: um sítio, ou o lugar de cada um. */
function destinationAt(ws: readonly string[], at: number, agents: readonly AgentName[]): PlaceRef | "own" | null {
  const prep = phrase(ws, at, PREPS);
  const rest = ws.slice(at + prep);
  if (!rest.length) return null;
  if (phrase(rest, 0, OWN) === rest.length) return "own";
  const ref = parsePlaceText(rest.join(" "), agents, null);
  return ref && ref.kind !== "unknown" ? ref : null;
}

/** Lê uma ordem de grupo, ou devolve null (não é uma ordem de grupo de movimento). */
export function parseGroupMove(text: string, agents: readonly AgentName[]): GroupMove | null {
  let ws = words(text);
  // "Atlas, …" e palavras de arranque.
  if (ws[0] === "atlas" || ws[0] === "ceo") ws = ws.slice(1);
  while (["agora", "entao", "ok", "pronto", "bem", "olha", "ja", "e", "por", "favor"].includes(ws[0] ?? "")) ws = ws.slice(1);
  // "Cada um para o seu gabinete", "cada um vai para a sua secretária".
  if (ws[0] === "cada" && ws[1] === "um") {
    let at = 2;
    at += phrase(ws, at, VERBS);
    const to = destinationAt(ws, at, agents);
    return to === "own" ? { agents: agents.map((a) => a.id), to } : null;
  }
  const sender = phrase(ws, 0, SENDERS);
  let at = sender;
  let verb = phrase(ws, at, VERBS);
  at += verb;
  const group = groupAt(ws, at, agents);
  // Sem grupo explícito: "voltem aos vossos lugares", "vão todos" (verbo no plural) é para toda a gente.
  if (!group) {
    if (!verb || !["vao", "voltem", "venham", "passem", "sigam", "regressem", "corram", "ide", "vamos"].includes(ws[at - verb] ?? ""))
      return null;
    const after = phrase(ws, at, ["todos", "todas"]);
    const to = destinationAt(ws, at + after, agents);
    return to ? { agents: agents.map((a) => a.id), to } : null;
  }
  at += group.used;
  // "toda a gente vai para…", "os chefes, venham à sala de reuniões", "todos para a copa".
  if (!verb) at += verb = phrase(ws, at, VERBS);
  at += phrase(ws, at, ["todos", "todas", "la", "ca"]);
  const to = destinationAt(ws, at, agents);
  if (!to) return null;
  // Sem verbo (nem "manda") tem de haver uma preposição antes do sítio ("todos para a copa", "os chefes à sala de
  // reuniões"); "toda a gente da sala de jogos" não é ordem.
  if (!verb && !sender && !phrase(ws, at, PREPS)) return null;
  return { agents: group.ids, to };
}

/** O sítio de cada agente num movimento de grupo. */
export const groupDestination = (move: GroupMove, agentId: string): PlaceRef =>
  move.to === "own" ? { kind: "place", id: deskPlace(agentId) } : move.to;
