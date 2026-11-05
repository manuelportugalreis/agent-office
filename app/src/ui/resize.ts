export const MIN_CHAT_WIDTH = 360;
const MAX_CHAT_WIDTH = 900;
const MAX_VIEWPORT_SHARE = 0.7;
const STORAGE_KEY = "agent-office.chatWidth";

/** Largura do painel do chat: nunca menos de 360 px, nunca mais de 900 px nem de 70% da janela. */
export function clampWidth(px: number, viewport: number): number {
  const max = Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, Math.floor(viewport * MAX_VIEWPORT_SHARE)));
  return Math.round(Math.min(max, Math.max(MIN_CHAT_WIDTH, px)));
}

function loadWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // o armazenamento pode estar bloqueado: a largura só deixa de ser lembrada
  }
}

function saveWidth(px: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(px));
  } catch {
    // ignorado: ver loadWidth
  }
}

/** Permite arrastar a margem do painel para o alargar ou estreitar (só no separador Chat). */
export function installResizer(main: HTMLElement, handle: HTMLElement): void {
  const apply = (px: number): void => {
    main.style.setProperty("--chat-w", `${clampWidth(px, innerWidth)}px`);
  };
  const saved = loadWidth();
  if (saved !== null) apply(saved);

  handle.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    document.body.classList.add("resizing");
    const move = (e: PointerEvent): void => apply(innerWidth - e.clientX);
    const up = (e: PointerEvent): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      saveWidth(clampWidth(innerWidth - e.clientX, innerWidth));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}
