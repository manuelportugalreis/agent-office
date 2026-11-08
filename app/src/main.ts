import "./style.css";
import "./shell.css";
import "./chat/chat.css";
import { AGENTS } from "./data/agents";
import type { Light } from "three";
import { buildBuilding, ground as groundMesh } from "./scene/building";
import { buildLisbon, tramPosition, updateLisbon } from "./scene/lisbon";
import { scene } from "./scene/world";
import { createPerson, STATE_INFO, updatePerson, type PersonView } from "./scene/person";
import { buildAmbient } from "./scene/ambient";
import { buildProps } from "./scene/props";
import { buildAnnex, updateServers } from "./scene/annex";
import { editables, loadLayout } from "./scene/editable";
import { createEditor } from "./scene/editor";
import { createScreen, drawScreen, type ScreenHandle } from "./scene/screens";
import { createStage, DEFAULT_ZOOM } from "./scene/stage";
import { chooseFigure, pickRadius } from "./scene/pick";
import type { ChatActions, ChatAgent } from "./chat/ChatPanel";
import { lazyChat } from "./chat/lazy";
import { createChatStore } from "./chat/store";
import { activityLabel } from "./chat/activity";
import { modelLabel, SUGGESTIONS } from "./data/prompts";
import { createPalette } from "./ui/palette";
import { installResizer } from "./ui/resize";
import { uploadFile } from "./net/upload";
import type { CanvasItem, ClientMsg, ServerMsg, Snapshot } from "../../shared/protocol";
import { connect } from "./net/client";
import { createAgent, sendTo, stateOf, stepAgent, teleport, type Agent } from "./sim/agent";
import { createFeed } from "./ui/feed";
import { buildReviewTray, createDossierProp } from "./scene/dossier";
import { createDossierUi } from "./ui/dossier";
import { waitingForUser } from "./ui/dossier-model";
import type { Dossier } from "../../shared/protocol";
import { createGuard, GUARD_DEF } from "./sim/guard";
import { createJanitor, JANITOR_DEF, janitorUpdate, requestCleaning } from "./sim/janitor";
import { shortcutAllowed } from "./ui/keys";
import { cancelAmbient, lifeTick, lifeUpdate, queueVisit } from "./sim/life";
import { createPlayer, PLAYER_DEF } from "./sim/player";
import { createMoveQueue, moveStatus, startMove } from "./sim/orders";
import { createOrdersUi } from "./ui/orders";
import { createTour, IS_DEMO, SETUP_URL } from "./ui/demo";
import { createWalkMode } from "./ui/walk-mode";
import { createOrderBar } from "./ui/order-bar";
import { createOfficePick } from "./ui/office-pick";
import { installViewMenu } from "./ui/view-menu";
import { createInstructionsUi } from "./ui/instructions";
import { createNotificationsUi } from "./ui/notifications";
import { ofPlace, placeName } from "../../shared/places";

interface LogEvent {
  readonly agent: Agent;
  readonly text: string;
}
import { deadlinesFor } from "./sim/canvas";
import { buildLocations } from "./sim/locations";
import { byId, toast } from "./ui/dom";
import { createApprovals } from "./ui/approvals";
import { createPanel, type Tab } from "./ui/panel";
import { createTeamBar, teamMembers } from "./ui/team";
import { createLocalMode, type LocalMode } from "./ui/local-mode";
import { createAgentTerminal, MAX_CLASS as TERM_MAX } from "./ui/terminal";

const SCREEN_REFRESH_S = 0.25;
const TEAM_REFRESH_MS = 1000;
const MAX_LOG = 200;

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
document.documentElement.dataset.theme = darkQuery.matches ? "dark" : "light";

