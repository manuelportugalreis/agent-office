import { createHash, randomUUID } from "node:crypto";
import type { AccessProfile, PermissionRequest, ServerMsg, ToolStep } from "../../shared/protocol.ts";
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
  /** Sessões locais: o que o agente fez (ferramentas, ficheiros alterados, falhas). */
  readonly steps?: readonly ToolStep[];
  /** Sessões locais: o id da sessão do Claude Code (para continuar no terminal). */
  readonly sessionId?: string;
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
  /** Perfil do modo "Claude Code local" do agente (null = modo escritório). */
  readonly profileFor?: (agentId: string) => AccessProfile | null;
  /** Quanto tempo uma pergunta de permissão espera por ti antes de ser recusada. */
  readonly permissionTimeoutMs?: number;
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
  run(agentId: string, text: string, opts?: RunOptions): Promise<RunResult>;
  /** Respondes a uma pergunta de permissão de uma sessão local. */
  decidePermission(id: number, allow: boolean): void;
  /** Perguntas por responder (para uma interface que acabou de ligar). */
  pendingPermissions(): PermissionRequest[];
  /** A sessão local de um agente num perfil (para a continuar no terminal). */
  localSession(agentId: string, profile: AccessProfile): { id: string; started: boolean } | undefined;
  isRunning(agentId: string): boolean;
  /** Há vaga para mais uma tarefa (limite global de agentes em simultâneo). */
  hasCapacity(): boolean;
  /** Tarefas em curso (para uma interface que acabou de ligar saber o que está a acontecer). */
  active(): { agentId: string; task: string }[];
  stop(agentId: string): void;
  realAgents(): string[];
  shutdown(): void;
}

export interface RunOptions {
  silent?: boolean;
  fresh?: boolean;
  label?: string;
  isolated?: boolean;
  skipComplete?: boolean;
  /**
   * Perfil desta corrida: um objeto corre em modo local com exatamente esse acesso (uma cópia, que não muda a meio);
   * null obriga ao modo escritório; omitido usa o modo atual do agente.
   */
  profile?: AccessProfile | null;
  /** Sem ferramentas (modo escritório só de texto): o plano e o resumo do CEO. */
  toolless?: boolean;
  /** Modo local só de leitura (revisões independentes): nenhuma escrita, mesmo que o perfil a permita. */
  readOnly?: boolean;
}

/**
 * Sem ferramentas, um modelo às vezes escreve "chamadas a ferramentas" como texto (e até um resultado inventado).
 * Isso não aconteceu e não pode chegar ao utilizador como se tivesse acontecido.
 */
export function stripFakeToolCalls(text: string): string {
  return text
    .replace(/<invoke\b[\s\S]*?<\/invoke>/g, "")
    .replace(/<invoke_result>[\s\S]*?<\/invoke_result>/g, "")
    .replace(/<\/?(function_calls|parameter|antml:[a-z_]+)[^>]*>/g, "")
    .trim();
}

const DEFAULT_LIMITS: HubLimits = { timeoutMs: 600_000, maxConcurrent: 3 };
const PERMISSION_TIMEOUT_MS = 15 * 60_000;
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/**
 * Versão do papel de um agente (o prompt de sistema definido em agents.ts). Uma conversa retomada no Claude Code
 * fica com o papel antigo; quando o papel muda, a chave muda e a conversa seguinte começa uma sessão nova com o novo.
 * (As tuas instruções no CLAUDE.md não precisam disto: são lidas em cada tarefa.)
 */
const roleVersion = (agentId: string): string => {
  const a = findAgent(agentId);
  return a ? createHash("sha256").update(`${a.systemPrompt}\n${a.localPrompt}`).digest("hex").slice(0, 8) : "";
};

/** Chave da sessão: no modo local, uma sessão por agente e por perfil (outro acesso, outra conversa), e por versão do papel. */
export const sessionKey = (agentId: string, profile: AccessProfile | null): string => {
  const base = profile ? `${agentId}@p${profile.id}` : agentId;
  const version = roleVersion(agentId);
  return version ? `${base}#${version}` : base;
};
const ERROR_LIMIT = 200;

