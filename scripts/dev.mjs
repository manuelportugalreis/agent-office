// Arranca o servidor e a interface (Vite) juntos, com a saída de cada um identificada. Ctrl+C para os dois.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = join(import.meta.dirname, "..");
const requireFromApp = createRequire(join(root, "app", "package.json"));
// O Vite não exporta o caminho do executável: lê-se do package.json dele.
const vitePackage = requireFromApp.resolve("vite/package.json");
const viteBin = join(dirname(vitePackage), JSON.parse(readFileSync(vitePackage, "utf8")).bin.vite);

function configuredPort() {
  if (process.env.AGENT_OFFICE_PORT) return process.env.AGENT_OFFICE_PORT;
  try {
    const file = process.env.AGENT_OFFICE_CONFIG ?? join(root, "office.config.json");
    const port = JSON.parse(readFileSync(file, "utf8")).port;
    return Number.isInteger(port) ? String(port) : undefined;
  } catch {
    return undefined;
  }
}
const port = configuredPort();
// A interface em desenvolvimento precisa de saber a porta do servidor (VITE_SERVER_PORT).
const childEnv = { ...process.env, ...(port ? { AGENT_OFFICE_PORT: port, VITE_SERVER_PORT: port } : {}) };

const COLORS = { servidor: "\x1b[35m", interface: "\x1b[36m" };
const RESET = "\x1b[0m";

const children = [];
let stopping = false;

function run(name, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `${COLORS[name]}[${name}]${RESET} `;
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.on("data", (chunk) => {
      const lines = (pending + chunk.toString()).split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) console.log(prefix + line);
    });
  }
  child.on("exit", (code) => {
    if (!stopping) {
      console.log(`${prefix}terminou (código ${code}). A parar o resto.`);
      stop(code ?? 1);
    }
  });
  children.push(child);
}

function stop(code = 0) {
  stopping = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

run("servidor", ["server/src/index.ts"], root);
run("interface", [viteBin], join(root, "app"));
console.log("A interface fica em http://127.0.0.1:5174 (modo de desenvolvimento).");
