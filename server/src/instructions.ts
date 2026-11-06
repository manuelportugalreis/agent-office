import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findAgent, officeMap, type RealAgent } from "./agents.ts";
import { COMPANY_DIR, ensureWorkspace, workspaceDir } from "./workspace.ts";

/**
 * Instruções de cada agente, para veres e mudares na app:
 * - o papel, a forma de ser e o playbook (definidos em server/src/agents.ts; só se veem aqui);
 * - as tuas instruções para esse agente: _company/instrucoes/<agente>.md. Os agentes podem lê-lo mas não escrevê-lo
 *   (a pasta _company é só de leitura para eles), por isso nada que um agente leia na web ou num documento passa
 *   por uma instrução tua;
 * - as regras para toda a equipa: _company/perfil.md (também só de leitura para os agentes);
 * - a memória do agente (o CLAUDE.md da pasta dele): é ele que a escreve; mostra-se só para ler.
 * As tuas instruções e as regras da equipa vão no pedido de cada tarefa, no modo escritório e no modo local.
 */

export const MAX_INSTRUCTIONS = 20_000;
/** Quanto de cada parte vai no pedido (as regras da equipa nunca são cortadas por causa das instruções de um agente). */
const SHARED_MAX = 6000;
const NOTES_MAX = 8000;

export interface Instructions {
  readonly agentId: string;
  readonly role: string;
  readonly voice: string;
  readonly playbook: string;
  readonly office: string;
  readonly notes: string;
  readonly shared: string;
  readonly memory: string;
  readonly file: string;
  readonly sharedFile: string;
  readonly memoryFile: string;
}

const read = (file: string): string => {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
};

/** Escreve primeiro num ficheiro temporário único e só depois substitui (nunca deixa o ficheiro a meio). */
function writeSafely(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** As tuas instruções para um agente (só tu as escreves). */
export const notesFile = (agentId: string): string => join(COMPANY_DIR, "instrucoes", `${agentId}.md`);
export const sharedFile = (): string => join(COMPANY_DIR, "perfil.md");
/** A memória do agente (escrita por ele). */
export const memoryFile = (agentId: string): string => join(workspaceDir(agentId), "CLAUDE.md");

export function readInstructions(agent: RealAgent): Instructions {
  ensureWorkspace(agent);
  return {
    agentId: agent.id,
    role: agent.job,
    voice: agent.voice,
    playbook: agent.playbook ?? "",
    office: officeMap(agent.id),
    notes: read(notesFile(agent.id)),
    shared: read(sharedFile()),
    memory: read(memoryFile(agent.id)),
    file: notesFile(agent.id),
    sharedFile: sharedFile(),
    memoryFile: memoryFile(agent.id),
  };
}

export class InstructionsError extends Error {}

/** Guarda as tuas instruções para o agente e, só se vierem (alteradas), as regras da equipa. */
export function saveInstructions(agentId: string, notes: string, shared?: string): Instructions {
  const agent = findAgent(agentId);
  if (!agent) throw new InstructionsError("Este agente não existe.");
  if (notes.length > MAX_INSTRUCTIONS || (shared?.length ?? 0) > MAX_INSTRUCTIONS)
    throw new InstructionsError(`As instruções têm um máximo de ${MAX_INSTRUCTIONS} caracteres.`);
  ensureWorkspace(agent);
  writeSafely(notesFile(agentId), notes);
  if (shared !== undefined) writeSafely(sharedFile(), shared);
  return readInstructions(agent);
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}\n[… cortado: o ficheiro tem ${text.length} caracteres]` : text;

/** As tuas instruções e as regras da equipa, para o pedido de cada tarefa (escritório e local). */
export function userInstructions(agentId: string): string {
  const shared = read(sharedFile()).trim();
  const notes = read(notesFile(agentId)).trim();
  return [
    shared ? `Regras do utilizador para toda a equipa (ficheiro que só ele edita):\n${clip(shared, SHARED_MAX)}` : "",
    notes ? `Instruções do utilizador para ti (ficheiro que só ele edita):\n${clip(notes, NOTES_MAX)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
