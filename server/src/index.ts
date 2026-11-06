import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { parseClientMsg, type ServerMsg } from "../../shared/protocol.ts";
import { courseFor, findAgent, REAL_AGENTS } from "./agents.ts";
import { createApprovals } from "./approvals.ts";
import { readFileSync } from "node:fs";
import { createDossierService } from "./dossier.ts";
import { COMPANY_DIR } from "./workspace.ts";
import { runGuardSelfTest } from "./selftest.ts";
import { saveApprovedDraft } from "./vaultNotes.ts";
import { canvasContext, createCanvasSync } from "./canvas.ts";
import { createChatService } from "./chat.ts";
import { allowedOrigins, bindHost, config, isAllowedHost } from "./config.ts";
import { createHub } from "./hub.ts";
import { createRequestHandler } from "./http.ts";
import { log } from "./log.ts";
import { createOrchestrator } from "./orchestrator.ts";
import { createRateLimiter } from "./ratelimit.ts";
import { openStore } from "./store.ts";
import type { AccessProfile, AgentMode } from "../../shared/protocol.ts";
import { describeProfile, mcpNames, ProfileError, validateProfile } from "./profiles.ts";
import { claudeVersion, openTerminal, resumeCommand } from "./terminal.ts";

const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Uma ligação não pode mandar mais de 40 mensagens em 10 segundos. */
const RATE_MAX = 40;
const RATE_WINDOW_MS = 10_000;

// Um guard avariado deixaria as ferramentas correr sem vigilância (só o código 2 bloqueia): por isso não se arranca assim.
const selfTest = runGuardSelfTest();
if (!selfTest.ok) {
  log.error("os guards de segurança não passaram o autoteste; o servidor não arranca:");
  for (const f of selfTest.failures) log.error(`  - ${f}`);
  process.exit(1);
}

const root = join(import.meta.dirname, "..", "..");
// AGENT_OFFICE_DB permite correr uma instância isolada (testes ao vivo) sem tocar na tua base de dados.
const store = openStore(process.env.AGENT_OFFICE_DB ?? join(import.meta.dirname, "..", "data", "office.db"));
const origins = allowedOrigins(config);

const clients = new Set<WebSocket>();
const send = (ws: WebSocket, m: ServerMsg): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
};

/** Guarda o que interessa guardar e envia a todas as interfaces ligadas. */
const broadcast = (m: ServerMsg): void => {
  if (m.type === "log") store.addLog(m.agentId, m.text);
  else if (m.type === "reply") store.addChat(m.agentId, false, m.text);
  else if (m.type === "canvas") store.saveCanvas(m.items, m.syncedAt);
  for (const c of clients) send(c, m);
};

const CANVAS_COMMAND = /^sincroniza o canvas\.?$/i;

/** "Sincroniza o Canvas" no chat do Dean: guarda a mensagem, sincroniza pelo caminho real e responde com o resultado. */
async function syncFromChat(text: string): Promise<void> {
  store.addChat("dean", true, text);
  broadcast({ type: "user-message", agentId: "dean", text, files: [] });
  const before = store.canvas()?.syncedAt ?? 0;
  await canvas.sync();
  const after = store.canvas();
  broadcast({
    type: "reply",
    agentId: "dean",
    text:
      after && after.syncedAt > before
        ? `Canvas sincronizado: ${after.items.length} entregas.`
        : "Não consegui sincronizar o Canvas desta vez. Vê o registo do Dean.",
  });
}

/** Corre uma tarefa em segundo plano sem deixar que um erro inesperado deite o servidor abaixo. */
const background = (task: Promise<unknown>, what: string): void => {
  task.catch((err: unknown) => {
    log.error(`erro em ${what}`, err);
    broadcast({ type: "error", message: "Ocorreu um erro interno. Vê o registo do servidor." });
  });
};

const approvals = createApprovals(
  broadcast,
  store,
  (agentId) => hub.isRunning(agentId),
  (agentId, draft) => saveApprovedDraft(config.vaultDir, findAgent(agentId)?.name ?? agentId, draft),
);
/** Perfil do modo local de um agente (null = modo escritório, ou perfil que já não existe). */
const profileOf = (agentId: string): AccessProfile | null => {
  const mode = store.modes()[agentId];
  return mode?.kind === "local" ? (store.profiles().find((p) => p.id === mode.profileId) ?? null) : null;
};

