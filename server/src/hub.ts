import { randomUUID } from "node:crypto";
import type { ServerMsg } from "../../shared/protocol.ts";
import { findAgent, REAL_AGENTS } from "./agents.ts";
import type { AgentEvent } from "./events.ts";
import { claudeRunner, type RunHandle, type Runner } from "./runner.ts";

export interface HubLimits {
  readonly timeoutMs: number;
  readonly maxConcurrent: number;
}

export interface RunResult {
  readonly ok: boolean;
  /** Texto final do agente (as respostas juntas). */
  readonly reply: string;
  readonly costUsd?: number;
  readonly error?: string;
}

export interface HubOptions {
  readonly emit: (m: ServerMsg) => void;
  readonly run?: Runner;
  readonly limits?: HubLimits;
  /** Chamado quando uma tarefa termina (com ou sem sucesso). */
  readonly onComplete?: (agentId: string, result: RunResult) => void;
  /** Onde se guardam as sessões (para continuar as conversas depois de um reinício). Por defeito, só em memória. */
  readonly sessions?: SessionStore;
  /** Texto de contexto juntado ao pedido de um agente (ex.: entregas do Canvas). */
  readonly context?: (agentId: string) => string;
}

export interface SessionStore {
  getSession(agentId: string): { id: string; started: boolean } | undefined;
  setSession(agentId: string, session: { id: string; started: boolean }): void;
}

function memorySessions(): SessionStore {
  const map = new Map<string, { id: string; started: boolean }>();
  return { getSession: (id) => map.get(id), setSession: (id, s) => void map.set(id, s) };
}

export interface Hub {
  /** Corre uma tarefa num agente. `silent` não mostra a resposta no chat (útil para respostas internas, como o plano do CEO). `fresh` começa uma sessão nova do Claude Code. `label` é o que se mostra como tarefa (por defeito, o próprio texto). */
  run(
    agentId: string,
    text: string,
    opts?: { silent?: boolean; fresh?: boolean; label?: string; isolated?: boolean; skipComplete?: boolean },
  ): Promise<RunResult>;
  isRunning(agentId: string): boolean;
  /** Há vaga para mais uma tarefa (limite global de agentes em simultâneo). */
  hasCapacity(): boolean;
  /** Tarefas em curso (para uma interface que acabou de ligar saber o que está a acontecer). */
  active(): { agentId: string; task: string }[];
  stop(agentId: string): void;
  realAgents(): string[];
  shutdown(): void;
}

const DEFAULT_LIMITS: HubLimits = { timeoutMs: 600_000, maxConcurrent: 3 };
const ERROR_LIMIT = 200;

interface Running {
  /** Distingue tarefas sucessivas do mesmo agente: eventos de um processo antigo não podem afetar a tarefa nova. */
  readonly runId: number;
  readonly handle: RunHandle;
  readonly timer: NodeJS.Timeout;
  readonly silent: boolean;
  /** Não chama `onComplete` (quem pediu a tarefa trata do resultado, ex.: o dossier pede a aprovação ele próprio). */
  readonly skipComplete: boolean;
  readonly task: string;
  /** Sessão descartável: não faz parte da conversa do agente (ex.: o pedido de plano ao CEO). */
  readonly isolated: boolean;
  readonly replies: string[];
  readonly resolve: (r: RunResult) => void;
  finished: boolean;
}

