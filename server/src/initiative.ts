import type { InitiativeSettings } from "../../shared/protocol.ts";
import { findAgent, officeMap } from "./agents.ts";
import type { Hub } from "./hub.ts";
import type { Notifications } from "./notifications.ts";

/**
 * Iniciativa: os agentes propõem ideias sem que ninguém peça. De tempos a tempos (com a app aberta e a equipa livre),
 * um agente, à vez, olha para o trabalho dele e para o material a que tem acesso e propõe UMA ideia concreta. Também
 * apanha as linhas "Ideia: …" que os agentes escrevem no fim das respostas. As ideias vão para as notificações;
 * avançar com uma põe o Atlas a organizar a equipa. Nada é feito sem o teu "avançar".
 */

export const DEFAULT_INITIATIVE: InitiativeSettings = { enabled: true, everyMin: 30 };
/** Quem propõe, à vez (o Atlas coordena; o Dean só lê o Canvas). */
export const PROPOSERS = ["rhea", "vera", "nina", "mira", "lena", "scout", "theo", "ada", "turing"];
const MAX_PER_DAY = 16;
const SETTINGS_KEY = "initiative";
const TURN_KEY = "initiativeTurn";
const IDEA_MAX = 500;

export interface InitiativeStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

export interface Initiative {
  settings(): InitiativeSettings;
  set(settings: InitiativeSettings): void;
  /** Pede já uma ideia ao próximo agente (ou ao indicado). Devolve false se não deu (equipa ocupada). */
  now(agentId?: string): Promise<boolean>;
  /** Linhas "Ideia: …" numa resposta de um agente: viram notificações. */
  fromReply(agentId: string, reply: string): void;
  /** Liga o relógio (chamar uma vez). */
  start(viewers: () => number): void;
  stop(): void;
}

/** O pedido de ideia: o agente olha para o que tem e propõe uma coisa concreta, ou nada. */
export function ideaPrompt(agentId: string): string {
  const name = findAgent(agentId)?.name ?? agentId;
  return [
    `Iniciativa (ninguém te pediu isto): és ${name}. ${officeMap(agentId)}`,
    "Olha para o teu trabalho recente, a tua memória (CLAUDE.md), a tua pasta e as notas do Obsidian a que tens acesso, e propõe UMA ideia nova e concreta que valha a pena fazer agora para o utilizador ou para a equipa: algo útil que ainda ninguém pediu.",
    "Não a faças agora e não alteres ficheiros: só propões. Baseia-a no que viste (cita o ficheiro ou a nota).",
    'Responde APENAS com JSON: {"idea":"a proposta numa frase","why":"porquê agora, com a fonte","first_step":"o primeiro passo concreto"}. Se não houver nada que valha mesmo a pena, responde {"idea":""}.',
  ].join("\n");
}

/** Lê a resposta a um pedido de ideia. */
export function parseIdea(reply: string): { idea: string; why: string; firstStep: string } | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const d = JSON.parse(reply.slice(start, end + 1)) as { idea?: unknown; why?: unknown; first_step?: unknown };
    const idea = typeof d.idea === "string" ? d.idea.trim() : "";
    if (!idea) return null;
    const str = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, IDEA_MAX) : "");
    return { idea: idea.slice(0, IDEA_MAX), why: str(d.why), firstStep: str(d.first_step) };
  } catch {
    return null;
  }
}

/** "Ideia: …" no fim de uma resposta (uma por linha). */
export function ideasInReply(reply: string): string[] {
  return [...reply.matchAll(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:💡\s*)?Ideia(?:\*\*)?\s*:\s*(.+)$/gim)]
    .map((m) => m[1].replace(/\*\*/g, "").trim())
    .filter((s) => s.length > 10);
}

const today = (): string => new Date().toISOString().slice(0, 10);

export function createInitiative(deps: {
  hub: Hub;
  notifications: Notifications;
  store: InitiativeStore;
  log: (agentId: string, text: string) => void;
}): Initiative {
  const { hub, notifications, store } = deps;
  let timer: NodeJS.Timeout | null = null;
  let lastRun = Date.now();
  let viewersOf: () => number = () => 0;

  const read = (): InitiativeSettings => {
    try {
      return { ...DEFAULT_INITIATIVE, ...(JSON.parse(store.getSetting(SETTINGS_KEY) ?? "{}") as Partial<InitiativeSettings>) };
    } catch {
      return DEFAULT_INITIATIVE;
    }
  };
  const counter = (): { day: string; n: number } => {
    try {
      const c = JSON.parse(store.getSetting(`${SETTINGS_KEY}Count`) ?? "{}") as { day?: string; n?: number };
      return c.day === today() ? { day: c.day, n: c.n ?? 0 } : { day: today(), n: 0 };
    } catch {
      return { day: today(), n: 0 };
    }
  };
  const key = (text: string): string =>
    `idea-${text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .slice(0, 80)}`;
  const addIdea = (agentId: string, idea: string, why = "", firstStep = ""): void => {
    // A mesma ideia (aberta ou já tratada) não volta a aparecer.
    if (notifications.list().some((n) => n.key === key(idea))) return;
    notifications.open(key(idea), agentId, "idea", idea, { ...(why ? { why } : {}), ...(firstStep ? { firstStep } : {}) });
    deps.log(agentId, `Ideia para ti: ${idea}`);
  };

  async function now(agentId?: string): Promise<boolean> {
    const turn = Number(store.getSetting(TURN_KEY) ?? "0") || 0;
    const who = agentId ?? PROPOSERS[turn % PROPOSERS.length];
    if (hub.isRunning(who) || !hub.hasCapacity()) return false;
    store.setSetting(TURN_KEY, String(turn + 1));
    const c = counter();
    store.setSetting(`${SETTINGS_KEY}Count`, JSON.stringify({ day: c.day, n: c.n + 1 }));
    lastRun = Date.now();
    // Sessão à parte, só de leitura e sem mostrar no chat: não mistura com as conversas nem mexe em nada.
    const result = await hub.run(who, ideaPrompt(who), {
      silent: true,
      isolated: true,
      readOnly: true,
      label: "A pensar numa ideia para a equipa",
    });
    const idea = result.ok ? parseIdea(result.reply) : null;
    if (idea) addIdea(who, idea.idea, idea.why, idea.firstStep);
    else
      deps.log(who, result.ok ? "Sem ideia nova que valha a pena desta vez." : `Não consegui pensar numa ideia: ${result.error ?? "erro"}`);
    return true;
  }

  return {
    settings: read,
    set(settings) {
      store.setSetting(SETTINGS_KEY, JSON.stringify(settings));
    },
    now,
    fromReply(agentId, reply) {
      for (const idea of ideasInReply(reply)) addIdea(agentId, idea);
    },
    start(viewers) {
      viewersOf = viewers;
      timer = setInterval(() => {
        const s = read();
        if (!s.enabled || viewersOf() === 0) return;
        if (Date.now() - lastRun < s.everyMin * 60_000) return;
        // Só com a equipa livre (não tira lugar ao teu trabalho) e com um limite por dia.
        if (hub.active().length > 0 || counter().n >= MAX_PER_DAY) return;
        void now().catch(() => undefined);
      }, 60_000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
