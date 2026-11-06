import { execFile, spawn } from "node:child_process";

/**
 * Continuar uma sessão local no terminal: abre uma janela nova na pasta do perfil com `claude --resume <id>`. Aí a
 * sessão corre com as tuas definições normais do Claude Code (os limites do perfil do escritório deixam de se aplicar),
 * e as perguntas de permissão aparecem no terminal como sempre.
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resumeCommand(folder: string, sessionId: string): string {
  return `cd "${folder}" && claude --resume ${sessionId}`;
}

/** Abre o terminal (só no Windows; nos outros sistemas devolve false e a interface mostra o comando para copiar). */
export function openTerminal(folder: string, sessionId: string, title: string): boolean {
  if (!SESSION_ID.test(sessionId)) throw new Error("id de sessão inválido");
  if (process.platform !== "win32") return false;
  // PowerShell com o caminho entre plicas (as plicas do próprio caminho escapam-se duplicando).
  const ps = `Set-Location -LiteralPath '${folder.replaceAll("'", "''")}'; claude --resume ${sessionId}`;
  const child = spawn("cmd.exe", ["/c", "start", title.replace(/[^\p{L}\p{N} .:-]/gu, ""), "powershell.exe", "-NoExit", "-Command", ps], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return true;
}

/** Versão do Claude Code instalado (para mostrar no escritório). */
export function claudeVersion(): Promise<string> {
  return new Promise((resolve) => {
    execFile("claude", ["--version"], { timeout: 15_000, windowsHide: true }, (err, stdout) => resolve(err ? "" : stdout.trim()));
  });
}