// ---- mundo
buildBuilding();
buildLisbon();
const locs = buildLocations(AGENTS);
const agents: Agent[] = AGENTS.map((d) => createAgent(d, locs[`desk-${d.id}`]));
const screens = new Map<string, ScreenHandle>(agents.map((a) => [a.def.id, createScreen()]));
buildProps(screens);
buildAnnex();
loadLayout();
// Tudo o que existe até aqui é edifício e mobília (estático); as pessoas, o dossier e o resto vêm depois.
const staticRoots = scene.children.filter((c) => !(c as Light).isLight && c !== groundMesh && !c.userData.live);
// A versão cozinhada no Blender é experimental e fica desligada por defeito (abre com ?baked).
if (new URLSearchParams(location.search).has("baked")) void import("./scene/baked").then((m) => m.loadBakedOffice(staticRoots));
if (new URLSearchParams(location.search).has("export")) void import("./dev/export-static").then((m) => m.exportStatic(staticRoots));
const dossierProp = createDossierProp();
const reviewTray = buildReviewTray();
const updateAmbient = buildAmbient();
const views = new Map<string, PersonView>(agents.map((a) => [a.def.id, createPerson(a.def)]));
const byAgentId = new Map<string, Agent>(agents.map((a) => [a.def.id, a]));
const player = createPlayer();
const playerView = createPerson(PLAYER_DEF);
const guard = createGuard();
const guardView = createPerson(GUARD_DEF);
const janitor = createJanitor();
const janitorView = createPerson(JANITOR_DEF);
for (const a of agents) if (a.def.startsResting) teleport(a, locs.rest0, "rest");

// ---- UI
const realAgents = new Set<string>();
const fileAgents = new Set<string>();
const models = new Map<string, string>();
let userName = "";
const chatStore = createChatStore();
let online = false;
const busy = new Set<string>();
/** Modo "Claude Code local" (criado depois da ligação ao servidor; o painel usa-o quando já existe). */
let localMode: LocalMode | null = null;
/** O Claude Code verdadeiro de cada agente (separador «Claude Code» do painel). */
const agentTerminal = createAgentTerminal(byId("termHost"), {
  upload: async (agentId, file) => {
    const saved = await uploadFile(agentId, file);
    if (!saved.path) throw new Error("O servidor não disse onde guardou o ficheiro.");
    return saved.path;
  },
  notify: toast,
});
/** Ao abrir um agente: o Claude Code dele quando o servidor está ligado e ele é real; senão o chat (simulado). */
const agentTab = (a: { def: { id: string } }): Tab => (online && realAgents.has(a.def.id) ? "term" : "chat");
byId("termRestart").onclick = () => agentTerminal.restart();
byId("termMax").onclick = () => agentTerminal.toggleMax();
const panel = createPanel({
  onTab: (a, t) => {
    if (t === "instr") instructionsUi.load(a.def.id, online && realAgents.has(a.def.id));
    if (t === "term") agentTerminal.show(a.def.id);
    else agentTerminal.hide();
  },
  extra: (a) => localMode?.sectionHtml(a.def.id, { real: realAgents.has(a.def.id), busy: busy.has(a.def.id) }) ?? "",
  bindExtra: (a) => localMode?.bind(a.def.id),
  onOpen: (a) => chat.show(chatAgentOf(a)),
  activityOf: (a) => chatStore.get(a.def.id).activity,
  lastReply: (a) => chatStore.lastAssistantText(a.def.id),
  courses: () => agents.flatMap((a) => (a.course ? [a.course] : [])),
  canStop: (a) => busy.has(a.def.id),
  stop: (a) => {
    client.send({ type: "stop", agentId: a.def.id });
  },
  goTo: (a) => {
    walkMode.set(true);
    walkMode.walkTo(a);
  },
  onClose: () => {
    agentTerminal.hide();
    byId("stage").focus({ preventScroll: true });
  },
  sync: () => {
    if (realAgents.has("dean") && client.send({ type: "sync" })) toast("A sincronizar o Canvas (o Dean vai ler o teu Chrome)…");
    else toast("Servidor offline: a sincronização só funciona com o servidor ligado.");
  },
});
const tag = byId("tag");
let hovered: Agent | null = null;

function addLog(e: LogEvent): void {
  const now = new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  e.agent.logs.push([now, e.text]);
  if (e.agent.logs.length > MAX_LOG) e.agent.logs.splice(0, e.agent.logs.length - MAX_LOG);
  panel.appendLog(e.agent);
}
const feed = createFeed();
const note = (agent: Agent, text: string): void => {
  addLog({ agent, text });
  feed.add(agent.def.name, text);
};

