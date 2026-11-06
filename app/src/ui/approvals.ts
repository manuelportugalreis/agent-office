import { byId, escapeHtml, toast } from "./dom";

export interface Approval {
  readonly id: number;
  readonly who: string;
  readonly text: string;
  /** O rascunho exato desta aprovação. */
  readonly draft?: string;
}

export interface ApprovalCallbacks {
  /** O utilizador decidiu. `who` é o nome do agente. */
  onDecide(id: number, who: string, approved: boolean, stillPending: boolean): boolean;
  /** O utilizador quer ver o rascunho do agente. */
  onView(who: string): void;
  /** O utilizador quer copiar o rascunho do agente. */
  onCopy(who: string, draft?: string): void;
}

export interface ApprovalQueue {
  add(item: Approval): void;
  /** Tira da fila uma aprovação decidida noutro separador. */
  remove(id: number, quiet?: boolean): void;
  /** Substitui a fila inteira (usado ao carregar o estado guardado no servidor). */
  setAll(items: readonly Approval[]): void;
  render(): void;
}

/** Fila de aprovações de ações sensíveis. Nada é enviado sem passar por aqui. */
export function createApprovals(initial: readonly Approval[], cb: ApprovalCallbacks): ApprovalQueue {
  let items = [...initial];
  const box = byId("appr");

  const resolve = (id: number, approved: boolean): void => {
    const done = items.find((i) => i.id === id);
    if (!done) return;
    const remaining = items.filter((i) => i.id !== id);
    // A aprovação só sai da fila quando o servidor confirma (evento approval-resolved); sem ligação ou se o servidor recusar, continua pendente.
    if (
      !cb.onDecide(
        id,
        done.who,
        approved,
        remaining.some((i) => i.who === done.who),
      )
    ) {
      toast("Sem ligação ao servidor: a decisão não foi enviada.");
      return;
    }
    toast("Decisão enviada, a aguardar confirmação…");
  };

  function render(): void {
    const count = byId("apCount");
    count.textContent = String(items.length);
    count.style.display = items.length > 0 ? "inline-flex" : "none";
    box.innerHTML = items.length
      ? items
          .map(
            (i) => `<div class="it"><b>${escapeHtml(i.who)}</b> · ${escapeHtml(i.text)}
          ${i.draft ? `<details><summary>Ver o texto a aprovar</summary><pre class="draft">${escapeHtml(i.draft)}</pre></details>` : ""}
          <div class="bt"><button class="primary" data-a="${i.id}">Aprovar</button><button data-r="${i.id}">Rejeitar</button><button data-v="${i.id}">Ver rascunho</button><button data-c="${i.id}">Copiar</button></div></div>`,
          )
          .join("")
      : `<div class="it" style="color:var(--muted)">Sem aprovações pendentes.</div>`;
    box.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => {
      b.onclick = () => resolve(Number(b.dataset.a), true);
    });
    box.querySelectorAll<HTMLButtonElement>("[data-r]").forEach((b) => {
      b.onclick = () => resolve(Number(b.dataset.r), false);
    });
    const wire = (attr: "v" | "c", fn: (who: string, draft?: string) => void): void => {
      box.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
        b.onclick = () => {
          const item = items.find((i) => i.id === Number(b.dataset[attr]));
          if (!item) return;
          // Abrir o painel ou copiar fecha a lista (senão ficava por cima do painel do agente).
          box.style.display = "none";
          fn(item.who, item.draft);
        };
      });
    };
    wire("v", cb.onView);
    wire("c", cb.onCopy);
  }

  byId("apBtn").onclick = (e) => {
    e.stopPropagation();
    byId("feed").style.display = "none";
    box.style.display = box.style.display === "block" ? "none" : "block";
  };
  // Fecha a lista ao clicar fora dela ou com Escape (antes ficava por cima do painel do agente).
  document.addEventListener("click", (e) => {
    if (box.style.display === "block" && !e.composedPath().includes(box)) box.style.display = "none";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || box.style.display !== "block" || e.defaultPrevented) return;
    box.style.display = "none";
    e.preventDefault(); // Esc fecha só isto (não também o painel do agente).
  });
  return {
    render,
    setAll(next) {
      items = [...next];
      render();
    },
    remove(id, quiet = false) {
      const gone = items.some((i) => i.id === id);
      items = items.filter((i) => i.id !== id);
      if (gone && !quiet) toast("Decisão registada");
      render();
    },
    add(item) {
      items = [...items, item];
      render();
    },
  };
}
