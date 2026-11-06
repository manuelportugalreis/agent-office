// Agent Office como app: arranca o servidor em segundo plano (se ainda não estiver a correr), compila a interface se
// ela mudou e abre o escritório numa janela própria (modo app do Edge, ou do Chrome se não houver Edge), sem
// separadores nem barra de endereço. Ao fechar a janela, o servidor que esta app arrancou desliga-se.
// Uso: node scripts/app.mjs   (os atalhos criados por `npm run app:install` correm isto sem consola)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const logDir = join(root, "server", "data");
mkdirSync(logDir, { recursive: true });

/** A porta do teu office.config.json (ou a predefinida). */
function port() {
  try {
    const cfg = JSON.parse(readFileSync(join(root, "office.config.json"), "utf8"));
    if (Number.isInteger(cfg.port)) return cfg.port;
  } catch {
    /* sem configuração: predefinição */
  }
  return Number(process.env.AGENT_OFFICE_PORT ?? 8787);
}

const url = `http://127.0.0.1:${port()}`;

async function healthy() {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Data do ficheiro mais recente de uma pasta (para saber se a interface tem de ser compilada de novo). */
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

function buildIfNeeded() {
  const index = join(root, "app", "dist", "index.html");
  const sources = Math.max(
    newest(join(root, "app", "src")),
    newest(join(root, "shared")),
    statSync(join(root, "app", "index.html")).mtimeMs,
  );
  if (existsSync(index) && statSync(index).mtimeMs >= sources) return;
  const r = spawnSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: join(root, "app"),
    stdio: "ignore",
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error("não consegui compilar a interface (corre `npm run build` para ver o erro)");
}

/** Edge ou Chrome instalado (o modo app precisa de um browser Chromium). */
function browser() {
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates =
    process.platform === "win32"
      ? [
          join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
          join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
          join(pf, "Google", "Chrome", "Application", "chrome.exe"),
          join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
          join(local, "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  return candidates.find((c) => existsSync(c)) ?? null;
}

async function main() {
  let server = null;
  if (!(await healthy())) {
    buildIfNeeded();
    // O servidor escreve o registo em server/data/app.log (sem janela de consola).
    const { openSync } = await import("node:fs");
    const out = openSync(join(logDir, "app.log"), "a");
    server = spawn(process.execPath, [join(root, "server", "src", "index.ts")], {
      cwd: root,
      stdio: ["ignore", out, out],
      windowsHide: true,
    });
    for (let i = 0; i < 60 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await healthy())) {
      server.kill();
      throw new Error(`o servidor não arrancou (vê ${join(logDir, "app.log")})`);
    }
  }
  const exe = browser();
  if (!exe) {
    // Sem Edge nem Chrome: abre no browser predefinido.
    spawn(process.platform === "win32" ? "explorer.exe" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  // Um perfil próprio: a janela não se mistura com o teu browser e esta app sabe quando ela fecha.
  const profile = join(root, "server", "data", "app-window");
  const win = spawn(
    exe,
    [`--app=${url}`, `--user-data-dir=${profile}`, "--window-size=1500,950", "--no-first-run", "--no-default-browser-check"],
    {
      stdio: "ignore",
      windowsHide: false,
    },
  );
  win.on("exit", () => {
    // Fechaste a janela: desliga o servidor se foi esta app que o arrancou.
    server?.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  // Sem consola: mostra o erro numa caixa do Windows.
  const msg = `Agent Office: ${err instanceof Error ? err.message : String(err)}`;
  if (process.platform === "win32")
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${msg.replaceAll("'", "''")}')`,
      ],
      {
        windowsHide: true,
      },
    );
  else console.error(msg);
  process.exit(1);
});