const stage = createStage(
  byId("stage"),
  (e) => {
    // Clicar no dossier (a pasta ou o rótulo) abre o cartão com tudo o que interessa.
    if (pickId(e) === DOSSIER_ID) return dossierUi.open();
    if (editor.active()) return;
    const a = pickAt(e);
    if (walkMode.on) return walkMode.click(e, a);
    if (a) panel.open(a, agentTab(a));
  },
  (e) => {
    hovered = pickAt(e);
    stage.dom.style.cursor = hovered || pickId(e) === DOSSIER_ID ? "pointer" : "grab";
  },
);
const editor = createEditor(stage, () => refreshEditBar());
function refreshEditBar(): void {
  const on = editor.active();
  byId("editBar").hidden = !on;
  const btn = byId("editBtn");
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("on", on);
  const name = editor.selected();
  byId("editInfo").textContent = name ? `${name}: arrasta para mudar de sítio` : "Arrasta uma peça para a mudar de sítio.";
}
function setEditMode(on: boolean): void {
  if (on && walkMode.on) walkMode.set(false);
  editor.setActive(on);
  byId("hint").hidden = on;
}
if (new URLSearchParams(location.search).has("debug"))
  Object.assign(window, {
    __office: {
      editor,
      stage,
      editables,
      janitor,
      requestCleaning,
      tramPosition,
      /** Onde está cada pessoa (para testes de ponta a ponta das ordens de movimento). */
      where: (id: string) => {
        const a = byAgentId.get(id);
        return a ? { x: a.x, z: a.z, loc: a.loc.key, kind: a.kind, walking: a.route.length > 0, state: a.state } : null;
      },
    },
  });
byId("editBtn").onclick = () => setEditMode(!editor.active());
byId("editRotate").onclick = () => editor.rotate();
byId("editReset").onclick = () => editor.reset();
byId("editDone").onclick = () => setEditMode(false);

// ---- modo Andar (o teu avatar pelo escritório): ver ui/walk-mode.ts
const walkMode = createWalkMode({
  stage,
  player,
  playerView,
  agents,
  locs,
  findAgent: (id) => byAgentId.get(id),
  defaultZoom: DEFAULT_ZOOM,
  leaveEdit: () => {
    if (editor.active()) setEditMode(false);
  },
  onArrive: (a) => panel.open(a, agentTab(a)),
});

addEventListener("keydown", (e) => {
  if (!shortcutAllowed(e)) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // Os atalhos de ligar/desligar não repetem quando a tecla fica carregada (o autorrepeat do browser).
  if (k === "g" && !e.repeat) return walkMode.set(!walkMode.on);
  if (k === "m" && !e.repeat) return setEditMode(!editor.active());
  if (editor.active()) {
    if (k === "r" && !e.repeat) editor.rotate();
    else if (k === "Escape") setEditMode(false);
    return;
  }
  // Esc fecha primeiro o que está por cima (menu, notificações, atividade, diálogo, dossier); só depois o painel.
  if (k === "Escape") return closeTopmost();
  if (!walkMode.on) return;
  if (k === "f" && !e.repeat) return walkMode.toggleFollow();
  walkMode.keyDown(k, e);
});
addEventListener("keyup", (e) => walkMode.keyUp(e.key.length === 1 ? e.key.toLowerCase() : e.key));
/**
 * Esc: fecha uma coisa de cada vez, a de cima primeiro. As sobreposições com Esc próprio (notificações, atividade,
 * aprovações, dossier) fecham-se sozinhas e marcam o evento, que já não chega aqui.
 */
function closeTopmost(): void {
  const menu = byId<HTMLDetailsElement>("viewMenu");
  if (menu.open) {
    menu.open = false;
    return;
  }
  const covered = document.querySelector("dialog[open]") !== null || byId("main").classList.contains("dossier-open");
  if (!covered && panel.selected) panel.close();
}
byId("walkBtn").onclick = () => walkMode.set(!walkMode.on);

const DOSSIER_ID = "dossier";

/** O que está sob o cursor: o id de um agente ou o do dossier. */
function pickId(e: PointerEvent): string | null {
  return stage.pickAgent(e, [...[...views.values()].map((v) => v.group), dossierProp.group]);
}

/** Altura da cabeça acima dos pés (m), para o segmento de toque de cada pessoa. */
const FIGURE_HEIGHT = 1.6;

