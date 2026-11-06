import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fold } from "../../shared/places.ts";

/**
 * O vault do Obsidian visto pelo servidor: encontrar uma nota pelo título, alias, link ([[...]]) ou caminho, e abri-la
 * no Obsidian do computador (protocolo obsidian://), confirmando pelo workspace do próprio Obsidian que a abriu.
 * Só leitura: escrever notas é trabalho dos agentes, com as ferramentas vigiadas pelos guards.
 */

const MAX_FILES = 20000;
const SKIP = new Set([".obsidian", ".trash", ".git", "node_modules"]);

export interface NoteRef {
  /** Caminho relativo ao vault, com barras "/" (ex.: "Projetos/Planeamento.md"). */
  readonly path: string;
  readonly title: string;
  readonly aliases: readonly string[];
}

export type NoteMatch =
  | { readonly kind: "one"; readonly note: NoteRef; readonly absolute: string }
  | { readonly kind: "many"; readonly options: readonly NoteRef[] }
  | { readonly kind: "none"; readonly similar: readonly NoteRef[] };

function walk(dir: string, out: string[]): string[] {
  if (out.length >= MAX_FILES) return out;
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

/** Aliases do frontmatter (aliases: [a, b], aliases:\n - a, ou alias: a). */
export function aliasesOf(text: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(aliases|alias)\s*:\s*(.*)$/i.exec(lines[i]);
    if (!kv) continue;
    const value = kv[2].trim();
    const clean = (v: string): string => v.trim().replace(/^["']|["']$/g, "");
    if (value.startsWith("[") && value.endsWith("]")) out.push(...value.slice(1, -1).split(",").map(clean));
    else if (value) out.push(clean(value));
    else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) out.push(clean(lines[j].replace(/^\s*-\s+/, "")));
  }
  return out.filter(Boolean);
}

const toRel = (vault: string, p: string): string => relative(vault, p).replaceAll("\\", "/");

/** O índice é reaproveitado por uns segundos: cada mensagem de chat consulta-o e um vault grande demora a ler. */
const INDEX_TTL_MS = 5000;
const indexCache = new Map<string, { at: number; notes: NoteRef[] }>();

/** Todas as notas do vault (fora das pastas escondidas). */
export function indexVault(vault: string, now = Date.now()): NoteRef[] {
  if (!vault || !existsSync(vault)) return [];
  const cached = indexCache.get(vault);
  if (cached && now - cached.at < INDEX_TTL_MS) return cached.notes;
  const notes = readIndex(vault);
  indexCache.set(vault, { at: now, notes });
  return notes;
}

function readIndex(vault: string): NoteRef[] {
  return walk(vault, []).map((p) => {
    let text = "";
    try {
      text = readFileSync(p, "utf8");
    } catch {
      /* nota ilegível: fica só com o título */
    }
    return { path: toRel(vault, p), title: basename(p, ".md"), aliases: aliasesOf(text) };
  });
}

/** Tira [[ ]], aspas, a extensão .md, a secção (#) e o texto alternativo (|) de uma referência a uma nota. */
export function cleanNoteQuery(raw: string): string {
  let q = raw.trim().replace(/^["'«“]|["'»”]$/g, "");
  const link = /^\[\[([^\]]+)\]\]$/.exec(q);
  if (link) q = link[1];
  return q.split("|")[0].split("#")[0].replace(/\.md$/i, "").replaceAll("\\", "/").trim();
}

/** Pontuação de uma nota para uma pesquisa: caminho exato > título ou alias exato > começa por > contém. */
function score(n: NoteRef, q: string): number {
  const path = fold(n.path.replace(/\.md$/i, ""));
  if (path === q) return 120;
  let best = 0;
  for (const name of [n.title, ...n.aliases].map(fold)) {
    if (name === q) best = Math.max(best, 100);
    else if (name.startsWith(q)) best = Math.max(best, 60);
    else if (name.includes(q)) best = Math.max(best, 40);
  }
  if (!best && path.endsWith(` ${q}`)) best = 90;
  return best;
}

/**
 * Resolve uma referência a uma nota. Um único resultado exato ganha; vários exatos (ou só parciais empatados) é
 * ambíguo e devolve as opções para perguntar ao utilizador.
 */
export function resolveNote(vault: string, raw: string, index: readonly NoteRef[] = indexVault(vault)): NoteMatch {
  let cleaned = cleanNoteQuery(raw);
  // Caminho completo de uma nota dentro do vault: passa a relativo.
  if (isAbsolute(cleaned)) {
    const rel = relative(resolve(vault), resolve(cleaned));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) cleaned = rel.replaceAll("\\", "/").replace(/\.md$/i, "");
  }
  const q = fold(cleaned.replaceAll("/", " "));
  if (!q) return { kind: "none", similar: [] };
  const scored = index
    .map((n) => ({ n, s: score(n, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.path.localeCompare(b.n.path));
  if (scored.length === 0) return { kind: "none", similar: similarNotes(index, q) };
  const top = scored[0].s;
  const best = scored.filter((x) => x.s === top).map((x) => x.n);
  if (best.length === 1 && (top >= 90 || scored.length === 1)) return one(vault, best[0]);
  return { kind: "many", options: (top >= 90 ? best : scored.map((x) => x.n)).slice(0, 6) };
}

function one(vault: string, note: NoteRef): NoteMatch {
  return { kind: "one", note, absolute: join(vault, ...note.path.split("/")) };
}

/** Notas com alguma palavra em comum (para sugerir quando nada bate certo). */
function similarNotes(index: readonly NoteRef[], q: string): NoteRef[] {
  const words = q.split(" ").filter((w) => w.length > 3);
  return index.filter((n) => words.some((w) => fold(n.title).includes(w))).slice(0, 5);
}

/**
 * Procura, dentro de um pedido em texto livre, a nota a que ele se refere: o maior pedaço de palavras seguidas que é
 * exatamente o título, um alias ou um link de uma nota (ex.: "ler Planeamento e propor..." → Planeamento).
 * `hint` marca onde começa a referência (a seguir a "nota" ou "ler"), para não apanhar palavras soltas.
 */
export function findNoteMention(vault: string, text: string, index: readonly NoteRef[] = indexVault(vault)): NoteMatch | null {
  const link = /\[\[([^\]]+)\]\]/.exec(text);
  if (link) return resolveNote(vault, link[0], index);
  // Caminho completo de uma nota dentro do vault (como os colegas escrevem nas tarefas).
  for (const m of text.matchAll(/[A-Za-z]:[\\/][^\n"'`<>|*?]*?\.md\b|\/[^\n"'`<>|*?]*?\.md\b/g)) {
    const rel = relative(resolve(vault), resolve(m[0]));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
      const hit = resolveNote(vault, rel.replaceAll("\\", "/"), index);
      if (hit.kind === "one") return hit;
    }
  }
  const quoted = /["«“]([^"»”]{1,120})["»”]/.exec(text);
  if (quoted) {
    const m = resolveNote(vault, quoted[1], index);
    if (m.kind !== "none") return m;
  }
  // Palavras a seguir às quais costuma vir o nome da nota ("a nota X", "ler X", "acrescenta à X", "edita X").
  const after =
    /(?<![\p{L}])(?:nota|notas|ler|lê|le|leia|lês|abre|abrir|abra|atualiza|atualizar|edita|editar|à|na|ao|no)\s+(?:a\s+|o\s+)?(?:nota\s+)?/giu;
  const names = new Map<string, NoteRef[]>();
  for (const n of index)
    for (const name of [n.title, ...n.aliases, n.path.replace(/\.md$/i, "")]) {
      const key = fold(name.replaceAll("/", " "));
      if (key) names.set(key, [...(names.get(key) ?? []), n]);
    }
  for (const m of text.matchAll(after)) {
    const words = text.slice((m.index ?? 0) + m[0].length).split(/\s+/);
    for (let len = Math.min(8, words.length); len >= 1; len--) {
      const key = fold(words.slice(0, len).join(" "));
      const hits = names.get(key);
      if (!hits) continue;
      const unique = [...new Map(hits.map((h) => [h.path, h])).values()];
      return unique.length === 1 ? one(vault, unique[0]) : { kind: "many", options: unique.slice(0, 6) };
    }
  }
  return null;
}

// ---------- abrir no Obsidian ----------

export interface ObsidianVault {
  /** Id do vault no Obsidian (o que o URI obsidian://open?vault= aceita). */
  readonly id: string;
  readonly path: string;
}

/** Pasta de configuração da app Obsidian (onde está o obsidian.json). */
const obsidianConfigDir = (): string =>
  process.platform === "win32"
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "obsidian")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "obsidian")
      : join(homedir(), ".config", "obsidian");

/** Vaults que o Obsidian deste computador conhece (o ficheiro obsidian.json da app). */
export function obsidianVaults(dir = obsidianConfigDir()): ObsidianVault[] {
  try {
    const data = JSON.parse(readFileSync(join(dir, "obsidian.json"), "utf8")) as { vaults?: Record<string, { path?: unknown }> };
    return Object.entries(data.vaults ?? {}).flatMap(([id, v]) => (typeof v.path === "string" && v.path ? [{ id, path: v.path }] : []));
  } catch {
    return [];
  }
}

const inside = (dir: string, file: string): boolean => {
  const r = relative(dir.toLowerCase(), file.toLowerCase());
  return !!r && !r.startsWith("..") && !isAbsolute(r);
};

/** O vault registado no Obsidian que contém o ficheiro (o mais específico), ou null. */
export function vaultFor(file: string, vaults: readonly string[]): string | null {
  const real = (p: string): string => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  const f = real(file);
  const hits = vaults.map(real).filter(
    (v) =>
      inside(v, f) &&
      !relative(v, f)
        .split(sep)
        .some((s) => s.startsWith(".")),
  );
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** O ficheiro que o Obsidian tem aberto (a última nota aberta segundo o workspace.json do vault). */
export function obsidianActiveFile(vault: string): string | null {
  for (const name of ["workspace.json", "workspace-mobile.json"]) {
    try {
      const data = JSON.parse(readFileSync(join(vault, ".obsidian", name), "utf8")) as {
        lastOpenFiles?: unknown;
        main?: unknown;
        active?: unknown;
      };
      const active = findLeafFile(data.main, typeof data.active === "string" ? data.active : "");
      if (active) return active;
      if (Array.isArray(data.lastOpenFiles) && typeof data.lastOpenFiles[0] === "string") return data.lastOpenFiles[0];
    } catch {
      /* sem workspace ainda */
    }
  }
  return null;
}

/** Procura, na árvore de painéis do workspace, o ficheiro do painel ativo. */
function findLeafFile(node: unknown, activeId: string): string | null {
  if (typeof node !== "object" || node === null) return null;
  const n = node as { id?: unknown; type?: unknown; state?: { state?: { file?: unknown } }; children?: unknown };
  if (n.type === "leaf" && n.id === activeId && typeof n.state?.state?.file === "string") return n.state.state.file;
  if (Array.isArray(n.children))
    for (const c of n.children) {
      const f = findLeafFile(c, activeId);
      if (f) return f;
    }
  return null;
}

export interface OpenResult {
  readonly launched: boolean;
  /** O workspace do Obsidian passou a mostrar esta nota (evidência de que abriu mesmo). */
  readonly confirmed: boolean;
  readonly error?: string;
}

export interface OpenDeps {
  readonly vaults?: readonly ObsidianVault[];
  readonly launch?: (uri: string) => boolean;
  readonly activeFile?: (vault: string) => string | null;
  readonly waitMs?: number;
  readonly pollMs?: number;
}

/** Lança um URI obsidian:// sem passar por uma shell (sem interpretação de % ou &). */
export function launchUri(uri: string): boolean {
  if (process.platform === "win32") {
    const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", uri], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  }
  const child = spawn(process.platform === "darwin" ? "open" : "xdg-open", [uri], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
  return true;
}

/**
 * Abre uma nota no Obsidian do computador: confirma que o Obsidian conhece um vault com esta nota, lança
 * `obsidian://open?path=` e espera que o workspace do vault mostre a nota (até `waitMs`).
 */
export async function openInObsidian(absolute: string, deps: OpenDeps = {}): Promise<OpenResult> {
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return { launched: false, confirmed: false, error: "a nota não existe" };
  const known = deps.vaults ?? obsidianVaults();
  // O vault registado mais específico que contém a nota (e o caminho real dele).
  const entry = known
    .map((v) => ({ v, root: vaultFor(absolute, [v.path]) }))
    .filter((x): x is { v: ObsidianVault; root: string } => x.root !== null)
    .sort((a, b) => b.root.length - a.root.length)[0];
  const vault = entry?.root;
  if (!vault || !entry)
    return {
      launched: false,
      confirmed: false,
      error: "o Obsidian deste computador não tem este vault registado (abre a pasta uma vez no Obsidian: Abrir pasta como vault)",
    };
  const rel = relative(vault, realpathSync.native(absolute)).replaceAll("\\", "/");
  // Pelo id do vault e o caminho relativo da nota (a forma documentada; o `path=` absoluto falha com algumas pastas).
  const uri = `obsidian://open?vault=${encodeURIComponent(entry.v.id)}&file=${encodeURIComponent(rel.replace(/\.md$/i, ""))}`;
  const launched = (deps.launch ?? launchUri)(uri);
  if (!launched) return { launched: false, confirmed: false, error: "não consegui lançar o Obsidian" };
  const active = deps.activeFile ?? obsidianActiveFile;
  const wait = deps.waitMs ?? 15_000;
  const poll = deps.pollMs ?? 500;
  for (let t = 0; t <= wait; t += poll) {
    if (active(vault) === rel) return { launched: true, confirmed: true };
    await new Promise((r) => setTimeout(r, poll));
  }
  return { launched: true, confirmed: false };
}
