import { byId } from "./dom";

export interface PaletteItem {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly emoji: string;
  readonly state: string;
}

const plain = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtra agentes por nome, função ou id (sem distinguir maiúsculas nem acentos). */
export function filterItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const q = plain(query.trim().replace(/^@/, ""));
  if (!q) return [...items];
  return items.filter((i) => plain(`${i.name} ${i.id} ${i.role}`).includes(q));
}

/** Paleta Ctrl+K: escolhe um agente e abre a conversa com ele. */
export function createPalette(getItems: () => readonly PaletteItem[], onPick: (id: string) => void): { open(): void; close(): void } {
  const root = byId("palette");
  const input = byId<HTMLInputElement>("palInput");
  const list = byId("palList");
  let shown: PaletteItem[] = [];
  let active = 0;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", "palList");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Agentes");

  const render = (): void => {
    shown = filterItems(getItems(), input.value);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = "";
    shown.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = i === active ? "on" : "";
      li.id = `palOpt${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === active));
      const emoji = document.createElement("span");
      emoji.textContent = item.emoji;
      const name = document.createElement("b");
      name.textContent = item.name;
      const role = document.createElement("small");
      role.textContent = item.role;
      const state = document.createElement("em");
      state.textContent = item.state;
      li.append(emoji, name, role, state);
      li.onmousedown = (e) => {
        e.preventDefault();
        pick(i);
      };
      list.append(li);
    });
    if (shown.length === 0) list.innerHTML = `<li class="none" role="status">Nenhum agente encontrado.</li>`;
    if (shown.length > 0) input.setAttribute("aria-activedescendant", `palOpt${active}`);
    else input.removeAttribute("aria-activedescendant");
  };

  const close = (): void => {
    root.style.display = "none";
  };
  const open = (): void => {
    root.style.display = "flex";
    input.value = "";
    active = 0;
    render();
    input.focus();
  };
  function pick(i: number): void {
    const item = shown[i];
    if (!item) return;
    close();
    onPick(item.id);
  }

  input.oninput = () => {
    active = 0;
    render();
  };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(shown.length - 1, active + 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, active - 1);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") close();
  };
  root.onmousedown = (e) => {
    if (e.target === root) close();
  };
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (root.style.display === "flex") close();
      else open();
    }
  });
  return { open, close };
}
