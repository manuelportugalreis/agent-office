// Hook PreToolUse do Claude Code para as sessões "Claude Code local" do Agent Office.
// Uso: node local-guard.mjs <política.json>
// A política (escrita pelo servidor, nunca pelo agente) diz que pastas o perfil deixa ler e escrever, onde fica o vault
// e em que porta corre o escritório.
// - Ficheiros: leitura só nas pastas de leitura; escrita só nas de escrita; nunca .claude*, .git, .obsidian, .mcp.json
//   nem CLAUDE.local.md (são regras e integrações: um agente não as pode mudar para a corrida seguinte).
// - Terminal: um comando que fale com o próprio Agent Office (a porta do servidor) é bloqueado.
// - Obsidian: não se pode tirar o frontmatter nem campos dele; tirar links, secções, aliases ou tags, reordenar secções
//   ou reescrever boa parte de uma nota (somando todas as edições desta corrida) obriga a uma pergunta ("ask"), que o
//   escritório te mostra com as alterações propostas.
// Sai com código 2 (mensagem em stderr) para bloquear; com JSON em stdout para pedir autorização. Qualquer erro
// inesperado bloqueia (um guard que falha não pode deixar passar).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const PROTECTED_DIRS = new Set([".claude", ".git", ".obsidian"]);
const PROTECTED_FILES = new Set([".mcp.json", "claude.local.md"]);
/** Uma alteração (somada desde o início da corrida) que muda mais do que esta fração das linhas é uma reescrita. */
const REWRITE_RATIO = 0.35;
const REWRITE_MIN_LINES = 6;
const LCS_MAX = 1500;

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
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
/** O Windows ignora pontos e espaços no fim dos nomes: ".claude." é ".claude". */
const segName = (s) => (process.platform === "win32" ? s.replace(/[. ]+$/, "") : s).toLowerCase();

