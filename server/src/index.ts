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
import { parsePlaceText } from "./intent.ts";
import { createOrderEngine } from "./orders.ts";
import { InstructionsError, readInstructions, saveInstructions, userInstructions } from "./instructions.ts";
import { createNotifications } from "./notifications.ts";
import { createInitiative } from "./initiative.ts";
import { createSceneBridge } from "./scene-bridge.ts";
import { createRateLimiter } from "./ratelimit.ts";
import { openStore } from "./store.ts";
import type { AccessProfile, AgentMode } from "../../shared/protocol.ts";
import { describeProfile, mcpNames, ProfileError, validateProfile } from "./profiles.ts";
import { terminalScript } from "./local-runner.ts";
import { claudeVersion, openTerminal, resumeCommand } from "./terminal.ts";

/** Chega para as instruções de um agente e as regras da equipa (2 × 20 000 caracteres, com acentos). */
const MAX_PAYLOAD_BYTES = 160 * 1024;
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

/** Guarda o que interessa guardar, atualiza as notificações e envia a todas as interfaces ligadas. */
const broadcast = (m: ServerMsg): void => {
  if (m.type === "log") store.addLog(m.agentId, m.text);
  else if (m.type === "reply") store.addChat(m.agentId, false, m.text);
  else if (m.type === "canvas") store.saveCanvas(m.items, m.syncedAt);
  for (const c of clients) send(c, m);
  notifyFrom(m);
};

/** O que precisa de ti vira uma notificação (e fecha-se sozinha quando é resolvido noutro sítio). */
const notifications = createNotifications(store, (m) => {
  for (const c of clients) send(c, m);
});
// Perguntas e pedidos de autorização não sobrevivem a um reinício do servidor.
notifications.resolvePrefix("q-");
notifications.resolvePrefix("perm-");

function notifyFrom(m: ServerMsg): void {
  if (m.type === "permission")
    notifications.open(`perm-${m.request.id}`, m.request.agentId, "permission", `Pede autorização: ${m.request.summary}`, {
      permissionId: m.request.id,
    });
  else if (m.type === "permission-resolved") notifications.resolve(`perm-${m.id}`);
  else if (m.type === "approval") notifications.open(`appr-${m.id}`, m.agentId, "approval", `Para aprovares: ${m.title}`);
  else if (m.type === "approval-resolved") notifications.resolve(`appr-${m.id}`);
  else if (m.type === "order-steps" && m.finished)
    for (const s of m.steps.filter((x) => x.state === "blocked"))
      notifications.open(`order-${m.id}-${s.id}`, m.owner, "blocked", `${s.label}: ${s.detail ?? "bloqueado"}`);
  else if (m.type === "dossier") {
    const d = m.dossier;
    const waiting = d && (d.stage === "review" || d.clarification || d.blocked);
    const key = d ? `dossier-${d.id}-${d.stage}-${d.draftVersion}-${d.clarification ? "q" : ""}${d.blocked ? "b" : ""}` : "";
    for (const n of notifications.list()) if (n.open && n.key.startsWith("dossier-") && n.key !== key) notifications.resolve(n.key);
    if (d && waiting)
      notifications.open(
        key,
        d.holder === "user" ? "ceo" : d.holder,
        "dossier",
        d.blocked
          ? `O dossier «${d.title}» parou: ${d.blocked.reason}`
          : d.clarification
            ? `A Mira precisa de uma resposta tua no dossier «${d.title}»`
            : `O dossier «${d.title}» está à tua espera para rever`,
      );
  }
}

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
  // Vai junto de cada pedido (também nas conversas retomadas, que não releem o prompt de sistema):
  // as tuas instruções para o agente, as regras da equipa e, para as disciplinas, as entregas do Canvas.
  context: (agentId) => {
    const course = findAgent(agentId)?.course;
    return [userInstructions(agentId), course ? canvasContext(store.canvas()?.items, course) : ""].filter(Boolean).join("\n\n");
  },
  onComplete: (agentId, result) => {
    if (result.ok && result.reply && findAgent(agentId)?.needsApproval)
      approvals.request(agentId, "Rascunho pronto para rever", result.reply);
    // "Ideia: …" no fim de uma resposta: vai para as notificações.
    if (result.ok && result.reply) initiative.fromReply(agentId, result.reply);
  },
});
const MY_OFFICE_SETTING = "myOffice";
const scene = createSceneBridge(broadcast, () => clients.size);
const orders = createOrderEngine({
  hub,
  emit: broadcast,
  scene,
  vaultDir: () => config.vaultDir,
  myOffice: () => store.getSetting(MY_OFFICE_SETTING),
  setMyOffice: (place) => setMyOffice(place),
  // Uma pergunta de um agente também aparece nas notificações (e fecha quando respondes no chat).
  onQuestion: (key, owner, text) => notifications.open(key, owner, "question", text),
  onQuestionClosed: (key) => notifications.resolve(key),
});
/** Escolhe o gabinete do utilizador (uma sala ou a secretária de alguém) e avisa todas as interfaces. */
function setMyOffice(place: string): boolean {
  const ref = parsePlaceText(place, REAL_AGENTS, null);
  if (ref?.kind !== "place") return false;
  store.setSetting(MY_OFFICE_SETTING, ref.id);
  broadcast({ type: "office", myOffice: ref.id });
  // Uma ordem à espera de saber o gabinete continua já (escolhido no menu em vez de responder no chat).
  orders.officeChosen(ref.id);
  return true;
}
const orchestrator = createOrchestrator(hub, broadcast, orders, {
  get: () => store.getSetting("lastOrderResults") ?? "",
  set: (text) => store.setSetting("lastOrderResults", text),
});
const canvas = createCanvasSync(hub, broadcast);
const chat = createChatService(hub, store, broadcast, { engine: orders, vaultDir: () => config.vaultDir, profileOf });
/** Ideias da equipa por iniciativa própria (vão para as notificações; avançar põe o Atlas a organizar). */
const initiative = createInitiative({
  hub,
  notifications,
  store,
  log: (agentId, text) => broadcast({ type: "log", agentId, text }),
});
initiative.start(() => clients.size);

