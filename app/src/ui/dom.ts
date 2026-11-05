export { escapeHtml, formatReply } from "./format";

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não existe no HTML`);
  return el as T;
}

let toastTimer: number | undefined;
export function toast(text: string): void {
  const el = byId("toast");
  el.textContent = text;
  el.style.opacity = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.style.opacity = "0";
  }, 1800);
}

export const isDark = (): boolean => document.documentElement.dataset.theme === "dark";
