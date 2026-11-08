/**
 * `npm run eval [-- ids/agentes]`: corre os casos de evals.ts com os agentes reais (Claude Code, gasta quota) numa
 * pasta temporária, no modo escritório e sem a tua configuração nem o teu Obsidian, e mostra o que passou.
 * O resultado fica em server/data/evals/<data>.json para comparares antes e depois de mudar um prompt.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agent-office-eval-"));
// Antes de carregar o servidor: pastas isoladas e a configuração predefinida (nada do utilizador real).
process.env.AGENT_OFFICE_WORKSPACES = root;
process.env.AGENT_OFFICE_CONFIG = "none";

const { EVAL_CASES, grade, selectCases } = await import("./evals.ts");
const { createHub } = await import("./hub.ts");
const { userInstructions } = await import("./instructions.ts");
const { findAgent } = await import("./agents.ts");
const { ensureWorkspace } = await import("./workspace.ts");

const filter = process.argv.slice(2).join(",");
const cases = selectCases(filter);
if (!cases.length) {
  console.error(`Nenhum caso corresponde a «${filter}». Casos: ${EVAL_CASES.map((c) => c.id).join(", ")}`);
  process.exit(2);
}

const hub = createHub({ emit: () => undefined, context: (id) => userInstructions(id), profileFor: () => null });
const results = [];
console.log(`A correr ${cases.length} caso(s) em ${root}\n`);
for (const c of cases) {
  const agent = findAgent(c.agent);
  if (!agent) throw new Error(`agente desconhecido: ${c.agent}`);
  const dir = ensureWorkspace(agent);
  for (const [rel, text] of Object.entries(c.files ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  const t0 = Date.now();
  const run = await hub.run(c.agent, c.prompt, { isolated: true, profile: null, silent: true, ...c.opts });
  const seconds = Math.round((Date.now() - t0) / 1000);
  const read = (rel: string): string | null => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : null);
  const written = (run.steps ?? []).filter((s) => s.ok !== false && s.file).map((s) => s.file as string);
  const r = run.ok
    ? grade(c, { reply: run.reply, written, read })
    : { id: c.id, agent: c.agent, passed: false, failed: [`não correu: ${run.error ?? "erro"}`], checks: c.checks.length };
  results.push({ ...r, seconds, reply: run.reply });
  console.log(`${r.passed ? "PASSA" : "FALHA"}  ${c.id.padEnd(20)} ${String(seconds).padStart(4)} s  ${c.about}`);
  for (const f of r.failed) console.log(`         x ${f}`);
}
hub.shutdown();

const passed = results.filter((r) => r.passed).length;
const checks = results.reduce((n, r) => n + r.checks, 0);
const failedChecks = results.reduce((n, r) => n + r.failed.length, 0);
console.log(`\n${passed}/${results.length} casos passaram; ${checks - failedChecks}/${checks} verificações.`);
const out = join(import.meta.dirname, "..", "data", "evals");
mkdirSync(out, { recursive: true });
const file = join(out, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), filter, results }, null, 2));
console.log(`Resultados: ${file}`);
process.exit(passed === results.length ? 0 : 1);
