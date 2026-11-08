import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, normalize, parse, relative, resolve } from "node:path";
import type { AccessProfile, ProfileInput } from "../../shared/protocol.ts";

/**
 * Perfis de acesso do modo "Claude Code local". O servidor é a única fonte do acesso: o que vem do browser é
 * validado aqui (caminhos reais, pastas existentes) e o que um agente escreve nunca chega a mudar um perfil.
 */

/** Pasta do próprio Agent Office: um agente local não a pode escrever (seria mudar as próprias regras). */
export const OFFICE_ROOT = resolve(import.meta.dirname, "..", "..");
/** Política do guard e configurações MCP das corridas: um perfil não pode ler nem escrever aqui. */
const RUNS_DIR = join(tmpdir(), "agent-office-runs");
/** Configuração do Claude Code do utilizador (definições, hooks, credenciais): nunca como pasta de trabalho. */
const CLAUDE_HOME = join(homedir(), ".claude");

const isWin = process.platform === "win32";
const norm = (p: string): string => (isWin ? normalize(p).toLowerCase() : normalize(p));

export function isInside(root: string, target: string): boolean {
  const rel = relative(norm(root), norm(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const overlaps = (a: string, b: string): boolean => isInside(a, b) || isInside(b, a);

export class ProfileError extends Error {}

/** Caminho real de uma pasta que tem de existir. */
function realDir(raw: string, what: string): string {
  if (!isAbsolute(raw)) throw new ProfileError(`${what}: usa um caminho completo (ex.: C:\\Users\\tu\\projeto)`);
  if (raw.startsWith("\\\\") || raw.startsWith("//")) throw new ProfileError(`${what}: pastas de rede não são permitidas`);
  if (!existsSync(raw) || !statSync(raw).isDirectory()) throw new ProfileError(`${what}: a pasta não existe (${raw})`);
  const real = realpathSync.native(raw);
  if (parse(real).root === real || norm(real) === norm(homedir()))
    throw new ProfileError(`${what}: escolhe uma pasta concreta, não a raiz do disco nem a tua pasta pessoal inteira`);
  if (overlaps(real, CLAUDE_HOME)) throw new ProfileError(`${what}: a pasta de configuração do Claude Code não pode ser usada`);
  if (overlaps(real, RUNS_DIR))
    throw new ProfileError(`${what}: inclui a pasta temporária onde o Agent Office guarda as regras das corridas`);
  return real;
}

const dedupe = (dirs: readonly string[]): string[] => {
  const out: string[] = [];
  for (const d of dirs) if (!out.some((o) => norm(o) === norm(d))) out.push(d);
  return out;
};

export interface ProfileContext {
  /** Vault do Obsidian configurado (vazio = sem vault). */
  readonly vaultDir: string;
  /** Nomes de servidores MCP que existem na tua configuração. */
  readonly mcpNames: readonly string[];
}

/** Valida e normaliza um perfil. Lança ProfileError com uma mensagem em português se algo estiver mal. */
export function validateProfile(input: ProfileInput, ctx: ProfileContext): ProfileInput {
  const folder = realDir(input.folder, "Pasta de trabalho");
  const readDirs = dedupe(input.readDirs.map((d) => realDir(d, "Pasta de leitura")));
  const writeDirs = dedupe(input.writeDirs.map((d) => realDir(d, "Pasta de escrita")));
  for (const d of [folder, ...writeDirs])
    if (overlaps(d, OFFICE_ROOT))
      throw new ProfileError("Não podes dar escrita na pasta do próprio Agent Office (as regras dos agentes vivem lá).");
  if (input.vault !== "none" && !ctx.vaultDir)
    throw new ProfileError("Não há vault do Obsidian configurado (vaultDir em office.config.json).");
  const vaultFolders = dedupe(
    input.vaultFolders.map((f) => {
      const clean = f.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
      if (!clean || isAbsolute(f) || clean.split("/").some((s) => s === ".." || s === "." || s.startsWith(".")))
        throw new ProfileError(`Pasta do vault inválida: ${f} (usa um caminho relativo dentro do vault)`);
      const abs = join(ctx.vaultDir, clean);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new ProfileError(`A pasta "${clean}" não existe no vault.`);
      // Um atalho (symlink/junction) dentro do vault não pode dar escrita fora dele.
      if (!isInside(realpathSync.native(ctx.vaultDir), realpathSync.native(abs)))
        throw new ProfileError(`A pasta "${clean}" aponta para fora do vault.`);
      return clean;
    }),
  );
  const unknown = input.mcp.find((m) => m !== "*" && !ctx.mcpNames.includes(m));
  if (unknown) throw new ProfileError(`O servidor MCP "${unknown}" não está na tua configuração do Claude Code.`);
  return { ...input, folder, readDirs, writeDirs, vaultFolders: input.vault === "write" ? vaultFolders : [], mcp: dedupe(input.mcp) };
}

/** Pastas que um perfil deixa ler e escrever (o vault conforme o acesso), para os guards e o `--add-dir`. */
export function profileRoots(p: AccessProfile, vaultDir: string): { read: string[]; write: string[] } {
  const vaultWrite = p.vault === "write" ? (p.vaultFolders.length ? p.vaultFolders.map((f) => join(vaultDir, f)) : [vaultDir]) : [];
  const vaultRead = p.vault !== "none" && vaultDir ? [vaultDir] : [];
  const write = dedupe([p.folder, ...p.writeDirs, ...vaultWrite]);
  return { read: dedupe([...write, ...p.readDirs, ...vaultRead]), write };
}

export { describeProfile } from "../../shared/access.ts";

// ---------- servidores MCP da tua configuração ----------

type McpConfig = Record<string, unknown>;

const CLAUDE_JSON = (): string => process.env.AGENT_OFFICE_CLAUDE_JSON ?? join(homedir(), ".claude.json");

function readJson(path: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const servers = (v: unknown): Record<string, McpConfig> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, McpConfig>) : {};

/**
 * Servidores MCP que podes escolher num perfil: os teus (âmbito utilizador) e os do projeto guardados em ~/.claude.json
 * (fora do alcance dos agentes). Só o servidor lê as definições (podem ter segredos); a interface só vê os nomes.
 */
export function mcpCatalog(folder?: string): Record<string, McpConfig> {
  const user = readJson(CLAUDE_JSON());
  const out: Record<string, McpConfig> = { ...servers(user?.mcpServers) };
  if (!folder) return out;
  const projects = servers(user?.projects);
  for (const [key, proj] of Object.entries(projects))
    if (norm(key.replaceAll("/", isWin ? "\\" : "/")) === norm(folder))
      Object.assign(out, servers((proj as Record<string, unknown>).mcpServers));
  // O .mcp.json da pasta do projeto não conta: um agente com escrita no projeto podia plantar lá um servidor que
  // correria na sessão seguinte. (Com "todas as do terminal", é o próprio Claude Code que o lê e pede confiança.)
  return out;
}

/** Nomes dos servidores MCP configurados (para a interface escolher). */
export const mcpNames = (folders: readonly string[] = []): string[] =>
  [...new Set([Object.keys(mcpCatalog()), ...folders.map((f) => Object.keys(mcpCatalog(f)))].flat())].sort();

/** Id do perfil por omissão (não fica na base de dados; nunca colide com os perfis criados, que começam em 1). */
export const DEFAULT_PROFILE_ID = 0;

/**
 * "Acesso total": o que o Claude Code do teu terminal tem. Pasta de trabalho = `workDir` (ou a tua pasta pessoal),
 * comandos de terminal, todas as tuas integrações e skills, edições sem perguntar; o vault com escrita se existir.
 * Sem validação de pastas porque não vem do browser; o Agent Office continua protegido pelo guard (noWrite).
 */
export function defaultProfile(workDir: string, vaultDir: string): AccessProfile {
  const folder = workDir && existsSync(workDir) ? workDir : homedir();
  return Object.freeze({
    id: DEFAULT_PROFILE_ID,
    name: "Acesso total",
    folder,
    readDirs: [],
    writeDirs: [],
    vault: vaultDir ? "write" : "none",
    vaultFolders: [],
    bash: true,
    mcp: ["*"],
    autoEdits: true,
    autoMode: true,
    skills: true,
    browser: false,
  });
}
