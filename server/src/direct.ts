import type { AgentName } from "./intent.ts";

/**
 * Ordens diretas para o Claude Code de um agente: "Mira, pesquisa a empresa X" (ou "@mira ...", "Mira: ...") vai tal
 * e qual para o terminal da Mira, sem plano do Atlas. Só quando a ordem é para UM agente: se nomear outros colegas
 * ("Mira, pesquisa X e depois a Lena escreve"), continua a ser coordenação e vai para o Atlas.
 */
export interface TerminalOrder {
  readonly agent: string;
  readonly task: string;
}

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function terminalOrder(text: string, agents: readonly AgentName[], coordinator = "ceo"): TerminalOrder | null {
  const m = /^\s*@?([\p{L}\d-]+)\s*[,:]\s*(.+)$/su.exec(text) ?? /^\s*@([\p{L}\d-]+)\s+(.+)$/su.exec(text);
  if (!m) return null;
  const [, rawName = "", rawTask = ""] = m;
  const agent = agents.find((a) => fold(a.name) === fold(rawName) || a.id === fold(rawName));
  if (!agent || agent.id === coordinator) return null;
  const task = rawTask.trim();
  if (!task) return null;
  const words = new Set(fold(task).split(/[^\p{L}\d-]+/u));
  if (agents.some((a) => a.id !== agent.id && (words.has(fold(a.name)) || words.has(a.id)))) return null;
  return { agent: agent.id, task };
}
