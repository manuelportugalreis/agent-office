// Hook PreToolUse do Claude Code: deixa um agente usar o Chrome só para LER páginas de domínios permitidos.
// Uso: node chrome-guard.mjs host1 host2 ...          (PreToolUse: bloqueia antes de correr)
//      node chrome-guard.mjs --post host1 host2 ...   (PostToolUse: regista os separadores onde a navegação correu bem)
// Sai com código 2 (e mensagem em stderr) para bloquear a ferramenta antes de ela correr.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALLOWED_TOOLS = new Set([
  "mcp__claude-in-chrome__tabs_context_mcp",
  "mcp__claude-in-chrome__tabs_create_mcp",
  "mcp__claude-in-chrome__navigate",
  "mcp__claude-in-chrome__get_page_text",
]);
const postMode = process.argv[2] === "--post";
const allowedHosts = process.argv.slice(postMode ? 3 : 2);

function block(message) {
  console.error(`Bloqueado: ${message}`);
  process.exit(2);
}

// Estado por sessão do Claude Code: que separadores já foram levados, com sucesso, a um domínio permitido. Ler texto de um
// separador que esta sessão nunca navegou (por exemplo, de outra sessão do Claude) fica bloqueado. Não apanha
// redirecionamentos feitos pela própria página depois de carregada (limite conhecido, ver SECURITY.md).
// Formato: { ok: ["7"], pending: { "7": "<tool_use_id>", "*": "<tool_use_id>" } }. "*" é uma navegação sem tabId.
const STATE_DIR = join(tmpdir(), "agent-office-chrome-guard");
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 5000;
const LOCK_RETRY_MS = 15;

/** Sem identificação da sessão não há isolamento possível: recusa em vez de partilhar um estado comum. */
function sessionKey(sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) block("pedido sem identificação da sessão");
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

const statePath = (key) => join(STATE_DIR, `${key}.json`);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Exclusão mútua entre processos do hook (cada chamada é um processo): leitura, alteração e escrita não se sobrepõem. */
function withLock(key, fn) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const lock = join(STATE_DIR, `${key}.lock`);
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      } catch {
        // Outro processo libertou o bloqueio entretanto.
      }
      if (Date.now() - started > LOCK_WAIT_MS) block("estado do guarda ocupado, tenta outra vez");
      sleep(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true });
    } catch {
      // O bloqueio fica por limpar: expira sozinho (LOCK_STALE_MS).
    }
  }
}

function loadState(key) {
  try {
    const data = JSON.parse(readFileSync(statePath(key), "utf8"));
    const ok = Array.isArray(data.ok) ? data.ok.map(String) : [];
    const pending = data.pending && typeof data.pending === "object" ? data.pending : {};
    return { ok, pending };
  } catch {
    return { ok: [], pending: {} };
  }
}