function pickAt(e: PointerEvent): Agent | null {
  const id = pickId(e);
  const hit = id && id !== DOSSIER_ID ? id : null;
  // As pessoas são pequenas, mexem-se e tapam-se umas às outras: conta também a posição no ecrã (ver chooseFigure).
  const r = stage.dom.getBoundingClientRect();
  const click = { x: e.clientX - r.left, y: e.clientY - r.top };
  let tallest = 0;
  const figures = [...views].map(([agentId, v]) => {
    const p = v.group.position;
    const foot = stage.project(p.x, p.y, p.z);
    const head = stage.project(p.x, p.y + FIGURE_HEIGHT, p.z);
    tallest = Math.max(tallest, Math.abs(foot.y - head.y));
    return { id: agentId, foot, head };
  });
  const chosen = chooseFigure(hit, click, figures, pickRadius(tallest));
  return chosen ? (byAgentId.get(chosen) ?? null) : null;
}

const agentNamed = (name: string): Agent | undefined => agents.find((a) => a.def.name === name);
const approvals = createApprovals([], {
  onDecide: (id, _who, approved, _stillPending, reason) => {
    const sent = client.send({ type: "decide", id, approved, ...(reason ? { reason } : {}) });
    panel.refresh();
    return sent;
  },
  onView: (who) => {
    const a = agentNamed(who);
    if (a) panel.open(a, "chat");
  },
  onCopy: (who, exact) => {
    const agent = agentNamed(who);
    const draft = exact ?? (agent && chatStore.lastAssistantText(agent.def.id));
    if (!draft) return toast("Ainda não há rascunho para copiar.");
    navigator.clipboard.writeText(draft).then(
      () => toast("Rascunho copiado"),
      () => toast("Não consegui copiar (o browser bloqueou o acesso à área de transferência)."),
    );
  },
});
approvals.render();

// ---- chat (React, com a biblioteca assistant-ui) ligado ao servidor
const chatAgentOf = (a: Agent): ChatAgent => ({
  id: a.def.id,
  name: a.def.name,
  role: a.role,
  emoji: a.def.emoji,
  files: fileAgents.has(a.def.id),
  userName,
  model: modelLabel(models.get(a.def.id)),
  suggestions: SUGGESTIONS[a.def.id] ?? [],
  task: a.task,
});
const sendToServer = (agentId: string, msg: ClientMsg): boolean => realAgents.has(agentId) && client.send(msg);
const chatActions: ChatActions = {
  online: () => online,
  // "Sincroniza o Canvas" no chat do Dean é tratado pelo servidor (guarda a mensagem, sincroniza e responde com o resultado).
  send: (agentId, text, files) => sendToServer(agentId, { type: "send", agentId, text, ...(files.length ? { files } : {}) }),
  redo: (agentId, text, files) => sendToServer(agentId, { type: "redo", agentId, text, ...(files.length ? { files } : {}) }),
  newChat: (agentId) => sendToServer(agentId, { type: "newchat", agentId }),
  stop: (agentId) => void client.send({ type: "stop", agentId }),
  upload: uploadFile,
  notify: toast,
  mentionables: () => agents.filter((a) => realAgents.has(a.def.id)).map((a) => ({ id: a.def.id, name: a.def.name })),
  handoff: (fromId, toId, text, files) => {
    const to = byAgentId.get(toId);
    if (!to || !sendToServer(toId, { type: "send", agentId: toId, text, from: fromId })) return false;
    if (files.length)
      toast("Os anexos ficaram na pasta de quem os recebeu primeiro: anexa-os de novo a " + to.def.name + " se ele precisar.");
    chatStore.addUser(toId, text);
    panel.open(to, "chat");
    return true;
  },
  ...(IS_DEMO ? { demo: { setupUrl: SETUP_URL, tour: () => void runTour() } } : {}),
};
const chat = lazyChat(byId("chatRoot"), chatStore, chatActions);

// ---- servidor de agentes reais
const WORKING = new Set(["think", "work"]);

function setBusy(a: Agent, isBusy: boolean): void {
  if (isBusy) busy.add(a.def.id);
  else busy.delete(a.def.id);
  a.pinned = isBusy;
}

const clock = (ms: number): string => new Date(ms).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

/** Distribui as entregas sincronizadas pelos agentes de cada disciplina. */
function applyCanvas(items: readonly CanvasItem[], syncedAt: number): void {
  for (const a of agents) {
    if (a.course) a.deadlines = deadlinesFor(items, a.course);
  }
  const dean = byAgentId.get("dean");
  if (dean) {
    dean.syncedAt = clock(syncedAt);
    dean.task = `${items.length} entregas sincronizadas do Canvas.`;
  }
  panel.refresh();
}

