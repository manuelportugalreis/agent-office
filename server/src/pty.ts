import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawn, type IPty } from "@lydell/node-pty";
import xtermHeadless from "@xterm/headless";
import type { WebSocket } from "ws";
import { findAgent, REAL_AGENTS, type RealAgent } from "./agents.ts";
import { config } from "./config.ts";
import { childEnv } from "./local-runner.ts";
import { ensureWorkspace } from "./workspace.ts";

/**
 * O Claude Code verdadeiro de cada agente, dentro da app: um `claude` interativo num terminal (pseudo-terminal), na
 * pasta de trabalho (`workDir`, por omissão a pasta pessoal) e com o papel dele numa linha. É o mesmo programa do teu terminal, com as tuas
 * definições, integrações e permissões (pergunta antes de agir, como sempre). Fica aberto enquanto o servidor corre:
 * fechar o painel não o fecha, e ao voltar vês o que lá estava.
 */

/** O que se guarda do ecrã para mostrar a quem volta a abrir o terminal. */
const SCROLLBACK = 256 * 1024;
const MAX_INPUT = 64 * 1024;

export interface PtySession {
  readonly agent: string;
  readonly proc: IPty;
  buffer: string;
  readonly sockets: Set<WebSocket>;
  exited: boolean;
  /** O Claude Code já mostrou a caixa de escrita (até lá, as ordens ficam à espera). */
  ready: boolean;
  /** Ordens à espera que o Claude Code fique pronto. */
  readonly queue: string[];
  activity: TermActivity;
  /** Última vez que o ecrã mostrou o indicador de trabalho. */
  lastWork: number;
  /** Cópia do ecrã (terminal sem janela): o Claude Code só redesenha o que muda, por isso lê-se o ecrã, não a saída. */
  readonly screen: InstanceType<typeof xtermHeadless.Terminal>;
  /** Última vez que alguém escreveu ou o agente trabalhou (para fechar terminais parados). */
  lastActive: number;
  /** Quando escreveste na caixa sem enviar (0 = nada por enviar): as ordens do Atlas esperam para não se misturarem. */
  draftAt: number;
}

/** Id da conversa do Claude Code de cada agente: ao reabrir um terminal fechado, a conversa continua (--resume). */
export interface ConversationId {
  readonly id: string;
  /** Já houve uma mensagem (só então o Claude Code guardou a conversa e o --resume funciona). */
  started: boolean;
}

/** Um terminal sem ninguém a ver e parado há este tempo fecha (cada um é um processo do Claude Code em memória). */
const IDLE_CLOSE_MS = 30 * 60_000;
/** Uma ordem espera no máximo este tempo por uma frase que estás a escrever no terminal (e que não enviaste). */
const DRAFT_HOLD_MS = 60_000;
/** Tamanho máximo do excerto da resposta no aviso "acabou". */
const ANSWER_MAX = 280;

/**
 * A última resposta no ecrã: o último bloco que começa por "●" (texto do Claude Code), até à linha de estado ("✻ …")
 * ou à caixa de escrita. Sem resposta visível, "".
 */
export function lastAnswer(screenText: string): string {
  const lines = screenText.split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*●/.test(lines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) return "";
  const out: string[] = [];
  for (const line of lines.slice(start)) {
    if (out.length && /^\s*(✻|✶|✳|✢|·|\*|❯|─|╭|╰|⏵)/.test(line)) break;
    out.push(line.replace(/^\s*●\s*/, "").trim());
  }
  const text = out.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return text.length > ANSWER_MAX ? `${text.slice(0, ANSWER_MAX - 1)}…` : text;
}

/** Sinal de que o Claude Code interativo está pronto a receber texto (a seta da caixa de escrita). */
const PROMPT_MARK = "❯";
/** Se a caixa de escrita não aparecer, escreve-se mesmo assim ao fim deste tempo. */
const READY_TIMEOUT_MS = 20_000;
/** O Enter vai à parte: escrito junto com o texto, o Claude Code trata-o como colagem e não envia. */
const SUBMIT_DELAY_MS = 300;
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

