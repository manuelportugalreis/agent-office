// Verifica se o computador está pronto para correr o Agent Office. Uso: npm run doctor
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const results = [];
const ok = (msg) => results.push(["ok", msg]);
const warn = (msg) => results.push(["warn", msg]);
const fail = (msg) => results.push(["fail", msg]);

// Node
const major = Number(process.versions.node.split(".")[0]);
if (major >= 24) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node}: precisa da versão 24 ou mais recente (usa node:sqlite e executa TypeScript diretamente)`);

// Claude Code
// Primeiro diretamente; se falhar (por exemplo, um atalho .cmd no Windows), pela shell com um comando fixo.
let claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
if (claude.error) claude = spawnSync("claude --version", { encoding: "utf8", shell: true });
if (claude.status === 0) ok(`Claude Code ${claude.stdout.trim()} (confirma que tens sessão iniciada: corre "claude" uma vez)`);
else fail("Claude Code não encontrado. Instala-o e inicia sessão: https://docs.claude.com/en/docs/claude-code");

// Dependências e compilação
if (existsSync(join(root, "node_modules"))) ok("Dependências instaladas");
else fail("Faltam as dependências: corre npm install");
if (existsSync(join(root, "app", "dist", "index.html"))) ok("Interface compilada (npm start serve-a)");
else warn("Interface ainda não compilada: npm start compila-a; para desenvolver usa npm run dev");

// Configuração
try {
  const { loadConfig, allowedOrigins } = await import("../server/src/config.ts");
  const config = loadConfig();
  const file = existsSync(join(root, "office.config.json"))
    ? "office.config.json"
    : "predefinições (copia office.config.example.json para office.config.json)";
  ok(`Configuração válida: ${file}`);
  ok(`Utilizador: ${config.userName || "(sem nome)"}; Canvas: ${config.canvasHost}; origens: ${allowedOrigins(config).length}`);

  // Porta
  const free = await new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(config.port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
  if (free) ok(`Porta ${config.port} livre`);
  else warn(`Porta ${config.port} em uso (já está a correr? senão muda "port" em office.config.json)`);
} catch (err) {
  fail(`Configuração inválida: ${err instanceof Error ? err.message : String(err)}`);
}

const icons = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };
for (const [level, msg] of results) console.log(`${icons[level]} ${msg}`);
const failed = results.filter(([l]) => l === "fail").length;
console.log(
  failed ? `\n${failed} problema(s) a resolver.` : "\nTudo pronto. Corre: npm run dev  (desenvolvimento)  ou  npm start  (uso normal)",
);
process.exit(failed ? 1 : 0);
