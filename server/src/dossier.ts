import type { Dossier, DossierReview, ServerMsg } from "../../shared/protocol.ts";
import type { Approvals } from "./approvals.ts";
import {
  checkPrompt,
  draftPrompt,
  jsonFixPrompt,
  materialsOf,
  notesOf,
  parseCheck,
  parseDraft,
  profileOf,
  renderEvidence,
} from "./dossier-review.ts";
import {
  formatFixPrompt,
  KIND_LABEL,
  needsClarification,
  parseResearch,
  renderResearch,
  researchInputOf,
  researchPrompt,
  todayOf,
  urlsIn,
} from "./dossier-research.ts";
import type { Hub, RunResult } from "./hub.ts";
import { withHandoff } from "./orchestrator.ts";
import type { Store } from "./store.ts";

/**
 * O dossier de candidatura: um processo que passa de mão em mão (Atlas, Mira, Lena, Nina e tu).
 * A Mira entrega uma pesquisa validada; a Lena escreve a partir dela e do perfil; a Nina verifica a carta contra a MESMA
 * pesquisa e a MESMA evidência antes de ela chegar à tua bandeja. O fluxo corre nos agentes reais; a cena 3D só o acompanha
 * (nada espera por uma personagem acabar de andar). Só há um dossier ativo. Aprovar regista a decisão: nada é enviado.
 */

const MAX_TITLE = 60;
const MAX_BRIEF = 1500;
const MAX_FINDINGS = 6000;
const MAX_DRAFT = 8000;
const MAX_NOTE = 1000;
const MAX_ANSWER = 1500;
const MAX_HISTORY = 60;
const MAX_REVIEWS = 30;
const MAX_CHECKS = 6;
const MAX_LANGUAGE = 60;
/** A Nina devolve uma vez o rascunho à Lena com correções concretas; se o problema continuar, decides tu. */
const MAX_AUTO_RETURNS = 1;
const DEFAULT_LANGUAGE = "português de Portugal";

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface DossierPlan {
  readonly title: string;
  readonly mira: string;
  readonly lena: string;
  readonly scope: "vaga" | "empresa";
  readonly language: string;
}