const hub = createHub({
  emit: broadcast,
  sessions: store,
  profileFor: profileOf,
  context: (agentId) => {
    const course = findAgent(agentId)?.course;
    return course ? canvasContext(store.canvas()?.items, course) : "";
  },
  onComplete: (agentId, result) => {
    if (result.ok && result.reply && findAgent(agentId)?.needsApproval)
      approvals.request(agentId, "Rascunho pronto para rever", result.reply);
  },
});
const orchestrator = createOrchestrator(hub, broadcast);
const canvas = createCanvasSync(hub, broadcast);
const chat = createChatService(hub, store, broadcast);
const dossier = createDossierService({
  hub,
  store,
  approvals,
  emit: broadcast,
  // O perfil partilhado: o mesmo texto vai à Lena e à Nina (só leitura; quem o edita és tu).
  readProfile: () => {
    try {
      return readFileSync(join(COMPANY_DIR, "perfil.md"), "utf8");
    } catch {
      return "";
    }
  },
});

let cliVersion = "";
void claudeVersion().then((v) => {
  cliVersion = v;
  if (v) log.info(`Claude Code instalado: ${v}`);
});

const profilesMsg = (): ServerMsg => {
  const profiles = store.profiles();
  return { type: "profiles", profiles, mcpAvailable: mcpNames(profiles.map((p) => p.folder)), vaultDir: config.vaultDir, cliVersion };
};
const modesMsg = (): ServerMsg => ({ type: "modes", modes: store.modes() });

function saveProfile(input: Parameters<typeof validateProfile>[0]): void {
  try {
    const clean = validateProfile(input, { vaultDir: config.vaultDir, mcpNames: mcpNames([input.folder]) });
    const saved = store.saveProfile(clean);
    broadcast(profilesMsg());
    broadcast({ type: "log", agentId: "ceo", text: `Perfil "${saved.name}" guardado: ${describeProfile(saved).join("; ")}` });
  } catch (err) {
    broadcast({ type: "error", message: err instanceof ProfileError ? err.message : "Não consegui guardar o perfil." });
  }
}

function setMode(agentId: string, mode: AgentMode): void {
  if (!findAgent(agentId)) return broadcast({ type: "error", agentId, message: "Este agente ainda não é real." });
  if (hub.isRunning(agentId)) return broadcast({ type: "error", agentId, message: "Espera que o agente termine antes de mudar o modo." });
  if (mode.kind === "local" && !store.profiles().some((p) => p.id === mode.profileId))
    return broadcast({ type: "error", agentId, message: "Esse perfil não existe." });
  if (mode.kind === "local" && agentId === "dean")
    return broadcast({ type: "error", agentId, message: "O Dean só lê o Canvas: fica no modo escritório." });
  store.setMode(agentId, mode);
  broadcast(modesMsg());
}

function continueInTerminal(agentId: string): void {
  const profile = profileOf(agentId);
  if (!profile) return broadcast({ type: "error", agentId, message: "Este agente não está no modo Claude Code local." });
  if (hub.isRunning(agentId))
    return broadcast({ type: "error", agentId, message: "Espera que o agente termine (ou pára-o) antes de continuar no terminal." });
  const session = hub.localSession(agentId, profile);
  if (!session?.started) return broadcast({ type: "error", agentId, message: "Ainda não há sessão local deste agente para continuar." });
  const command = resumeCommand(profile.folder, session.id);
  broadcast({ type: "session", agentId, sessionId: session.id, folder: profile.folder, profileId: profile.id, command });
  let opened = false;
  try {
    opened = openTerminal(profile.folder, session.id, `Agent Office ${findAgent(agentId)?.name ?? agentId}`);
  } catch (err) {
    log.warn("não consegui abrir o terminal", err);
  }
  broadcast({
    type: "log",
    agentId,
    text: opened
      ? `Abri o terminal com esta sessão (${command}). No terminal valem as tuas definições normais do Claude Code, não os limites do perfil.`
      : `Para continuar no terminal: ${command}`,
  });
}

const hello = (): ServerMsg => ({
  type: "hello",
  realAgents: hub.realAgents(),
  fileAgents: REAL_AGENTS.filter((a) => a.files).map((a) => a.id),
  models: Object.fromEntries(REAL_AGENTS.map((a) => [a.id, a.model])),
  user: config.userName,
  roles: Object.fromEntries(config.courses.map((c) => [c.agent, `${courseFor(c.agent).code} · ${courseFor(c.agent).title}`])),
  courses: Object.fromEntries(config.courses.map((c) => [c.agent, courseFor(c.agent).code])),
});

// Servidor HTTP (interface, uploads, /health) e WebSocket partilham a porta. Só aceita pedidos vindos da própria
// interface local (Origin e Host): sem isto, qualquer página aberta no browser podia ligar-se a 127.0.0.1
// e mandar os agentes trabalhar.
const server = createServer(createRequestHandler({ config, distDir: join(root, "app", "dist") }));
const wss = new WebSocketServer({
  server,
  maxPayload: MAX_PAYLOAD_BYTES,
  verifyClient: (info: { origin: string; req: { headers: { host?: string } } }) =>
    origins.includes(info.origin) && isAllowedHost(info.req.headers.host, config),
});

