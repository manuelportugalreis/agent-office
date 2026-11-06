// Hook PreToolUse do Claude Code para as sessões "Claude Code local" do Agent Office.
// Uso: node local-guard.mjs <política.json>
// A política (escrita pelo servidor, nunca pelo agente) diz que pastas o perfil deixa ler e escrever e onde fica o vault.
// - Ficheiros: leitura só nas pastas de leitura; escrita só nas de escrita; nunca .claude, .git ou .obsidian.
// - Obsidian: não se pode tirar o frontmatter de uma nota; apagar links ou secções, ou reescrever boa parte de uma nota,
//   obriga a uma pergunta ("ask"), que o escritório te mostra com as alterações propostas.
// Sai com código 2 (mensagem em stderr) para bloquear; com JSON em stdout para pedir autorização.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const PROTECTED_DIRS = new Set([".claude", ".git", ".obsidian"]);
/** Uma alteração que muda mais do que esta fração das linhas de uma nota existente é uma reescrita. */
const REWRITE_RATIO = 0.35;
const REWRITE_MIN_LINES = 6;

function block(message) {
  console.error(`Bloqueado pelo perfil de acesso: ${message}`);
  process.exit(2);
}

function ask(reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }),
  );
  process.exit(0);
}

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

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const isInside = (root, target) => {
  const rel = relative(norm(root), norm(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const policyPath = process.argv[2];
if (!policyPath) block("política em falta");
let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
} catch {
  block("política ilegível");
}
const readRoots = (policy.read ?? []).map((p) => realPath(resolve(p)));
const writeRoots = (policy.write ?? []).map((p) => realPath(resolve(p)));
const cwd = policy.cwd ? realPath(resolve(policy.cwd)) : process.cwd();
const vault = policy.vault ? realPath(resolve(policy.vault)) : null;

function target(raw) {
  if (typeof raw !== "string" || raw.length === 0) block("caminho em falta");
  if (raw.startsWith("\\\\") || raw.startsWith("//")) block("caminhos de rede não são permitidos");
  if (process.platform !== "win32" && /^[a-zA-Z]:/.test(raw)) block("caminhos com letra de disco não são permitidos");
  return realPath(resolve(cwd, raw));
}

function checkRead(path) {
  if (!readRoots.some((r) => isInside(r, path))) block(`não tens acesso de leitura a ${path}`);
}

function checkWrite(path) {
  const root = writeRoots.find((r) => isInside(r, path));
  if (!root) block(`não tens acesso de escrita a ${path}`);
  if (
    relative(root, path)
      .split(sep)
      .some((s) => PROTECTED_DIRS.has(s.toLowerCase()))
  )
    block("esta pasta é protegida (.claude, .git, .obsidian)");
}

// ---------- Obsidian ----------

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return null;
  const keys = new Set();
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_\-À-ÿ ]+):/.exec(line);
    if (k) keys.add(k[1].trim());
  }
  return keys;
}
const links = (text) => new Set([...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim().toLowerCase()));
const headings = (text) => new Set([...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase()));

function changedLines(before, after) {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const count = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  let removed = 0;
  for (const [l, n] of ca) removed += Math.max(0, n - (cb.get(l) ?? 0));
  return { removed, total: a.length };
}

function applyEdit(text, oldStr, newStr, all) {
  if (typeof oldStr !== "string" || typeof newStr !== "string") return text;
  return all ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
}

function proposed(name, args, current) {
  if (name === "Write") return typeof args.content === "string" ? args.content : current;
  if (name === "Edit") return applyEdit(current, args.old_string, args.new_string, args.replace_all === true);
  if (name === "MultiEdit" && Array.isArray(args.edits))
    return args.edits.reduce((t, e) => applyEdit(t, e?.old_string, e?.new_string, e?.replace_all === true), current);
  return current;
}

function checkNote(name, args, path) {
  if (!vault || !isInside(vault, path) || !path.toLowerCase().endsWith(".md") || !existsSync(path)) return;
  const before = readFileSync(path, "utf8");
  const after = proposed(name, args, before);
  const fmBefore = frontmatter(before);
  if (fmBefore) {
    const fmAfter = frontmatter(after);
    if (!fmAfter) block("esta alteração apagava o frontmatter da nota; mantém o bloco --- inicial e edita só o que precisas");
    const missing = [...fmBefore].filter((k) => !fmAfter.has(k));
    if (missing.length) block(`esta alteração apagava campos do frontmatter (${missing.join(", ")}); mantém-nos`);
  }
  const lostLinks = [...links(before)].filter((l) => !links(after).has(l));
  const lostHeadings = [...headings(before)].filter((h) => !headings(after).has(h));
  const { removed, total } = changedLines(before, after);
  const reasons = [];
  if (lostLinks.length) reasons.push(`retira ${lostLinks.length} link(s): ${lostLinks.slice(0, 5).join(", ")}`);
  if (lostHeadings.length) reasons.push(`retira secções: ${lostHeadings.slice(0, 5).join(", ")}`);
  if (total >= REWRITE_MIN_LINES && removed / total > REWRITE_RATIO) reasons.push(`muda ${removed} de ${total} linhas`);
  if (reasons.length)
    ask(`Alteração grande a uma nota do Obsidian (${reasons.join("; ")}). Revê as alterações propostas antes de permitir.`);
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
  if (READ_TOOLS.has(name)) {
    if (name === "Read") checkRead(target(args.file_path));
    else {
      checkRead(args.path !== undefined ? target(args.path) : cwd);
      for (const pattern of [args.pattern, args.glob])
        if (
          typeof pattern === "string" &&
          name === "Glob" &&
          (isAbsolute(pattern) || /^[a-zA-Z]:/.test(pattern) || pattern.split(/[\\/]/).includes(".."))
        )
          block("o padrão não pode sair das pastas do perfil (usa o parâmetro path)");
    }
    process.exit(0);
  }
  if (WRITE_TOOLS.has(name)) {
    const path = target(name === "NotebookEdit" ? args.notebook_path : args.file_path);
    checkWrite(path);
    checkNote(name, args, path);
    process.exit(0);
  }
  process.exit(0);
});
