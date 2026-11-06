import { execFile, spawn } from "node:child_process";

/**
 * Continuar uma sessão local no terminal: abre uma janela de PowerShell que corre o script gerado pelo servidor
 * (`terminalScript`), com `claude --resume <id>` e os mesmos limites do perfil (guard, MCP, terminal, pastas). As
 * perguntas de permissão aparecem no próprio terminal, como sempre.
 */

/** Comando para correr o script à mão (para copiar). */
export const resumeCommand = (script: string): string => `powershell -NoExit -ExecutionPolicy Bypass -File "${script}"`;

/** Abre o terminal (só no Windows; nos outros sistemas devolve false e a interface mostra o comando para copiar). */
export function openTerminal(script: string, title: string): boolean {
  if (process.platform !== "win32") return false;
  const child = spawn(
    "cmd.exe",
    ["/c", "start", title.replace(/[^\p{L}\p{N} .:-]/gu, ""), "powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", script],
    { detached: true, stdio: "ignore", windowsHide: false },
  );
  child.unref();
  return true;
}

/** Versão do Claude Code instalado (para mostrar no escritório). */
export function claudeVersion(): Promise<string> {
  return new Promise((resolve) => {
    execFile("claude", ["--version"], { timeout: 15_000, windowsHide: true }, (err, stdout) => resolve(err ? "" : stdout.trim()));
  });
}