/** Onde está o `claude` (o node-pty precisa do caminho do executável). */
function claudePath(): string {
  if (process.platform !== "win32") return "claude";
  try {
    const found = execFileSync("where.exe", ["claude"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).filter(Boolean);
    // claude.exe primeiro; um claude.cmd (npm) corre pelo cmd.
    return found.find((p) => /\.exe$/i.test(p)) ?? found[0] ?? "claude";
  } catch {
    return "claude";
  }
}

/**
 * O papel do agente numa linha. Sem personagem nem regras do escritório: é o Claude Code normal, com as ferramentas, as
 * pastas e as permissões do utilizador; o papel só diz em que se especializa e quem são os colegas.
 */
export function ptyRole(agent: RealAgent, userName: string = config.userName): string {
  const who = userName || "o utilizador";
  return `No Agent Office de ${who} és ${agent.name}: ${agent.blurb}. Trabalhas como o Claude Code normal, com acesso às ferramentas, pastas e integrações de ${who}, e respondes de forma direta, sem personagem.`;
}

/**
 * O modelo do Claude Code de um agente: o de terminalModels na configuração (o do agente, ou "*"), senão o do agente.
 * Sem isto, todos usavam o modelo das tuas definições (ex.: Opus) e a quota do plano ia-se depressa.
 */
export function terminalModel(agent: RealAgent, models: Readonly<Record<string, string>> = config.terminalModels): string {
  return models[agent.id] ?? models["*"] ?? agent.model;
}

/** Argumentos do `claude` interativo de um agente: o modelo, o papel dele e, se houver, o vault do Obsidian. */
export function ptyArgs(agent: RealAgent, vaultDir: string = config.vaultDir, model: string = terminalModel(agent)): string[] {
  return ["--model", model, "--append-system-prompt", ptyRole(agent), ...(vaultDir ? ["--add-dir", vaultDir] : [])];
}

/** Onde abre o Claude Code dos agentes: `workDir` da configuração ou a pasta pessoal; se não existir, a pasta do agente. */
export function ptyCwd(agent: RealAgent, workDir: string = config.workDir): string {
  const dir = workDir || homedir();
  return existsSync(dir) ? dir : ensureWorkspace(agent);
}

/** O que o Claude Code de um agente está a fazer, lido do ecrã dele. */
export type TermActivity = "idle" | "work" | "appr";

/** Sem o indicador de trabalho no ecrã durante este tempo, o agente está parado (evita piscar entre passos). */
const IDLE_AFTER_MS = 1500;
const ACTIVITY_TICK_MS = 1000;

/** Texto do ecrã sem códigos de terminal nem espaços (o Claude Code redesenha com saltos de cursor em vez de espaços). */
const flat = (chunk: string): string =>
  chunk
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-Za-z]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

/**
 * O que o ecrã visível diz: «Do you want to…» é a pergunta de permissão (espera por ti); «esc to interrupt» só está
 * no ecrã enquanto o Claude Code trabalha; sem nenhum dos dois, está parado.
 */
export function screenActivity(screenText: string): TermActivity {
  const s = flat(screenText);
  if (s.includes("doyouwantto")) return "appr";
  if (s.includes("esctointerrupt")) return "work";
  return "idle";
}

/** As linhas visíveis do ecrã. */
function visibleText(screen: PtySession["screen"]): string {
  const b = screen.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < screen.rows; i++) lines.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? "");
  return lines.join("\n");
}

export interface PtyDeps {
  readonly spawnPty?: (file: string, args: string[], cwd: string, cols: number, rows: number) => IPty;
  /** O agente mudou de atividade no terminal (para a cena: a trabalhar, à espera de ti, parado). */
  readonly onActivity?: (agentId: string, activity: TermActivity) => void;
  /** O agente acabou um trabalho no terminal (passou de "a trabalhar" a parado), com o começo da resposta. */
  readonly onDone?: (agentId: string, answer: string) => void;
  readonly now?: () => number;
  readonly newId?: () => string;
  /** Onde se guarda o id da conversa de cada agente (sobrevive a reiniciar o servidor). Sem isto, só em memória. */
  readonly conversations?: ConversationStore;
}

export interface ConversationStore {
  load(agentId: string): ConversationId | undefined;
  save(agentId: string, convo: ConversationId): void;
}

/**
 * O que uma tecla (ou colagem) no terminal faz à caixa de escrita: "send" (Enter envia), "clear" (Ctrl+C limpa),
 * "draft" (texto, colagem ou nova linha: fica uma frase a meio) ou "other" (setas e outras teclas de controlo).
 */
