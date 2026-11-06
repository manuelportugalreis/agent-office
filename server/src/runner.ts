import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CHROME_READ_TOOLS, FILE_TOOLS, WEB_TOOLS, type RealAgent } from "./agents.ts";
import { config } from "./config.ts";
import { parseLine, type AgentEvent } from "./events.ts";
import type { AccessProfile } from "../../shared/protocol.ts";
import { localRun } from "./local-runner.ts";
import { ensureWorkspace, WORKSPACES_DIR, workspaceDir } from "./workspace.ts";

export interface RunRequest {
  readonly agent: RealAgent;
  readonly text: string;
  readonly sessionId: string;
  /** true se a sessão já existe (continua a conversa em vez de criar uma nova). */
  readonly resume: boolean;
  /** Modo "Claude Code local": corre na pasta do perfil, com as tuas definições e os limites do perfil. */
  readonly profile?: AccessProfile;
  /** Sem ferramentas nenhumas (o plano e o resumo do CEO: só texto, a partir do que lhe é dado). */
  readonly toolless?: boolean;
}

/** Uma pergunta de permissão de uma sessão local (o que no terminal te apareceria para confirmar). */
export interface PermissionAsk {
  readonly tool: string;
  readonly input: unknown;
  readonly summary: string;
  readonly detail?: string;
  readonly reason?: string;
}

export interface RunHandlers {
  onEvent(event: AgentEvent): void;
  onExit(code: number | null, stderr: string): void;
  /** Só nas sessões locais: responde com `respond(true)` para permitir ou `respond(false, motivo)` para recusar. */
  onPermission?(ask: PermissionAsk, respond: (allow: boolean, message?: string) => void): void;
}

export interface RunHandle {
  kill(): void;
}

export type Runner = (req: RunRequest, handlers: RunHandlers) => RunHandle;

const STDERR_LIMIT = 2000;
const slash = (p: string): string => p.replaceAll("\\", "/");
/** O hook corre com o mesmo Node que está a correr o servidor (caminho absoluto): não depende do PATH do processo do Claude. */
const nodeCommand = (): string => `"${slash(process.execPath)}"`;
const hookPath = (name: string): string => slash(join(import.meta.dirname, "..", "hooks", name));

interface Hook {
  readonly matcher: string;
  readonly hooks: readonly { readonly type: "command"; readonly command: string }[];
}

/** O vault do Obsidian (se configurado) é uma pasta onde os agentes também podem escrever. */
const vaultArgs = (): string => (config.vaultDir ? ` "rw:${slash(config.vaultDir)}"` : "");

/** Hooks que bloqueiam, antes de correr, o que o agente não pode fazer (Chrome fora dos domínios, ficheiros fora da pasta). */
export function guardHooks(agent: RealAgent): Hook[] {
  const hooks: Hook[] = [];
  if (agent.chrome) {
    hooks.push({
      matcher: "mcp__claude-in-chrome__.*",
      hooks: [{ type: "command", command: `${nodeCommand()} "${hookPath("chrome-guard.mjs")}" ${agent.chrome.hosts.join(" ")}` }],
    });
  }
  if (agent.files) {
    const command = `${nodeCommand()} "${hookPath("fs-guard.mjs")}" "${slash(workspaceDir(agent.id))}" "${slash(WORKSPACES_DIR)}"${vaultArgs()}`;
    hooks.push({ matcher: FILE_TOOLS.join("|"), hooks: [{ type: "command", command }] });
  }
  if (agent.tools.some((t) => WEB_TOOLS.includes(t))) {
    hooks.push({ matcher: WEB_TOOLS.join("|"), hooks: [{ type: "command", command: `${nodeCommand()} "${hookPath("web-guard.mjs")}"` }] });
  }
  return hooks;
}

/** Hooks de pós-execução: o do Chrome regista os separadores onde a navegação correu bem (só esses podem ser lidos). */
export function postHooks(agent: RealAgent): Hook[] {
  if (!agent.chrome) return [];
  return [
    {
      matcher: "mcp__claude-in-chrome__navigate",
      hooks: [{ type: "command", command: `${nodeCommand()} "${hookPath("chrome-guard.mjs")}" --post ${agent.chrome.hosts.join(" ")}` }],
    },
  ];
}

/** Argumentos do `claude -p`: isolado das tuas definições, sem MCP, só com as ferramentas do agente e com os hooks de segurança. */
export function buildArgs(req: RunRequest): string[] {
  if (req.toolless) return toollessArgs(req);
  const { agent } = req;
  const builtin = [...(agent.files ? FILE_TOOLS : []), ...agent.tools];
  const allowed = [...builtin, ...(agent.chrome ? CHROME_READ_TOOLS : [])].join(",");
  const hooks = guardHooks(agent);
  const post = postHooks(agent);
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // "project" carrega o CLAUDE.md da pasta do agente (a memória dele); as tuas definições globais ficam de fora.
    "--setting-sources",
    "local,project",
    "--strict-mcp-config",
    ...(agent.chrome ? ["--chrome"] : []),
    ...(hooks.length
      ? ["--settings", JSON.stringify({ hooks: { PreToolUse: hooks, ...(post.length ? { PostToolUse: post } : {}) } })]
      : []),
    ...(agent.files ? ["--add-dir", slash(WORKSPACES_DIR), ...(config.vaultDir ? ["--add-dir", slash(config.vaultDir)] : [])] : []),
    "--tools",
    builtin.join(","),
    ...(allowed ? ["--allowedTools", allowed] : []),
    "--permission-mode",
    "dontAsk",
    "--model",
    agent.model,
    "--append-system-prompt",
    agent.systemPrompt,
    req.resume ? "--resume" : "--session-id",
    req.sessionId,
  ];
}

/** Só texto: nenhuma ferramenta, nenhum hook, nenhuma pasta extra (o modelo responde ao que lhe é dado). */
function toollessArgs(req: RunRequest): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources",
    "local,project",
    "--strict-mcp-config",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--model",
    req.agent.model,
    "--append-system-prompt",
    `${req.agent.systemPrompt} ${TOOLLESS_RULE}`,
    req.resume ? "--resume" : "--session-id",
    req.sessionId,
  ];
}

/** Sem ferramentas o modelo não pode gravar nada: não pode fingir que gravou (nem escrever chamadas a ferramentas). */
export const TOOLLESS_RULE =
  "Nesta resposta não tens ferramentas nenhumas: responde só com texto, nunca escrevas chamadas a ferramentas, não atualizes o teu CLAUDE.md nem outros ficheiros e nunca digas que gravaste ou registaste alguma coisa.";

/** Lança o `claude` num processo próprio. O texto do utilizador vai por stdin, nunca como argumento. */
export const claudeRunner: Runner = (req, handlers) => {
  if (req.profile) return localRun({ ...req, profile: req.profile }, handlers);
  const cwd = ensureWorkspace(req.agent);
  const child = spawn("claude", buildArgs(req), { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < STDERR_LIMIT) stderr += chunk.toString();
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    for (const event of parseLine(line)) handlers.onEvent(event);
  });
  child.on("error", (err) => handlers.onExit(null, `Não consegui lançar o claude: ${err.message}`));
  child.on("close", (code) => handlers.onExit(code, stderr));
  child.stdin.on("error", () => undefined);
  child.stdin.end(req.text);
  return {
    kill: () => {
      child.kill();
    },
  };
};
