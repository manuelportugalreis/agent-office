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
import { createStage, DEFAULT_ZOOM, type TimeMode } from "./scene/stage";
import { chooseFigure, pickRadius } from "./scene/pick";
import type { ChatActions, ChatAgent } from "./chat/ChatPanel";
import type { ChatMount } from "./chat/mount";
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
import { arrivedAtDesk, clickCorridor, createPlayer, goToDesk, nearestDesk, freeWalk, PLAYER_DEF } from "./sim/player";
import { moveStatus, startMove, type PendingMove } from "./sim/orders";
import { createOrdersUi } from "./ui/orders";
import { createTour, IS_DEMO, SETUP_URL } from "./ui/demo";
import { createWalkStatus } from "./ui/walk-status";
import { createInstructionsUi } from "./ui/instructions";
import { createNotificationsUi } from "./ui/notifications";
import { ofPlace, placeName, ROOM_PLACES } from "../../shared/places";

interface LogEvent {
  readonly agent: Agent;
  readonly text: string;
}
import { deadlinesFor } from "./sim/canvas";
import { buildLocations } from "./sim/locations";
import { byId, escapeHtml, isDark, toast } from "./ui/dom";
import { createApprovals } from "./ui/approvals";
import { createPanel, type Tab } from "./ui/panel";
import { createTeamBar } from "./ui/team";
import { createLocalMode, type LocalMode } from "./ui/local-mode";
import { createAgentTerminal } from "./ui/terminal";

const SCREEN_REFRESH_S = 0.25;
const TEAM_REFRESH_MS = 1000;
const ARRIVAL_LOOK_MS = 6000;
const WALK_ZOOM = 2;
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
playerView.group.visible = false;
const walk = { on: false, follow: true, keys: new Set<string>(), arrivedFor: null as string | null };
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
const agentTerminal = createAgentTerminal(byId("termHost"));
/** Ao abrir um agente: o Claude Code dele quando o servidor está ligado e ele é real; senão o chat (simulado). */
const agentTab = (a: { def: { id: string } }): Tab => (online && realAgents.has(a.def.id) ? "term" : "chat");
byId("termRestart").onclick = () => agentTerminal.restart();
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
    setWalkMode(true);
    walkTo(a);
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
    if (walk.on) return clickInWalkMode(e, a);
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
  if (on && walk.on) setWalkMode(false);
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

/** Modo andar: clicar numa pessoa leva-te à secretária dela; no corredor, ao sítio clicado; numa sala, à secretária mais próxima. */
function clickInWalkMode(e: PointerEvent, clicked: Agent | null): void {
  if (clicked) return walkTo(clicked);
  const ground = stage.pickGround(e);
  if (!ground) return;
  if (clickCorridor(player, ground)) {
    walkTarget = null;
    return walkStatus.heading(null);
  }
  const desk = nearestDesk(agents, ground);
  if (desk) walkTo(desk);
}

const walkStatus = createWalkStatus(byId("walkStatus"));
let walkTarget: Agent | null = null;
/** Vai à secretária de alguém, a dizer para quem vais. */
function walkTo(a: Agent): void {
  if (!goToDesk(player, locs, a.def.id)) return toast(`Não encontro caminho até ${a.def.name}.`);
  walk.arrivedFor = null;
  walkTarget = a;
  walkStatus.heading(a.def.name);
}

function setWalkMode(on: boolean): void {
  if (on && editor.active()) setEditMode(false);
  walk.on = on;
  playerView.group.visible = on;
  const btn = byId("walkBtn");
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("on", on);
  byId("hint").textContent = on
    ? "Andar: WASD ou setas · Q/E rodam a câmara · clica numa pessoa para ir lá · F segue-te · G para sair"
    : "Arrastar: mover · Roda: zoom · Botão direito ou Q/E: rodar · Clica numa pessoa";
  stage.setZoom(on ? WALK_ZOOM : DEFAULT_ZOOM);
  if (on) {
    setFollow(true);
  } else {
    stage.setFollow(null);
    walk.keys.clear();
    walkTarget = null;
    walkStatus.heading(null);
  }
}

function setFollow(on: boolean): void {
  walk.follow = on;
  if (on)
    stage.setFollow(
      () => ({ x: player.x, z: player.z }),
      () => (walk.follow = false),
    );
  else stage.setFollow(null);
}

/** Quando o avatar chega à secretária de alguém: abre a conversa e essa pessoa vira-se para ele. */
function handleArrival(now: number): void {
  const id = arrivedAtDesk(player);
  if (!id) {
    walk.arrivedFor = null;
    return;
  }
  if (walk.arrivedFor === id) return;
  walk.arrivedFor = id;
  const worker = byAgentId.get(id);
  if (!worker) return;
  worker.lookAt = { x: player.x, z: player.z, until: now + ARRIVAL_LOOK_MS };
  walkTarget = null;
  walkStatus.arrived(worker.def.name);
  panel.open(worker, agentTab(worker));
}