/** Devolve falso se não conseguiu guardar: quem chama decide (ao revogar, uma falha bloqueia a navegação). */
function saveState(key, state) {
  try {
    writeFileSync(statePath(key), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Ao começar uma navegação os separadores afetados deixam de estar autorizados até ela acabar bem (o hook de pós-execução autoriza). */
function beginNavigation(event) {
  const key = sessionKey(event.session_id);
  const tabId = event.tool_input?.tabId;
  const toolUseId = String(event.tool_use_id ?? "");
  withLock(key, () => {
    const state = loadState(key);
    const noTab = tabId === undefined || tabId === null;
    // Sem tabId o browser escolhe o separador: por segurança, nenhum fica autorizado até saber qual foi.
    const next = noTab
      ? { ok: [], pending: { ...state.pending, "*": toolUseId } }
      : { ok: state.ok.filter((t) => t !== String(tabId)), pending: { ...state.pending, [String(tabId)]: toolUseId } };
    // Se a revogação não ficou gravada, a navegação não pode avançar (a leitura continuaria autorizada com o estado antigo).
    if (!saveState(key, next)) block("não consegui gravar o estado do guarda; navegação recusada");
  });
}

function checkRead(sessionId, tabId) {
  const key = sessionKey(sessionId);
  const allowed = withLock(key, () => {
    const state = loadState(key);
    return state.ok.includes(String(tabId)) && !(String(tabId) in state.pending);
  });
  if (!allowed)
    block("só podes ler separadores onde navegaste com sucesso (usa o tabId no navigate e no get_page_text) para um domínio permitido");
}

/** Caminhos do Canvas com efeitos ao abrir: sair, ferramentas externas (LTI), descargas, OAuth. */
const SIDE_EFFECT_PATH = /(^|\/)(logout|external_tools|download|login\/oauth2|oauth2)(\/|$)/i;

/** Origem de ensaio local (só 127.0.0.1/localhost com porta): a única forma de a lista aceitar http. */
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

/** Um URL está na lista: domínio exato em https, ou a origem exata (esquema, endereço e porta) de um Canvas de ensaio local. */
function matches(url) {
  return allowedHosts.some((entry) =>
    entry.includes("://") ? LOOPBACK_ORIGIN.test(entry) && url.origin === entry : url.protocol === "https:" && url.hostname === entry,
  );
}

/** URL permitido, sem bloquear: usado no pós-execução. */
function isAllowedUrl(raw) {
  try {
    return matches(new URL(String(raw).includes("://") ? String(raw) : `https://${raw}`));
  } catch {
    return false;
  }
}

/** Texto e marca de erro de uma resposta de ferramenta (texto simples, objeto ou lista de blocos de conteúdo). */
function readResponse(response) {
  if (typeof response === "string") return { text: response, isError: false };
  const blocks = Array.isArray(response) ? response : Array.isArray(response?.content) ? response.content : [response];
  const text = blocks.map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "")).join("\n");
  return { text, isError: response?.is_error === true || response?.isError === true };
}

/** Pós-execução de um navigate: só se correu bem e o destino é permitido é que o separador fica autorizado para leitura. */
function afterNavigate(event) {
  const key = sessionKey(event.session_id);
  const { text, isError } = readResponse(event.tool_response);
  const toolUseId = String(event.tool_use_id ?? "");
  const explicit = event.tool_input?.tabId;
  const success = !isError && isAllowedUrl(event.tool_input?.url) && /^\s*Navigated to /i.test(text);
  const fromResponse = /Executed on tabId: (\d+)/.exec(text)?.[1];
  const tabId = explicit ?? fromResponse;
  const slot = explicit === undefined || explicit === null ? "*" : String(explicit);
  withLock(key, () => {
    const state = loadState(key);
    // Só a navegação mais recente deste separador pode autorizá-lo (uma resposta atrasada de uma anterior não conta).
    if (state.pending[slot] !== toolUseId) return;
    const pending = { ...state.pending };
    delete pending[slot];
    const ok = success && tabId !== undefined && tabId !== null ? [...new Set([...state.ok, String(tabId)])] : state.ok;
    saveState(key, { ok, pending });
  });
}

function checkUrl(raw) {
  if (typeof raw !== "string") block("navigate sem URL");
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return block("URL inválido");
  }
  // Utilizador ou palavra-passe no endereço autenticam por HTTP Basic: nunca (nenhum agente autentica).
  if (url.username || url.password) block("endereços com utilizador ou palavra-passe não são permitidos");
  if (!matches(url)) {
    if (url.protocol !== "https:") block("só https é permitido");
    block(`o domínio ${url.hostname} não está na lista permitida`);
  }
  // Mesmo no Canvas, há endereços que fazem coisas ao abrir (sair da sessão, lançar ferramentas externas com a tua
  // identidade, descarregar ficheiros para o disco): ler não precisa deles.
  if (SIDE_EFFECT_PATH.test(url.pathname) || /(^|&)download_frd=1/.test(url.search.slice(1)))
    block(`o caminho ${url.pathname} não é de leitura (sair, ferramentas externas ou descargas)`);
}

let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    handle();
  } catch {
    // Qualquer falha inesperada do guarda bloqueia (no pós-execução só deixa de autorizar a leitura).
    if (postMode) process.exit(0);
    block("erro interno do guarda do Chrome");
  }
});

function handle() {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return block("entrada do hook inválida");
  }
  const name = String(event.tool_name ?? "");
  if (postMode) {
    if (name.endsWith("__navigate")) afterNavigate(event);
    process.exit(0);
  }
  // Ferramentas que não são do Chrome não passam por aqui (o matcher só apanha as do Chrome).
  if (!ALLOWED_TOOLS.has(name)) return block(`a ferramenta ${name} não é permitida`);
  // Abrir um separador com um URL também tem de respeitar a lista (a ferramenta normalmente abre um separador vazio).
  if (name.endsWith("__tabs_create_mcp") && event.tool_input?.url !== undefined) checkUrl(event.tool_input.url);
  if (name.endsWith("__navigate")) {
    checkUrl(event.tool_input?.url);
    beginNavigation(event);
  }
  if (name.endsWith("__get_page_text")) checkRead(event.session_id, event.tool_input?.tabId);
  process.exit(0);
}
