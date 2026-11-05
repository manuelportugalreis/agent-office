import type { Dossier, DossierReview, ServerMsg } from "../../shared/protocol.ts";
import type { Approvals } from "./approvals.ts";
import type { Hub, RunResult } from "./hub.ts";
import { withHandoff } from "./orchestrator.ts";
import type { Store } from "./store.ts";

/**
 * O dossier de candidatura: um processo que passa de mão em mão (Atlas, Mira, Lena e tu).
 * O fluxo corre nos agentes reais; a cena 3D só o acompanha (nada espera por uma personagem acabar de andar).
 * Só há um dossier ativo. Aprovar regista a decisão: nada é enviado nem submetido.
 */

const MAX_TITLE = 60;
const MAX_BRIEF = 1500;
const MAX_FINDINGS = 6000;
const MAX_DRAFT = 8000;
const MAX_NOTE = 1000;
const MAX_HISTORY = 60;
const MAX_REVIEWS = 30;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface DossierPlan {
  readonly title: string;
  readonly mira: string;
  readonly lena: string;
}

/** Pedido ao Atlas: título e instruções para a Mira e para a Lena (JSON validado por `parseDossierPlan`). */
export function dossierPlanPrompt(request: string): string {
  return [
    "Vais abrir um dossier de candidatura. O dossier passa por ti, depois pela Mira (pesquisa) e pela Lena (carta), e por fim volta ao utilizador.",
    `Pedido do utilizador: «${request}»`,
    "Decide só isto: um título curto (máximo 60 caracteres); o que a Mira deve pesquisar (empresa ou vaga: o que fazem, cultura, notícias recentes, o que a vaga pede, fontes); e como a Lena deve redigir a carta (tom, ênfase, só factos da pesquisa e do perfil do utilizador, [PREENCHER] onde faltar informação).",
    'Responde APENAS com um objeto JSON, sem mais texto: {"title":"...","mira":"instrução completa e autónoma","lena":"instrução completa e autónoma"}',
  ].join("\n");
}

/** Lê a resposta do Atlas. Devolve null se o formato estiver errado (o fluxo usa então um plano por defeito). */
export function parseDossierPlan(reply: string): DossierPlan | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { title, mira, lena } = data as Record<string, unknown>;
  if (typeof title !== "string" || typeof mira !== "string" || typeof lena !== "string") return null;
  if (!oneLine(title) || !mira.trim() || !lena.trim()) return null;
  return { title: clip(oneLine(title), MAX_TITLE), mira: clip(mira.trim(), MAX_BRIEF), lena: clip(lena.trim(), MAX_BRIEF) };
}

export const shortTitle = (request: string): string => clip(oneLine(request) || "Dossier de candidatura", MAX_TITLE);

export function fallbackPlan(request: string): DossierPlan {
  return {
    title: shortTitle(request),
    mira: `Pesquisa o seguinte para uma candidatura: ${request}. Indica fontes, cultura, notícias recentes, o que a vaga pede e como o utilizador se pode destacar. Se não encontrares algo, di-lo.`,
    lena: `Escreve uma carta de motivação curta (até 250 palavras), em rascunho, para: ${request}. Usa só os factos da pesquisa da Mira e do perfil do utilizador; onde faltar informação escreve [PREENCHER].`,
  };
}

/** Pedido à Lena para rever o rascunho com a nota do utilizador. */
export function revisionPrompt(brief: string, draft: string, version: number, note: string): string {
  return [
    brief,
    "",
    `Rascunho anterior (versão ${version}):`,
    draft,
    "",
    `Nota do utilizador para esta revisão: «${note}»`,
    "",
    "Reescreve o rascunho completo aplicando a nota. Usa só factos que tens (pesquisa e perfil); onde faltar informação escreve [PREENCHER]. Responde só com o novo rascunho.",
  ].join("\n");
}

/** Motivo legível de uma falha do agente. */
const friendly = (error: string | undefined): string => oneLine(error ?? "erro desconhecido");

