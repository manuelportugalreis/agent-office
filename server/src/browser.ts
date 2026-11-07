import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canvasUrl, config, type OfficeConfig } from "./config.ts";

/**
 * Abrir um sítio numa janela real do browser (o teu, com a tua sessão iniciada) e dizer o que se vê.
 * O servidor lança o Chrome com o endereço (vem da configuração, nunca do texto de uma ordem); o Chrome abre-o num
 * separador da janela que já tens e traz essa janela para a frente. Abrir não é o mesmo que ter acesso: o título da
 * janela diz se ficou à vista o Canvas, uma página de login ou outra coisa, e a leitura da página (pela extensão do
 * Chrome) confirma o acesso à parte.
 */

export type SiteId = "canvas";
/** O que a janela mostra: a página pedida, um login (sessão expirada, MFA) ou não se sabe. */
export type PageAccess = "ok" | "login" | "unknown";

export interface SiteOpenResult {
  readonly launched: boolean;
  /** Em que browser se abriu ("Chrome" ou "o browser predefinido"). */
  readonly browser?: string;
  /** Título da janela depois de abrir (o separador ativo), sem o nome do browser. */
  readonly title?: string;
  readonly access: PageAccess;
  readonly error?: string;
  /** Títulos das janelas no fim (para, depois do login, ver o que mudou desde aqui). */
  readonly snapshot?: readonly string[];
  /** Uma janela já mostrava esta página antes de abrir (título igual): não confirma, mas diz-se. */
  readonly alreadyShown?: string;
}

export interface SiteWindow {
  readonly title?: string;
  readonly access: PageAccess;
}

export interface BrowserDeps {
  /** Lança o URL; devolve o nome do browser, ou null se não conseguiu. */
  readonly launch?: (url: string) => Promise<string | null>;
  /** Títulos das janelas dos browsers abertos. */
  readonly titles?: () => Promise<string[]>;
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly config?: OfficeConfig;
}

export const SITE_NAMES: Readonly<Record<SiteId, string>> = { canvas: "o Canvas" };

export const siteUrl = (site: SiteId, c: OfficeConfig = config): string => (site === "canvas" ? canvasUrl(c) : "");

const BROWSER_SUFFIX = /\s+[-–—]\s+(Google Chrome|Chromium|Microsoft Edge|Mozilla Firefox|Brave)$/i;
const LOGIN =
  /(sign\s?in|log\s?in|login|iniciar sess|inicie sess|entrar na conta|autentica|single sign|\bsso\b|\bduo\b|two-step|2-step|verify your|verifica[çc][ãa]o|weblogin|\bcas\b|okta|microsoftonline|session (expired|timed out)|sess[ãa]o expirou)/i;
const CANVAS_PAGE =
  /(dashboard|painel|courses|cursos|disciplinas|assignments|trabalhos|tarefas|to do|a fazer|calendar|calend[áa]rio|inbox|syllabus|modules|m[óo]dulos|grades|notas|canvas)/i;

/** Título sem o nome do browser ("Dashboard - Google Chrome" → "Dashboard"). */
export const cleanTitle = (title: string): string => title.replace(BROWSER_SUFFIX, "").trim();

/** O que um título de janela diz sobre a página: login primeiro ("Log In to Canvas" é login, não o Canvas). */
export function classifyTitle(title: string | undefined): PageAccess {
  const t = cleanTitle(title ?? "");
  if (!t) return "unknown";
  if (LOGIN.test(t)) return "login";
  if (CANVAS_PAGE.test(t)) return "ok";
  return "unknown";
}

