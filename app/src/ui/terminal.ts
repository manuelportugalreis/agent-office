import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { wsUrl } from "../net/endpoint";
import { keyAction, NEWLINE_SEQ, pathText } from "./terminal-keys";

/**
 * O separador «Claude Code» do painel: o Claude Code verdadeiro do agente (o mesmo programa do teu terminal), a correr
 * no servidor, na pasta do agente. Um terminal por agente; trocar de agente troca de terminal, e o do anterior continua
 * a correr no servidor.
 */
export interface AgentTerminal {
  show(agentId: string): void;
  hide(): void;
  restart(): void;
  /** Liga ou desliga o terminal em ecrã inteiro (a cena 3D para de desenhar enquanto está assim). */
  toggleMax(): void;
}

export interface TerminalDeps {
  /** Envia um ficheiro (colado ou arrastado) para a pasta do agente e devolve o caminho completo no PC. */
  readonly upload: (agentId: string, file: File) => Promise<string>;
  /** Mensagem curta para o utilizador (erros de envio, por exemplo). */
  readonly notify: (text: string) => void;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10_000;
export const MAX_CLASS = "term-max";

export function createAgentTerminal(host: HTMLElement, deps: TerminalDeps): AgentTerminal {
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let ws: WebSocket | null = null;
  let agent = "";
  let observer: ResizeObserver | null = null;
  let retryMs = RETRY_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const status = (text: string): void => term?.write(`\r\n\x1b[90m${text}\x1b[0m\r\n`);
  const sendJson = (m: object): void => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const typeText = (text: string): void => sendJson({ t: "in", d: `${PASTE_START}${text}${PASTE_END}` });

  function connect(reconnecting = false): void {
    if (!term || !fit) return;
    fit.fit();
    const url = `${wsUrl()}/pty?agent=${encodeURIComponent(agent)}&cols=${term.cols}&rows=${term.rows}`;
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      if (ws !== socket) return;
      retryMs = RETRY_MIN_MS;
      // O servidor volta a mandar o ecrã todo: limpa-se o que estava para não ficar repetido.
      if (reconnecting) term?.reset();
    };
    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      const m = JSON.parse(String(ev.data)) as { t: string; d?: string; code?: number };
      if (m.t === "out" && m.d) term?.write(m.d);
      else if (m.t === "reset") term?.reset();
      else if (m.t === "exit") status(`O Claude Code terminou (código ${m.code ?? "?"}). Carrega em «Nova sessão» para abrir outro.`);
      else if (m.t === "error") status(m.d ?? "erro");
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      // O servidor reiniciou ou caiu: volta a ligar sozinho (a conversa do agente continua do lado do servidor).
      status(`Ligação ao servidor perdida. A ligar outra vez dentro de ${Math.round(retryMs / 1000)} s…`);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (ws === socket) connect(true);
      }, retryMs);
      retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
    };
  }

  /** Ficheiros colados ou largados no terminal: vão para a pasta do agente e o caminho é escrito na caixa. */
  async function sendFiles(files: File[]): Promise<void> {
    const forAgent = agent;
    const paths: string[] = [];
    for (const file of files) {
      try {
        paths.push(pathText(await deps.upload(forAgent, file)));
      } catch (err) {
        deps.notify(err instanceof Error ? err.message : String(err));
      }
    }
    if (paths.length && agent === forAgent) {
      typeText(`${paths.join(" ")} `);
      term?.focus();
    }
  }

  const filesOf = (data: DataTransfer | null): File[] => (data ? [...data.files] : []);

  function onPaste(e: ClipboardEvent): void {
    const files = filesOf(e.clipboardData);
    if (!files.length) return; // texto: o terminal cola-o normalmente
    e.preventDefault();
    e.stopPropagation();
    void sendFiles(files);
  }
  function onDragOver(e: DragEvent): void {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  }
  function onDrop(e: DragEvent): void {
    const files = filesOf(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    void sendFiles(files);
  }
  host.addEventListener("paste", onPaste, true);
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", onDrop);

  function toggleMax(): void {
    document.body.classList.toggle(MAX_CLASS);
    requestAnimationFrame(() => fit?.fit());
    term?.focus();
  }

  function dispose(): void {
    const old = ws;
    ws = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryMs = RETRY_MIN_MS;
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
      const t = new Terminal({
        cursorBlink: true,
        fontFamily: "Cascadia Mono, Consolas, ui-monospace, monospace",
        fontSize: 13,
        scrollback: 5000,
        theme: { background: "#1e1e1e" },
      });
      term = t;
      fit = new FitAddon();
      t.loadAddon(fit);
      t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, "_blank", "noopener,noreferrer")));
      t.attachCustomKeyEventHandler((e) => {
        const action = keyAction(e, t.hasSelection());
        if (action === "pass") return true;
        if (e.type !== "keydown") return false;
        if (action === "newline") sendJson({ t: "in", d: NEWLINE_SEQ });
        else if (action === "copy") {
          void navigator.clipboard?.writeText(t.getSelection()).catch(() => deps.notify("Não consegui copiar."));
          t.clearSelection();
        } else if (action === "max") toggleMax();
        // "paste": o terminal não envia ^V; o browser cola (evento paste).
        return false;
      });
      t.open(host);
      t.onData((d) => sendJson({ t: "in", d }));
      t.onResize(({ cols, rows }) => sendJson({ t: "resize", cols, rows }));
      observer = new ResizeObserver(() => fit?.fit());
      observer.observe(host);
      connect();
      t.focus();
    },
    hide() {
      document.body.classList.remove(MAX_CLASS);
      dispose();
    },
    restart() {
      sendJson({ t: "restart" });
      term?.focus();
    },
    toggleMax,
  };
}
