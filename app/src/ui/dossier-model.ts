import type { Dossier, DossierHolder, NinaCheck } from "../../../shared/protocol";

/** Texto e estado do dossier para quem olha para o escritório: quem o tem, o que o prende e se a equipa espera por ti. */

export type Tone = "work" | "wait" | "blocked" | "done";

const NAMES: Readonly<Record<DossierHolder, string>> = { ceo: "o Atlas", mira: "a Mira", lena: "a Lena", nina: "a Nina", user: "ti" };
const SHORT_NAMES: Readonly<Record<DossierHolder, string>> = { ceo: "Atlas", mira: "Mira", lena: "Lena", nina: "Nina", user: "Tu" };

export const holderName = (holder: DossierHolder): string => SHORT_NAMES[holder];

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A Nina verificou e não encontrou nada que bloqueie (ou é um dossier antigo, de antes da verificação). */
export const passedCheck = (d: Dossier): boolean => d.check === undefined || d.check.passed;

/** Há uma pergunta da Mira à espera de resposta tua. */
export const hasQuestion = (d: Dossier | null): boolean => d !== null && d.clarification !== undefined && !d.blocked;

/** A equipa está parada à espera de uma decisão ou de uma resposta tua. */
export const waitingForUser = (d: Dossier | null): boolean => d !== null && !d.blocked && (d.stage === "review" || hasQuestion(d));

/** Rascunho em revisão, mas a Nina ainda vê problemas: não pode aprovar-se, só devolver com uma nota. */
export const reviewHasProblems = (d: Dossier | null): boolean => d !== null && d.stage === "review" && !d.blocked && !passedCheck(d);

export interface DossierStatus {
  readonly tone: Tone;
  /** Quem tem o dossier e o que está a fazer, numa linha. */
  readonly headline: string;
  /** O que acontece a seguir. */
  readonly next: string;
}

export function statusOf(d: Dossier): DossierStatus {
  if (d.blocked) {
    return { tone: "blocked", headline: `Parado com ${NAMES[d.holder]}`, next: d.blocked.reason };
  }
  if (hasQuestion(d)) {
    return {
      tone: "wait",
      headline: "À tua espera: a Mira precisa de uma resposta",
      next: "Responde no cartão (ou continua só com a empresa).",
    };
  }
  switch (d.stage) {
    case "atlas":
      return { tone: "work", headline: "Com o Atlas, a planear", next: "A seguir: a Mira pesquisa." };
    case "research":
      return { tone: "work", headline: "Com a Mira, a pesquisar", next: "A seguir: a Lena redige a carta." };
    case "drafting":
      if (d.pendingCorrections?.length) {
        return { tone: "work", headline: "Com a Lena, a corrigir com a Nina", next: "A seguir: a Nina verifica outra vez." };
      }
      return d.pendingNote !== undefined
        ? { tone: "work", headline: "Com a Lena, a rever com a tua nota", next: "A seguir: a Nina verifica e volta à tua bandeja." }
        : { tone: "work", headline: "Com a Lena, a redigir a carta", next: "A seguir: a Nina verifica antes de chegar a ti." };
    case "checking":
      return { tone: "work", headline: "Com a Nina, a verificar o rascunho", next: "A seguir: fica na tua bandeja se passar." };
    case "review":
      return passedCheck(d)
        ? {
            tone: "wait",
            headline: `À tua espera: rascunho v${d.draftVersion} verificado`,
            next: "Aprova ou devolve à Lena com uma nota.",
          }
        : {
            tone: "blocked",
            headline: `À tua espera: a Nina ainda vê problemas na v${d.draftVersion}`,
            next: "Devolve à Lena com uma nota (não se pode aprovar assim).",
          };
    case "approved":
      return { tone: "done", headline: "Aprovado (nada foi enviado)", next: "Podes abrir outro dossier." };
  }
}

export interface TimelineStep {
  readonly key: DossierHolder;
  readonly label: string;
  readonly state: "done" | "active" | "wait" | "todo" | "blocked";
}

const ORDER: readonly DossierHolder[] = ["ceo", "mira", "lena", "nina", "user"];
const STAGE_INDEX = { atlas: 0, research: 1, drafting: 2, checking: 3, review: 4, approved: 5 } as const;

/** Atlas, Mira, Lena, Nina e tu: quem já fez a sua parte, quem tem o dossier agora e quem ainda não pegou nele. */
export function timelineOf(d: Dossier): TimelineStep[] {
  const at = STAGE_INDEX[d.stage];
  return ORDER.map((key, i): TimelineStep => {
    const label = SHORT_NAMES[key];
    if (i < at) return { key, label, state: "done" };
    if (i > at) return { key, label, state: "todo" };
    if (d.blocked) return { key, label, state: "blocked" };
    return { key, label, state: waitingForUser(d) ? "wait" : "active" };
  });
}

