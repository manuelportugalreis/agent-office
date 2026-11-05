// Hook PreToolUse do Claude Code: confina as ferramentas de ficheiros de um agente à pasta dele.
// Uso: node fs-guard.mjs <pastaDoAgente> [pastaSoLeitura ...]
// Escrita (Write/Edit): só dentro da pasta do agente. Leitura (Read/Glob/Grep): pasta do agente + pastas só de leitura.
// Sai com código 2 (e mensagem em stderr) para bloquear a ferramenta antes de ela correr.

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Argumentos com prefixo "rw:" são pastas onde também se pode escrever (ex.: o vault do Obsidian).
const [workspaceArg, ...extraArgs] = process.argv.slice(2);
const readOnlyArgs = extraArgs.filter((a) => !a.startsWith("rw:"));
const writableArgs = extraArgs.filter((a) => a.startsWith("rw:")).map((a) => a.slice(3));
const FILE_TOOLS = new Set(["Read", "Write", "Edit", "Glob", "Grep"]);
const WRITE_TOOLS = new Set(["Write", "Edit"]);
// Pastas de configuração do Claude Code: um agente não pode alterar as suas próprias regras.
const PROTECTED_DIRS = new Set([".claude", ".git", ".obsidian"]);

function block(message) {
  console.error(`Bloqueado: ${message}`);
  process.exit(2);
}

/** Resolve o caminho real, seguindo links simbólicos no que já existe (para não escapar por um atalho). */
function realPath(p) {
  let existing = p;
  const rest = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  const base = existsSync(existing) ? realpathSync.native(existing) : existing;
  return join(base, ...rest);
}

const normalize = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

function isInside(root, target) {
  const rel = relative(normalize(root), normalize(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

if (!workspaceArg) block("pasta do agente em falta");
const workspace = realPath(resolve(workspaceArg));
const writeRoots = [workspace, ...writableArgs.map((p) => realPath(resolve(p)))];
const readRoots = [...writeRoots, ...readOnlyArgs.map((p) => realPath(resolve(p)))];

function checkPath(raw, write) {
  if (typeof raw !== "string" || raw.length === 0) return block("caminho em falta");
  if (raw.startsWith("\\\\") || raw.startsWith("//")) return block("caminhos de rede não são permitidos");
  // Fora do Windows "C:\..." seria um nome de ficheiro relativo: recusar, para a regra ser igual em todos os sistemas.
  // (No Windows estes caminhos são normais e passam pela verificação de pastas abaixo.)
  if (process.platform !== "win32" && /^[a-zA-Z]:/.test(raw)) return block("caminhos com letra de disco não são permitidos");
  const target = realPath(resolve(workspace, raw));
  const roots = write ? writeRoots : readRoots;
  if (!roots.some((r) => isInside(r, target)))
    block(write ? "só podes escrever na tua pasta" : "só podes ler a tua pasta e as pastas partilhadas");
  if (write) {
    const root = writeRoots.find((r) => isInside(r, target)) ?? workspace;
    const segments = relative(root, target).split(sep);
    if (segments.some((s) => PROTECTED_DIRS.has(s.toLowerCase()))) block("esta pasta é protegida");
  }
}

function checkPattern(pattern) {
  if (typeof pattern !== "string") return;
  if (isAbsolute(pattern) || /^[a-zA-Z]:/.test(pattern) || pattern.split(/[\\/]/).includes(".."))
    block("o padrão não pode sair da tua pasta");
}

let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return block("entrada do hook inválida");
  }
  const name = String(event.tool_name ?? "");
  const args = event.tool_input ?? {};
  if (!FILE_TOOLS.has(name)) return block(`a ferramenta ${name} não é permitida`);
  const write = WRITE_TOOLS.has(name);
  if (name === "Glob" || name === "Grep") {
    if (args.path !== undefined) checkPath(args.path, false);
    checkPattern(args.pattern);
    if (typeof args.glob === "string") checkPattern(args.glob);
  } else {
    checkPath(args.file_path, write);
  }
  process.exit(0);
});
