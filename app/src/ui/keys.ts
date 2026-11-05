/** Elemento onde se escreve: os atalhos de teclado não se aplicam enquanto o foco está aí. */
function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return el instanceof HTMLElement && (el.isContentEditable || el.closest('[contenteditable="true"]') !== null);
}

/** Pode uma tecla funcionar como atalho da aplicação? Não com modificadores, já tratada por outro, nem a escrever. */
export function shortcutAllowed(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented && !isEditable(document.activeElement);
}
