import type { AppNotification, ClientMsg, InitiativeSettings, NotificationKind } from "../../../shared/protocol";
import { byId, escapeHtml, toast } from "./dom";

/**
 * Notificações (🔔): tudo o que precisa de ti num só sítio. Perguntas dos agentes, pedidos de autorização, rascunhos
 * para aprovar, passos bloqueados, o dossier à tua espera e as ideias que a equipa propõe por iniciativa própria.
 */

export interface NotificationsDeps {
  send(m: ClientMsg): boolean;
  nameOf(agentId: string): string;
  emojiOf(agentId: string): string;
  /** Abre a conversa de um agente (para responder a uma pergunta ou ver o que bloqueou). */
  openChat(agentId: string): void;
  openApprovals(): void;
  openDossier(): void;
}

export interface NotificationsUi {
  set(items: readonly AppNotification[]): void;
  setInitiative(s: InitiativeSettings): void;
}

const KIND: Record<NotificationKind, { label: string; icon: string }> = {
  question: { label: "Pergunta", icon: "?" },
  permission: { label: "Autorização", icon: "🔐" },
  approval: { label: "Para aprovar", icon: "✍" },
  blocked: { label: "Bloqueado", icon: "✗" },
  dossier: { label: "Dossier", icon: "📁" },
  idea: { label: "Ideia", icon: "💡" },
};
const EVERY = [15, 30, 60, 120, 240];
const ago = (ts: number): string => {
  const min = Math.round((Date.now() - ts) / 60_000);
  return min < 1 ? "agora" : min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`;
};

export function createNotificationsUi(deps: NotificationsDeps): NotificationsUi {
  const btn = byId("notifBtn");
  const count = byId("notifCount");
  const panel = byId("notifPanel");
  let items: readonly AppNotification[] = [];
  let initiative: InitiativeSettings = { enabled: true, everyMin: 30 };
  let loaded = false;
  let showClosed = false;

  const actions = (n: AppNotification): string => {
    const b = (act: string, label: string, primary = false): string =>
      `<button type="button" data-act="${act}" data-id="${n.id}"${primary ? ' class="primary"' : ""}>${label}</button>`;
    if (!n.open) return "";
    switch (n.kind) {
      case "question":
        return b("chat", "Responder", true);
      case "permission":
        return `${b("allow", "Permitir", true)}${b("deny", "Recusar")}`;
      case "approval":
        return b("approvals", "Ver", true);
      case "dossier":
        return `${b("dossier", "Abrir dossier", true)}${b("dismiss", "Visto")}`;
      case "idea":
        return `${b("accept", "Avançar", true)}${b("chat", "Falar")}${b("reject", "Dispensar")}`;
      case "blocked":
        return `${b("chat", "Ver")}${b("dismiss", "Visto")}`;
    }
  };

  function render(): void {
    const open = items.filter((n) => n.open);
    count.textContent = String(open.length);
    count.style.display = open.length ? "" : "none";
    btn.classList.toggle("attn", open.length > 0);
    const shown = showClosed ? [...items].reverse() : [...open].reverse();
    const rows = shown
      .map((n) => {
        const k = KIND[n.kind];
        const extra =
          n.kind === "idea" && (n.data?.why || n.data?.firstStep)
            ? `<small>${n.data?.why ? `Porquê: ${escapeHtml(n.data.why)}` : ""}${n.data?.firstStep ? `<br>Primeiro passo: ${escapeHtml(n.data.firstStep)}` : ""}</small>`
            : "";
        return `<li class="nt nt-${n.kind}${n.open ? "" : " closed"}">
          <span class="nt-icon" aria-hidden="true">${k.icon}</span>
          <div class="nt-body"><div class="nt-head"><b>${escapeHtml(deps.emojiOf(n.agentId))} ${escapeHtml(deps.nameOf(n.agentId))}</b> · ${k.label} · <small>${ago(n.ts)}</small></div>
          <div class="nt-text">${escapeHtml(n.text)}</div>${extra}
          <div class="nt-actions">${actions(n)}</div></div></li>`;
      })
      .join("");
    const every = EVERY.map(
      (m) =>
        `<option value="${m}"${initiative.everyMin === m && initiative.enabled ? " selected" : ""}>a cada ${m < 60 ? `${m} min` : `${m / 60} h`}</option>`,
    ).join("");
    panel.innerHTML = `
      <div class="nt-top"><b>O que precisa de ti</b>
        <label class="nt-toggle">Ver as resolvidas <input type="checkbox" id="ntClosed"${showClosed ? " checked" : ""}></label></div>
      <ul class="nt-list">${rows || `<li class="nt-empty">Nada à tua espera.</li>`}</ul>
      <div class="nt-ideas"><span>💡 Ideias da equipa</span>
        <select id="ntEvery" aria-label="Frequência das ideias da equipa"><option value="off"${initiative.enabled ? "" : " selected"}>desligadas</option>${every}</select>
        <button type="button" id="ntNow">Pedir uma ideia agora</button></div>
      <div class="mode-note">Os agentes propõem ideias por iniciativa própria (com a app aberta e a equipa livre). Nada é feito sem «Avançar»: aí o Atlas organiza a equipa.</div>`;
  }

  panel.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!t) return;
    const n = items.find((x) => x.id === Number(t.dataset.id));
    if (!n) return;
    const act = t.dataset.act;
    if (act === "chat") deps.openChat(n.agentId);
    else if (act === "approvals") deps.openApprovals();
    else if (act === "dossier") {
      deps.openDossier();
      deps.send({ type: "notification-dismiss", id: n.id });
    } else if (act === "allow" || act === "deny") {
      if (n.data?.permissionId !== undefined) deps.send({ type: "permission-decide", id: n.data.permissionId, allow: act === "allow" });
    } else if (act === "accept") {
      if (deps.send({ type: "idea-decide", id: n.id, accept: true })) toast(`A ideia vai para o Atlas, que organiza a equipa.`);
    } else if (act === "reject") deps.send({ type: "idea-decide", id: n.id, accept: false });
    else if (act === "dismiss") deps.send({ type: "notification-dismiss", id: n.id });
  });
  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (t.id === "ntClosed") {
      showClosed = (t as HTMLInputElement).checked;
      render();
    } else if (t.id === "ntEvery") {
      const v = (t as HTMLSelectElement).value;
      deps.send(
        v === "off"
          ? { type: "initiative-set", enabled: false, everyMin: initiative.everyMin }
          : { type: "initiative-set", enabled: true, everyMin: Number(v) },
      );
    }
  });
  panel.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id !== "ntNow") return;
    if (deps.send({ type: "initiative-now" })) toast("Pedi uma ideia ao próximo da equipa: aparece aqui quando estiver pronta.");
  });

  btn.onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) render();
  };
  document.addEventListener("click", (e) => {
    if (panel.hidden) return;
    const t = e.target as Node;
    if (!panel.contains(t) && !btn.contains(t)) panel.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") panel.hidden = true;
  });

  return {
    set(next) {
      // Uma notificação nova (não as que já estavam ao abrir a app) aparece também como aviso rápido.
      if (loaded)
        for (const n of next)
          if (n.open && !items.some((x) => x.id === n.id)) toast(`🔔 ${deps.nameOf(n.agentId)}: ${n.text.slice(0, 90)}`);
      loaded = true;
      items = next;
      render();
    },
    setInitiative(s) {
      initiative = s;
      render();
    },
  };
}
