import "./style.css";
import "./chat/chat.css";
import { AGENTS } from "./data/agents";
import { buildBuilding } from "./scene/building";
import { createPerson, STATE_INFO, updatePerson, type PersonView } from "./scene/person";
import { buildAmbient } from "./scene/ambient";
import { buildProps } from "./scene/props";
import { createScreen, drawScreen, type ScreenHandle } from "./scene/screens";
import { createStage, type TimeMode } from "./scene/stage";
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
import { createDossierBoard } from "./scene/dossier-board";
import { createDossierUi } from "./ui/dossier";
import { waitingForUser } from "./ui/dossier-model";
import type { Dossier } from "../../shared/protocol";
import { shortcutAllowed } from "./ui/keys";
import { cancelAmbient, lifeTick, lifeUpdate, queueVisit } from "./sim/life";
import {
  arrivedAtDesk,
  clickCorridor,
  createPlayer,
  goToDesk,
  nearestDesk,
  stopWalking,
  walkAlongCorridor,
  PLAYER_DEF,
} from "./sim/player";

interface LogEvent {
  readonly agent: Agent;
  readonly text: string;
}
import { deadlinesFor } from "./sim/canvas";
import { buildLocations } from "./sim/locations";
import { byId, isDark, toast } from "./ui/dom";
import { createApprovals } from "./ui/approvals";
import { createPanel, type Tab } from "./ui/panel";

const SCREEN_REFRESH_S = 0.25;
const ARRIVAL_LOOK_MS = 6000;
const WALK_ZOOM = 2;
const MAX_LOG = 200;

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
document.documentElement.dataset.theme = darkQuery.matches ? "dark" : "light";

// ---- mundo
buildBuilding();
const locs = buildLocations(AGENTS);
const agents: Agent[] = AGENTS.map((d) => createAgent(d, locs[`desk-${d.id}`]));
const screens = new Map<string, ScreenHandle>(agents.map((a) => [a.def.id, createScreen()]));
buildProps(screens);
const dossierProp = createDossierProp();
const dossierBoard = createDossierBoard();
const reviewTray = buildReviewTray();
const updateAmbient = buildAmbient();
const views = new Map<string, PersonView>(agents.map((a) => [a.def.id, createPerson(a.def)]));
const byAgentId = new Map<string, Agent>(agents.map((a) => [a.def.id, a]));
const player = createPlayer();
const playerView = createPerson(PLAYER_DEF);
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
const panel = createPanel({
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
    if (goToDesk(player, locs, a.def.id)) walk.arrivedFor = null;
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
    const a = pickAt(e);
    if (walk.on) return clickInWalkMode(e, a);
    if (a) panel.open(a, "chat");
  },
  (e) => {
    hovered = pickAt(e);
    stage.dom.style.cursor = hovered || pickId(e) === DOSSIER_ID ? "pointer" : "grab";
  },
);
/** Modo andar: clicar numa pessoa leva-te à secretária dela; no corredor, ao sítio clicado; numa sala, à secretária mais próxima. */
function clickInWalkMode(e: PointerEvent, clicked: Agent | null): void {
  if (clicked) {
    goToDesk(player, locs, clicked.def.id);
    walk.arrivedFor = null;
    return;
  }
  const ground = stage.pickGround(e);
  if (!ground) return;
  if (clickCorridor(player, ground)) return;
  const desk = nearestDesk(agents, ground);
  if (desk) {
    goToDesk(player, locs, desk.def.id);
    walk.arrivedFor = null;
  }
}

function setWalkMode(on: boolean): void {
  walk.on = on;
  playerView.group.visible = on;
  const btn = byId("walkBtn");
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("on", on);
  byId("hint").textContent = on
    ? "Andar: ← → no corredor · clica no chão ou numa pessoa para ir lá · F segue-te · W para sair"
    : "Arrastar: mover · Roda: zoom · Botão direito ou Q/E: rodar · Clica numa pessoa";
  stage.setZoom(on ? WALK_ZOOM : 1);
  if (on) {
    setFollow(true);
  } else {
    stage.setFollow(null);
    walk.keys.clear();
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
  panel.open(worker, "chat");
}

const WALK_KEYS: Record<string, -1 | 1> = { ArrowLeft: -1, ArrowRight: 1 };
addEventListener("keydown", (e) => {
  if (!shortcutAllowed(e)) return;
  // Os atalhos de ligar/desligar não repetem quando a tecla fica carregada (o autorrepeat do browser).
  if ((e.key === "w" || e.key === "W") && !e.repeat) return setWalkMode(!walk.on);
  if (!walk.on) return;
  if ((e.key === "f" || e.key === "F") && !e.repeat) return setFollow(!walk.follow);
  if (e.key in WALK_KEYS) {
    e.preventDefault();
    walk.keys.add(e.key);
    walk.arrivedFor = null;
  }
});
/** Perder o foco (mudar de janela ou separador) larga as setas: senão o avatar continuava a andar sozinho. */
function releaseWalkKeys(): void {
  if (walk.keys.size === 0) return;
  walk.keys.clear();
  stopWalking(player);
}
addEventListener("blur", releaseWalkKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseWalkKeys();
});
addEventListener("keyup", (e) => {
  if (!walk.keys.delete(e.key) || walk.keys.size > 0) return;
  stopWalking(player);
});
byId("walkBtn").onclick = () => setWalkMode(!walk.on);