/** Pedido ao Atlas: título, âmbito, idioma e instruções para a Mira e para a Lena (JSON validado por `parseDossierPlan`). */
export function dossierPlanPrompt(request: string): string {
  return [
    "Vais abrir um dossier de candidatura. O dossier passa por ti, depois pela Mira (pesquisa), pela Lena (carta) e pela Nina (verificação), e por fim volta ao utilizador.",
    `Pedido do utilizador: «${request}»`,
    'Decide: um título curto (máximo 60 caracteres); o âmbito ("vaga" se quer uma carta para uma vaga concreta, "empresa" se pediu só pesquisa ou candidatura espontânea a uma empresa); o idioma da carta (o que o utilizador pediu; se não pediu, o do anúncio, ou português de Portugal); o que a Mira deve pesquisar; e como a Lena deve redigir a carta (tom e ênfase; só factos da pesquisa e do perfil do utilizador).',
    'Responde APENAS com um objeto JSON, sem mais texto: {"title":"...","scope":"vaga | empresa","language":"...","mira":"instrução completa e autónoma","lena":"instrução completa e autónoma"}',
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
  const { title, mira, lena, scope, language } = data as Record<string, unknown>;
  if (typeof title !== "string" || typeof mira !== "string" || typeof lena !== "string") return null;
  if (!oneLine(title) || !mira.trim() || !lena.trim()) return null;
  return {
    title: clip(oneLine(title), MAX_TITLE),
    mira: clip(mira.trim(), MAX_BRIEF),
    lena: clip(lena.trim(), MAX_BRIEF),
    scope: scope === "empresa" ? "empresa" : "vaga",
    language: typeof language === "string" && oneLine(language) ? clip(oneLine(language), MAX_LANGUAGE) : DEFAULT_LANGUAGE,
  };
}

export const shortTitle = (request: string): string => clip(oneLine(request) || "Dossier de candidatura", MAX_TITLE);

const COMPANY_ONLY = /\b(s[óo]\s+(a\s+)?empresa|apenas\s+(a\s+)?empresa|candidatura\s+espont[âa]nea|only\s+the\s+company)\b/i;
const ENGLISH = /\b(em\s+ingl[êe]s|in\s+english|english\s+letter)\b/i;

export function fallbackPlan(request: string): DossierPlan {
  return {
    title: shortTitle(request),
    scope: COMPANY_ONLY.test(request) ? "empresa" : "vaga",
    language: ENGLISH.test(request) ? "inglês" : DEFAULT_LANGUAGE,
    mira: `Pesquisa o seguinte para uma candidatura: ${request}. Indica fontes, o que a vaga pede e como o utilizador se pode destacar. Se não encontrares algo, di-lo.`,
    lena: `Escreve uma carta de motivação curta (até 250 palavras), em rascunho, para: ${request}. Usa só os factos da pesquisa da Mira e do perfil do utilizador.`,
  };
}

/** Pedido à Lena para rever um rascunho de um dossier antigo (sem pesquisa estruturada) com a nota do utilizador. */
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

/** Pode aprovar-se: a Nina verificou e passou (ou é um dossier antigo, de antes da verificação existir). */
export const canApprove = (d: Dossier): boolean => d.stage === "review" && (d.check === undefined || d.check.passed);

export interface DossierService {
  /** Abre um dossier novo e corre o fluxo até à revisão (ou até parar num bloqueio ou numa pergunta para ti). */
  start(request: string, materials?: string): Promise<void>;
  /** Devolve o rascunho à Lena com uma nota e corre a revisão (e a verificação da Nina). */
  returnDraft(id: number, note: string): Promise<void>;
  /** Responde à pergunta da Mira (ou continua só com a empresa) e retoma a pesquisa. */
  answer(id: number, answer: string, companyOnly?: boolean): Promise<void>;
  /** Aprova o rascunho que passou na Nina: regista a decisão (nada é enviado). */
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
  /** O perfil partilhado do utilizador (`_company/perfil.md`). */
  readonly readProfile?: () => string;
  readonly now?: () => number;
}

type Step = "atlas" | "research" | "drafting" | "checking";

export function createDossierService({ hub, store, approvals, emit, readProfile = () => "", now = Date.now }: DossierDeps): DossierService {
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
  if (current && !current.blocked && !current.clarification) {
    const running =
      current.stage === "atlas" || current.stage === "research" || current.stage === "drafting" || current.stage === "checking";
    if (running) block(current.stage as Step, "O servidor reiniciou durante este passo. Tenta outra vez.");
  }

  const label = (d: Dossier): string => `Dossier: ${d.title}`;

  async function planStep(): Promise<boolean> {
    const d = current as Dossier;
    commit({ stage: "atlas", holder: "ceo", blocked: undefined });
    const result = await hub.run("ceo", dossierPlanPrompt(d.request), { silent: true, isolated: true, label: label(d) });
    if (!result.ok) {
      block("atlas", `O Atlas não conseguiu planear: ${friendly(result.error)}`);
      return false;
    }
    const plan = parseDossierPlan(result.reply) ?? fallbackPlan(d.request);
    commit(
      { title: plan.title, scope: plan.scope, language: plan.language, briefs: { mira: plan.mira, lena: plan.lena } },
      "O Atlas atribuiu a pesquisa à Mira",
    );
    return true;
  }

  /** Corre um agente que tem de responder num formato; se vier mal, pede a correção uma vez. */
  async function runStructured<T>(
    agent: string,
    prompt: string,
    d: Dossier,
    parse: (reply: string) => { ok: true; value: T } | { ok: false; reason: string },
    fixPrompt: (reason: string, previous: string) => string,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string; raw: string }> {
    const first: RunResult = await hub.run(agent, prompt, { label: label(d), skipComplete: true });
    if (!first.ok) return { ok: false, reason: friendly(first.error), raw: "" };
    const parsed = parse(first.reply);
    if (parsed.ok) return parsed;
    const second: RunResult = await hub.run(agent, fixPrompt(parsed.reason, first.reply), {
      label: `${label(d)} (formato)`,
      skipComplete: true,
    });
    if (!second.ok) return { ok: false, reason: friendly(second.error), raw: first.reply };
    const again = parse(second.reply);
    return again.ok ? again : { ok: false, reason: again.reason, raw: second.reply };
  }

  async function researchStep(): Promise<"continue" | "stop"> {
    const d = current as Dossier;
    commit(
      { stage: "research", holder: "mira", blocked: undefined, clarification: undefined },
      d.answers?.length ? "A Mira retomou a pesquisa com a tua resposta" : "A Mira está a pesquisar",
    );
    emit({ type: "delegate", from: "ceo", to: "mira" });
    const prompt = researchPrompt(researchInputOf(d, d.briefs?.mira ?? fallbackPlan(d.request).mira, todayOf(now())));
    const result = await runStructured(
      "mira",
      prompt,
      d,
      (reply) => {
        const r = parseResearch(reply);
        return r.ok ? { ok: true, value: r.brief } : r;
      },
      formatFixPrompt,
    );
    if (!result.ok) {
      if (result.raw) commit({ findings: clip(result.raw, MAX_FINDINGS) });
      block(
        "research",
        result.raw ? `A Mira entregou a pesquisa sem o formato pedido (${result.reason}).` : `A pesquisa da Mira falhou: ${result.reason}`,
      );
      return "stop";
    }
    const brief = result.value;
    commit({ research: brief, findings: renderResearch(brief) }, `A Mira entregou a pesquisa: ${KIND_LABEL[brief.kind]}`);
    if (needsClarification(brief, d.scope ?? "vaga")) {
      const questions = brief.clarifications.length
        ? brief.clarifications
        : ["Qual é a vaga concreta (cargo ou link do anúncio)? Ou queres continuar só com a empresa?"];
      commit(
        { holder: "user", clarification: { questions, reason: KIND_LABEL[brief.kind] } },
        "A Mira precisa de uma resposta tua antes de a Lena escrever",
      );
      return "stop";
    }
    return "continue";
  }

  /** Dossier antigo (sem pesquisa estruturada): a Lena revê o rascunho como antes, sem verificação da Nina. */
  async function legacyDraftStep(d: Dossier): Promise<void> {
    const revising = d.pendingNote !== undefined && d.draft !== undefined;
    const brief = d.briefs?.lena ?? fallbackPlan(d.request).lena;
    commit(
      { stage: "drafting", holder: "lena", blocked: undefined },
      revising ? "A Lena está a rever o rascunho com a tua nota" : "A Lena recebeu os resultados da Mira e está a redigir",
    );
    if (!revising) emit({ type: "delegate", from: "mira", to: "lena" });
    const prompt = revising
      ? revisionPrompt(brief, d.draft as string, d.draftVersion, d.pendingNote as string)
      : withHandoff(brief, [{ agent: "mira", reply: d.findings ?? "" }]);
    const result = await hub.run("lena", prompt, { label: label(d), skipComplete: true });
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

  async function draftStep(): Promise<boolean> {
    const d = current as Dossier;
    if (!d.research) {
      if (d.findings) {
        await legacyDraftStep(d);
        return false;
      }
      block("research", "Faltam os resultados da Mira.");
      return false;
    }
    const corrections = d.pendingCorrections ?? [];
    const mode = corrections.length ? "auto" : d.pendingNote !== undefined && d.draft !== undefined ? "user" : "first";
    // O perfil usado fica guardado: a Nina verifica contra exatamente a mesma evidência que a Lena viu.
    const profile = mode === "auto" && d.profileSnapshot !== undefined ? d.profileSnapshot : profileOf(readProfile());
    const evidence = renderEvidence({ profile, materials: materialsOf(d.materials ?? ""), answers: d.answers ?? [], notes: notesOf(d) });
    commit(
      { stage: "drafting", holder: "lena", blocked: undefined, profileSnapshot: profile },
      mode === "auto"
        ? "A Lena está a corrigir o rascunho com as indicações da Nina"
        : mode === "user"
          ? "A Lena está a rever o rascunho com a tua nota"
          : "A Lena recebeu a pesquisa da Mira e está a redigir",
    );
    if (mode === "first") emit({ type: "delegate", from: "mira", to: "lena" });
    if (mode === "auto") emit({ type: "delegate", from: "nina", to: "lena" });
    const prompt = draftPrompt({
      atlasBrief: d.briefs?.lena ?? fallbackPlan(d.request).lena,
      language: d.language ?? DEFAULT_LANGUAGE,
      brief: d.research,
      evidence,
      ...(mode !== "first" ? { previousDraft: d.draft, previousVersion: d.draftVersion } : {}),
      ...(mode === "user" ? { userNote: d.pendingNote } : {}),
      ...(mode === "auto" ? { corrections } : {}),
    });
    const result = await runStructured(
      "lena",
      prompt,
      d,
      (reply) => {
        const parsed = parseDraft(reply);
        return parsed && !parsed.fallback
          ? { ok: true, value: parsed }
          : { ok: false, reason: parsed ? "a resposta não vem em JSON com a carta, as perguntas e as evidências" : "a carta está vazia" };
      },
      (reason, previous) => jsonFixPrompt(reason, previous, "draft"),
    );
    if (!result.ok) {
      // Se a Lena escreveu a carta mas não no formato pedido, usa-se o texto (sem mapa de evidências) e a Nina verifica na mesma.
      const salvage = result.raw ? parseDraft(result.raw) : null;
      if (!salvage) {
        block("drafting", `A Lena não conseguiu redigir: ${result.reason}`);
        return false;
      }
      return finishDraft(d, salvage.letter, [], [], "Rascunho sem mapa de evidências");
    }
    return finishDraft(d, result.value.letter, result.value.claims, result.value.questions);
  }

  function finishDraft(d: Dossier, letter: string, claims: Dossier["claims"], questions: readonly string[], note?: string): boolean {
    const version = d.draftVersion + 1;
    commit(
      {
        draft: clip(letter, MAX_DRAFT),
        draftVersion: version,
        claims,
        questions,
        pendingNote: undefined,
        pendingCorrections: undefined,
        check: undefined,
        blocked: undefined,
      },
      `Rascunho v${version} escrito pela Lena${note ? ` (${note})` : ""}`,
    );
    return true;
  }

  async function checkStep(): Promise<"done" | "redraft"> {
    const d = current as Dossier;
    const research = d.research;
    if (!research || d.draft === undefined) {
      block("drafting", "Falta o rascunho ou a pesquisa para a Nina verificar.");
      return "done";
    }
    const afterAutoReturn = (d.autoReturns ?? 0) > 0;
    const profile = d.profileSnapshot ?? profileOf(readProfile());
    const evidence = renderEvidence({ profile, materials: materialsOf(d.materials ?? ""), answers: d.answers ?? [], notes: notesOf(d) });
    commit(
      { stage: "checking", holder: "nina", blocked: undefined },
      afterAutoReturn ? "A Nina está a verificar a versão corrigida" : "A Nina está a verificar o rascunho",
    );
    emit({ type: "delegate", from: "lena", to: "nina" });
    const prompt = checkPrompt({
      language: d.language ?? DEFAULT_LANGUAGE,
      brief: research,
      evidence,
      letter: d.draft,
      version: d.draftVersion,
      claims: d.claims ?? [],
      questions: d.questions ?? [],
      afterAutoReturn,
    });
    const result = await runStructured(
      "nina",
      prompt,
      d,
      (reply) => {
        const r = parseCheck(reply, d.draftVersion, now(), afterAutoReturn);
        return r.ok ? { ok: true, value: r.check } : r;
      },
      (reason, previous) => jsonFixPrompt(reason, previous, "check"),
    );
    if (!result.ok) {
      block("checking", `A Nina não conseguiu verificar o rascunho: ${result.reason}`);
      return "done";
    }
    const check = result.value;
    const checks = [...(d.checks ?? []), check].slice(-MAX_CHECKS);
    const blocking = check.issues.filter((i) => i.severity === "bloqueia");
    if (check.passed) {
      const approvalId = approvals.request("lena", `Dossier: ${d.title}`, d.draft);
      const pending = check.confirmations.length ? ` (${check.confirmations.length} facto(s) por confirmares)` : "";
      commit(
        { check, checks, stage: "review", holder: "user", approvalId, autoReturns: 0 },
        `A Nina verificou a v${d.draftVersion} e passou${pending}. Rascunho pronto para ti`,
      );
      emit({ type: "delegate", from: "nina", to: "tray" });
      return "done";
    }
    if ((d.autoReturns ?? 0) < MAX_AUTO_RETURNS) {
      commit(
        { check, checks, pendingCorrections: blocking, autoReturns: (d.autoReturns ?? 0) + 1 },
        `A Nina devolveu o rascunho v${d.draftVersion} à Lena com ${blocking.length} correção(ões)`,
      );
      return "redraft";
    }
    approvals.supersede("lena");
    commit(
      { check, checks, stage: "review", holder: "user", approvalId: undefined },
      `A Nina ainda vê ${blocking.length} problema(s) que bloqueiam a v${d.draftVersion}: precisam da tua decisão`,
    );
    emit({ type: "delegate", from: "nina", to: "tray" });
    return "done";
  }

  /** Corre os passos a partir de `from`; um erro inesperado também deixa o dossier bloqueado em vez de ficar a meio. */
  async function execute(from: Step): Promise<void> {
    busy = true;
    let step: Step = from;
    try {
      for (;;) {
        if (step === "atlas") {
          if (!(await planStep())) return;
          step = "research";
        }
        if (step === "research") {
          if ((await researchStep()) === "stop") return;
          step = "drafting";
        }
        if (step === "drafting") {
          if (!(await draftStep())) return;
          // Um dossier antigo que passou pelo caminho sem Nina já está em revisão.
          if ((current as Dossier).stage === "review") return;
          step = "checking";
        }
        if ((await checkStep()) === "done") return;
        step = "drafting";
      }
    } catch (err) {
      block(step, `Erro inesperado: ${friendly(err instanceof Error ? err.message : String(err))}`);
    } finally {
      busy = false;
    }
  }

  const find = (id: number): Dossier | null => (current && current.id === id ? current : null);

  return {
    current: () => current,

    async start(request, materials) {
      if (busy || (current && current.stage !== "approved" && !current.blocked)) {
        return complain("Já há um dossier em curso. Aprova-o ou resolve o bloqueio antes de abrir outro.");
      }
      if (current?.blocked) return complain("O dossier atual está bloqueado. Tenta outra vez esse passo antes de abrir outro.");
      if (["ceo", "mira", "lena", "nina"].some((id) => hub.isRunning(id)) || !hub.hasCapacity()) {
        return complain("O Atlas, a Mira, a Lena ou a Nina estão ocupados. Tenta daqui a pouco.");
      }
      const ts = now();
      const urls = urlsIn(request);
      const extra = materialsOf(materials ?? "");
      current = {
        id: (current?.id ?? 0) + 1,
        title: shortTitle(request),
        request,
        stage: "atlas",
        holder: "ceo",
        draftVersion: 0,
        ...(urls.length ? { sourceUrls: urls } : {}),
        ...(extra ? { materials: extra } : {}),
        reviews: [],
        history: [{ ts, text: "Pedido recebido pelo Atlas" }],
        createdAt: ts,
        updatedAt: ts,
      };
      store.saveDossier(current);
      emit({ type: "dossier", dossier: current });
      return execute("atlas");
    },

    async answer(id, answer, companyOnly = false) {
      const d = find(id);
      if (!d?.clarification || busy) return complain("Este dossier não está à espera de uma resposta tua.");
      const text = clip(answer.trim(), MAX_ANSWER);
      if (!text && !companyOnly) return complain("Escreve a resposta ou escolhe continuar só com a empresa.");
      const links = urlsIn(text);
      const answers = text ? [...(d.answers ?? []), text] : (d.answers ?? []);
      const sourceUrls = [...new Set([...(d.sourceUrls ?? []), ...links])].slice(0, 3);
      commit(
        {
          answers,
          sourceUrls,
          ...(companyOnly ? { scope: "empresa" as const } : {}),
          clarification: undefined,
          holder: "mira",
        },
        companyOnly ? "Escolheste continuar só com a empresa" : `Respondeste à Mira: «${clip(oneLine(text), 120)}»`,
      );
      return execute("research");
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
          autoReturns: 0,
          reviews: [...d.reviews, review].slice(-MAX_REVIEWS),
        },
        `Devolveste o rascunho v${d.draftVersion} à Lena: «${clip(oneLine(text), 120)}»`,
      );
      return execute("drafting");
    },

    approve(id) {
      const d = find(id);
      if (!d || d.stage !== "review" || busy) return complain("Este dossier não está à espera da tua aprovação.");
      if (!canApprove(d)) return complain("A Nina ainda vê problemas neste rascunho. Devolve-o à Lena com uma nota.");
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
