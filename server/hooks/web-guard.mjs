// Hook PreToolUse do Claude Code: vigia WebFetch e WebSearch para dificultar a fuga de dados por URL
// (uma página maliciosa pode tentar convencer o agente a abrir um endereço com dados teus no URL).
// Não elimina o risco: reduz-o. Sai com código 2 (e mensagem em stderr) para bloquear a ferramenta.

const MAX_URL_LENGTH = 400;
const MAX_QUERY_LENGTH = 150;
const MAX_SEARCH_LENGTH = 300;
// Serviços que existem para receber pedidos de outros (usados para roubar dados).
const COLLECTOR_DOMAINS = [
  "webhook.site",
  "requestbin.com",
  "pipedream.net",
  "ngrok.io",
  "ngrok-free.app",
  "ngrok.app",
  "interact.sh",
  "oast.fun",
  "oast.live",
  "oast.me",
  "oast.online",
  "oast.pro",
  "oast.site",
  "burpcollaborator.net",
  "requestcatcher.com",
  "hookbin.com",
  "beeceptor.com",
  "canarytokens.com",
  "trycloudflare.com",
  "pastebin.com",
  "transfer.sh",
];

function block(message) {
  console.error(`Bloqueado: ${message}`);
  process.exit(2);
}

function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    h.endsWith(".home.arpa")
  )
    return true;
  if (!h.includes(".") && !h.includes(":")) return true; // nomes sem ponto (intranet)
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe80)/.test(h) || h.startsWith("::ffff:");
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  // Endereços numéricos disfarçados (decimal, hexadecimal, octal).
  return /^(0x[0-9a-f]+|\d+)$/i.test(h);
}

function checkFetch(raw) {
  if (typeof raw !== "string" || raw.length === 0) return block("URL em falta");
  if (raw.length > MAX_URL_LENGTH) return block("o URL é demasiado longo (dados escondidos no endereço?)");
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return block("URL inválido");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") block("só http e https são permitidos");
  if (url.username || url.password) block("URLs com credenciais não são permitidos");
  const host = url.hostname;
  if (isPrivateHost(host)) block("endereços locais ou privados não são permitidos");
  if (COLLECTOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) block(`o domínio ${host} não é permitido`);
  if (url.search.length > MAX_QUERY_LENGTH) block("a parte de pesquisa do URL é demasiado longa (dados escondidos no endereço?)");
  if (/[A-Za-z0-9+/_-]{60,}={0,2}/.test(url.pathname + url.search)) block("o URL contém uma sequência longa que parece dados codificados");
}

let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return block("entrada do hook inválida");
  }
  const name = String(event.tool_name ?? "");
  const args = event.tool_input ?? {};
  if (name === "WebFetch") checkFetch(args.url);
  else if (name === "WebSearch") {
    if (typeof args.query !== "string" || args.query.length > MAX_SEARCH_LENGTH) block("a pesquisa é demasiado longa");
  } else block(`a ferramenta ${name} não é permitida`);
  process.exit(0);
});