/** Onde está o Chrome neste computador (Windows, macOS); null se não estiver instalado. */
export function findChrome(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const candidates =
    process.platform === "win32"
      ? [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]
          .filter((d): d is string => !!d)
          .map((d) => join(d, "Google", "Chrome", "Application", "chrome.exe"))
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Corre um programa sem shell e diz se arrancou (o URL vai como argumento: nada é interpretado). */
function startDetached(cmd: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, [...args], { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Lança o URL no Chrome (a tua sessão); sem Chrome, no browser predefinido. */
export async function launchInBrowser(url: string): Promise<string | null> {
  const chrome = findChrome();
  if (chrome && (await startDetached(chrome, [url]))) return "Chrome";
  const fallback =
    process.platform === "win32"
      ? startDetached("rundll32", ["url.dll,FileProtocolHandler", url])
      : startDetached(process.platform === "darwin" ? "open" : "xdg-open", [url]);
  return (await fallback) ? "o browser predefinido" : null;
}

/** Abre uma pasta no explorador de ficheiros (Explorador do Windows, Finder) para lá pores ficheiros. */
export function openFolder(dir: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  return startDetached(cmd, [dir]);
}

// "exit 0": sem isto, um browser que não está aberto (ex.: Firefox) põe o código de saída a 1 e a lista certa perdia-se.
const TITLE_SCRIPT =
  "Get-Process chrome,msedge,firefox,brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }; exit 0";

/** Títulos das janelas dos browsers (Windows; noutros sistemas não se sabe e devolve []). */
export function browserTitles(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    // A saída conta mesmo com um código de erro (o PowerShell marca erros não fatais); só um timeout a perde.
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", TITLE_SCRIPT], { windowsHide: true, timeout: 8000 }, (_err, out) =>
      resolve(
        String(out ?? "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    );
  });
}

/** O título que se mostra: curto e sem caracteres de controlo (é texto de uma página, logo dados, não instruções). */
const shown = (title: string): string =>
  cleanTitle(title)
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .slice(0, 80);

/**
 * A janela que mudou desde `before` e mostra o Canvas ou o login. Só as que mudaram contam: um "Dashboard" que já
 * estava aberto noutra janela não prova que o Canvas abriu agora. Os títulos de outras janelas (um email, o banco)
 * nunca saem daqui: sem Canvas nem login, não se diz título nenhum.
 */
function pick(titles: readonly string[], before: readonly string[]): SiteWindow {
  const fresh = titles.filter((t) => !before.includes(t));
  const login = fresh.find((t) => classifyTitle(t) === "login");
  if (login) return { title: shown(login), access: "login" };
  const ok = fresh.find((t) => classifyTitle(t) === "ok");
  if (ok) return { title: shown(ok), access: "ok" };
  return { access: "unknown" };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Abre o sítio numa janela e espera (pouco) que a janela mostre a página ou o login. */
export async function openSite(site: SiteId, deps: BrowserDeps = {}): Promise<SiteOpenResult> {
  const url = siteUrl(site, deps.config ?? config);
  if (!url) return { launched: false, access: "unknown", error: "não sei o endereço desse sítio" };
  const titles = deps.titles ?? browserTitles;
  const before = await titles();
  const browser = await (deps.launch ?? launchInBrowser)(url);
  if (!browser) return { launched: false, access: "unknown", error: "não encontrei um browser para abrir" };
  const wait = deps.waitMs ?? 15_000;
  const poll = deps.pollMs ?? 800;
  let seen: SiteWindow = { access: "unknown" };
  let last: string[] = before;
  for (let t = 0; t <= wait; t += poll) {
    await sleep(poll);
    last = await titles();
    seen = pick(last, before);
    if (seen.access !== "unknown") break;
  }
  // Nada mudou, mas uma janela já mostrava o Canvas antes de abrir: diz-se, sem o contar como confirmação.
  const before_ = seen.access === "unknown" ? pick(last, []) : null;
  const already = before_?.access === "ok" ? { alreadyShown: before_.title } : {};
  return { launched: true, browser, access: seen.access, snapshot: last, ...(seen.title ? { title: seen.title } : {}), ...already };
}

/**
 * O que a janela mostra agora, sem abrir nada (depois de o utilizador iniciar sessão): conta o que mudou desde
 * `snapshot` (o que se via quando se pediu o login).
 */
export async function checkSiteWindow(snapshot: readonly string[] = [], deps: BrowserDeps = {}): Promise<SiteWindow> {
  return pick(await (deps.titles ?? browserTitles)(), snapshot);
}
