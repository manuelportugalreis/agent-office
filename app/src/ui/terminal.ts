import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { wsUrl } from "../net/endpoint";

/**
 * O separador «Claude Code» do painel: o Claude Code verdadeiro do agente (o mesmo programa do teu terminal), a correr
 * no servidor, na pasta do agente. Um terminal por agente; trocar de agente troca de terminal, e o do anterior continua
 * a correr no servidor.
 */
export interface AgentTerminal {
  show(agentId: string): void;
  hide(): void;
  restart(): void;
}

export function createAgentTerminal(host: HTMLElement): AgentTerminal {
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let ws: WebSocket | null = null;
  let agent = "";
  let observer: ResizeObserver | null = null;

  const status = (text: string): void => term?.write(`\r\n\x1b[90m${text}\x1b[0m\r\n`);
  const sendJson = (m: object): void => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  function connect(): void {
    if (!term || !fit) return;
    fit.fit();
    const url = `${wsUrl()}/pty?agent=${encodeURIComponent(agent)}&cols=${term.cols}&rows=${term.rows}`;
    const socket = new WebSocket(url);
    ws = socket;
    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      const m = JSON.parse(String(ev.data)) as { t: string; d?: string; code?: number };
      if (m.t === "out" && m.d) term?.write(m.d);
      else if (m.t === "reset") term?.reset();
      else if (m.t === "exit") status(`O Claude Code terminou (código ${m.code ?? "?"}). Carrega em «Nova sessão» para abrir outro.`);
      else if (m.t === "error") status(m.d ?? "erro");
    };
    socket.onclose = () => {
      if (ws === socket) status("Ligação ao servidor perdida. Volta a abrir este separador para ligar outra vez.");
    };
  }

  function dispose(): void {
    const old = ws;
    ws = null;
    old?.close();
    observer?.disconnect();
    observer = null;
    term?.dispose();
    term = null;
    fit = null;
    host.innerHTML = "";
  }

  return {
    show(agentId) {
      if (term && agent === agentId) {
        fit?.fit();
        term.focus();
        return;
      }
      dispose();
      agent = agentId;
      term = new Terminal({
        cursorBlink: true,
        fontFamily: "Cascadia Mono, Consolas, ui-monospace, monospace",
        fontSize: 13,
        scrollback: 5000,
        theme: { background: "#1e1e1e" },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      term.onData((d) => sendJson({ t: "in", d }));
      term.onResize(({ cols, rows }) => sendJson({ t: "resize", cols, rows }));
      observer = new ResizeObserver(() => fit?.fit());
      observer.observe(host);
      connect();
      term.focus();
    },
    hide: dispose,
    restart() {
      sendJson({ t: "restart" });
      term?.focus();
    },
  };
}
