import type { CanvasItem } from "../../../shared/protocol";
import type { Deadline } from "../data/agents";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

/** "2026-11-07" → "7 nov". Não depende do locale do browser (que varia). */
export function formatDue(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return MONTHS[month - 1] ? `${day} ${MONTHS[month - 1]}` : iso;
}

/** Entregas de uma disciplina, por data, no formato que o painel mostra. */
export function deadlinesFor(items: readonly CanvasItem[], course: string): Deadline[] {
  return items
    .filter((i) => i.course === course)
    .sort((a, b) => a.due.localeCompare(b.due))
    .map((i): Deadline => [i.title, formatDue(i.due), `${i.points ?? "?"} pts${i.done ? " · feito" : ""}`]);
}
