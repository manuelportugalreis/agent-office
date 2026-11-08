import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { parseLine } from "./events.ts";
import type { RunHandle, RunHandlers } from "./runner.ts";

/**
 * Processos `claude -p` que ficam vivos entre mensagens (entrada stream-json com o stdin aberto). Lançar o Claude Code
 * custa uns 2 a 4 s por mensagem; com o processo já aberto, a mensagem seguinte da mesma sessão só paga o modelo.
 *
 * Um processo serve uma sessão (a chave inclui o id da sessão e o acesso): nunca mistura conversas nem acessos.
 * Corridas isoladas (oneShot) fecham no fim, como antes. Processos parados fecham sozinhos ao fim de um tempo.
 * Serve o modo escritório e o modo local (este traz perguntas de permissão, que vão a quem pediu a mensagem atual).
 */

export interface WarmPoolOptions {
  readonly spawnClaude?: (args: string[], cwd: string) => ChildProcessWithoutNullStreams;
  /** Tempo parado até fechar o processo. */
  readonly idleMs?: number;
  /** Máximo de processos parados à espera (os mais antigos fecham primeiro). */
  readonly maxIdle?: number;
}

/** Pedido de controlo do Claude Code (ex.: uma pergunta de permissão) e a forma de lhe responder. */
export type ControlHandler = (
  request: Record<string, unknown>,
  handlers: RunHandlers,
  reply: (response: Record<string, unknown>) => void,
) => void;

export interface Launched {
  readonly child: ChildProcessWithoutNullStreams;
  /** Ficheiros temporários do processo (políticas, MCP): apagados quando ele fecha. */
  readonly cleanup?: () => void;
}

export interface WarmRun {
  readonly key: string;
  /** Argumentos do `claude` (com `-p`); o pool junta `--input-format stream-json` se faltar. */
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Lança o processo à medida (modo local: ficheiros da política do perfil). Sem isto, `claude` com `args` em `cwd`. */
  readonly launch?: () => Launched;
  /** Pedidos de controlo (perguntas de permissão do modo local). Sem isto, são recusados. */
  readonly control?: ControlHandler;
  readonly text: string;
  /** Fecha o processo no fim (sessões que nunca se retomam). */
  readonly oneShot: boolean;
}

const IDLE_MS = 10 * 60_000;
const MAX_IDLE = 4;
const STDERR_LIMIT = 2000;

interface Proc {
  readonly key: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly oneShot: boolean;
  readonly control?: ControlHandler;
  handlers: RunHandlers | null;
  stderr: string;
  /** Custo total acumulado pelo processo (o Claude Code soma as mensagens todas da sessão). */
  cost: number;
  timer: ReturnType<typeof setTimeout> | null;
  dead: boolean;
}

/** `-p` primeiro, depois a entrada em stream-json: o processo lê mensagens do stdin até este fechar. */
export function streamingArgs(args: readonly string[]): string[] {
  if (args.includes("--input-format")) return [...args];
  const rest = args[0] === "-p" ? args.slice(1) : [...args];
  return ["-p", "--input-format", "stream-json", ...rest];
}

