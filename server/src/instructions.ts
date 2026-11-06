import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findAgent, officeMap, type RealAgent } from "./agents.ts";
import { COMPANY_DIR, ensureWorkspace, workspaceDir } from "./workspace.ts";

/**
 * Instruções de cada agente, para veres e mudares na app:
 * - o papel, a forma de ser e o playbook (definidos em server/src/agents.ts; só se veem aqui);
 * - as tuas instruções para esse agente: o CLAUDE.md da pasta dele, lido no início de cada tarefa;
 * - as regras para toda a equipa: _company/perfil.md (todos o leem).
 */

export const MAX_INSTRUCTIONS = 20_000;
/** Quanto das tuas instruções vai junto com as sessões locais (que não leem o CLAUDE.md da pasta do agente). */
const LOCAL_NOTES_MAX = 8000;

export interface Instructions {
  readonly agentId: string;
  readonly role: string;
  readonly voice: string;
  readonly playbook: string;
  readonly office: string;
  readonly notes: string;
  readonly shared: string;
  readonly file: string;
  readonly sharedFile: string;
}

const read = (file: string): string => {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
};

/** Escreve primeiro num ficheiro temporário e só depois substitui (nunca deixa o ficheiro a meio). */
function writeSafely(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export const notesFile = (agentId: string): string => join(workspaceDir(agentId), "CLAUDE.md");
export const sharedFile = (): string => join(COMPANY_DIR, "perfil.md");

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
    file: notesFile(agent.id),
    sharedFile: sharedFile(),
  };
}

export class InstructionsError extends Error {}

/** Guarda as tuas instruções para o agente e (se vierem) as regras da equipa. */
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

/**
 * As tuas instruções, para as sessões locais (correm na pasta do projeto, não na do agente, por isso o CLAUDE.md
 * dele não é lido sozinho). Vão como instruções tuas, com as regras da equipa.
 */
export function localNotes(agentId: string): string {
  const notes = read(notesFile(agentId)).trim();
  const shared = read(sharedFile()).trim();
  const parts = [
    notes ? `Instruções do utilizador para ti (o teu CLAUDE.md):\n${notes}` : "",
    shared ? `Regras do utilizador para toda a equipa:\n${shared}` : "",
  ].filter(Boolean);
  const text = parts.join("\n\n");
  return text.length > LOCAL_NOTES_MAX ? `${text.slice(0, LOCAL_NOTES_MAX)}\n[… cortado]` : text;
}