export function inputKind(d: string): "send" | "clear" | "draft" | "other" {
  if (d.includes("\x03")) return "clear";
  // O texto colado (entre os marcadores) pode ter Enters, que não enviam; Esc+Enter é nova linha.
  // eslint-disable-next-line no-control-regex
  const rest = d.replace(/\x1b\[200~[\s\S]*?\x1b\[201~/g, "P").replace(/\x1b\r/g, "N");
  if (rest.includes("\r")) return "send";
  if (rest !== d) return "draft";
  // eslint-disable-next-line no-control-regex
  return !d.startsWith("\x1b") && /[^\x00-\x1f\x7f]/.test(d) ? "draft" : "other";
}

export function createPtyHub(deps: PtyDeps = {}) {
  const sessions = new Map<string, PtySession>();
  let exe: string | null = null;
  const launch =
    deps.spawnPty ??
    ((file: string, args: string[], cwd: string, cols: number, rows: number): IPty => {
      const cmd = /\.cmd$/i.test(file);
      return spawn(cmd ? "cmd.exe" : file, cmd ? ["/c", file, ...args] : args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...childEnv(), TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
      });
    });

  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const memory = new Map<string, ConversationId>();
  const conversations: ConversationStore = deps.conversations ?? {
    load: (id) => memory.get(id),
    save: (id, c) => void memory.set(id, c),
  };
  const drafting = (s: PtySession): boolean => s.draftAt > 0 && now() - s.draftAt < DRAFT_HOLD_MS;
  /** Envia as ordens à espera quando o Claude Code está pronto e não tens uma frase a meio na caixa. */
  function pump(s: PtySession): void {
    if (!s.ready || s.exited || drafting(s)) return;
    s.draftAt = 0;
    for (const text of s.queue.splice(0)) submit(s, text);
  }

  function setActivity(s: PtySession, activity: TermActivity): void {
    if (s.activity === activity) return;
    const was = s.activity;
    s.activity = activity;
    deps.onActivity?.(s.agent, activity);
    if (was === "work" && activity === "idle" && !s.exited) deps.onDone?.(s.agent, lastAnswer(visibleText(s.screen)));
  }

  /** Lê o ecrã de cada terminal, atualiza a personagem e fecha os terminais parados há muito sem ninguém a ver. */
  function poll(): void {
    for (const s of sessions.values()) {
      if (s.exited) continue;
      const seen = screenActivity(visibleText(s.screen));
      if (seen === "work") s.lastWork = s.lastActive = now();
      setActivity(s, seen === "idle" && now() - s.lastWork < IDLE_AFTER_MS ? "work" : seen);
      if (s.queue.length) pump(s);
      if (s.sockets.size === 0 && s.activity === "idle" && !s.queue.length && now() - s.lastActive > IDLE_CLOSE_MS) {
        // A conversa fica guardada pelo Claude Code: ao voltar, abre-se com --resume e continua onde estava.
        sessions.delete(s.agent);
        s.proc.kill();
      }
    }
  }
  const ticker = setInterval(poll, ACTIVITY_TICK_MS);
  ticker.unref?.();

  const send = (ws: WebSocket, m: object): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };

  function start(agent: RealAgent, cols: number, rows: number): PtySession {
    exe ??= claudePath();
    let convo = conversations.load(agent.id);
    if (!convo) {
      convo = { id: newId(), started: false };
      conversations.save(agent.id, convo);
    }
    const session = convo.started ? ["--resume", convo.id] : ["--session-id", convo.id];
    const proc = launch(exe, [...ptyArgs(agent), ...session], ptyCwd(agent), cols, rows);
    const s: PtySession = {
      agent: agent.id,
      proc,
      buffer: "",
      sockets: new Set(),
      exited: false,
      ready: false,
      queue: [],
      activity: "idle",
      lastWork: 0,
      screen: new xtermHeadless.Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 }),
      lastActive: now(),
      draftAt: 0,
    };
    const flush = (): void => {
      if (s.ready) return;
      s.ready = true;
      pump(s);
    };
    const fallback = setTimeout(flush, READY_TIMEOUT_MS);
    fallback.unref?.();
    proc.onData((d) => {
      s.buffer = (s.buffer + d).slice(-SCROLLBACK);
      for (const ws of s.sockets) send(ws, { t: "out", d });
      if (!s.ready && d.includes(PROMPT_MARK)) {
        clearTimeout(fallback);
        flush();
      }
      s.screen.write(d);
    });
    proc.onExit(({ exitCode }) => {
      s.exited = true;
      setActivity(s, "idle");
      s.screen.dispose();
      for (const ws of s.sockets) send(ws, { t: "exit", code: exitCode });
      if (sessions.get(agent.id) === s) sessions.delete(agent.id);
    });
    sessions.set(agent.id, s);
    return s;
  }

  /** Houve escrita: o terminal não está parado, e a conversa já existe no Claude Code (pode retomar-se). */
  function touched(s: PtySession): void {
    s.lastActive = now();
    const convo = conversations.load(s.agent);
    if (convo && !convo.started) conversations.save(s.agent, { id: convo.id, started: true });
  }

  /** O terminal e a cópia do ecrã mudam de tamanho juntos (senão a cópia deixa de corresponder ao que se vê). */
  function resize(s: PtySession, cols: number, rows: number): void {
    s.proc.resize(cols, rows);
    s.screen.resize(cols, rows);
  }

  /**
   * Escreve uma mensagem e carrega em Enter. O texto vai como colagem delimitada (bracketed paste): sem isso, o Claude
   * Code trata um texto longo como colagem em curso e o Enter seguinte vira uma linha nova em vez de enviar.
   */
  function submit(s: PtySession, text: string): void {
    if (s.exited) return;
    touched(s);
    s.proc.write(`${PASTE_START}${text.replace(/\r?\n/g, " ")}${PASTE_END}`);
    const enter = setTimeout(() => {
      if (!s.exited) s.proc.write("\r");
    }, SUBMIT_DELAY_MS);
    enter.unref?.();
  }

  const size = (v: unknown, fallback: number, max: number): number =>
    typeof v === "number" && Number.isInteger(v) && v >= 10 && v <= max ? v : fallback;

  return {
    /** Liga uma janela da interface ao terminal do agente (abre-o se ainda não estiver aberto). */
    attach(ws: WebSocket, agentId: string, cols0: unknown, rows0: unknown): void {
      const agent = findAgent(agentId);
      if (!agent || !REAL_AGENTS.includes(agent)) {
        send(ws, { t: "error", d: "agente desconhecido" });
        return ws.close();
      }
      const cols = size(cols0, 100, 500);
      const rows = size(rows0, 30, 200);
      let s = sessions.get(agent.id);
      try {
        if (!s) s = start(agent, cols, rows);
        else {
          resize(s, cols, rows);
          if (s.buffer) send(ws, { t: "out", d: s.buffer });
        }
      } catch (err) {
        send(ws, { t: "error", d: `não consegui abrir o Claude Code: ${err instanceof Error ? err.message : String(err)}` });
        return ws.close();
      }
      const session = s;
      session.sockets.add(ws);
      ws.on("message", (raw) => {
        if (String(raw).length > MAX_INPUT) return;
        let m: { t?: unknown; d?: unknown; cols?: unknown; rows?: unknown };
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        const live = sessions.get(agent.id);
        if (m.t === "in" && typeof m.d === "string" && live && !live.exited) {
          live.proc.write(m.d);
          // Enter envia a tua frase; Ctrl+C limpa-a. Depois disso, as ordens à espera podem seguir.
          const kind = inputKind(m.d);
          if (kind === "send" || kind === "clear") {
            if (kind === "send") touched(live);
            live.draftAt = 0;
            pump(live);
          } else if (kind === "draft") live.draftAt = now();
        } else if (m.t === "resize" && live && !live.exited) resize(live, size(m.cols, cols, 500), size(m.rows, rows, 200));
        else if (m.t === "restart") {
          // Uma sessão nova do Claude Code para este agente (a anterior fecha; as janelas abertas passam para a nova).
          const old = sessions.get(agent.id);
          const watchers = old ? [...old.sockets] : [ws];
          conversations.save(agent.id, { id: newId(), started: false });
          if (old) {
            sessions.delete(agent.id);
            old.sockets.clear();
            if (!old.exited) old.proc.kill();
          }
          const fresh = start(agent, cols, rows);
          for (const w of watchers) {
            fresh.sockets.add(w);
            send(w, { t: "reset" });
          }
        }
      });
      ws.on("close", () => {
        for (const x of sessions.values()) x.sockets.delete(ws);
      });
    },
    /**
     * Uma ordem para o Claude Code de um agente (abre-o se ainda não estiver aberto). Se ainda está a arrancar, a ordem
     * espera pela caixa de escrita. Devolve false para agentes desconhecidos ou se não for possível abrir o terminal.
     */
    type(agentId: string, text: string): boolean {
      const agent = findAgent(agentId);
      if (!agent || !REAL_AGENTS.includes(agent) || !text.trim() || text.length > MAX_INPUT) return false;
      let s = sessions.get(agent.id);
      try {
        s ??= start(agent, DEFAULT_COLS, DEFAULT_ROWS);
      } catch {
        return false;
      }
      s.queue.push(text);
      pump(s);
      return true;
    },
    /** Agentes com o Claude Code aberto. */
    open: (): string[] => [...sessions.keys()],
    /** Lê já os ecrãs (o servidor fá-lo a cada segundo; os testes chamam-no à mão). */
    poll,
    shutdown(): void {
      clearInterval(ticker);
      for (const s of sessions.values()) if (!s.exited) s.proc.kill();
      sessions.clear();
    },
  };
}

export type PtyHub = ReturnType<typeof createPtyHub>;