/** Teclas de andar: setas e WASD (em relação ao ecrã, não ao mundo). */
const MOVE_KEYS: Readonly<Record<string, readonly [right: number, up: number]>> = {
  ArrowUp: [0, 1],
  w: [0, 1],
  ArrowDown: [0, -1],
  s: [0, -1],
  ArrowLeft: [-1, 0],
  a: [-1, 0],
  ArrowRight: [1, 0],
  d: [1, 0],
};
addEventListener("keydown", (e) => {
  if (!shortcutAllowed(e)) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // Os atalhos de ligar/desligar não repetem quando a tecla fica carregada (o autorrepeat do browser).
  if (k === "g" && !e.repeat) return setWalkMode(!walk.on);
  if (k === "m" && !e.repeat) return setEditMode(!editor.active());
  if (editor.active()) {
    if (k === "r" && !e.repeat) editor.rotate();
    else if (k === "Escape") setEditMode(false);
    return;
  }
  // Esc fecha primeiro o que está por cima (menu, notificações, atividade, diálogo, dossier); só depois o painel.
  if (k === "Escape") return closeTopmost();
  if (!walk.on) return;
  if (k === "f" && !e.repeat) return setFollow(!walk.follow);
  if (k in MOVE_KEYS) {
    e.preventDefault();
    walk.keys.add(k);
    walk.arrivedFor = null;
    if (walkTarget) {
      walkTarget = null;
      walkStatus.heading(null);
    }
  }
});
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

