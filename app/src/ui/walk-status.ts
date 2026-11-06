/**
 * Modo andar: diz para quem vais e quando chegas (antes não se via se o clique tinha feito alguma coisa).
 */

const ARRIVED_SHOWN_MS = 3500;

export interface WalkStatus {
  /** Vais ter com esta pessoa (null: andas livremente ou paraste). */
  heading(name: string | null): void;
  arrived(name: string): void;
}

export function createWalkStatus(el: HTMLElement): WalkStatus {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = (text: string, arrived: boolean): void => {
    clearTimeout(timer);
    el.textContent = text;
    el.classList.toggle("arrived", arrived);
    el.hidden = false;
  };
  return {
    heading(name) {
      if (name) return show(`🚶 A ir ter com ${name}…`, false);
      clearTimeout(timer);
      el.hidden = true;
    },
    arrived(name) {
      show(`✓ Chegaste: a conversa com ${name} está aberta ao lado`, true);
      timer = setTimeout(() => (el.hidden = true), ARRIVED_SHOWN_MS);
    },
  };
}