/** Avançar com uma ideia: o Atlas planeia e reparte, com o acesso que o Atlas tem (o do perfil dele, se tiver). */
function acceptIdea(id: number): void {
  const n = notifications.dismiss(id);
  if (!n || n.kind !== "idea") return;
  const who = findAgent(n.agentId)?.name ?? n.agentId;
  const order = [
    `Ideia da ${who} que aprovei: ${n.text}`,
    n.data?.why ? `Porquê: ${n.data.why}` : "",
    n.data?.firstStep ? `Primeiro passo sugerido: ${n.data.firstStep}` : "",
    "Põe-na em marcha com a equipa e diz-me o que ficou feito.",
  ]
    .filter(Boolean)
    .join("\n");
  store.addChat("ceo", true, order);
  broadcast({ type: "user-message", agentId: "ceo", text: order, files: [] });
  background(orchestrator.order(order, profileOf("ceo")), "ideia aprovada");
}
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
  const agent = findAgent(agentId);
  if (!profile || !agent) return broadcast({ type: "error", agentId, message: "Este agente não está no modo Claude Code local." });
  if (hub.isRunning(agentId))
    return broadcast({ type: "error", agentId, message: "Espera que o agente termine (ou pára-o) antes de continuar no terminal." });
  const session = hub.localSession(agentId, profile);
  if (!session?.started) return broadcast({ type: "error", agentId, message: "Ainda não há sessão local deste agente para continuar." });
  let script: string;
  try {
    script = terminalScript({ agent, text: "", sessionId: session.id, resume: true, profile });
  } catch (err) {
    log.warn("não consegui preparar o terminal", err);
    return broadcast({ type: "error", agentId, message: "Não consegui preparar o terminal." });
  }
  const command = resumeCommand(script);
  broadcast({ type: "session", agentId, sessionId: session.id, folder: profile.folder, profileId: profile.id, command });
  let opened = false;
  try {
    opened = openTerminal(script, `Agent Office ${agent.name}`);
  } catch (err) {
    log.warn("não consegui abrir o terminal", err);
  }
  broadcast({
    type: "log",
    agentId,
    text: opened
      ? `Abri o terminal com esta sessão e o perfil "${profile.name}" (mesmas pastas, MCP e regras; as perguntas aparecem lá).`
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
  send(ws, { type: "office", myOffice: store.getSetting(MY_OFFICE_SETTING) });
  send(ws, { type: "notifications", items: notifications.list() });
  send(ws, { type: "initiative", settings: initiative.settings() });
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
        // Resposta a uma pergunta do Atlas (que nota, que gabinete): a ordem em curso continua.
        if (orders.answer("ceo", msg.text)) return;
        return background(orchestrator.order(msg.text, profile), "ordem ao CEO");
      }
      case "arrived":
        return scene.arrived(msg.id, msg.ok, msg.reason);
      case "notification-dismiss":
        notifications.dismiss(msg.id);
        return;
      case "idea-decide":
        if (msg.accept) return acceptIdea(msg.id);
        notifications.dismiss(msg.id);
        return;
      case "initiative-set":
        initiative.set({ enabled: msg.enabled, everyMin: msg.everyMin });
        return broadcast({ type: "initiative", settings: initiative.settings() });
      case "initiative-now":
        return background(
          initiative.now().then((ran) => {
            if (!ran) send(ws, { type: "error", message: "A equipa está ocupada: a próxima ideia vem quando houver alguém livre." });
          }),
          "ideia a pedido",
        );
      case "instructions-get": {
        const agent = findAgent(msg.agentId);
        if (!agent) return send(ws, { type: "error", agentId: msg.agentId, message: "Este agente ainda não é real." });
        return send(ws, { type: "instructions", ...readInstructions(agent) });
      }
      case "instructions-save":
        try {
          const saved = saveInstructions(msg.agentId, msg.notes, msg.shared);
          broadcast({ type: "log", agentId: msg.agentId, text: "Instruções atualizadas por ti (valem a partir da próxima tarefa)." });
          return send(ws, { type: "instructions", ...saved, saved: true });
        } catch (err) {
          log.warn("não consegui guardar as instruções", err);
          return send(ws, {
            type: "error",
            agentId: msg.agentId,
            message: err instanceof InstructionsError ? err.message : "Não consegui guardar as instruções.",
          });
        }
      case "set-office": {
        if (!setMyOffice(msg.place)) return send(ws, { type: "error", message: "Esse sítio não existe no escritório." });
        return;
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
