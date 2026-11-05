import type { Dossier, DossierHolder } from "../../../shared/protocol";

/** Texto e estado do dossier para quem olha para o escritório: quem o tem, o que o prende e se a equipa espera por ti. */

export type Tone = "work" | "wait" | "blocked" | "done";

const NAMES: Readonly<Record<DossierHolder, string>> = { ceo: "o Atlas", mira: "a Mira", lena: "a Lena", user: "ti" };
const SHORT_NAMES: Readonly<Record<DossierHolder, string>> = { ceo: "Atlas", mira: "Mira", lena: "Lena", user: "Tu" };

export const holderName = (holder: DossierHolder): string => SHORT_NAMES[holder];

export interface DossierStatus {
  readonly tone: Tone;
  /** Quem tem o dossier e o que está a fazer, numa linha. */
  readonly headline: string;
  /** O que acontece a seguir. */
  readonly next: string;
}

export function statusOf(d: Dossier): DossierStatus {
  if (d.blocked) {
    const who = NAMES[d.holder];
    return {
      tone: "blocked",
      headline: `Parado com ${who}`,
      next: d.blocked.reason,
    };
  }
  switch (d.stage) {
    case "atlas":
      return { tone: "work", headline: "Com o Atlas, a planear", next: "A seguir: a Mira pesquisa." };
    case "research":
      return { tone: "work", headline: "Com a Mira, a pesquisar", next: "A seguir: a Lena redige a carta." };
    case "drafting":
      return d.pendingNote !== undefined
        ? { tone: "work", headline: "Com a Lena, a rever com a tua nota", next: "A seguir: volta à tua bandeja de revisão." }
        : { tone: "work", headline: "Com a Lena, a redigir a carta", next: "A seguir: fica na tua bandeja para a reveres." };
    case "review":
      return {
        tone: "wait",
        headline: `À tua espera: rascunho v${d.draftVersion} pronto`,
        next: "Aprova ou devolve à Lena com uma nota.",
      };
    case "approved":
      return { tone: "done", headline: "Aprovado (nada foi enviado)", next: "Podes abrir outro dossier." };
  }
}

/** A equipa está parada à espera de uma decisão tua. */
export const waitingForUser = (d: Dossier | null): boolean => d !== null && d.stage === "review" && !d.blocked;

export interface TimelineStep {
  readonly key: DossierHolder;
  readonly label: string;
  readonly state: "done" | "active" | "todo" | "blocked";
}

const ORDER: readonly DossierHolder[] = ["ceo", "mira", "lena", "user"];
const STAGE_HOLDER = { atlas: 0, research: 1, drafting: 2, review: 3, approved: 4 } as const;

/** Atlas, Mira, Lena e tu: quem já fez a sua parte, quem tem o dossier agora e quem ainda não pegou nele. */
export function timelineOf(d: Dossier): TimelineStep[] {
  const at = STAGE_HOLDER[d.stage];
  return ORDER.map((key, i): TimelineStep => {
    if (i < at) return { key, label: SHORT_NAMES[key], state: "done" };
    if (i === at) return { key, label: SHORT_NAMES[key], state: d.blocked ? "blocked" : "active" };
    return { key, label: SHORT_NAMES[key], state: "todo" };
  });
}

/** Texto curto do ícone flutuante por cima do dossier na cena. */
export function sceneLabel(d: Dossier): { readonly title: string; readonly line: string } {
  const s = statusOf(d);
  const line =
    d.blocked !== undefined
      ? "parado: precisa de ajuda"
      : d.stage === "review"
        ? "à tua espera"
        : d.stage === "approved"
          ? "aprovado"
          : `com ${NAMES[d.holder]}`;
  return { title: d.title, line: s.tone === "blocked" ? "parado: precisa de ajuda" : line };
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Linha do HUD (sempre visível por cima do mapa). */
export function chipText(d: Dossier): string {
  const s = statusOf(d);
  return `${clip(d.title, 34)} · ${s.tone === "blocked" ? "parado" : s.tone === "wait" ? "à tua espera" : s.tone === "done" ? "aprovado" : s.headline.replace(/^Com /, "com ")}`;
}

/** Excerto da pesquisa para o cartão (o texto completo fica num bloco que se abre). */
export function findingsPreview(findings: string | undefined, max = 360): string {
  if (!findings) return "";
  const plain = findings
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clip(plain, max);
}

/** Estado do quadro da sala de Gestão: o que se lê de relance, sem abrir o cartão. */
export interface BoardView {
  readonly tone: Tone | "empty";
  /** A linha mais importante (grande): quem tem o dossier ou o que se espera de ti. */
  readonly headline: string;
  readonly title: string;
  /** O que está a acontecer, em poucas palavras. */
  readonly lines: readonly string[];
  /** Pista pequena no fundo do quadro. */
  readonly hint: string;
}

const WHERE_BLOCKED = { atlas: "no planeamento do Atlas", research: "na pesquisa da Mira", drafting: "na redação da Lena" } as const;

const DOING: Readonly<Record<"atlas" | "research" | "drafting", string>> = {
  atlas: "A planear o dossier",
  research: "A pesquisar a empresa",
  drafting: "A redigir a carta",
};

export function boardView(d: Dossier | null): BoardView {
  if (!d) return { tone: "empty", headline: "Sem dossier ativo", title: "", lines: [], hint: "Abre um em 📁 Dossier" };
  const title = clip(d.title, 40);
  if (d.blocked) {
    return {
      tone: "blocked",
      headline: "Parado",
      title,
      lines: [`Parado ${WHERE_BLOCKED[d.blocked.stage]}`, clip(d.blocked.reason, 90)],
      hint: "Abre o cartão para tentar outra vez",
    };
  }
  if (d.stage === "review") {
    const revised = d.reviews.some((r) => r.kind === "returned");
    return {
      tone: "wait",
      headline: "À tua espera",
      title,
      lines: [`Rascunho v${d.draftVersion} · ${revised ? "revisto" : "primeira versão"}`],
      hint: "Abre o cartão para aprovar ou devolver",
    };
  }
  if (d.stage === "approved") {
    return { tone: "done", headline: "Aprovado", title, lines: ["Nada foi enviado"], hint: "Abre o cartão ou começa outro dossier" };
  }
  const doing = d.stage === "drafting" && d.pendingNote !== undefined ? "A rever com a tua nota" : DOING[d.stage];
  return { tone: "work", headline: `Com ${NAMES[d.holder]}`, title, lines: [doing], hint: "Em curso" };
}
