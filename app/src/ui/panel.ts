import { STATE_INFO } from "../scene/person";
import { stateOf, type Agent } from "../sim/agent";
import { byId, escapeHtml, isDark } from "./dom";

export type Tab = "sum" | "log" | "chat" | "instr" | "term";
const LOG_LIMIT = 30;

export interface Panel {
  open(a: Agent, tab?: Tab): void;
  /** Fecha o painel: o escritório fica com o espaço todo. */
  close(): void;
  refresh(): void;
  appendLog(a: Agent): void;
  readonly selected: Agent | null;
  /** Separador aberto neste momento. */
  readonly tab: Tab;
}

export interface PanelDeps {
  /** Chamado quando se abre o painel de um agente (o chat mostra a conversa dele). */
  onOpen(a: Agent): void;
  /** O que o agente está a fazer agora (para o cabeçalho). */
  activityOf(a: Agent): string | null;
  /** Códigos das disciplinas configuradas (para o painel do Dean). */
  courses(): readonly string[];
  /** Se o agente está a trabalhar numa tarefa real que se pode parar. */
  canStop(a: Agent): boolean;
  /** Última resposta do agente (para mostrar um excerto no resumo). */
  lastReply(a: Agent): string | undefined;
  stop(a: Agent): void;
  /** Pede ao Dean para sincronizar o Canvas. */
  sync(): void;
  /** Leva o avatar do utilizador até à secretária do agente. */
  goTo(a: Agent): void;
  /** Abriu-se um separador (o das instruções pede-as ao servidor). */
  onTab?(a: Agent, tab: Tab): void;
  /** O painel fechou (ninguém escolhido). */
  onClose?(): void;
  /** Secção extra do resumo (modo de trabalho: escritório ou Claude Code local) e a ligação dos botões dela. */
  extra?(a: Agent): string;
  bindExtra?(a: Agent): void;
}

/** Primeiras linhas de uma resposta, sem marcas de Markdown, para o resumo do painel. */
export function snippet(text: string | undefined, max = 280): string {
  if (!text) return "";
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function summaryHtml(a: Agent, canStop: boolean, courses: readonly string[], lastReply?: string, extra = ""): string {
  const d = a.def;
  const last = snippet(lastReply);
  let h = `<div class="lbl">Task atual</div><div>${escapeHtml(a.task)}</div>${last ? `<div class="lbl">Última resposta</div><div class="last">${escapeHtml(last)}</div>` : ""}
    <div class="lbl">Reporta a</div><div>${escapeHtml(d.boss)}</div>`;
  if (d.hasCourse) {
    const rows = a.deadlines
      .map(
        ([t, due, note]) =>
          `<div class="row"><span>${escapeHtml(t)}<br><small>${escapeHtml(note)}</small></span><small>${escapeHtml(due)}</small></div>`,
      )
      .join("");
    h += `<div class="lbl">Entregas (Canvas)</div>${rows || `<div class="row"><span>Sem entregas.</span></div>`}`;
  }
  if (d.canvas) {
    h += `<div class="lbl">Canvas</div><div class="row"><span>Última sincronização</span><small>${a.syncedAt ?? "nunca"}</small></div>
      <div class="row"><span>Disciplinas</span><small>${escapeHtml(courses.join(" · ") || "—")}</small></div>
      <div style="margin-top:10px"><button id="syncBtn">Sincronizar agora</button></div>`;
  }
  const u = a.usage;
  if (u.done + u.failed > 0) {
    h += `<div class="lbl">Uso nesta sessão</div><div class="row"><span>Tarefas concluídas</span><small>${u.done}${u.failed ? ` · ${u.failed} falhadas` : ""}</small></div>
      <div class="row"><span>Custo equivalente</span><small>$${u.costUsd.toFixed(2)}</small></div>`;
  }
  h += extra;
  h += `<div style="margin-top:12px"><button id="goBtn">🚶 Ir à secretária</button></div>`;
  if (canStop) h += `<div style="margin-top:12px"><button id="stopBtn">Parar tarefa</button></div>`;
  if (a.state === "appr") h += `<div class="lbl">Aprovação pendente</div><div>Tens ações à espera na fila de aprovações.</div>`;
  if (a.state === "err") {
    const reason = a.lastError ?? "A última tarefa falhou.";
    const login = /login|sign.?in|autentic|inici[ao] sess/i.test(reason) ? " Faz login no Chrome e diz-lhe para continuar." : "";
    h += `<div class="lbl">Erro</div><div>${escapeHtml(reason)}${login}</div>`;
  }
  return h;
}

export function createPanel(deps: PanelDeps): Panel {
  let sel: Agent | null = null;
  let current: Tab = "sum";
  const sum = byId("tSum");
  const log = byId("tLog");
  const chatBox = byId("chatbox");
  const instr = byId("tInstr");

  const showTab = (t: Tab): void => {
    current = t;
    document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    sum.style.display = t === "sum" ? "block" : "none";
    log.style.display = t === "log" ? "block" : "none";
    instr.style.display = t === "instr" ? "block" : "none";
    if (sel) deps.onTab?.(sel, t);
    chatBox.style.display = t === "chat" ? "flex" : "none";
    byId("termbox").style.display = t === "term" ? "flex" : "none";
    document.querySelector("main")?.classList.toggle("chat-wide", t === "chat" || t === "term");
  };
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => {
    b.onclick = () => showTab(b.dataset.t as Tab);
  });

  const drawSummary = (): void => {
    if (!sel) return;
    byId("pState").textContent = STATE_INFO[stateOf(sel)].label;
    byId("pAct").textContent = deps.activityOf(sel) ?? "";
    const agent = sel;
    sum.innerHTML = summaryHtml(agent, deps.canStop(agent), deps.courses(), deps.lastReply(agent), deps.extra?.(agent) ?? "");
    deps.bindExtra?.(agent);
    const sync = document.getElementById("syncBtn");
    if (sync) sync.onclick = () => deps.sync();
    const go = document.getElementById("goBtn");
    if (go) go.onclick = () => deps.goTo(agent);
    const stop = document.getElementById("stopBtn");
    if (stop) stop.onclick = () => deps.stop(agent);
  };
  const drawLog = (): void => {
    if (!sel) return;
    log.innerHTML = sel.logs
      .slice(-LOG_LIMIT)
      .map(([t, text]) => `<div class="logl"><small>${t}</small> ${escapeHtml(text)}</div>`)
      .join("");
    log.scrollTop = log.scrollHeight;
  };
  return {
    get selected() {
      return sel;
    },
    get tab() {
      return current;
    },
    open(a, tab = "sum") {
      sel = a;
      document.querySelector("main")?.classList.remove("no-sel");
      byId("panel").style.display = "flex";
      const av = byId("pAv");
      av.textContent = a.def.emoji;
      av.style.background = `hsl(${a.def.hue} 60% ${isDark() ? 30 : 88}%)`;
      byId("pName").textContent = a.def.name;
      byId("pRole").textContent = a.role;
      drawSummary();
      drawLog();
      deps.onOpen(a);
      showTab(tab);
    },
    close() {
      if (!sel) return;
      sel = null;
      byId("panel").style.display = "none";
      const main = document.querySelector("main");
      main?.classList.add("no-sel");
      main?.classList.remove("chat-wide");
      deps.onClose?.();
    },
    refresh: drawSummary,
    appendLog(a) {
      if (sel === a) drawLog();
    },
  };
}
