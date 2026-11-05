import type { ClientMsg, ServerMsg } from "../../../shared/protocol";
import { wsUrl } from "./endpoint";

export interface Client {
  send(msg: ClientMsg): boolean;
}

const RECONNECT_MS = 2000;

const isServerMsg = (v: unknown): v is ServerMsg =>
  typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

/** Liga ao servidor de agentes e religa-se sozinho se cair. */
export function connect(onMessage: (m: ServerMsg) => void, onConnection: (online: boolean) => void): Client {
  let ws: WebSocket | null = null;

  const open = (): void => {
    const socket = new WebSocket(wsUrl());
    ws = socket;
    socket.onopen = () => onConnection(true);
    socket.onmessage = (e) => {
      try {
        const data: unknown = JSON.parse(String(e.data));
        if (isServerMsg(data)) onMessage(data);
      } catch {
        // mensagem inválida: ignorar
      }
    };
    socket.onclose = () => {
      onConnection(false);
      ws = null;
      setTimeout(open, RECONNECT_MS);
    };
  };
  open();

  return {
    send(msg) {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
  };
}