export interface DossierService {
  /** Abre um dossier novo e corre o fluxo até à revisão (ou até parar num bloqueio). */
  start(request: string): Promise<void>;
  /** Devolve o rascunho à Lena com uma nota e corre a revisão. */
  returnDraft(id: number, note: string): Promise<void>;
  /** Aprova o rascunho: regista a decisão (nada é enviado). */
  approve(id: number): void;
  /** Volta a tentar o passo que ficou bloqueado. */
  retry(id: number): Promise<void>;
  current(): Dossier | null;
}

export interface DossierDeps {
  readonly hub: Pick<Hub, "run" | "isRunning" | "hasCapacity">;
  readonly store: Pick<Store, "saveDossier" | "loadDossier">;
  readonly approvals: Pick<Approvals, "request" | "decide" | "supersede">;
  readonly emit: (m: ServerMsg) => void;
  readonly now?: () => number;
}

type Step = "atlas" | "research" | "drafting";

export function createDossierService({ hub, store, approvals, emit, now = Date.now }: DossierDeps): DossierService {
  let current: Dossier | null = store.loadDossier();
  /** Há um passo a correr neste servidor (impede ações em simultâneo sobre o mesmo dossier). */
  let busy = false;

  const complain = (message: string): void => emit({ type: "error", message });

  /** Altera o dossier (sem mutar o anterior), guarda-o e avisa as interfaces. */
  function commit(patch: Partial<Dossier>, event?: string): Dossier {
    if (!current) throw new Error("sem dossier");
    const ts = now();
    const history = event ? [...current.history, { ts, text: event }].slice(-MAX_HISTORY) : current.history;
    current = { ...current, ...patch, history, updatedAt: ts };
    store.saveDossier(current);
    emit({ type: "dossier", dossier: current });
    return current;
  }

  const block = (stage: Step, reason: string): void => {
    commit({ blocked: { stage, reason } }, `Bloqueado: ${reason}`);
  };

  // Um dossier que ficou a meio de um passo quando o servidor parou já não tem nenhum agente a trabalhar nele.
  if (current && (current.stage === "atlas" || current.stage === "research" || current.stage === "drafting") && !current.blocked) {
    block(current.stage, "O servidor reiniciou durante este passo. Tenta outra vez.");
  }

  async function planStep(): Promise<boolean> {
    const d = current as Dossier;
    commit({ stage: "atlas", holder: "ceo", blocked: undefined });
    const result = await hub.run("ceo", dossierPlanPrompt(d.request), { silent: true, isolated: true, label: `Dossier: ${d.title}` });
    if (!result.ok) {
      block("atlas", `O Atlas não conseguiu planear: ${friendly(result.error)}`);
      return false;
    }
    const plan = parseDossierPlan(result.reply) ?? fallbackPlan(d.request);
    commit({ title: plan.title, briefs: { mira: plan.mira, lena: plan.lena } }, "O Atlas atribuiu a pesquisa à Mira");
    return true;
  }

  async function researchStep(): Promise<boolean> {
    const d = current as Dossier;
    const brief = d.briefs?.mira ?? fallbackPlan(d.request).mira;
    commit({ stage: "research", holder: "mira", blocked: undefined }, "A Mira está a pesquisar");
    emit({ type: "delegate", from: "ceo", to: "mira" });
    const result: RunResult = await hub.run("mira", brief, { label: `Dossier: ${d.title}` });
    if (!result.ok || !result.reply.trim()) {
      block("research", `A pesquisa da Mira falhou: ${friendly(result.error ?? "sem resultados")}`);
      return false;
    }
    commit({ findings: clip(result.reply.trim(), MAX_FINDINGS) }, "A Mira entregou os resultados");
    return true;
  }

  async function draftStep(): Promise<void> {
    const d = current as Dossier;
    const revising = d.pendingNote !== undefined && d.draft !== undefined;
    if (!d.findings) return block("research", "Faltam os resultados da Mira.");
    const brief = d.briefs?.lena ?? fallbackPlan(d.request).lena;
    commit(
      { stage: "drafting", holder: "lena", blocked: undefined },
      revising ? "A Lena está a rever o rascunho com a tua nota" : "A Lena recebeu os resultados da Mira e está a redigir",
    );
    if (!revising) emit({ type: "delegate", from: "mira", to: "lena" });
    const prompt = revising
      ? revisionPrompt(brief, d.draft as string, d.draftVersion, d.pendingNote as string)
      : withHandoff(brief, [{ agent: "mira", reply: d.findings }]);
    const result = await hub.run("lena", prompt, { label: `Dossier: ${d.title}`, skipComplete: true });
    if (!result.ok || !result.reply.trim()) {
      block("drafting", `A Lena não conseguiu redigir: ${friendly(result.error ?? "sem texto")}`);
      return;
    }
    const version = d.draftVersion + 1;
    const draft = clip(result.reply.trim(), MAX_DRAFT);
    const approvalId = approvals.request("lena", `Dossier: ${d.title}`, draft);
    commit(
      { stage: "review", holder: "user", draft, draftVersion: version, approvalId, pendingNote: undefined, blocked: undefined },
      `Rascunho v${version} pronto para ti`,
    );
    emit({ type: "delegate", from: "lena", to: "tray" });
  }

  /** Corre os passos a partir de `from`; um erro inesperado também deixa o dossier bloqueado em vez de ficar a meio. */
  async function execute(from: Step): Promise<void> {
    busy = true;
    let step: Step = from;
    try {
      if (step === "atlas") {
        if (!(await planStep())) return;
        step = "research";
      }
      if (step === "research") {
        if (!(await researchStep())) return;
        step = "drafting";
      }
      await draftStep();
    } catch (err) {
      block(step, `Erro inesperado: ${friendly(err instanceof Error ? err.message : String(err))}`);
    } finally {
      busy = false;
    }
  }

  const find = (id: number): Dossier | null => (current && current.id === id ? current : null);

  return {
    current: () => current,

    async start(request) {
      if (busy || (current && current.stage !== "approved" && !current.blocked)) {
        return complain("Já há um dossier em curso. Aprova-o ou resolve o bloqueio antes de abrir outro.");
      }
      if (current?.blocked) return complain("O dossier atual está bloqueado. Tenta outra vez esse passo antes de abrir outro.");
      if (hub.isRunning("ceo") || hub.isRunning("mira") || hub.isRunning("lena") || !hub.hasCapacity()) {
        return complain("O Atlas, a Mira ou a Lena estão ocupados. Tenta daqui a pouco.");
      }
      const ts = now();
      current = {
        id: (current?.id ?? 0) + 1,
        title: shortTitle(request),
        request,
        stage: "atlas",
        holder: "ceo",
        draftVersion: 0,
        reviews: [],
        history: [{ ts, text: "Pedido recebido pelo Atlas" }],
        createdAt: ts,
        updatedAt: ts,
      };
      store.saveDossier(current);
      emit({ type: "dossier", dossier: current });
      return execute("atlas");
    },

    async returnDraft(id, note) {
      const d = find(id);
      const text = note.trim();
      if (!d || d.stage !== "review" || busy) return complain("Este dossier não está à espera da tua revisão.");
      if (!text) return complain("Escreve uma nota para a Lena.");
      const review: DossierReview = { ts: now(), kind: "returned", note: clip(text, MAX_NOTE), version: d.draftVersion };
      approvals.supersede("lena");
      commit(
        {
          stage: "drafting",
          holder: "lena",
          pendingNote: review.note,
          approvalId: undefined,
          reviews: [...d.reviews, review].slice(-MAX_REVIEWS),
        },
        `Devolveste o rascunho v${d.draftVersion} à Lena: «${clip(oneLine(text), 120)}»`,
      );
      return execute("drafting");
    },

    approve(id) {
      const d = find(id);
      if (!d || d.stage !== "review" || busy) return complain("Este dossier não está à espera da tua aprovação.");
      if (d.approvalId !== undefined) approvals.decide(d.approvalId, true);
      const review: DossierReview = { ts: now(), kind: "approved", version: d.draftVersion };
      commit(
        { stage: "approved", holder: "user", approvalId: undefined, reviews: [...d.reviews, review].slice(-MAX_REVIEWS) },
        `Aprovaste o rascunho v${d.draftVersion}. Nada foi enviado.`,
      );
    },

    async retry(id) {
      const d = find(id);
      if (!d?.blocked || busy) return complain("Este dossier não está bloqueado.");
      const stage = d.blocked.stage;
      commit({ blocked: undefined }, "A tentar outra vez");
      return execute(stage);
    },
  };
}
