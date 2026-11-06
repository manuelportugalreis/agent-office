import { describeProfile } from "../../../shared/access";
import type { AccessProfile, AgentMode, ClientMsg, PermissionRequest, ProfileInput, ServerMsg, ToolStep } from "../../../shared/protocol";
import { byId, escapeHtml, toast } from "./dom";

/**
 * Modo "Claude Code local" na interface: o modo e o perfil de cada agente, o acesso efetivo, o rasto da última tarefa,
 * o editor de perfis, a fila de pedidos de permissão (com as alterações propostas) e "Continuar no terminal".
 * O servidor é a fonte de verdade: aqui só se mostra e se pede.
 */

export interface LocalState {
  profiles: AccessProfile[];
  mcpAvailable: string[];
  vaultDir: string;
  cliVersion: string;
  modes: Record<string, AgentMode>;
  permissions: PermissionRequest[];
  /** Última sessão local de cada agente (por perfil): o comando para a continuar no terminal. */
  sessions: Record<string, { profileId: number; command: string }>;
  /** Rasto da última tarefa local de cada agente. */
  traces: Record<string, ToolStep[]>;
}

export interface LocalModeDeps {
  send(msg: ClientMsg): boolean;
  nameOf(agentId: string): string;
  /** Algo mudou (o painel do agente redesenha a secção). */
  changed(agentId?: string): void;
  /** Abre o painel de um agente (ao clicar num pedido de permissão). */
  openAgent(agentId: string): void;
}

export interface LocalMode {
  readonly state: LocalState;
  /** Trata uma mensagem do servidor; devolve true se era deste módulo. */
  handle(m: ServerMsg): boolean;
  profileOf(agentId: string): AccessProfile | null;
  /** HTML da secção "Modo de trabalho" para o resumo do agente. */
  sectionHtml(agentId: string, opts: { real: boolean; busy: boolean }): string;
  /** Liga os botões da secção depois de o HTML entrar no painel. */
  bind(agentId: string): void;
  openEditor(profileId?: number): void;
}

const lines = (v: string): string[] =>
  v
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

const stepText = (s: ToolStep): string =>
  `${s.ok === false ? "✗" : "✓"} ${s.tool}${s.file ? ` ${s.file}` : s.summary ? `: ${s.summary}` : ""}`;