/** Carrega o estado guardado no servidor: histórico, aprovações pendentes e Canvas. */
function applySnapshot(s: Snapshot): void {
  chatStore.loadAll(s.chat);
  for (const a of agents) {
    const logs = s.logs[a.def.id];
    if (logs?.length) a.logs = logs.map((l) => [clock(l.ts), l.text]);
  }
  approvals.setAll(
    s.approvals.map((p) => ({ id: p.id, who: byAgentId.get(p.agentId)?.def.name ?? p.agentId, text: p.title, draft: p.draft })),
  );
  for (const p of s.approvals) {
    const a = byAgentId.get(p.agentId);
    if (a) a.state = "appr";
  }
  if (s.canvas) applyCanvas(s.canvas.items, s.canvas.syncedAt);
  const open = panel.selected;
  if (open) {
    panel.refresh();
    panel.appendLog(open);
  }
}

function onServerMsg(m: ServerMsg): void {
  if (m.type === "terminal-order") {
    const a = byAgentId.get(m.agentId);
    if (!a) return;
    panel.open(a, "term");
    toast(`Ordem escrita no Claude Code de ${a.def.name}`);
    return;
  }
  if (
    m.type === "profiles" ||
    m.type === "modes" ||
    m.type === "permission" ||
    m.type === "permission-resolved" ||
    m.type === "session" ||
    m.type === "trace"
  ) {
    localMode?.handle(m);
    if (m.type === "permission") {
      const a = byAgentId.get(m.request.agentId);
      if (a) {
        a.state = "appr";
        note(a, `Pede autorização: ${m.request.summary}`);
      }
    }
    return;
  }
  if (m.type === "hello") {
    m.fileAgents.forEach((id) => fileAgents.add(id));
    for (const [id, model] of Object.entries(m.models)) models.set(id, model);
    userName = m.user;
    for (const [id, role] of Object.entries(m.roles)) {
      const a = byAgentId.get(id);
      if (a) a.role = role;
    }
    for (const [id, code] of Object.entries(m.courses)) {
      const a = byAgentId.get(id);
      if (a) a.course = code;
    }
    m.realAgents.forEach((id) => {
      realAgents.add(id);
      const a = byAgentId.get(id);
      if (!a) return;
      a.state = "idle";
      a.task = "Pronto para receber tarefas (fala com ele no chat).";
      note(a, "Ligado ao servidor de agentes");
    });
    panel.refresh();
    // Se o painel já estava aberto (ligação direta), o chat só agora sabe se o agente aceita ficheiros.
    const open = panel.selected;
    if (open) chat.show(chatAgentOf(open));
    return;
  }
  if (m.type === "quota") {
    const q = byId("quota");
    q.style.display = "inline-block";
    q.textContent = `plano: ${Math.round(m.fiveHour * 100)}% (5h) · ${Math.round(m.sevenDay * 100)}% (7d)`;
    return;
  }
  if (m.type === "canvas") return applyCanvas(m.items, m.syncedAt);
  if (m.type === "snapshot") return applySnapshot(m);
  if (m.type === "dossier") return applyDossier(m.dossier);
  if (m.type === "approval-resolved") return approvals.remove(m.id, m.superseded === true);
  if (m.type === "user-message") return chatStore.addUserIfNew(m.agentId, m.text, m.files);
  if (m.type === "delegate") return queueVisit(agents, locs, m.from, m.to, performance.now());
  if (m.type === "move") return moves.begin(m.id, m.agentId, m.place);
  if (m.type === "order-steps") return ordersUi.update(m);
  if (m.type === "office") return officePick.show(m.myOffice);
  if (m.type === "instructions") return instructionsUi.handle(m);
  if (m.type === "notifications") return notificationsUi.set(m.items);
  if (m.type === "initiative") return notificationsUi.setInitiative(m.settings);
  if (m.type === "error" && !m.agentId) return toast(m.message);
  const a = m.agentId ? byAgentId.get(m.agentId) : undefined;
  if (!a) return;
  if (m.type === "error") {
    // Só um envio recusado desfaz a mensagem otimista; erros de editar/regenerar/nova conversa não mexem no histórico.
    if (m.op === "send") chatStore.dropRejectedUser(a.def.id);
    return toast(m.message);
  }
  if (m.type === "approval") {
    approvals.add({ id: m.id, who: a.def.name, text: m.title, draft: m.draft });
    a.state = "appr";
    note(a, "Rascunho à espera da tua aprovação");
    panel.refresh();
  } else if (m.type === "status") {
    a.state = m.status;
    setBusy(a, WORKING.has(m.status));
    chatStore.setRunning(a.def.id, WORKING.has(m.status));
    if (m.task) a.task = m.task;
    if (WORKING.has(m.status)) {
      cancelAmbient(a);
      // Quem foi a um sítio a teu pedido trabalha lá (só volta à secretária quando lhe pedires).
      if (a.kind !== "desk" && a.kind !== "go") sendTo(a, locs[`desk-${a.def.id}`], "desk");
    }
    panel.refresh();
  } else if (m.type === "log") {
    note(a, m.text);
    const doing = activityLabel(m.text);
    if (doing) {
      chatStore.setActivity(a.def.id, doing);
      panel.refresh();
    }
  } else if (m.type === "delta") {
    chatStore.delta(a.def.id, m.text);
  } else if (m.type === "reply") {
    chatStore.reply(a.def.id, m.text);
  } else if (m.type === "conversation") {
    // Só com a confirmação do servidor: um pedido recusado nunca faz o Joaquim sair do sítio.
    if (m.cleared) requestCleaning(janitor, m.agentId);
    chatStore.replace(a.def.id, m.chat);
  } else if (m.type === "done") {
    a.lastError = m.ok ? null : (m.error ?? "erro desconhecido");
    a.usage = {
      done: a.usage.done + (m.ok ? 1 : 0),
      failed: a.usage.failed + (m.ok ? 0 : 1),
      costUsd: a.usage.costUsd + (m.costUsd ?? 0),
    };
    note(a, m.ok ? `Concluído (custo equivalente $${(m.costUsd ?? 0).toFixed(3)})` : `Falhou: ${m.error ?? "erro desconhecido"}`);
    if (!m.ok && !m.silent) {
      chatStore.reply(a.def.id, `Falhou: ${m.error ?? "erro desconhecido"}`);
    }
  }
}