wss.on("connection", (ws) => {
  clients.add(ws);
  log.info(`interface ligada (${clients.size})`);
  const allow = createRateLimiter(RATE_MAX, RATE_WINDOW_MS);
  send(ws, hello());
  send(ws, { type: "dossier", dossier: dossier.current() });
  send(ws, { type: "snapshot", ...store.snapshot() });
  send(ws, profilesMsg());
  send(ws, modesMsg());
  // Perguntas de permissão por responder (a página foi recarregada a meio de uma tarefa local).
  for (const request of hub.pendingPermissions()) send(ws, { type: "permission", request });
  // Quem já está a trabalhar (a página foi recarregada a meio): a interface não pode achar que está livre.
  for (const { agentId, task } of hub.active()) send(ws, { type: "status", agentId, status: "work", task });
  ws.on("message", (raw) => {
    if (!allow()) return send(ws, { type: "error", message: "Demasiadas mensagens seguidas. Espera um pouco." });
    const msg = parseClientMsg(raw.toString());
    if (!msg) return send(ws, { type: "error", message: "Mensagem inválida." });
    switch (msg.type) {
      case "send":
        if (msg.agentId === "dean" && CANVAS_COMMAND.test(msg.text.trim()) && !msg.files?.length)
          return background(syncFromChat(msg.text), "sincronização do Canvas");
        return chat.send(msg.agentId, msg.text, msg.files, msg.from);
      case "redo":
        return chat.redo(msg.agentId, msg.text, msg.files);
      case "newchat":
        return chat.newChat(msg.agentId);
      case "stop":
        return hub.stop(msg.agentId);
      case "order": {
        const profile = msg.profileId === undefined ? null : (store.profiles().find((p) => p.id === msg.profileId) ?? null);
        if (msg.profileId !== undefined && !profile) return send(ws, { type: "error", agentId: "ceo", message: "Esse perfil não existe." });
        store.addChat("ceo", true, msg.text);
        broadcast({ type: "user-message", agentId: "ceo", text: msg.text, files: [] });
        return background(orchestrator.order(msg.text, profile), "ordem ao CEO");
      }
      case "profile-save":
        return saveProfile(msg.profile);
      case "profile-delete":
        if (Object.entries(store.modes()).some(([a, m]) => m.kind === "local" && m.profileId === msg.id && hub.isRunning(a)))
          return send(ws, { type: "error", message: "Há um agente a trabalhar com este perfil." });
        store.deleteProfile(msg.id);
        broadcast(profilesMsg());
        return broadcast(modesMsg());
      case "set-mode":
        return setMode(msg.agentId, msg.mode);
      case "permission-decide":
        return hub.decidePermission(msg.id, msg.allow);
      case "open-terminal":
        return continueInTerminal(msg.agentId);
      case "dossier-start":
        return background(dossier.start(msg.request, msg.materials), "dossier");
      case "dossier-answer":
        return background(dossier.answer(msg.id, msg.answer, msg.companyOnly), "dossier");
      case "dossier-return":
        return background(dossier.returnDraft(msg.id, msg.note), "dossier");
      case "dossier-approve":
        return dossier.approve(msg.id);
      case "dossier-retry":
        return background(dossier.retry(msg.id), "dossier");
      case "decide":
        return approvals.decide(msg.id, msg.approved);
      case "sync":
        return background(canvas.sync(), "sincronização do Canvas");
    }
  });
  ws.on("error", (err) => log.warn("erro numa ligação", err));
  ws.on("close", () => {
    clients.delete(ws);
    log.info(`interface desligada (${clients.size})`);
  });
});

// O WebSocketServer repete os erros do servidor HTTP; sem este ouvinte, um erro de arranque (porta ocupada) seria "inesperado".
wss.on("error", () => undefined);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") log.error(`a porta ${config.port} já está em uso (outro servidor a correr?)`);
  else log.error("erro no servidor", err);
  process.exit(1);
});

server.listen(config.port, bindHost(), () => {
  log.info(`Agent Office a correr em http://127.0.0.1:${config.port}`);
  log.info(`origens aceites: ${origins.join(", ")}`);
});

const stop = (code = 0): void => {
  hub.shutdown();
  wss.close();
  server.close();
  store.close();
  process.exit(code);
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
process.on("unhandledRejection", (err) => log.error("promessa rejeitada sem tratamento", err));
process.on("uncaughtException", (err) => {
  log.error("erro inesperado, a terminar", err);
  stop(1);
});