/** Gere as tarefas dos agentes: uma de cada vez por agente, com limite global e tempo máximo. */
export function createHub({
  emit,
  run = claudeRunner,
  limits = DEFAULT_LIMITS,
  onComplete,
  sessions = memorySessions(),
  context,
}: HubOptions): Hub {
  const running = new Map<string, Running>();
  let runCounter = 0;

  const sessionFor = (agentId: string): { id: string; started: boolean } => {
    let s = sessions.getSession(agentId);
    if (!s) {
      s = { id: randomUUID(), started: false };
      sessions.setSession(agentId, s);
    }
    return s;
  };

  function finish(agentId: string, runId: number, ok: boolean, costUsd?: number, error?: string): void {
    const r = running.get(agentId);
    if (!r || r.runId !== runId || r.finished) return;
    r.finished = true;
    clearTimeout(r.timer);
    running.delete(agentId);
    if (!r.isolated) {
      const current = sessionFor(agentId);
      // Uma sessão que nunca chegou a ser confirmada pode já existir no Claude Code: recomeçar com um id novo em vez de a reutilizar.
      if (ok) sessions.setSession(agentId, { id: current.id, started: true });
      else if (!current.started) sessions.setSession(agentId, { id: randomUUID(), started: false });
    }
    emit({ type: "done", agentId, ok, costUsd, error, ...(r.silent ? { silent: true } : {}) });
    emit({ type: "status", agentId, status: ok ? "idle" : "err" });
    const result: RunResult = { ok, reply: r.replies.join("\n\n"), costUsd, error };
    r.resolve(result);
    if (!r.skipComplete) onComplete?.(agentId, result);
  }

  function onEvent(agentId: string, runId: number, e: AgentEvent): void {
    const r = running.get(agentId);
    if (!r || r.runId !== runId) return;
    switch (e.kind) {
      case "think":
        return emit({ type: "status", agentId, status: "think" });
      case "delta":
        if (!r?.silent) emit({ type: "delta", agentId, text: e.text });
        return;
      case "text":
        r?.replies.push(e.text);
        if (!r?.silent) emit({ type: "reply", agentId, text: e.text });
        return emit({ type: "status", agentId, status: "think" });
      case "tool":
        emit({ type: "status", agentId, status: "work" });
        return emit({ type: "log", agentId, text: `${e.name}: ${e.summary}` });
      case "quota":
        return emit({ type: "quota", fiveHour: e.fiveHour, sevenDay: e.sevenDay });
      case "done":
        return finish(agentId, runId, e.ok, e.costUsd, e.error);
    }
  }

  const refuse = (agentId: string, message: string): Promise<RunResult> => {
    emit({ type: "error", agentId, message });
    return Promise.resolve({ ok: false, reply: "", error: message });
  };

  function start(
    agentId: string,
    text: string,
    silent: boolean,
    fresh: boolean,
    isolated: boolean,
    label?: string,
    skipComplete = false,
  ): Promise<RunResult> {
    const agent = findAgent(agentId);
    if (!agent) return refuse(agentId, "Este agente ainda não é real.");
    if (running.has(agentId)) return refuse(agentId, "O agente ainda está a trabalhar.");
    if (running.size >= limits.maxConcurrent) return refuse(agentId, "Há demasiados agentes a trabalhar ao mesmo tempo.");

    if (fresh && !isolated) sessions.setSession(agentId, { id: randomUUID(), started: false });
    const session = isolated ? { id: randomUUID(), started: false } : sessionFor(agentId);
    emit({ type: "status", agentId, status: "think", task: label ?? text });
    const prompt = [context?.(agentId), text].filter(Boolean).join("\n\n");
    const runId = ++runCounter;
    return new Promise<RunResult>((resolve) => {
      const handle = run(
        { agent, text: prompt, sessionId: session.id, resume: session.started },
        {
          onEvent: (e) => onEvent(agentId, runId, e),
          onExit: (code, stderr) =>
            finish(agentId, runId, false, undefined, (stderr.trim() || `terminou com código ${code}`).slice(0, ERROR_LIMIT)),
        },
      );
      const timer = setTimeout(() => {
        handle.kill();
        finish(agentId, runId, false, undefined, "Tempo máximo excedido.");
      }, limits.timeoutMs);
      running.set(agentId, {
        runId,
        handle,
        timer,
        silent,
        skipComplete,
        task: label ?? text,
        isolated,
        replies: [],
        resolve,
        finished: false,
      });
    });
  }

  return {
    run: (agentId, text, opts) =>
      start(agentId, text, opts?.silent ?? false, opts?.fresh ?? false, opts?.isolated ?? false, opts?.label, opts?.skipComplete ?? false),
    isRunning: (agentId) => running.has(agentId),
    hasCapacity: () => running.size < limits.maxConcurrent,
    active: () => [...running.entries()].map(([agentId, r]) => ({ agentId, task: r.task })),
    realAgents: () => REAL_AGENTS.map((a) => a.id),
    stop(agentId) {
      const r = running.get(agentId);
      if (!r) return;
      r.handle.kill();
      finish(agentId, r.runId, false, undefined, "Parado por ti.");
    },
    shutdown() {
      for (const r of running.values()) {
        clearTimeout(r.timer);
        r.handle.kill();
      }
      running.clear();
    },
  };
}