// ---- ordens de movimento: o servidor pede, a cena leva a pessoa até lá e confirma a chegada (sim/orders.ts)
const agentName = (id: string): string => byAgentId.get(id)?.def.name ?? id;
const moves = createMoveQueue({
  find: (id) => byAgentId.get(id),
  locs,
  reply: (r) => void client.send({ type: "arrived", ...r }),
  started: (a, place) => {
    a.task = `A caminho ${ofPlace(placeName(place, agentName))}.`;
    panel.refresh();
  },
  now: () => performance.now(),
});
setInterval(() => moves.check(), 250);

const ordersUi = createOrdersUi(
  byId("orders"),
  (id) => (id === "ceo" ? "Atlas" : agentName(id)),
  (owner) => {
    const a = byAgentId.get(owner);
    if (a) panel.open(a, "chat");
  },
  (text) => {
    if (IS_DEMO) {
      void runTour();
      return true;
    }
    if (busy.has("ceo")) {
      toast("O Atlas ainda está ocupado: repete a ordem quando ele acabar (ou responde-lhe no chat).");
      return false;
    }
    const profile = localMode?.profileOf("ceo");
    if (!realAgents.has("ceo") || !client.send({ type: "order", text, ...(profile ? { profileId: profile.id } : {}) })) {
      toast("Servidor offline: não consegui repetir a ordem.");
      return false;
    }
    chatStore.addUser("ceo", text);
    toast("Ordem repetida");
    return true;
  },
);

// ---- notificações: o que precisa de ti (perguntas, autorizações, aprovações, bloqueios, dossier, ideias)
const notificationsUi = createNotificationsUi({
  send: (m) => client.send(m),
  nameOf: (id) => agentName(id),
  emojiOf: (id) => byAgentId.get(id)?.def.emoji ?? "",
  openChat: (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, "chat");
  },
  openApprovals: () => byId("apBtn").click(),
  openDossier: () => dossierUi.open(),
  openTerminal: (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, "term");
  },
  isViewing: (id) => panel.selected?.def.id === id && panel.tab === "term",
});

// ---- instruções de cada agente (separador do painel)
const instructionsUi = createInstructionsUi((m) => client.send(m), agentName);

