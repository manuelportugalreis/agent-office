const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Formatação em linha, aplicada a texto JÁ escapado: links http(s), negrito e código. */
function inline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function formatLine(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return `<b>${inline(escapeHtml(heading[1]))}</b>`;
  const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
  if (bullet) return `• ${inline(escapeHtml(bullet[1]))}`;
  const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
  if (numbered) return `${numbered[1]}. ${inline(escapeHtml(numbered[2]))}`;
  return inline(escapeHtml(line));
}

/** Texto de um agente para o chat: escapa o HTML e aplica só títulos, listas, negrito, código e links http(s). */
export const formatReply = (text: string): string => text.split("\n").map(formatLine).join("<br>");
