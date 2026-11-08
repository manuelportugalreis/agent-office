import { stateOf, type Agent, type DisplayState } from "../sim/agent";
import { escapeHtml } from "./dom";

/**
 * A equipa num relance, sem procurar no 3D: cada agente com o que está a fazer (a trabalhar, à espera de ti, erro ou
 * livre). Clicar abre o Claude Code dele. As idas ao café ou ao ginásio contam como "livre": aqui interessa o trabalho.
 */

export type TeamStatus = "work" | "wait" | "err" | "free";

export interface TeamMember {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  /** Função numa palavra ou duas (ex.: "Analista"). */
  readonly role: string;
  readonly state: DisplayState;
  /** Agente real (com servidor ligado): só esses abrem o Claude Code. */
  readonly real: boolean;
}

const LABEL: Record<TeamStatus, string> = {
  work: "A trabalhar",
  wait: "À espera de ti",
  err: "Erro",
  free: "Livre",
};

export function teamStatus(state: DisplayState): TeamStatus {
  if (state === "work" || state === "think") return "work";
  if (state === "appr") return "wait";
  if (state === "err") return "err";
  return "free";
}

/** HTML da lista (os que esperam por ti primeiro, depois os que trabalham, depois o resto, pela ordem da equipa). */
export function teamHtml(members: readonly TeamMember[]): string {
  const rank: Record<TeamStatus, number> = { wait: 0, err: 1, work: 2, free: 3 };
  const sorted = members.map((m, i) => ({ m, i, s: teamStatus(m.state) })).sort((a, b) => rank[a.s] - rank[b.s] || a.i - b.i);
  const busy = sorted.filter((x) => x.s === "work").length;
  const waiting = sorted.filter((x) => x.s === "wait").length;
  const head = `<div class="team-head">Equipa<small>${busy} a trabalhar${waiting ? ` · ${waiting} à tua espera` : ""}</small></div>`;
  const rows = sorted
    .map(
      ({ m, s }) =>
        `<button type="button" class="team-row is-${s}" data-agent="${escapeHtml(m.id)}"${m.real ? "" : " disabled"} title="${escapeHtml(
          `${m.name} · ${m.role}${m.real ? " · abrir o Claude Code" : " · servidor desligado"}`,
        )}"><span class="team-emoji" aria-hidden="true">${escapeHtml(m.emoji)}</span><span class="team-name">${escapeHtml(
          m.name,
        )}</span><span class="team-state"><i aria-hidden="true"></i>${LABEL[s]}</span></button>`,
    )
    .join("");
  return head + rows;
}

export interface TeamBar {
  /** Volta a desenhar (só toca no DOM se algo mudou). */
  refresh(): void;
}

export function createTeamBar(host: HTMLElement, list: () => readonly TeamMember[], open: (id: string) => void): TeamBar {
  let last = "";
  host.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-agent]");
    if (row && !row.disabled) open(row.dataset.agent ?? "");
  });
  return {
    refresh() {
      const html = teamHtml(list());
      if (html === last) return;
      last = html;
      host.innerHTML = html;
    },
  };
}

/** A equipa tal como a barra a mostra: nome, emoji, função curta, estado e se o terminal se pode abrir. */
export function teamMembers(agents: readonly Agent[], isReal: (id: string) => boolean): TeamMember[] {
  return agents.map((a) => ({
    id: a.def.id,
    name: a.def.name,
    emoji: a.def.emoji,
    role: a.role.split("·")[0]?.trim() ?? "",
    state: stateOf(a),
    real: isReal(a.def.id),
  }));
}