// ---- o meu gabinete: para onde vai quem mandas ao «meu gabinete»
const officePick = createOfficePick(agentName, (place) => client.send({ type: "set-office", place }));

/** O dossier mudou (ou foi restaurado ao ligar): atualiza o cartão, o rótulo e a pasta na cena. */
function applyDossier(d: Dossier | null): void {
  dossierUi.update(d);
  dossierProp.set(d);
  reviewTray.setAttention(waitingForUser(d));
}

/** O exemplo da demonstração desiste da deslocação se não chegar neste tempo (não fica preso). */
const TOUR_MOVE_TIMEOUT_MS = 60_000;

/** Leva uma pessoa a um lugar e espera que a cena confirme a chegada (o exemplo da demonstração). */
function moveAndWait(agentId: string, place: string): Promise<boolean> {
  const a = byAgentId.get(agentId);
  if (!a) return Promise.resolve(false);
  const started = startMove(a, place, locs, Date.now(), performance.now());
  if ("error" in started) return Promise.resolve(false);
  a.task = `A caminho ${ofPlace(placeName(place, agentName))}.`;
  const deadline = performance.now() + TOUR_MOVE_TIMEOUT_MS;
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      const status = moveStatus(started);
      if (status === "walking" && performance.now() < deadline) return;
      clearInterval(poll);
      resolve(status === "arrived");
    }, 250);
  });
}

const runTour = createTour({
  move: moveAndWait,
  showOrder: (v) => ordersUi.update(v),
  addUser: (id, text) => chatStore.addUser(id, text),
  reply: (id, text) => chatStore.reply(id, text),
  openChat: (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, "chat");
  },
  notify: toast,
});

/** Na demonstração publicada (GitHub Pages) os agentes não trabalham: diz-se onde se age, com um exemplo e um caminho para instalar. */
if (IS_DEMO) {
  const badge = byId<HTMLAnchorElement>("demoBadge");
  badge.href = SETUP_URL;
  badge.hidden = false;
  byId("conn").hidden = true;
  byId("cmd").classList.add("is-demo");
  byId<HTMLInputElement>("cmdIn").placeholder = "Demonstração: os agentes não respondem aqui. Vê um exemplo de ordem →";
  byId("cmd").querySelector("button")!.textContent = "▶ Ver exemplo";
}

const client = connect(onServerMsg, (isOnline) => {
  online = isOnline;
  chat.setOnline(isOnline);
  byId("conn").textContent = isOnline ? "servidor: online" : "servidor: offline";
  if (isOnline) return;
  realAgents.clear();
  for (const a of agents) if (busy.has(a.def.id)) setBusy(a, false);
});

localMode = createLocalMode({
  send: (msg) => client.send(msg),
  nameOf: (id) => byAgentId.get(id)?.def.name ?? id,
  changed: (agentId) => {
    const open = panel.selected;
    if (open && (!agentId || open.def.id === agentId)) panel.refresh();
    updateOrderHint();
  },
  openAgent: (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, "sum");
  },
});

/** A barra de ordens diz em que perfil a ordem vai correr (o do Atlas, se estiver em modo local). */
function updateOrderHint(): void {
  const profile = localMode?.profileOf("ceo");
  byId<HTMLInputElement>("cmdIn").placeholder = profile
    ? `Ordem ao Atlas (Claude Code local, perfil ${profile.name})…  Com "Mira, …" vai direto para ela`
    : "Mira, lê o meu CV…  (com um nome vai direto; sem nome, o Atlas organiza a equipa)";
}

const sendDossier = (msg: ClientMsg): boolean => {
  const sent = client.send(msg);
  if (!sent) toast("Servidor offline: o dossier só avança com o servidor ligado.");
  return sent;
};
const dossierUi = createDossierUi(
  {
    start: (request, materials) => sendDossier({ type: "dossier-start", request, ...(materials ? { materials } : {}) }),
    answer: (id, answer, companyOnly) => sendDossier({ type: "dossier-answer", id, answer, ...(companyOnly ? { companyOnly } : {}) }),
    returnDraft: (id, note) => sendDossier({ type: "dossier-return", id, note }),
    approve: (id) => sendDossier({ type: "dossier-approve", id }),
    retry: (id) => sendDossier({ type: "dossier-retry", id }),
    archive: (id) => sendDossier({ type: "dossier-archive", id }),
  },
  IS_DEMO ? { setupUrl: SETUP_URL } : undefined,
);

