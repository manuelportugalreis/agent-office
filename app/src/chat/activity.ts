const base = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const host = (url: string): string => {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
};

const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Converte uma linha de log do servidor ("WebSearch: vagas AI") no que o agente está a fazer, em português.
 * Devolve null se a linha não for o uso de uma ferramenta.
 */
export function activityLabel(log: string): string | null {
  const m = /^(WebSearch|WebFetch|Read|Write|Edit|Glob|Grep|mcp__claude-in-chrome__\w+): ?(.*)$/s.exec(log);
  if (!m) return null;
  const [, tool, arg] = m;
  switch (tool) {
    case "WebSearch":
      return `A pesquisar: ${clip(arg)}`;
    case "WebFetch":
      return `A abrir ${host(arg)}`;
    case "Read":
      return `A ler ${clip(base(arg))}`;
    case "Write":
    case "Edit":
      return `A escrever ${clip(base(arg))}`;
    case "Glob":
    case "Grep":
      return "A procurar nos ficheiros";
    default:
      if (tool.endsWith("navigate")) return `A abrir ${host(arg)}`;
      if (tool.endsWith("get_page_text")) return "A ler a página";
      return "A usar o Chrome";
  }
}