/** Texto curto do ícone flutuante por cima do dossier na cena. */
export function sceneLabel(d: Dossier): { readonly title: string; readonly line: string } {
  const line = d.blocked
    ? "parado: precisa de ajuda"
    : hasQuestion(d)
      ? "à tua espera: pergunta"
      : d.stage === "review"
        ? reviewHasProblems(d)
          ? "à tua espera: problemas"
          : "à tua espera"
        : d.stage === "approved"
          ? "aprovado"
          : `com ${NAMES[d.holder]}`;
  return { title: d.title, line };
}

/** Linha do HUD (sempre visível por cima do mapa). */
export function chipText(d: Dossier): string {
  const s = statusOf(d);
  if (d.blocked) return `${clip(d.title, 34)} · parado`;
  if (waitingForUser(d)) return `${clip(d.title, 34)} · à tua espera`;
  if (s.tone === "done") return `${clip(d.title, 34)} · aprovado`;
  return `${clip(d.title, 34)} · ${s.headline.replace(/^Com /, "com ")}`;
}

/** Excerto de um texto para o cartão (o completo fica num bloco que se abre). */
export function findingsPreview(findings: string | undefined, max = 360): string {
  if (!findings) return "";
  const plain = findings
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clip(plain, max);
}

/** As perguntas que ainda precisam da tua resposta: da Mira (vaga), da Lena (evidência em falta) e da Nina (factos a confirmar). */
export interface OpenQuestion {
  readonly from: "Mira" | "Lena" | "Nina";
  readonly text: string;
}

export function openQuestions(d: Dossier): OpenQuestion[] {
  const fromMira = (d.clarification?.questions ?? []).map((text): OpenQuestion => ({ from: "Mira", text }));
  // A Lena e a Nina só têm perguntas úteis para o rascunho atual.
  const draftIsCurrent = d.stage === "review" || d.stage === "checking" || d.stage === "approved";
  const fromLena = draftIsCurrent ? (d.questions ?? []).map((text): OpenQuestion => ({ from: "Lena", text })) : [];
  const fromNina = draftIsCurrent ? (d.check?.confirmations ?? []).map((text): OpenQuestion => ({ from: "Nina", text })) : [];
  return [...fromMira, ...fromLena, ...fromNina];
}

/** O que a Nina conferiu e o que encontrou, numa linha. */
export function checkSummary(check: NinaCheck | undefined): string {
  if (!check) return "";
  const blocking = check.issues.filter((i) => i.severity === "bloqueia").length;
  const optional = check.issues.length - blocking;
  const parts = [
    check.passed ? "Passou" : `${blocking} problema(s) que bloqueiam`,
    optional ? `${optional} sugestão(ões) de estilo` : "",
    check.confirmations.length ? `${check.confirmations.length} facto(s) por confirmares` : "",
  ].filter(Boolean);
  return parts.join(" · ");
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

const WHERE_BLOCKED = {
  atlas: "no planeamento do Atlas",
  research: "na pesquisa da Mira",
  drafting: "na redação da Lena",
  checking: "na verificação da Nina",
} as const;

const DOING = {
  atlas: "A planear o dossier",
  research: "A pesquisar a vaga",
  drafting: "A redigir a carta",
  checking: "A verificar o rascunho",
} as const;

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
  if (hasQuestion(d)) {
    return {
      tone: "wait",
      headline: "À tua espera",
      title,
      lines: ["A Mira precisa de uma resposta tua"],
      hint: "Abre o cartão para responder",
    };
  }
  if (d.stage === "review") {
    const revised = d.reviews.some((r) => r.kind === "returned");
    const version = `Rascunho v${d.draftVersion} · ${revised ? "revisto" : "primeira versão"}`;
    if (reviewHasProblems(d)) {
      return {
        tone: "blocked",
        headline: "À tua espera",
        title,
        lines: [version, "A Nina ainda vê problemas: devolve à Lena"],
        hint: "Abre o cartão para devolver com uma nota",
      };
    }
    const confirm = openQuestions(d).length;
    return {
      tone: "wait",
      headline: "À tua espera",
      title,
      lines: [version, d.check ? `Verificado pela Nina${confirm ? ` · ${confirm} pergunta(s) para ti` : ""}` : ""].filter(Boolean),
      hint: "Abre o cartão para aprovar ou devolver",
    };
  }
  if (d.stage === "approved") {
    return { tone: "done", headline: "Aprovado", title, lines: ["Nada foi enviado"], hint: "Abre o cartão ou começa outro dossier" };
  }
  if (d.stage === "drafting" && d.pendingCorrections?.length) {
    return { tone: "work", headline: `Com ${NAMES[d.holder]}`, title, lines: ["A corrigir com as indicações da Nina"], hint: "Em curso" };
  }
  const doing = d.stage === "drafting" && d.pendingNote !== undefined ? "A rever com a tua nota" : DOING[d.stage];
  return { tone: "work", headline: `Com ${NAMES[d.holder]}`, title, lines: [doing], hint: "Em curso" };
}