export function createLocalMode(deps: LocalModeDeps): LocalMode {
  const state: LocalState = {
    profiles: [],
    mcpAvailable: [],
    vaultDir: "",
    cliVersion: "",
    modes: {},
    permissions: [],
    sessions: {},
    traces: {},
  };
  const queue = byId("perm");
  const profileOf = (agentId: string): AccessProfile | null => {
    const m = state.modes[agentId];
    return m?.kind === "local" ? (state.profiles.find((p) => p.id === m.profileId) ?? null) : null;
  };

  function renderQueue(): void {
    queue.style.display = state.permissions.length ? "block" : "none";
    queue.innerHTML =
      `<div class="perm-h">Pedidos de autorização <small>(Claude Code local)</small></div>` +
      state.permissions
        .map(
          (p) => `<div class="it" data-id="${p.id}">
        <b>${escapeHtml(deps.nameOf(p.agentId))}</b> quer usar <code>${escapeHtml(p.tool)}</code>
        <div class="perm-sum">${escapeHtml(p.summary)}</div>
        ${p.reason ? `<div class="perm-why">${escapeHtml(p.reason)}</div>` : ""}
        ${p.detail ? `<details${p.detail.length < 900 ? " open" : ""}><summary>Ver o que vai fazer</summary><pre class="perm-detail">${escapeHtml(p.detail)}</pre></details>` : ""}
        <div class="bt"><button class="primary" data-allow="${p.id}">Permitir</button><button data-deny="${p.id}">Recusar</button><button data-view="${escapeHtml(p.agentId)}">Ver agente</button></div>
      </div>`,
        )
        .join("");
    queue.querySelectorAll<HTMLButtonElement>("[data-allow],[data-deny]").forEach((b) => {
      b.onclick = () => {
        const allow = b.dataset.allow !== undefined;
        const id = Number(allow ? b.dataset.allow : b.dataset.deny);
        if (!deps.send({ type: "permission-decide", id, allow })) toast("Servidor offline: não consegui responder.");
        b.disabled = true;
      };
    });
    queue.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
      b.onclick = () => deps.openAgent(b.dataset.view ?? "");
    });
  }

  function handle(m: ServerMsg): boolean {
    switch (m.type) {
      case "profiles":
        Object.assign(state, {
          profiles: [...m.profiles],
          mcpAvailable: [...m.mcpAvailable],
          vaultDir: m.vaultDir,
          cliVersion: m.cliVersion,
        });
        deps.changed();
        refreshEditor();
        return true;
      case "modes":
        state.modes = { ...m.modes };
        deps.changed();
        return true;
      case "permission":
        if (!state.permissions.some((p) => p.id === m.request.id)) state.permissions.push(m.request);
        renderQueue();
        toast(`${deps.nameOf(m.request.agentId)} pede autorização: ${m.request.summary}`);
        deps.changed(m.request.agentId);
        return true;
      case "permission-resolved":
        state.permissions = state.permissions.filter((p) => p.id !== m.id);
        renderQueue();
        deps.changed(m.agentId);
        return true;
      case "session":
        state.sessions[m.agentId] = { profileId: m.profileId, command: m.command };
        deps.changed(m.agentId);
        return true;
      case "trace":
        state.traces[m.agentId] = [...m.steps];
        deps.changed(m.agentId);
        return true;
      default:
        return false;
    }
  }

  function sectionHtml(agentId: string, { real, busy }: { real: boolean; busy: boolean }): string {
    if (!real || agentId === "dean") return "";
    const profile = profileOf(agentId);
    const local = !!profile;
    const options = state.profiles
      .map((p) => `<option value="${p.id}"${profile?.id === p.id ? " selected" : ""}>${escapeHtml(p.name)}</option>`)
      .join("");
    let h = `<div class="lbl">Modo de trabalho</div>
      <div class="mode-row">
        <button id="modeOffice" class="${local ? "" : "on"}"${busy ? " disabled" : ""}>Escritório</button>
        <button id="modeLocal" class="${local ? "on" : ""}"${busy || !state.profiles.length ? " disabled" : ""}>Claude Code local</button>
        ${state.profiles.length ? `<select id="modeProfile"${busy ? " disabled" : ""}>${options}</select>` : ""}
        <button id="profilesBtn" title="Criar e editar perfis de acesso">Perfis…</button>
      </div>`;
    if (!state.profiles.length)
      h += `<div class="mode-note">Cria um perfil (pasta do projeto, Obsidian, terminal, MCP) para este agente trabalhar como o Claude Code no teu terminal.</div>`;
    if (!local)
      h += `<div class="mode-note">Escritório: trabalha na pasta própria do agente, só com ficheiros${agentId === "ceo" ? "" : " e as ferramentas do papel"}, sem terminal nem MCP.</div>`;
    else {
      h += `<div class="access">${describeProfile(profile)
        .map((l) => `<div>${escapeHtml(l)}</div>`)
        .join(
          "",
        )}<div class="mode-note">Usa o Claude Code instalado${state.cliVersion ? ` (${escapeHtml(state.cliVersion)})` : ""} com a tua autenticação, as tuas definições, hooks e regras de permissão. O que no terminal te perguntaria aparece aqui para permitires ou recusares.</div></div>`;
      const trace = state.traces[agentId];
      if (trace?.length)
        h += `<div class="lbl">Última tarefa local (rasto)</div><div class="trace">${trace
          .slice(-14)
          .map((s) => `<div class="${s.ok === false ? "bad" : ""}">${escapeHtml(stepText(s))}</div>`)
          .join("")}</div>`;
      // Só a sessão deste perfil (uma tarefa delegada noutro perfil não conta).
      const last = state.sessions[agentId];
      const cmd = last?.profileId === profile.id && last.command.includes("-File") ? last.command : undefined;
      h += `<div class="mode-row"><button id="termBtn"${busy ? " disabled" : ""}>Continuar no terminal</button>${cmd ? `<button id="copyCmd" title="${escapeHtml(cmd)}">Copiar comando</button>` : ""}</div>
        <div class="mode-note">Abre uma janela de terminal com esta sessão e o mesmo perfil (pastas, MCP, terminal e regras); as perguntas de permissão passam a aparecer lá.</div>`;
    }
    const pending = state.permissions.filter((p) => p.agentId === agentId);
    if (pending.length)
      h += `<div class="lbl">À espera da tua autorização</div><div>${pending.map((p) => escapeHtml(p.summary)).join("<br>")} (na fila do lado direito)</div>`;
    if (agentId === "ceo" && local)
      h += `<div class="mode-note">As ordens dadas ao Atlas na barra de baixo correm neste perfil: a equipa herda este acesso e só este.</div>`;
    return h;
  }

  function bind(agentId: string): void {
    const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
    const select = el<HTMLSelectElement>("modeProfile");
    const setLocal = (): void => {
      const profileId = Number(select?.value ?? state.profiles[0]?.id);
      if (Number.isInteger(profileId)) deps.send({ type: "set-mode", agentId, mode: { kind: "local", profileId } });
    };
    const office = el<HTMLButtonElement>("modeOffice");
    if (office) office.onclick = () => deps.send({ type: "set-mode", agentId, mode: { kind: "office" } });
    const local = el<HTMLButtonElement>("modeLocal");
    if (local) local.onclick = setLocal;
    if (select) select.onchange = () => profileOf(agentId) && setLocal();
    const profiles = el<HTMLButtonElement>("profilesBtn");
    if (profiles) profiles.onclick = () => openEditor(profileOf(agentId)?.id);
    const term = el<HTMLButtonElement>("termBtn");
    if (term) term.onclick = () => deps.send({ type: "open-terminal", agentId });
    const copy = el<HTMLButtonElement>("copyCmd");
    if (copy)
      copy.onclick = () =>
        navigator.clipboard.writeText(state.sessions[agentId]?.command ?? "").then(
          () => toast("Comando copiado"),
          () => toast("Não consegui copiar."),
        );
  }

  // ---------- editor de perfis ----------
  const dialog = byId<HTMLDialogElement>("profileDialog");
  let editing: number | undefined;

  function fill(p: AccessProfile | undefined): void {
    const f = (id: string): HTMLInputElement => byId<HTMLInputElement>(id);
    f("pfName").value = p?.name ?? "";
    f("pfFolder").value = p?.folder ?? "";
    byId<HTMLTextAreaElement>("pfRead").value = (p?.readDirs ?? []).join("\n");
    byId<HTMLTextAreaElement>("pfWrite").value = (p?.writeDirs ?? []).join("\n");
    byId<HTMLSelectElement>("pfVault").value = p?.vault ?? (state.vaultDir ? "read" : "none");
    byId<HTMLTextAreaElement>("pfVaultFolders").value = (p?.vaultFolders ?? []).join("\n");
    f("pfBash").checked = p?.bash ?? true;
    f("pfAuto").checked = p?.autoEdits ?? false;
    const chosen = new Set(p?.mcp ?? []);
    byId("pfMcp").innerHTML =
      `<label><input type="checkbox" value="*"${chosen.has("*") ? " checked" : ""}> Todas as que uso no terminal</label>` +
      state.mcpAvailable
        .map((n) => `<label><input type="checkbox" value="${escapeHtml(n)}"${chosen.has(n) ? " checked" : ""}> ${escapeHtml(n)}</label>`)
        .join("");
    byId("pfDelete").style.display = p ? "inline-block" : "none";
    byId("pfVaultInfo").textContent = state.vaultDir
      ? `Vault configurado: ${state.vaultDir}`
      : "Sem vault configurado (vaultDir em office.config.json).";
  }

  function refreshEditor(): void {
    const list = byId<HTMLSelectElement>("pfList");
    list.innerHTML =
      `<option value="">+ Novo perfil</option>` +
      state.profiles.map((p) => `<option value="${p.id}"${p.id === editing ? " selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
    if (editing !== undefined && !state.profiles.some((p) => p.id === editing)) editing = undefined;
  }

  function openEditor(profileId?: number): void {
    editing = profileId;
    refreshEditor();
    fill(state.profiles.find((p) => p.id === profileId));
    dialog.showModal();
  }

  byId<HTMLSelectElement>("pfList").onchange = (e) => {
    const v = (e.target as HTMLSelectElement).value;
    editing = v ? Number(v) : undefined;
    fill(state.profiles.find((p) => p.id === editing));
  };
  byId("pfClose").onclick = () => dialog.close();
  byId("pfDelete").onclick = () => {
    if (editing === undefined) return;
    deps.send({ type: "profile-delete", id: editing });
    editing = undefined;
    fill(undefined);
  };
  byId<HTMLFormElement>("pfForm").onsubmit = (e) => {
    e.preventDefault();
    const profile: ProfileInput = {
      ...(editing !== undefined ? { id: editing } : {}),
      name: byId<HTMLInputElement>("pfName").value.trim(),
      folder: byId<HTMLInputElement>("pfFolder").value.trim(),
      readDirs: lines(byId<HTMLTextAreaElement>("pfRead").value),
      writeDirs: lines(byId<HTMLTextAreaElement>("pfWrite").value),
      vault: byId<HTMLSelectElement>("pfVault").value as ProfileInput["vault"],
      vaultFolders: lines(byId<HTMLTextAreaElement>("pfVaultFolders").value),
      bash: byId<HTMLInputElement>("pfBash").checked,
      autoEdits: byId<HTMLInputElement>("pfAuto").checked,
      mcp: [...byId("pfMcp").querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value),
    };
    if (!profile.name || !profile.folder) return toast("Dá um nome ao perfil e escolhe a pasta de trabalho.");
    if (deps.send({ type: "profile-save", profile })) {
      toast("A guardar o perfil…");
      dialog.close();
    } else toast("Servidor offline.");
  };

  renderQueue();
  return { state, handle, profileOf, sectionHtml, bind, openEditor };
}
