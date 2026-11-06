import type { StepState, StepView } from "../../../shared/protocol";

/**
 * Cartões das ordens em curso: cada passo com o estado (feito, à espera de ti, bloqueado) e a evidência ou o motivo.
 * Os passos feitos ficam à vista até fechares o cartão.
 */

export interface OrderView {
  readonly id: number;
  readonly owner: string;
  readonly title: string;
  readonly steps: readonly StepView[];
  readonly finished: boolean;
}

const MARK: Record<StepState, string> = {
  pending: "○",
  running: "◔",
  waiting: "?",
  done: "✓",
  partial: "~",
  blocked: "✗",
  skipped: "–",
};
const STATE_LABEL: Record<StepState, string> = {
  pending: "por começar",
  running: "a decorrer",
  waiting: "à espera da tua resposta",
  done: "feito",
  partial: "feito com ressalvas",
  blocked: "bloqueado",
  skipped: "não começou",
};
const MAX_CARDS = 3;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface OrdersUi {
  update(view: OrderView): void;
}

export function createOrdersUi(root: HTMLElement, nameOf: (id: string) => string, openChat: (owner: string) => void): OrdersUi {
  const orders = new Map<number, OrderView>();

  function render(): void {
    const list = [...orders.values()].slice(-MAX_CARDS);
    root.hidden = list.length === 0;
    root.innerHTML = list
      .map((o) => {
        const steps = o.steps
          .map(
            (s) =>
              `<li class="os-${s.state}"><span class="os-mark" aria-label="${STATE_LABEL[s.state]}" title="${STATE_LABEL[s.state]}">${MARK[s.state]}</span><span><b>${esc(s.label)}</b>${s.detail ? `<small>${esc(s.detail)}</small>` : ""}</span></li>`,
          )
          .join("");
        const blocked = o.steps.some((s) => s.state === "blocked" || s.state === "waiting");
        return `<article class="order-card${o.finished ? " done" : ""}${blocked ? " attn" : ""}" data-id="${o.id}">
          <header><span class="oc-who">${esc(nameOf(o.owner))}</span><span class="oc-title" title="${esc(o.title)}">${esc(o.title)}</span>
          <button type="button" class="oc-chat" data-owner="${esc(o.owner)}" title="Abrir a conversa">Chat</button>
          ${o.finished ? `<button type="button" class="oc-x" data-close="${o.id}" aria-label="Fechar">×</button>` : ""}</header>
          <ol>${steps}</ol></article>`;
      })
      .join("");
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const close = t.closest<HTMLElement>("[data-close]")?.dataset.close;
    if (close) {
      orders.delete(Number(close));
      render();
      return;
    }
    const owner = t.closest<HTMLElement>("[data-owner]")?.dataset.owner;
    if (owner) openChat(owner);
  });

  return {
    update(view) {
      orders.delete(view.id);
      orders.set(view.id, view);
      render();
    },
  };
}
