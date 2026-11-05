import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Pasta do vault onde ficam os rascunhos aprovados (só se já existir: o servidor não inventa pastas no teu Obsidian). */
export const APPROVED_DRAFTS_DIR: readonly string[] = ["01 Candidaturas", "00 Aprovações"];
const MAX_NAME_ATTEMPTS = 50;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Nome de ficheiro seguro (sem caracteres que o Windows ou o Obsidian rejeitam). */
const safeName = (s: string): string =>
  s
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Guarda um rascunho aprovado como nota Markdown no vault. Devolve o caminho relativo ao vault, ou null se não houve
 * onde guardar (sem vault configurado, pasta em falta ou rascunho vazio). Nunca sobrescreve uma nota existente.
 * Nada é enviado a ninguém: é só o registo, para ficares com o texto aprovado.
 */
export function saveApprovedDraft(vaultDir: string, agentName: string, draft: string | null, now: Date = new Date()): string | null {
  if (!vaultDir || !draft?.trim()) return null;
  const dir = join(vaultDir, ...APPROVED_DRAFTS_DIR);
  if (!existsSync(dir)) return null;
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = `${stamp} ${safeName(agentName) || "agente"} rascunho aprovado`;
  const content = [
    "---",
    "tipo: rascunho aprovado",
    `agente: ${safeName(agentName)}`,
    `aprovado: ${now.toISOString()}`,
    "enviado: não",
    "---",
    "",
    draft.trim(),
    "",
  ].join("\n");
  for (let i = 1; i <= MAX_NAME_ATTEMPTS; i++) {
    const name = i === 1 ? `${base}.md` : `${base} ${i}.md`;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), content, { flag: "wx" });
      return [...APPROVED_DRAFTS_DIR, name].join("/");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") return null;
    }
  }
  return null;
}
