/** Teclas e texto do terminal do agente (sem o xterm, para se poder testar). */

/** Shift+Enter no Claude Code: Esc+Enter é «nova linha» (o mesmo que o /terminal-setup configura). */
export const NEWLINE_SEQ = "\x1b\r";

/** Um caminho de ficheiro como o terminal o cola ao largar um ficheiro (entre aspas se tiver espaços). */
export const pathText = (path: string): string => (/\s/.test(path) ? `"${path}"` : path);

/** O que fazer com uma tecla antes do terminal: o Claude Code no teu terminal comporta-se assim. */
export type KeyAction = "newline" | "copy" | "paste" | "max" | "pass";

export function keyAction(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">, hasSelection: boolean): KeyAction {
  if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) return "newline";
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && e.shiftKey && k === "f") return "max";
  // Ctrl+C só copia com texto selecionado; sem seleção continua a ser o Ctrl+C do Claude Code (interromper/limpar).
  if (mod && !e.shiftKey && k === "c" && hasSelection) return "copy";
  if (mod && e.shiftKey && k === "c") return "copy";
  // Ctrl+V: deixa o browser colar (texto, ou ficheiros/imagens que vão para a pasta do agente).
  if (mod && k === "v") return "paste";
  return "pass";
}