function main() {
  const policyPath = process.argv[2];
  if (!policyPath) block("política em falta");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const readRoots = (policy.read ?? []).map((p) => realPath(resolve(p)));
  const writeRoots = (policy.write ?? []).map((p) => realPath(resolve(p)));
  // Pastas onde nunca se escreve, mesmo dentro de uma pasta com escrita (ex.: o próprio Agent Office na tua pasta pessoal).
  const noWrite = (policy.noWrite ?? []).map((p) => realPath(resolve(p)));
  const cwd = policy.cwd ? realPath(resolve(policy.cwd)) : process.cwd();
  const vault = policy.vault ? realPath(resolve(policy.vault)) : null;
  const ledgerDir = `${policyPath}.ledger`;

  const target = (raw) => {
    if (typeof raw !== "string" || raw.length === 0) block("caminho em falta");
    if (raw.startsWith("\\\\") || raw.startsWith("//")) block("caminhos de rede não são permitidos");
    if (process.platform !== "win32" && /^[a-zA-Z]:/.test(raw)) block("caminhos com letra de disco não são permitidos");
    return realPath(resolve(cwd, raw));
  };
  const checkRead = (path) => {
    if (!readRoots.some((r) => isInside(r, path))) block(`não tens acesso de leitura a ${path}`);
  };
  const checkWrite = (path) => {
    const root = writeRoots.find((r) => isInside(r, path));
    if (!root) block(`não tens acesso de escrita a ${path}`);
    if (noWrite.some((r) => isInside(r, path))) block(`esta pasta é protegida (o Agent Office e as regras dos agentes): ${path}`);
    const segments = relative(root, path).split(sep).map(segName);
    if (segments.some((s) => PROTECTED_DIRS.has(s) || s.startsWith(".claude"))) block("esta pasta é protegida (.claude, .git, .obsidian)");
    if (PROTECTED_FILES.has(segments.at(-1))) block("este ficheiro configura integrações e regras do Claude Code e é protegido");
  };

  // ---------- Obsidian ----------
  const stripBom = (t) => t.replace(/^\uFEFF/, "");
  function frontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/.exec(stripBom(text));
    if (!m) return null;
    const keys = new Map();
    let list = null;
    for (const line of m[1].split(/\r?\n/)) {
      const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
      if (item && list) {
        keys.get(list).push(item[1].trim().replace(/^["']|["']$/g, ""));
        continue;
      }
      const k = /^([^\s:#-][^:]*):\s*(.*)$/.exec(line);
      if (!k) continue;
      const key = k[1].trim();
      const v = k[2].trim();
      if (v === "") {
        keys.set(key, []);
        list = key;
      } else if (v.startsWith("[") && v.endsWith("]")) {
        keys.set(
          key,
          v
            .slice(1, -1)
            .split(",")
            .map((x) => x.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean),
        );
        list = null;
      } else {
        keys.set(key, v);
        list = null;
      }
    }
    return keys;
  }
  const fold = (s) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
  const count = (items) => items.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const links = (text) =>
    count([
      ...[...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `w:${fold(m[1])}`),
      ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => `u:${m[1]}`),
    ]);
  const headings = (text) => [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => fold(m[1]));
  const lost = (before, after) => [...before].filter(([k, n]) => (after.get(k) ?? 0) < n).map(([k]) => k.slice(2));

  /** Linhas da versão original que deixam de existir na proposta (ordenado: reordenar também conta). */
  function removedLines(before, after) {
    const a = before.split(/\r?\n/);
    const b = after.split(/\r?\n/);
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    const x = a.slice(s, a.length - e);
    const y = b.slice(s, b.length - e);
    if (x.length > LCS_MAX || y.length > LCS_MAX) return { removed: x.length, total: a.length };
    let prev = new Uint16Array(y.length + 1);
    for (let i = x.length - 1; i >= 0; i--) {
      const cur = new Uint16Array(y.length + 1);
      for (let j = y.length - 1; j >= 0; j--) cur[j] = x[i] === y[j] ? prev[j + 1] + 1 : Math.max(prev[j], cur[j + 1]);
      prev = cur;
    }
    return { removed: x.length - prev[0], total: a.length };
  }

  const applyEdit = (text, oldStr, newStr, all) => {
    if (typeof oldStr !== "string" || typeof newStr !== "string") return text;
    return all ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
  };
  const proposed = (name, args, current) => {
    if (name === "Write") return typeof args.content === "string" ? args.content : current;
    if (name === "Edit") return applyEdit(current, args.old_string, args.new_string, args.replace_all === true);
    if (name === "MultiEdit" && Array.isArray(args.edits))
      return args.edits.reduce((t, e) => applyEdit(t, e?.old_string, e?.new_string, e?.replace_all === true), current);
    return current;
  };

  /** A nota tal como estava antes da primeira alteração desta corrida (as edições pequenas somam-se). */
  function original(path, current) {
    mkdirSync(ledgerDir, { recursive: true });
    const file = join(ledgerDir, `${createHash("sha1").update(norm(path)).digest("hex")}.md`);
    if (existsSync(file)) return readFileSync(file, "utf8");
    writeFileSync(file, current);
    return current;
  }

  function checkNote(name, args, path) {
    if (!vault || !isInside(vault, path) || !path.toLowerCase().endsWith(".md") || !existsSync(path) || !statSync(path).isFile()) return;
    const current = readFileSync(path, "utf8");
    const after = proposed(name, args, current);
    const before = original(path, current);
    const fmBefore = frontmatter(before);
    const fmAfter = frontmatter(after);
    if (fmBefore) {
      if (!fmAfter) block("esta alteração apagava o frontmatter da nota; mantém o bloco --- inicial e edita só o que precisas");
      const missing = [...fmBefore.keys()].filter((k) => !fmAfter.has(k));
      if (missing.length) block(`esta alteração apagava campos do frontmatter (${missing.join(", ")}); mantém-nos`);
    }
    const reasons = [];
    for (const key of ["aliases", "alias", "tags"]) {
      const b = fmBefore?.get(key);
      const a = fmAfter?.get(key);
      if (Array.isArray(b) && b.some((v) => !(Array.isArray(a) ? a : [a]).includes(v))) reasons.push(`retira valores de ${key}`);
    }
    const lostLinks = lost(links(before), links(after));
    if (lostLinks.length) reasons.push(`retira ${lostLinks.length} link(s): ${lostLinks.slice(0, 5).join(", ")}`);
    const hb = headings(before);
    const ha = headings(after);
    const lostHeadings = [...count(hb)].filter(([h, n]) => ha.filter((x) => x === h).length < n).map(([h]) => h);
    if (lostHeadings.length) reasons.push(`retira secções: ${lostHeadings.slice(0, 5).join(", ")}`);
    else if (hb.join("\n") !== ha.filter((h) => hb.includes(h)).join("\n")) reasons.push("muda a ordem das secções");
    const { removed, total } = removedLines(stripBom(before), stripBom(after));
    if (total >= REWRITE_MIN_LINES && removed / total > REWRITE_RATIO) reasons.push(`muda ${removed} de ${total} linhas da nota original`);
    if (reasons.length)
      ask(`Alteração grande a uma nota do Obsidian (${reasons.join("; ")}). Revê as alterações propostas antes de permitir.`);
  }

  /** Um comando não pode falar com o próprio Agent Office (aprovar-se a si próprio, mudar perfis). */
  function checkShell(args) {
    const command = String(args.command ?? "");
    const ports = (policy.officePorts ?? []).map(String);
    if (ports.some((p) => new RegExp(`(^|[^0-9])${p}([^0-9]|$)`).test(command)))
      block("os comandos não podem falar com o servidor do Agent Office");
  }

  let input = "";
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    try {
      const event = JSON.parse(input);
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
      } else if (WRITE_TOOLS.has(name)) {
        const path = target(name === "NotebookEdit" ? args.notebook_path : args.file_path);
        checkWrite(path);
        checkNote(name, args, path);
      } else if (SHELL_TOOLS.has(name)) checkShell(args);
      process.exit(0);
    } catch (err) {
      block(`erro no guard (${err instanceof Error ? err.message : String(err)})`);
    }
  });
}

try {
  main();
} catch (err) {
  block(`erro no guard (${err instanceof Error ? err.message : String(err)})`);
}