const DOSSIER_ID = "dossier";

/** O que está sob o cursor: o id de um agente ou o do dossier. */
function pickId(e: PointerEvent): string | null {
  return stage.pickAgent(e, [...[...views.values()].map((v) => v.group), dossierProp.group, dossierBoard.group]);
}

function pickAt(e: PointerEvent): Agent | null {
  const id = pickId(e);
  return id && id !== DOSSIER_ID ? (byAgentId.get(id) ?? null) : null;
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
      if (a.kind !== "desk") sendTo(a, locs[`desk-${a.def.id}`], "desk");
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

/** O dossier mudou (ou foi restaurado ao ligar): atualiza o cartão, o rótulo e a pasta na cena. */
function applyDossier(d: Dossier | null): void {
  dossierUi.update(d);
  dossierProp.set(d);
  dossierBoard.set(d);
  reviewTray.setAttention(waitingForUser(d));
}

const client = connect(onServerMsg, (isOnline) => {
  online = isOnline;
  chat.setOnline(isOnline);
  byId("conn").textContent = isOnline ? "servidor: online" : "servidor: offline";
  if (isOnline) return;
  realAgents.clear();
  for (const a of agents) if (busy.has(a.def.id)) setBusy(a, false);
});

const sendDossier = (msg: ClientMsg): boolean => {
  const sent = client.send(msg);
  if (!sent) toast("Servidor offline: o dossier só avança com o servidor ligado.");
  return sent;
};
const dossierUi = createDossierUi({
  start: (request, materials) => sendDossier({ type: "dossier-start", request, ...(materials ? { materials } : {}) }),
  answer: (id, answer, companyOnly) => sendDossier({ type: "dossier-answer", id, answer, ...(companyOnly ? { companyOnly } : {}) }),
  returnDraft: (id, note) => sendDossier({ type: "dossier-return", id, note }),
  approve: (id) => sendDossier({ type: "dossier-approve", id }),
  retry: (id) => sendDossier({ type: "dossier-retry", id }),
});
byId("dossierBtn").onclick = () => dossierUi.toggle();

// ---- comportamento
// A vida de ambiente (café, conversas, gestos) só envolve quem está livre; o resto do tempo é tempo real.
setInterval(() => lifeTick(agents, locs, performance.now()), 2000);
setInterval(() => lifeUpdate(agents, locs, performance.now()), 100);

// ---- comandos ao CEO
byId<HTMLFormElement>("cmd").onsubmit = (e) => {
  e.preventDefault();
  const input = byId<HTMLInputElement>("cmdIn");
  const text = input.value.trim();
  const ceo = byAgentId.get("ceo");
  if (!text || !ceo) return;
  if (realAgents.has("ceo") && client.send({ type: "order", text })) {
    input.value = "";
    chatStore.addUser("ceo", text);
    toast("Ordem enviada ao CEO");
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
  if (walk.on) {
    const held = [...walk.keys].at(-1);
    if (held) walkAlongCorridor(player, WALK_KEYS[held]);
    stepAgent(player, dt);
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
  placeTag(panel.selected ?? hovered);
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
  tag.textContent = `${a.def.name} · ${a.role.split("·")[0].trim()}`;
  tag.style.left = `${p.x}px`;
  tag.style.top = `${p.y - 22}px`;
}

// ---- paleta Ctrl+K e painel redimensionável
const palette = createPalette(
  () => agents.map((a) => ({ id: a.def.id, name: a.def.name, role: a.role, emoji: a.def.emoji, state: STATE_INFO[stateOf(a)].label })),
  (id) => {
    const a = byAgentId.get(id);
    if (a) panel.open(a, "chat");
  },
);
byId("palBtn").onclick = () => palette.open();
installResizer(byId("main"), byId("resizer"));

// ---- ligação direta: #ada ou #ada/chat abre logo o painel desse agente
function openFromHash(): void {
  const [agentId, tab] = location.hash.slice(1).split("/");
  const agent = byAgentId.get(agentId ?? "");
  if (agent) panel.open(agent, (["sum", "log", "chat"] as const).find((t): t is Tab => t === tab) ?? "sum");
}
openFromHash();
addEventListener("hashchange", openFromHash);

requestAnimationFrame(frame);
