import { createRoot } from "react-dom/client";
import ChatPanel, { type ChatActions, type ChatAgent } from "./ChatPanel";
import type { ChatStore } from "./store";

export interface ChatMount {
  /** Mostra a conversa de um agente (ou nada). */
  show(agent: ChatAgent | null): void;
  setOnline(online: boolean): void;
}

/** Monta o chat (React) dentro de um elemento da página (que é vanilla). */
export function mountChat(container: HTMLElement, store: ChatStore, actions: ChatActions): ChatMount {
  const root = createRoot(container);
  let agent: ChatAgent | null = null;
  let online = false;
  const render = (): void => root.render(agent ? <ChatPanel agent={agent} store={store} actions={actions} online={online} /> : null);
  return {
    show(next) {
      agent = next;
      render();
    },
    setOnline(next) {
      online = next;
      render();
    },
  };
}
