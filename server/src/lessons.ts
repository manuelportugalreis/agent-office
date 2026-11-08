import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMPANY_DIR } from "./workspace.ts";

/**
 * Lições das tuas revisões: quando rejeitas ou devolves um rascunho com um motivo, o motivo fica guardado como regra
 * para esse agente e vai junto de cada tarefa seguinte. O ficheiro está em _company (só de leitura para os agentes),
 * por isso nenhum agente o pode escrever; podes editá-lo ou apagá-lo à vontade.
 */

export const MAX_LESSONS = 15;
const MAX_LESSON = 300;

export const lessonsFile = (agentId: string): string => join(COMPANY_DIR, "licoes", `${agentId}.md`);

const HEADER = (name: string): string =>
  `# Lições para ${name}\n\nO que corrigiste nos rascunhos (o servidor escreve aqui; podes editar ou apagar linhas).\n\n`;

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const normal = (s: string): string => oneLine(s).toLowerCase();

/** As linhas de lições ("- ...") de um ficheiro. */
export function parseLessons(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/** Junta uma lição: sem repetidas e só as mais recentes. Devolve o texto novo do ficheiro. */
export function withLesson(text: string, name: string, lesson: string, date: string): string {
  const clean = oneLine(lesson).slice(0, MAX_LESSON);
  const kept = parseLessons(text).filter((l) => normal(l.replace(/^\d{4}-\d{2}-\d{2}: /, "")) !== normal(clean));
  const lines = [...kept, `${date}: ${clean}`].slice(-MAX_LESSONS);
  return `${HEADER(name)}${lines.map((l) => `- ${l}`).join("\n")}\n`;
}

export function readLessons(agentId: string): string {
  try {
    const f = lessonsFile(agentId);
    return existsSync(f) ? readFileSync(f, "utf8") : "";
  } catch {
    return "";
  }
}

/** Guarda o motivo de uma rejeição como lição do agente. Ignora motivos vazios. */
export function addLesson(agentId: string, name: string, lesson: string, now: Date = new Date()): void {
  if (!oneLine(lesson)) return;
  const file = lessonsFile(agentId);
  mkdirSync(dirname(file), { recursive: true });
  const text = withLesson(readLessons(agentId), name, lesson, now.toISOString().slice(0, 10));
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** As lições para o pedido de cada tarefa (vazio se não houver). */
export function lessonsContext(agentId: string): string {
  const lines = parseLessons(readLessons(agentId));
  return lines.length
    ? `Lições das tuas revisões anteriores (o utilizador corrigiu isto antes; não repitas o erro):\n${lines.map((l) => `- ${l}`).join("\n")}`
    : "";
}