const defaultSpawn = (args: string[], cwd: string): ChildProcessWithoutNullStreams =>
  spawn("claude", args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

export function createWarmPool(opts: WarmPoolOptions = {}) {
  const launchChild = opts.spawnClaude ?? defaultSpawn;
  const idleMs = opts.idleMs ?? IDLE_MS;
  const maxIdle = opts.maxIdle ?? MAX_IDLE;
  /** Processos parados, por chave (a ordem de inserção dá os mais antigos). */
  const idle = new Map<string, Proc>();
  const all = new Set<Proc>();

  const write = (p: Proc, msg: unknown): void => {
    if (!p.dead && p.child.stdin.writable) p.child.stdin.write(`${JSON.stringify(msg)}\n`);
  };

  function retire(p: Proc): void {
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    if (idle.get(p.key) === p) idle.delete(p.key);
    if (p.dead) return;
    p.child.stdin.end();
    p.child.kill();
  }

  /** Fim de uma mensagem: o processo fica à espera da seguinte, ou fecha. */
  function park(p: Proc, ok: boolean): void {
    if (p.dead) return;
    if (p.oneShot || !ok) {
      p.child.stdin.end();
      return;
    }
    const previous = idle.get(p.key);
    if (previous && previous !== p) retire(previous);
    while (idle.size >= maxIdle) {
      const oldest = idle.values().next().value;
      if (!oldest) break;
      retire(oldest);
    }
    idle.set(p.key, p);
    p.timer = setTimeout(() => retire(p), idleMs);
    p.timer.unref?.();
  }

  /** Um pedido de controlo (pergunta de permissão): vai a quem pediu a mensagem atual. */
  function onControl(p: Proc, data: Record<string, unknown>, request: Record<string, unknown>): void {
    const requestId = typeof data.request_id === "string" ? data.request_id : "";
    const reply = (response: Record<string, unknown>): void =>
      write(p, { type: "control_response", response: { subtype: "success", request_id: requestId, response } });
    if (request.subtype !== "can_use_tool") return reply({});
    const h = p.handlers;
    if (!h || !p.control) return reply({ behavior: "deny", message: "Sem forma de pedir autorização." });
    p.control(request, h, reply);
  }

  function onLine(p: Proc, line: string): void {
    if (line.includes('"control_request"')) {
      try {
        const data = JSON.parse(line) as Record<string, unknown>;
        const request = data.request;
        if (data.type === "control_request" && request && typeof request === "object")
          return onControl(p, data, request as Record<string, unknown>);
      } catch {
        /* não é JSON: segue como evento */
      }
    }
    for (const event of parseLine(line)) {
      const h = p.handlers;
      if (!h) continue;
      if (event.kind !== "done") {
        h.onEvent(event);
        continue;
      }
      // O custo do Claude Code é o total da sessão: a mensagem custou a diferença.
      const total = event.costUsd;
      const delta = total === undefined ? undefined : Math.max(0, total - p.cost);
      if (total !== undefined) p.cost = total;
      p.handlers = null;
      h.onEvent(delta === undefined ? event : { ...event, costUsd: delta });
      park(p, event.ok);
    }
  }

  function launch(run: WarmRun): Proc {
    const launched: Launched = run.launch ? run.launch() : { child: launchChild(streamingArgs(run.args ?? []), run.cwd ?? process.cwd()) };
    const child = launched.child;
    const p: Proc = {
      key: run.key,
      child,
      oneShot: run.oneShot,
      ...(run.control ? { control: run.control } : {}),
      handlers: null,
      stderr: "",
      cost: 0,
      timer: null,
      dead: false,
    };
    all.add(p);
    child.stderr.on("data", (chunk: Buffer) => {
      if (p.stderr.length < STDERR_LIMIT) p.stderr += chunk.toString();
    });
    createInterface({ input: child.stdout }).on("line", (line) => onLine(p, line));
    const gone = (code: number | null, why: string): void => {
      if (p.dead) return;
      p.dead = true;
      all.delete(p);
      launched.cleanup?.();
      if (p.timer) clearTimeout(p.timer);
      if (idle.get(p.key) === p) idle.delete(p.key);
      const h = p.handlers;
      p.handlers = null;
      h?.onExit(code, why);
    };
    child.on("error", (err) => gone(null, `Não consegui lançar o claude: ${err.message}`));
    child.on("close", (code) => gone(code, p.stderr));
    child.stdin.on("error", () => undefined);
    return p;
  }

  return {
    run(run: WarmRun, handlers: RunHandlers): RunHandle {
      let p = run.oneShot ? undefined : idle.get(run.key);
      if (p) {
        idle.delete(run.key);
        if (p.timer) clearTimeout(p.timer);
        p.timer = null;
      } else p = launch(run);
      const proc = p;
      proc.handlers = handlers;
      proc.stderr = "";
      write(proc, { type: "user", message: { role: "user", content: run.text } });
      return {
        kill: () => {
          if (proc.handlers !== handlers) return;
          retire(proc);
        },
      };
    },
    /** Processos parados à espera de uma mensagem. */
    idleCount: (): number => idle.size,
    /** Processos vivos (a trabalhar ou parados). */
    liveCount: (): number => all.size,
    shutdown(): void {
      for (const p of [...all]) retire(p);
      idle.clear();
    },
  };
}

export type WarmPool = ReturnType<typeof createWarmPool>;

/** O pool partilhado do servidor (modo escritório e modo local). */
export const warmPool = createWarmPool();