interface Running {
  /** Distingue tarefas sucessivas do mesmo agente: eventos de um processo antigo não podem afetar a tarefa nova. */
  readonly runId: number;
  handle: RunHandle;
  timer?: NodeJS.Timeout;
  readonly silent: boolean;
  /** Não chama `onComplete` (quem pediu a tarefa trata do resultado, ex.: o dossier pede a aprovação ele próprio). */
  readonly skipComplete: boolean;
  readonly task: string;
  /** Sessão descartável: não faz parte da conversa do agente (ex.: o pedido de plano ao CEO). */
  readonly isolated: boolean;
  readonly replies: string[];
  readonly resolve: (r: RunResult) => void;
  readonly profile: AccessProfile | null;
  readonly sessionId: string;
  readonly steps: Map<string, ToolStep>;
  readonly toolless: boolean;
  finished: boolean;
}

interface PendingPermission {
  readonly request: PermissionRequest;
  readonly runId: number;
  readonly timer: NodeJS.Timeout;
  readonly respond: (allow: boolean, message?: string) => void;
}

/** Gere as tarefas dos agentes: uma de cada vez por agente, com limite global e tempo máximo. */
export function createHub({
  emit,
  run = claudeRunner,
  limits = DEFAULT_LIMITS,
  onComplete,
  sessions = memorySessions(),
  context,
  profileFor = () => null,
  permissionTimeoutMs = PERMISSION_TIMEOUT_MS,
}: HubOptions): Hub {
  const running = new Map<string, Running>();
  const permissions = new Map<number, PendingPermission>();
  let runCounter = 0;
  let permissionCounter = 0;

  const sessionFor = (key: string): { id: string; started: boolean } => {
    let s = sessions.getSession(key);
    if (!s) {
      s = { id: randomUUID(), started: false };
      sessions.setSession(key, s);
    }
    return s;
  };

  function resolvePermission(id: number, allow: boolean, by: "user" | "timeout" | "stopped"): void {
    const p = permissions.get(id);
    if (!p) return;
    permissions.delete(id);
    clearTimeout(p.timer);
    p.respond(
      allow,
      by === "timeout" ? "Ninguém respondeu a tempo no Agent Office: recusado." : by === "stopped" ? "A tarefa foi parada." : undefined,
    );
    emit({ type: "permission-resolved", id, agentId: p.request.agentId, allowed: allow, by });
    emit({
      type: "log",
      agentId: p.request.agentId,
      text: `${allow ? "Permitido" : "Recusado"}${by === "user" ? " por ti" : by === "timeout" ? " (sem resposta)" : ""}: ${p.request.summary}`,
    });
  }

  function finish(agentId: string, runId: number, ok: boolean, costUsd?: number, error?: string): void {
    const r = running.get(agentId);
    if (!r || r.runId !== runId || r.finished) return;
    r.finished = true;
    clearTimeout(r.timer);
    running.delete(agentId);
    for (const [id, p] of permissions) if (p.runId === runId) resolvePermission(id, false, "stopped");
    if (!r.isolated) {
      const key = sessionKey(agentId, r.profile);
      const current = sessionFor(key);
      // Uma sessão que nunca chegou a ser confirmada pode já existir no Claude Code: recomeçar com um id novo em vez de a reutilizar.
      if (ok) sessions.setSession(key, { id: current.id, started: true });
      else if (!current.started) sessions.setSession(key, { id: randomUUID(), started: false });
    }
    const steps = [...r.steps.values()];
    if (r.profile) {
      emit({ type: "trace", agentId, steps });
      emit({
        type: "session",
        agentId,
        sessionId: r.sessionId,
        folder: r.profile.folder,
        profileId: r.profile.id,
        // O comando exato (com o perfil) é gerado quando pedes para continuar no terminal.
        command: `claude --resume ${r.sessionId}`,
      });
    }
    emit({ type: "done", agentId, ok, costUsd, error, ...(r.silent ? { silent: true } : {}) });
    emit({ type: "status", agentId, status: ok ? "idle" : "err" });
    const result: RunResult = {
      ok,
      reply: r.replies.join("\n\n"),
      costUsd,
      error,
      // O rasto vale também no modo escritório: é a evidência do que o agente fez (não o que ele diz).
      ...(r.profile || steps.length ? { steps } : {}),
      ...(r.profile ? { sessionId: r.sessionId } : {}),
    };
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
      case "text": {
        const text = r.toolless ? stripFakeToolCalls(e.text) : e.text;
        if (!text) return;
        r.replies.push(text);
        if (!r.silent) emit({ type: "reply", agentId, text });
        return emit({ type: "status", agentId, status: "think" });
      }
      case "tool": {
        emit({ type: "status", agentId, status: "work" });
        const file = WRITE_TOOLS.has(e.name) ? (e.input?.file_path ?? e.input?.notebook_path) : undefined;
        r.steps.set(e.id ?? `step-${r.steps.size}`, {
          tool: e.name,
          summary: e.summary,
          ...(typeof file === "string" ? { file } : {}),
          ok: true,
        });
        return emit({ type: "log", agentId, text: `${e.name}: ${e.summary}` });
      }
      case "toolError": {
        const step = r.steps.get(e.id);
        if (step) r.steps.set(e.id, { ...step, ok: false });
        return emit({ type: "log", agentId, text: `Falhou ou foi recusado (${step?.tool ?? "ferramenta"}): ${e.text}` });
      }
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

  function start(agentId: string, text: string, opts: RunOptions = {}): Promise<RunResult> {
    const { silent = false, fresh = false, isolated = false, label, skipComplete = false } = opts;
    const agent = findAgent(agentId);
    if (!agent) return refuse(agentId, "Este agente ainda não é real.");
    if (running.has(agentId)) return refuse(agentId, "O agente ainda está a trabalhar.");
    if (running.size >= limits.maxConcurrent) return refuse(agentId, "Há demasiados agentes a trabalhar ao mesmo tempo.");
    // Cópia congelada: o acesso desta corrida não muda se o perfil for editado (ou apagado) a meio.
    const resolved = opts.profile === undefined ? profileFor(agentId) : opts.profile;
    const profile = resolved ? Object.freeze(structuredClone(resolved)) : null;

    const key = sessionKey(agentId, profile);
    if (fresh && !isolated) sessions.setSession(key, { id: randomUUID(), started: false });
    const session = isolated ? { id: randomUUID(), started: false } : sessionFor(key);
    emit({ type: "status", agentId, status: "think", task: label ?? text });
    const prompt = [context?.(agentId), text].filter(Boolean).join("\n\n");
    const runId = ++runCounter;
    return new Promise<RunResult>((resolve) => {
      // A tarefa fica registada antes de o processo arrancar: um runner pode emitir eventos (ou pedir permissões) logo.
      const entry: Running = {
        runId,
        handle: { kill: () => undefined },
        silent,
        skipComplete,
        task: label ?? text,
        isolated,
        replies: [],
        resolve,
        profile,
        sessionId: session.id,
        steps: new Map(),
        toolless: !!opts.toolless && !profile,
        finished: false,
      };
      running.set(agentId, entry);
      entry.handle = run(
        {
          agent,
          text: prompt,
          sessionId: session.id,
          resume: session.started,
          ...(profile ? { profile } : {}),
          ...(opts.toolless && !profile ? { toolless: true } : {}),
          ...(opts.readOnly ? { readOnly: true } : {}),
        },
        {
          onEvent: (e) => onEvent(agentId, runId, e),
          onExit: (code, stderr) =>
            finish(agentId, runId, false, undefined, (stderr.trim() || `terminou com código ${code}`).slice(0, ERROR_LIMIT)),
          onPermission: (ask, respond) => {
            const current = running.get(agentId);
            if (!current || current.runId !== runId) return respond(false, "A tarefa já terminou.");
            const id = ++permissionCounter;
            const request: PermissionRequest = {
              id,
              agentId,
              tool: ask.tool,
              summary: ask.summary,
              ...(ask.detail ? { detail: ask.detail } : {}),
              ...(ask.reason ? { reason: ask.reason } : {}),
              ts: Date.now(),
            };
            const timer = setTimeout(() => resolvePermission(id, false, "timeout"), permissionTimeoutMs);
            permissions.set(id, { request, runId, timer, respond });
            emit({ type: "permission", request });
            emit({ type: "log", agentId, text: `Pede autorização: ${ask.summary}` });
          },
        },
      );
      if (!entry.finished)
        entry.timer = setTimeout(() => {
          entry.handle.kill();
          finish(agentId, runId, false, undefined, "Tempo máximo excedido.");
        }, limits.timeoutMs);
    });
  }

  return {
    run: (agentId, text, opts) => start(agentId, text, opts),
    decidePermission: (id, allow) => resolvePermission(id, allow, "user"),
    pendingPermissions: () => [...permissions.values()].map((p) => p.request),
    localSession: (agentId, profile) => sessions.getSession(sessionKey(agentId, profile)),
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
      for (const id of [...permissions.keys()]) resolvePermission(id, false, "stopped");
      for (const r of running.values()) {
        clearTimeout(r.timer);
        r.handle.kill();
      }
      running.clear();
    },
  };
}
