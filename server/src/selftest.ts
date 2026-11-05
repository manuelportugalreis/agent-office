import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Probe {
  readonly name: string;
  readonly script: string;
  readonly args: readonly string[];
  readonly tool: string;
  readonly input: Record<string, unknown>;
  /** 0 = tem de deixar passar, 2 = tem de bloquear. */
  readonly expect: 0 | 2;
}

export interface SelfTestResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

const DEFAULT_HOOKS_DIR = join(import.meta.dirname, "..", "hooks");

/**
 * Corre cada guard com uma entrada que deve passar e outra que deve ser bloqueada.
 * No Claude Code só o código de saída 2 bloqueia uma ferramenta; qualquer outro erro do hook (Node em falta, ficheiro
 * apagado, erro de sintaxe) deixa a ferramenta correr. Por isso um guard avariado "falha aberto": isto garante que
 * não se arranca com um guard que não bloqueia.
 */
export function runGuardSelfTest(hooksDir: string = DEFAULT_HOOKS_DIR): SelfTestResult {
  const base = mkdtempSync(join(tmpdir(), "office-selftest-"));
  const workspace = join(base, "agente");
  const shared = join(base, "partilhada");
  const fs = join(hooksDir, "fs-guard.mjs");
  const web = join(hooksDir, "web-guard.mjs");
  const chrome = join(hooksDir, "chrome-guard.mjs");
  const probes: Probe[] = [
    {
      name: "fs: ler dentro da pasta",
      script: fs,
      args: [workspace, shared],
      tool: "Read",
      input: { file_path: join(workspace, "a.md") },
      expect: 0,
    },
    {
      name: "fs: ler fora da pasta",
      script: fs,
      args: [workspace, shared],
      tool: "Read",
      input: { file_path: join(base, "fora.txt") },
      expect: 2,
    },
    { name: "fs: sair com ..", script: fs, args: [workspace, shared], tool: "Write", input: { file_path: "../fora.txt" }, expect: 2 },
    {
      name: "fs: escrever na pasta partilhada",
      script: fs,
      args: [workspace, shared],
      tool: "Write",
      input: { file_path: join(shared, "x.md") },
      expect: 2,
    },
    { name: "web: página normal", script: web, args: [], tool: "WebFetch", input: { url: "https://example.com/" }, expect: 0 },
    { name: "web: endereço local", script: web, args: [], tool: "WebFetch", input: { url: "http://127.0.0.1:8787/" }, expect: 2 },
    {
      name: "chrome: domínio permitido",
      script: chrome,
      args: ["canvas.example.edu"],
      tool: "mcp__claude-in-chrome__navigate",
      input: { url: "https://canvas.example.edu/" },
      expect: 0,
    },
    {
      name: "chrome: outro domínio",
      script: chrome,
      args: ["canvas.example.edu"],
      tool: "mcp__claude-in-chrome__navigate",
      input: { url: "https://example.com/" },
      expect: 2,
    },
    {
      name: "chrome: ferramenta de clique",
      script: chrome,
      args: ["canvas.example.edu"],
      tool: "mcp__claude-in-chrome__computer",
      input: {},
      expect: 2,
    },
  ];
  const failures: string[] = [];
  try {
    for (const p of probes) {
      const run = spawnSync(process.execPath, [p.script, ...p.args], {
        input: JSON.stringify({ tool_name: p.tool, tool_input: p.input, session_id: "selftest-session", tool_use_id: "selftest-use" }),
        encoding: "utf8",
        timeout: 10_000,
      });
      if (run.status !== p.expect)
        failures.push(`${p.name} (esperado ${p.expect}, obtido ${run.status ?? run.error?.message ?? "sem resposta"})`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  return { ok: failures.length === 0, failures };
}
