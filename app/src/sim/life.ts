import { MEETING_IDS } from "../data/agents";
import { isSettled, sendTo, type Agent, type FidgetKind } from "./agent";
import { freeLoc, TRAY_ID, type LocMap } from "./locations";

/**
 * A vida do escritório. Tudo o que está aqui é ambiente: pessoas que vão ao café, conversam, se espreguiçam.
 * Nunca finge trabalho: só quem está LIVRE (estado "idle", sem tarefa real) faz estas coisas, e quem tem uma
 * tarefa real fica na secretária. As visitas (um papel entregue a um colega) só acontecem quando o CEO delega mesmo.
 */

type Rng = () => number;

const COFFEE_CHANCE = 0.14;
const CHAT_CHANCE = 0.1;
const MEETING_CHANCE = 0.015;
const WC_CHANCE = 0.06;
const PLAY_CHANCE = 0.07;
const GYM_CHANCE = 0.06;
const SERVER_CHANCE = 0.04;
const FIDGET_CHANCE = 0.08;
const MIN_MEETING_SIZE = 3;
const WC_DWELL_MS: readonly [number, number] = [5000, 8000];
const PLAY_DWELL_MS: readonly [number, number] = [14000, 22000];
const GYM_DWELL_MS: readonly [number, number] = [12000, 20000];
const SERVER_DWELL_MS: readonly [number, number] = [8000, 14000];

const REST_DWELL_MS: readonly [number, number] = [9000, 16000];
const CHAT_DWELL_MS: readonly [number, number] = [8000, 13000];
const MEETING_DWELL_MS = 12_000;
const VISIT_WAIT_MS = 2800;
const FIDGET_MS: Readonly<Record<FidgetKind, number>> = { stretch: 2400, look: 3200, sip: 2600 };
const FIDGETS: readonly FidgetKind[] = ["stretch", "look", "sip"];

const between = ([lo, hi]: readonly [number, number], rng: Rng): number => lo + rng() * (hi - lo);
const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)];
const home = (a: Agent, locs: LocMap) => locs[`desk-${a.def.id}`];

/** Livre e sentado à secretária: pode fazer coisas de ambiente. */
export const isIdleAtDesk = (a: Agent): boolean =>
  a.kind === "desk" && isSettled(a) && !a.pinned && a.state === "idle" && !a.carrying && a.visitQueue.length === 0;

type AwayKind = "rest" | "chat" | "meet" | "wc" | "play" | "gym" | "server";

function goAway(a: Agent, loc: Parameters<typeof sendTo>[1], kind: AwayKind, stayMs: number): void {
  sendTo(a, loc, kind);
  a.dwellUntil = 0;
  a.dwellFor = stayMs;
  a.fidget = null;
}

/** Decisões de ambiente (chamar de tempos a tempos, por exemplo de 2 em 2 segundos). */
export function lifeTick(agents: readonly Agent[], locs: LocMap, now: number, rng: Rng = Math.random): void {
  const idle = agents.filter(isIdleAtDesk);

  for (const a of idle) {
    if (!a.fidget && rng() < FIDGET_CHANCE) {
      const kind = pick(FIDGETS, rng);
      a.fidget = { kind, until: now + FIDGET_MS[kind] };
    }
  }

  const free = idle.filter((a) => !a.fidget);
  if (free.length > 0 && rng() < COFFEE_CHANCE) {
    const spot = freeLoc(locs, "rest");
    if (spot) goAway(pick(free, rng), spot, "rest", between(REST_DWELL_MS, rng));
    return;
  }
  if (free.length > 0 && rng() < WC_CHANCE) {
    const spot = freeLoc(locs, "wc");
    if (spot) goAway(pick(free, rng), spot, "wc", between(WC_DWELL_MS, rng));
    return;
  }
  if (free.length > 0 && rng() < GYM_CHANCE) {
    const spot = freeLoc(locs, "gym");
    if (spot) goAway(pick(free, rng), spot, "gym", between(GYM_DWELL_MS, rng));
    return;
  }
  if (free.length > 0 && rng() < SERVER_CHANCE) {
    const spot = freeLoc(locs, "srv");
    if (spot) goAway(pick(free, rng), spot, "server", between(SERVER_DWELL_MS, rng));
    return;
  }
  if (free.length >= 2 && rng() < PLAY_CHANCE) {
    startPlay(free, locs, now, rng);
    return;
  }
  if (free.length >= 2 && rng() < CHAT_CHANCE) {
    startChat(free, locs, now, rng);
    return;
  }
  if (rng() < MEETING_CHANCE) startMeeting(agents, locs, now);
}

export function startChat(candidates: readonly Agent[], locs: LocMap, _now: number, rng: Rng): void {
  const pairs = [0, 2, 4].filter((i) => !locs[`chat${i}`]?.owner && !locs[`chat${i + 1}`]?.owner);
  if (pairs.length === 0) return;
  const i = pick(pairs, rng);
  const first = pick(candidates, rng);
  const second = pick(
    candidates.filter((c) => c !== first),
    rng,
  );
  const until = between(CHAT_DWELL_MS, rng);
  goAway(first, locs[`chat${i}`], "chat", until);
  goAway(second, locs[`chat${i + 1}`], "chat", until);
}