// ---- comportamento
// A vida de ambiente (café, conversas, gestos) só envolve quem está livre; o resto do tempo é tempo real.
setInterval(() => lifeTick(agents, locs, performance.now()), 2000);
setInterval(() => lifeUpdate(agents, locs, performance.now()), 100);

// ---- caixa de ordens ("Mira, …" vai direto; sem nome vai ao Atlas) e menu Vista
createOrderBar({
  agents: agents.map((a) => ({ id: a.def.id, name: a.def.name })),
  submit: (text) => {
    if (IS_DEMO) {
      void runTour();
      return false;
    }
    if (!text || !byAgentId.has("ceo")) return false;
    const orderProfile = localMode?.profileOf("ceo");
    if (realAgents.has("ceo") && client.send({ type: "order", text, ...(orderProfile ? { profileId: orderProfile.id } : {}) })) {
      chatStore.addUser("ceo", text);
      toast("Ordem enviada");
      return true;
    }
    toast("Servidor offline: as ordens só funcionam com o servidor ligado.");
    return false;
  },
});
installViewMenu(stage, () => {
  if (panel.selected) panel.open(panel.selected, panel.tab);
});

// ---- loop
let last = performance.now();
let screenClock = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  screenClock += dt;
  for (const a of agents) {
    stepAgent(a, dt);
    const view = views.get(a.def.id);
    if (view) updatePerson(view, a, dt, t);
  }
  updatePerson(guardView, guard, dt, t);
  stepAgent(janitor.agent, dt);
  janitorUpdate(janitor, locs, now);
  updatePerson(janitorView, janitor.agent, dt, t);
  updateLisbon(dt);
  updateServers(t);
  walkMode.step(dt, t, now);
  if (screenClock > SCREEN_REFRESH_S) {
    screenClock = 0;
    for (const a of agents) {
      const s = screens.get(a.def.id);
      if (s) drawScreen(a, s, t);
    }
  }
  updateAmbient(t);
  dossierProp.update(dt, t);
  reviewTray.update(t);
  stage.update(dt);
  // Terminal em ecrã inteiro: a cena não se vê, não se desenha (poupa o computador).
  if (document.body.classList.contains(TERM_MAX)) {
    requestAnimationFrame(frame);
    return;
  }
  placeTag(walkMode.target ?? panel.selected ?? hovered);
  stage.render();
  requestAnimationFrame(frame);
}

function placeTag(a: Agent | null): void {
  if (!a) {
    tag.style.display = "none";
    return;
  }
  const p = stage.project(a.x, 2.5 - a.sit * 0.45, a.z);
  tag.style.display = "block";
  const selected = a === panel.selected;
  tag.classList.toggle("is-selected", selected);
  tag.textContent = `${a === walkMode.target ? "🚶 " : selected ? "● " : ""}${a.def.name} · ${a.role.split("·")[0].trim()}`;
  tag.style.left = `${p.x}px`;
  tag.style.top = `${p.y - 22}px`;
}

// ---- paleta Ctrl+K e painel redimensionável
const palette = createPalette(
  () => agents.map((a) => ({ id: a.def.id, name: a.def.name, role: a.role, emoji: a.def.emoji, state: STATE_INFO[stateOf(a)].label })),
  (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, agentTab(a));
  },
);
byId("palBtn").onclick = () => palette.open();

// ---- equipa num relance (canto do escritório) e a caixa de ordens que ensina o atalho "Nome, …"
const teamBar = createTeamBar(
  byId("team"),
  () => teamMembers(agents, (id) => online && realAgents.has(id)),
  (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, agentTab(a));
  },
);
teamBar.refresh();
setInterval(() => teamBar.refresh(), TEAM_REFRESH_MS);
byId("pClose").onclick = () => panel.close();
installResizer(byId("main"), byId("resizer"));

// ---- ligação direta: #ada ou #ada/chat abre logo o painel desse agente
function openFromHash(): void {
  const [agentId, tab] = location.hash.slice(1).split("/");
  const agent = byAgentId.get(agentId ?? "");
  if (agent) panel.open(agent, (["sum", "log", "chat", "instr", "term"] as Tab[]).find((t) => t === tab) ?? agentTab(agent));
}
openFromHash();
addEventListener("hashchange", openFromHash);

requestAnimationFrame(frame);
