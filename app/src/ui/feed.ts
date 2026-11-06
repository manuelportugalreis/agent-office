import { byId, escapeHtml } from "./dom";

/** Eventos que interessam num resumo do que se passou (o resto, como "Read: …", é ruído para quem só quer saber o resultado). */
const MEANINGFUL = /^(Concluído|Falhou|Delegou|Rascunho|Ordem recebida|A equipa|Canvas|Aprovado|Rejeitado|Não consegui|Parado)/i;
const MAX_ENTRIES = 60;

export interface FeedEntry {
  readonly time: string;
  readonly who: string;
  readonly text: string;
}

/** Junta um registo à lista se for relevante. Devolve a lista nova (a antiga não muda), com as mais recentes primeiro. */
export function pushFeed(entries: readonly FeedEntry[], entry: FeedEntry): readonly FeedEntry[] {
  if (!MEANINGFUL.test(entry.text)) return entries;
  return [entry, ...entries].slice(0, MAX_ENTRIES);
}

export interface Feed {
  add(who: string, text: string): void;
}

/** Lista "Atividade" no topo: o que cada agente fez, com a hora, sem abrir o painel de cada um. */
export function createFeed(): Feed {
  let entries: readonly FeedEntry[] = [];
  const box = byId("feed");
  const button = byId("feedBtn");

  const render = (): void => {
    box.innerHTML = entries.length
      ? entries
          .map((e) => `<div class="it"><small>${escapeHtml(e.time)}</small> <b>${escapeHtml(e.who)}</b> · ${escapeHtml(e.text)}</div>`)
          .join("")
      : `<div class="it" style="color:var(--muted)">Ainda não aconteceu nada nesta sessão.</div>`;
  };
  render();

  button.onclick = (e) => {
    e.stopPropagation();
    byId("appr").style.display = "none";
    box.style.display = box.style.display === "block" ? "none" : "block";
  };
  document.addEventListener("click", (e) => {
    if (box.style.display === "block" && !e.composedPath().includes(box)) box.style.display = "none";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || box.style.display !== "block" || e.defaultPrevented) return;
    box.style.display = "none";
    e.preventDefault(); // Esc fecha só isto (não também o painel do agente).
  });

  return {
    add(who, text) {
      const next = pushFeed(entries, { time: new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }), who, text });
      if (next === entries) return;
      entries = next;
      render();
    },
  };
}
