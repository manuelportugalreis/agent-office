import type { ChatActions, ChatAgent } from "./ChatPanel";
import type { ChatMount } from "./mount";
import type { ChatStore } from "./store";

/**
 * O chat (React + assistant-ui) só é descarregado quando é preciso: o arranque da cena 3D fica mais leve. Até o módulo
 * chegar, guarda o agente mostrado e o estado da ligação, e aplica-os quando o chat monta.
 */
export function lazyChat(root: HTMLElement, store: ChatStore, actions: ChatActions): ChatMount {
  let real: ChatMount | null = null;
  let shown: ChatAgent | null = null;
  let isOnline = false;
  void import("./mount").then(({ mountChat }) => {
    real = mountChat(root, store, actions);
    real.setOnline(isOnline);
    real.show(shown);
  });
  return {
    show(agent) {
      shown = agent;
      real?.show(agent);
    },
    setOnline(next) {
      isOnline = next;
      real?.setOnline(next);
    },
  };
}