/** Perder o foco (mudar de janela ou separador) larga as setas: senão o avatar continuava a andar sozinho. */
function releaseWalkKeys(): void {
  if (walk.keys.size === 0) return;
  walk.keys.clear();
  player.route = [];
}
addEventListener("blur", releaseWalkKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseWalkKeys();
});
addEventListener("keyup", (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (!walk.keys.delete(k) || walk.keys.size > 0) return;
  player.route = [];
});
byId("walkBtn").onclick = () => setWalkMode(!walk.on);

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
  onDecide: (id, _who, approved) => {
    const sent = client.send({ type: "decide", id, approved });
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
/** O chat (React + assistant-ui) só é descarregado quando é preciso: o arranque da cena 3D fica mais leve. */
function lazyChat(): ChatMount {
  let real: ChatMount | null = null;
  let shown: ChatAgent | null = null;
  let isOnline = false;
  void import("./chat/mount").then(({ mountChat }) => {
    real = mountChat(byId("chatRoot"), chatStore, chatActions);
    real.setOnline(isOnline);
    real.show(shown);
  });
  return {
    show(agent) {
      shown = agent;
      real?.show(agent);
    },
    setOnline(next) {
      isOnline = next;
      real?.setOnline(next);
    },
  };
}
const chat = lazyChat();

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
  if (m.type === "move") return beginMove(m.id, m.agentId, m.place);
  if (m.type === "order-steps") return ordersUi.update(m);
  if (m.type === "office") return showOffice(m.myOffice);
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

// ---- ordens de movimento: o servidor pede, a cena leva a pessoa até lá e confirma a chegada
const pendingMoves: PendingMove[] = [];
const agentName = (id: string): string => byAgentId.get(id)?.def.name ?? id;

function beginMove(id: number, agentId: string, place: string): void {
  const a = byAgentId.get(agentId);
  if (!a) return void client.send({ type: "arrived", id, ok: false, reason: "essa pessoa não existe na cena" });
  const started = startMove(a, place, locs, id, performance.now());
  if ("error" in started) return void client.send({ type: "arrived", id, ok: false, reason: started.error });
  // Uma ordem nova para a mesma pessoa substitui a anterior.
  for (let i = pendingMoves.length - 1; i >= 0; i--)
    if (pendingMoves[i].agent === a) {
      // A ordem anterior fica respondida (senão o servidor esperava por ela até desistir).
      client.send({ type: "arrived", id: pendingMoves[i].id, ok: false, reason: "substituída por outra ordem de movimento" });
      pendingMoves.splice(i, 1);
    }
  pendingMoves.push(started);
  a.task = `A caminho ${ofPlace(placeName(place, agentName))}.`;
  panel.refresh();
}

function checkMoves(): void {
  for (let i = pendingMoves.length - 1; i >= 0; i--) {
    const m = pendingMoves[i];
    const status = moveStatus(m);
    if (status === "walking") continue;
    pendingMoves.splice(i, 1);
    client.send(
      status === "arrived"
        ? { type: "arrived", id: m.id, ok: true }
        : { type: "arrived", id: m.id, ok: false, reason: "foi desviada para outro sítio antes de chegar" },
    );
  }
}
setInterval(checkMoves, 250);

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
const officeSel = byId<HTMLSelectElement>("officeSel");
officeSel.innerHTML =
  `<option value="">O meu gabinete…</option>` +
  ROOM_PLACES.filter((p) => p.id !== "tray")
    .map((p) => `<option value="${p.id}">${p.name.replace(/^(a|o) /, "")}</option>`)
    .join("");
function showOffice(place: string | null): void {
  if (place && ![...officeSel.options].some((o) => o.value === place)) {
    const opt = document.createElement("option");
    opt.value = place;
    opt.textContent = placeName(place, agentName);
    officeSel.append(opt);
  }
  officeSel.value = place ?? "";
}
officeSel.onchange = () => {
  if (!officeSel.value) return;
  if (client.send({ type: "set-office", place: officeSel.value })) toast(`O teu gabinete: ${placeName(officeSel.value, agentName)}`);
  else toast("Servidor offline: não consegui guardar o gabinete.");
};

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

// ---- comandos ao CEO
byId<HTMLFormElement>("cmd").onsubmit = (e) => {
  e.preventDefault();
  const input = byId<HTMLInputElement>("cmdIn");
  if (IS_DEMO) return void runTour();
  const text = input.value.trim();
  const ceo = byAgentId.get("ceo");
  if (!text || !ceo) return;
  const orderProfile = localMode?.profileOf("ceo");
  if (realAgents.has("ceo") && client.send({ type: "order", text, ...(orderProfile ? { profileId: orderProfile.id } : {}) })) {
    input.value = "";
    chatStore.addUser("ceo", text);
    toast("Ordem enviada");
    showOrderTarget();
    return;
  }
  toast("Servidor offline: as ordens ao CEO só funcionam com o servidor ligado.");
};

// ---- cabeçalho: tema e hora
byId("themeBtn").onclick = () => {
  document.documentElement.dataset.theme = isDark() ? "light" : "dark";
  if (panel.selected) panel.open(panel.selected, panel.tab);
};
const TIME_CYCLE: Record<TimeMode, { label: string; next: TimeMode }> = {
  auto: { label: "🕒 Auto", next: "day" },
  day: { label: "☀ Dia", next: "night" },
  night: { label: "🌙 Noite", next: "auto" },
};
let timeMode: TimeMode = "auto";
const showQuality = (): void => {
  byId("qualBtn").textContent = stage.quality() === "alta" ? "✨ Alta" : "Normal";
};
byId("qualBtn").onclick = () => {
  stage.setQuality(stage.quality() === "alta" ? "normal" : "alta");
  showQuality();
};
showQuality();
// A cena estava lenta e o palco aliviou-a sozinho: diz-se o que mudou (e o botão mostra a qualidade atual).
stage.onAutoAdjust((message) => {
  showQuality();
  toast(message);
});
byId("timeBtn").onclick = () => {
  timeMode = TIME_CYCLE[timeMode].next;
  stage.setTimeMode(timeMode);
  byId("timeBtn").textContent = TIME_CYCLE[timeMode].label;
};

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
  if (walk.on) {
    let right = 0;
    let up = 0;
    for (const k of walk.keys) {
      right += MOVE_KEYS[k][0];
      up += MOVE_KEYS[k][1];
    }
    const az = stage.azimuth();
    // Frente no ecrã = para longe da câmara; direita no ecrã = (cos, -sin).
    const moving = right !== 0 || up !== 0;
    stepAgent(player, dt);
    if (moving) freeWalk(player, -Math.sin(az) * up + Math.cos(az) * right, -Math.cos(az) * up - Math.sin(az) * right, dt);
    updatePerson(playerView, player, dt, t);
    handleArrival(now);
  }
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
  placeTag(walkTarget ?? panel.selected ?? hovered);
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
  tag.textContent = `${a === walkTarget ? "🚶 " : selected ? "● " : ""}${a.def.name} · ${a.role.split("·")[0].trim()}`;
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
  () =>
    agents.map((a) => ({
      id: a.def.id,
      name: a.def.name,
      emoji: a.def.emoji,
      role: a.role.split("·")[0]?.trim() ?? "",
      state: stateOf(a),
      real: online && realAgents.has(a.def.id),
    })),
  (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, agentTab(a));
  },
);
teamBar.refresh();
setInterval(() => teamBar.refresh(), TEAM_REFRESH_MS);
byId("cmdNames").innerHTML = agents.map((a) => `<option value="${escapeHtml(`${a.def.name}, `)}"></option>`).join("");
const cmdIn = byId<HTMLInputElement>("cmdIn");
const cmdSend = byId("cmdSend");
/** O botão diz para onde vai a ordem: "Mira, …" vai direta para ela; sem nome vai ao Atlas. */
const showOrderTarget = (): void => {
  const m = /^\s*@?([\p{L}-]+)\s*[,:]/u.exec(cmdIn.value);
  const name = m?.[1]?.toLowerCase();
  const target = name ? agents.find((a) => a.def.name.toLowerCase() === name || a.def.id === name) : undefined;
  cmdSend.textContent = target && target.def.id !== "ceo" ? `Enviar → ${target.def.name}` : "Enviar ao Atlas";
};
cmdIn.addEventListener("input", showOrderTarget);
byId("pClose").onclick = () => panel.close();
// O menu Vista fecha-se ao clicar fora dele.
document.addEventListener("pointerdown", (e) => {
  const menu = byId<HTMLDetailsElement>("viewMenu");
  if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
});
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