/** Dois colegas jogam ténis de mesa na sala de jogos. */
export function startPlay(candidates: readonly Agent[], locs: LocMap, _now: number, rng: Rng): void {
  if (locs.play0?.owner || locs.play1?.owner) return;
  const first = pick(candidates, rng);
  const second = pick(
    candidates.filter((c) => c !== first),
    rng,
  );
  const until = between(PLAY_DWELL_MS, rng);
  goAway(first, locs.play0, "play", until);
  goAway(second, locs.play1, "play", until);
}

/** Reunião de ambiente: o CEO e os chefes, se estiverem todos livres. Devolve quem foi. */
export function startMeeting(agents: readonly Agent[], locs: LocMap, _now: number): Agent[] {
  const who = MEETING_IDS.map((id) => agents.find((a) => a.def.id === id)).filter((a): a is Agent => a !== undefined && isIdleAtDesk(a));
  if (who.length < MIN_MEETING_SIZE) return [];
  who.forEach((a, i) => goAway(a, locs[`meet${i}`], "meet", MEETING_DWELL_MS));
  return who;
}

/** O CEO (ou quem delega) leva um papel a `toId`. Várias entregas seguidas fazem-se por ordem. */
export function queueVisit(agents: readonly Agent[], locs: LocMap, fromId: string, toId: string, now: number): void {
  const from = agents.find((a) => a.def.id === fromId);
  // O destino é a secretária de alguém ou a bandeja de revisão (não é uma pessoa).
  const destinationExists = toId === TRAY_ID || agents.some((a) => a.def.id === toId);
  if (!from || fromId === toId || !locs[`visit-${toId}`] || !destinationExists) return;
  from.visitQueue.push(toId);
  if (from.kind !== "visit") startNextVisit(from, locs, now);
}

function startNextVisit(a: Agent, locs: LocMap, now: number): void {
  const next = a.visitQueue.shift();
  if (!next) return;
  a.carrying = true;
  a.fidget = null;
  sendTo(a, locs[`visit-${next}`], "visit");
  a.dwellUntil = 0;
  void now;
}

const isAway = (kind: Agent["kind"]): boolean =>
  kind === "rest" || kind === "chat" || kind === "meet" || kind === "wc" || kind === "play" || kind === "gym" || kind === "server";

/** Quando uma tarefa real começa: larga entregas, passeios e gestos e volta à secretária. */
export function cancelAmbient(a: Agent): void {
  a.carrying = false;
  a.visitQueue = [];
  a.fidget = null;
  a.lookAt = null;
  a.dwellUntil = 0;
  a.dwellFor = 0;
}

/** Avança o que depende do tempo: voltar à secretária, esperar numa visita, gestos que acabam. Chamar várias vezes por segundo. */
export function lifeUpdate(agents: readonly Agent[], locs: LocMap, now: number): void {
  for (const a of agents) {
    if (a.fidget && now >= a.fidget.until) a.fidget = null;
    if (a.lookAt && now >= a.lookAt.until) a.lookAt = null;
    if (!isSettled(a)) continue;

    if (a.kind === "visit") updateVisit(a, agents, locs, now);
    else if (isAway(a.kind)) {
      // O tempo de estadia só conta a partir da chegada (o caminho até lá pode demorar mais do que a estadia).
      if (a.dwellUntil === 0 && a.dwellFor > 0) {
        a.dwellUntil = now + a.dwellFor;
        a.dwellFor = 0;
      }
      if (a.dwellUntil > 0 && now >= a.dwellUntil) {
        a.dwellUntil = 0;
        a.lookAt = null;
        sendTo(a, home(a, locs), "desk");
      } else if ((a.kind === "chat" || a.kind === "play") && !a.lookAt) lookAtPartner(a, agents, locs, now);
    }
  }
}

function updateVisit(a: Agent, agents: readonly Agent[], locs: LocMap, now: number): void {
  if (a.dwellUntil === 0) {
    // Acabou de chegar: o colega vira-se para ele durante uns instantes.
    a.dwellUntil = now + VISIT_WAIT_MS;
    const target = agents.find((t) => `visit-${t.def.id}` === a.loc.key);
    if (target) target.lookAt = { x: a.x, z: a.z, until: a.dwellUntil };
    return;
  }
  if (now < a.dwellUntil) return;
  a.dwellUntil = 0;
  if (a.visitQueue.length > 0) return startNextVisit(a, locs, now);
  a.carrying = false;
  sendTo(a, home(a, locs), "desk");
}

/** Quem conversa olha para o parceiro (o outro lugar do mesmo par). */
function lookAtPartner(a: Agent, agents: readonly Agent[], locs: LocMap, now: number): void {
  const match = /^(chat|play)(\d+)$/.exec(a.loc.key);
  if (!match) return;
  const index = Number(match[2]);
  const partnerLoc = locs[`${match[1]}${index % 2 === 0 ? index + 1 : index - 1}`];
  const partner = agents.find((p) => p.def.id === partnerLoc?.owner);
  if (partner) a.lookAt = { x: partner.x, z: partner.z, until: now + 1500 };
}
