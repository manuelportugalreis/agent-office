import { placeName, ROOM_PLACES } from "../../../shared/places";
import { byId, toast } from "./dom";

/** O menu "O meu gabinete" (em ⚙ Vista): para onde vai quem mandas ao «meu gabinete». */
export interface OfficePick {
  /** Mostra o gabinete escolhido (o servidor diz qual é ao ligar e quando muda). */
  show(place: string | null): void;
}

export function createOfficePick(nameOf: (id: string) => string, save: (place: string) => boolean): OfficePick {
  const sel = byId<HTMLSelectElement>("officeSel");
  sel.innerHTML =
    `<option value="">O meu gabinete…</option>` +
    ROOM_PLACES.filter((p) => p.id !== "tray")
      .map((p) => `<option value="${p.id}">${p.name.replace(/^(a|o) /, "")}</option>`)
      .join("");
  sel.onchange = () => {
    if (!sel.value) return;
    if (save(sel.value)) toast(`O teu gabinete: ${placeName(sel.value, nameOf)}`);
    else toast("Servidor offline: não consegui guardar o gabinete.");
  };
  return {
    show(place) {
      if (place && ![...sel.options].some((o) => o.value === place)) {
        const opt = document.createElement("option");
        opt.value = place;
        opt.textContent = placeName(place, nameOf);
        sel.append(opt);
      }
      sel.value = place ?? "";
    },
  };
}
