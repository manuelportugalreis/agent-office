import { describe, expect, it } from "vitest";
import type { Dossier, ServerMsg } from "../../shared/protocol.ts";
import { canApprove, createDossierService, dossierPlanPrompt, fallbackPlan, parseDossierPlan, revisionPrompt } from "./dossier.ts";
import type { RunResult } from "./hub.ts";

type Script = Record<string, RunResult[]>;

const PLAN = JSON.stringify({
  title: "Candidatura ACME",
  scope: "vaga",
  language: "português de Portugal",
  mira: "Pesquisa a ACME",
  lena: "Escreve a carta para a ACME",
});
const ok = (reply: string): RunResult => ({ ok: true, reply });
const fail = (error: string): RunResult => ({ ok: false, reply: "", error });
const LISTING = "https://acme.com/careers/ba";
const PROFILE =
  "Mestrando em AI in Business numa universidade americana. Contribuí para a migração do ERP de uma empresa. Domino SQL e Power BI.";

const research = (patch: Record<string, unknown> = {}): RunResult =>
  ok(
    JSON.stringify({
      kind: "vaga_verificada",
      role: "Business Analyst",
      company: "ACME",
      sourceUrl: LISTING,
      checkedAt: "2026-11-05",
      mandatory: [
        { text: "SQL", source: LISTING },
        { text: "Kubernetes em produção", source: LISTING },
      ],
      desirable: [{ text: "Jira", source: LISTING }],
      findings: [{ text: "A ACME vende software de faturação", source: "https://acme.com/about", verified: true }],
      unknowns: ["Salário não indicado"],
      clarifications: [],
      summary: "Vaga remota de BA na ACME.",
      ...patch,
    }),
  );
const draft = (letter: string, extra: Record<string, unknown> = {}): RunResult =>
  ok(
    JSON.stringify({
      carta: letter,
      perguntas: [],
      evidencias: [{ afirmacao: "Domina SQL", fonte: "PERFIL", detalhe: "perfil" }],
      ...extra,
    }),
  );
const check = (problemas: unknown[] = [], confirmacoes: string[] = []): RunResult =>
  ok(
    JSON.stringify({ verificado: ["Cargo e empresa", "Requisitos obrigatórios", "Afirmações sobre o candidato"], problemas, confirmacoes }),
  );
const blocking = (frase: string) => ({
  gravidade: "bloqueia",
  frase,
  problema: "Sem sustento no perfil",
  correcao: "Remove ou escreve só o que o perfil diz",
});

/** Hub de mentira: devolve, por agente, os resultados combinados e regista o que lhe foi pedido. */
function setup(script: Script, saved: Dossier | null = null, profile = PROFILE) {
  const out: ServerMsg[] = [];
  const calls: { agent: string; text: string; opts?: Record<string, unknown> }[] = [];
  const approvalCalls: string[] = [];
  let stored: Dossier | null = saved;
  let clock = 1000;
  const hub = {
    isRunning: () => false,
    hasCapacity: () => true,
    run: async (agent: string, text: string, opts?: Record<string, unknown>): Promise<RunResult> => {
      calls.push({ agent, text, opts });
      const next = script[agent]?.shift();
      if (!next) throw new Error(`sem resultado combinado para ${agent}`);
      return next;
    },
  };
  let approvalId = 0;
  const approvals = {
    request: (agentId: string, title: string, d?: string) => {
      approvalCalls.push(`request:${agentId}:${title}:${d}`);
      return ++approvalId;
    },
    decide: (id: number, approved: boolean) => void approvalCalls.push(`decide:${id}:${approved}`),
    supersede: (agentId: string) => void approvalCalls.push(`supersede:${agentId}`),
  };
  const service = createDossierService({
    hub,
    approvals,
    store: { saveDossier: (d) => void (stored = d), loadDossier: () => stored },
    emit: (m) => out.push(m),
    readProfile: () => profile,
    now: () => (clock += 10),
  });
  const path = (): string[] => {
    const seq = out.flatMap((m) =>
      m.type === "dossier" && m.dossier ? [`${m.dossier.stage}/${m.dossier.holder}${m.dossier.blocked ? "!" : ""}`] : [],
    );
    return seq.filter((s, i) => s !== seq[i - 1]);
  };
  const delegates = (): string[] => out.flatMap((m) => (m.type === "delegate" ? [`${m.from}>${m.to}`] : []));
  const errors = (): string[] => out.flatMap((m) => (m.type === "error" ? [m.message] : []));
  const calledBy = (agent: string) => calls.filter((c) => c.agent === agent);
  return { service, out, calls, approvalCalls, path, delegates, errors, calledBy, stored: () => stored };
}

describe("dossier: vaga com anúncio original, carta verificada pela Nina", () => {
  it("passa de mão em mão e só chega à bandeja depois de a Nina verificar", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [draft("Carta v1 [PREENCHER]")],
      nina: [
        check(
          [{ gravidade: "opcional", frase: "Prezados,", problema: "Saudação genérica", correcao: "Usa o nome do recrutador" }],
          ["Confirma as datas do ERP"],
        ),
      ],
    });
    await t.service.start(`Candidatura à ACME: ${LISTING}`);
    expect(t.path()).toEqual(["atlas/ceo", "research/mira", "drafting/lena", "checking/nina", "review/user"]);
    expect(t.delegates()).toEqual(["ceo>mira", "mira>lena", "lena>nina", "nina>tray"]);
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({
      title: "Candidatura ACME",
      stage: "review",
      holder: "user",
      draftVersion: 1,
      scope: "vaga",
      language: "português de Portugal",
    });
    expect(d.research).toMatchObject({ kind: "vaga_verificada", sourceUrl: LISTING, checkedAt: "2026-11-05" });
    expect(d.sourceUrls).toEqual([LISTING]);
    expect(d.claims).toEqual([{ claim: "Domina SQL", source: "PERFIL", detail: "perfil" }]);
    expect(d.check).toMatchObject({ passed: true, version: 1, afterAutoReturn: false, confirmations: ["Confirma as datas do ERP"] });
    expect(d.check?.checked).toHaveLength(3);
    expect(d.findings).toContain(`Anúncio: ${LISTING}`);
    // A aprovação só é pedida quando a Nina passou, e uma só vez (o dossier trata disso, não a Lena).
    expect(t.approvalCalls).toEqual(["request:lena:Dossier: Candidatura ACME:Carta v1 [PREENCHER]"]);
    expect(t.calledBy("lena")[0].opts).toMatchObject({ skipComplete: true });
    expect(canApprove(d)).toBe(true);
    expect(t.stored()).toEqual(d);
  });

  it("a Mira recebe o link e a data; a Lena e a Nina recebem a MESMA pesquisa e a MESMA evidência", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [research()], lena: [draft("Carta")], nina: [check()] });
    await t.service.start(`Candidatura à ACME: ${LISTING}`);
    const mira = t.calledBy("mira")[0].text;
    expect(mira).toContain(LISTING);
    expect(mira).toContain("obrigatórios");
    const lena = t.calledBy("lena")[0].text;
    const nina = t.calledBy("nina")[0].text;
    for (const prompt of [lena, nina]) {
      expect(prompt).toContain("Kubernetes em produção");
      expect(prompt).toContain(`(fonte: ${LISTING})`);
      expect(prompt).toContain("[PERFIL]");
      expect(prompt).toContain("Contribuí para a migração do ERP");
    }
    expect(nina).toContain("Carta");
    expect(nina).toContain("Domina SQL [PERFIL: perfil]");
    expect((t.service.current() as Dossier).profileSnapshot).toContain("Contribuí para a migração do ERP");
  });

  it("devolver com uma nota: nova versão, verificada outra vez pela Nina antes de voltar a ti", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [draft("Carta v1"), draft("Carta v2 mais curta")],
      nina: [check(), check()],
    });
    await t.service.start("ACME");
    const id = (t.service.current() as Dossier).id;
    await t.service.returnDraft(id, "Mais curta e menos formal");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "review", holder: "user", draftVersion: 2, draft: "Carta v2 mais curta" });
    expect(d.reviews).toMatchObject([{ kind: "returned", note: "Mais curta e menos formal", version: 1 }]);
    expect(t.calledBy("nina")).toHaveLength(2);
    expect(t.calledBy("nina")[1].text).toContain("Carta v2 mais curta");
    expect(t.approvalCalls).toContain("supersede:lena");
    expect(t.approvalCalls.filter((c) => c.startsWith("request:"))).toHaveLength(2);
    // Ao devolver à Lena, o dossier passa por Lena e Nina antes de voltar à bandeja.
    expect(t.path().slice(-3)).toEqual(["drafting/lena", "checking/nina", "review/user"]);
  });

  it("aprovar regista a decisão e não envia nada", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [research()], lena: [draft("Carta")], nina: [check()] });
    await t.service.start("ACME");
    t.service.approve((t.service.current() as Dossier).id);
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "approved", holder: "user" });
    expect(d.reviews).toMatchObject([{ kind: "approved", version: 1 }]);
    expect(t.approvalCalls).toContain("decide:1:true");
    expect(d.history.at(-1)?.text).toBe("Aprovaste o rascunho v1. Nada foi enviado.");
  });
});

describe("dossier: anúncio indisponível ou ambíguo", () => {
  const ambiguous = research({
    kind: "vaga_ambigua",
    sourceUrl: null,
    mandatory: [],
    desirable: [],
    clarifications: ["Qual das duas vagas de analista (Lisboa ou Porto)?"],
    unknowns: ["Há duas vagas com o mesmo título"],
  });

  it("não escreve sobre uma vaga que ninguém confirmou: pede ao utilizador o que falta", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ambiguous] });
    await t.service.start("Analista na ACME");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({
      stage: "research",
      holder: "user",
      clarification: { questions: ["Qual das duas vagas de analista (Lisboa ou Porto)?"], reason: "Vaga ambígua" },
    });
    expect(d.blocked).toBeUndefined();
    expect(t.calledBy("lena")).toHaveLength(0);
    expect(t.calledBy("nina")).toHaveLength(0);
    expect(d.research?.unknowns).toEqual(["Há duas vagas com o mesmo título"]);
    expect(d.history.at(-1)?.text).toContain("precisa de uma resposta tua");
  });

  it("depois de responderes (com um link), a Mira retoma e o fluxo segue até à Nina", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ambiguous, research()], lena: [draft("Carta")], nina: [check()] });
    await t.service.start("Analista na ACME");
    const id = (t.service.current() as Dossier).id;
    await t.service.answer(id, `É a de Lisboa: ${LISTING}`);
    const mira2 = t.calledBy("mira")[1].text;
    expect(mira2).toContain("É a de Lisboa");
    expect(mira2).toContain(LISTING);
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "review", answers: [`É a de Lisboa: ${LISTING}`], sourceUrls: [LISTING] });
    expect(d.clarification).toBeUndefined();
    // A resposta do utilizador entra na evidência da Lena e da Nina.
    expect(t.calledBy("nina")[0].text).toContain("[RESPOSTA]");
  });

  it("'continuar só com a empresa' muda o âmbito e aceita uma pesquisa só da empresa", async () => {
    const companyOnly = research({ kind: "so_empresa", role: "", sourceUrl: null, mandatory: [], desirable: [] });
    const t = setup({ ceo: [ok(PLAN)], mira: [ambiguous, companyOnly], lena: [draft("Carta espontânea")], nina: [check()] });
    await t.service.start("Analista na ACME");
    await t.service.answer((t.service.current() as Dossier).id, "", true);
    expect(t.service.current()).toMatchObject({ scope: "empresa", stage: "review" });
    expect(t.calledBy("mira")[1].text).toContain("so_empresa");
  });

  it("quando o utilizador pediu só a empresa, 'só a empresa' é válido logo à primeira", async () => {
    const plan = JSON.stringify({ title: "ACME", scope: "empresa", language: "inglês", mira: "m", lena: "l" });
    const t = setup({
      ceo: [ok(plan)],
      mira: [research({ kind: "so_empresa", role: "", sourceUrl: null, mandatory: [], desirable: [] })],
      lena: [draft("Cover letter")],
      nina: [check()],
    });
    await t.service.start("Candidatura espontânea à ACME");
    expect(t.service.current()).toMatchObject({ scope: "empresa", language: "inglês", stage: "review" });
    expect(t.calledBy("lena")[0].text).toContain("Idioma da carta: inglês.");
  });

  it("uma pesquisa sem o formato pedido é corrigida uma vez; se continuar mal fica bloqueada com o texto guardado", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ok("A ACME parece ótima!"), research()], lena: [draft("Carta")], nina: [check()] });
    await t.service.start("ACME");
    expect(t.calledBy("mira")).toHaveLength(2);
    expect(t.calledBy("mira")[1].text).toContain("não passou na validação");
    expect(t.service.current()?.stage).toBe("review");
    const bad = setup({ ceo: [ok(PLAN)], mira: [ok("só texto"), ok("ainda só texto")] });
    await bad.service.start("ACME");
    const d = bad.service.current() as Dossier;
    expect(d.blocked).toMatchObject({ stage: "research" });
    expect(d.blocked?.reason).toContain("sem o formato pedido");
    expect(d.findings).toBe("ainda só texto");
    expect(bad.calledBy("lena")).toHaveLength(0);
  });

  it("uma vaga 'verificada' sem requisitos com fonte não passa a passagem de mão", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research({ mandatory: [{ text: "SQL" }] }), research({ mandatory: [{ text: "SQL" }] })],
    });
    await t.service.start("ACME");
    expect(t.service.current()?.blocked?.reason).toContain("fonte");
    expect(t.calledBy("lena")).toHaveLength(0);
  });
});

describe("dossier: competência que o perfil não sustenta", () => {
  const kube = "Tenho experiência sólida com Kubernetes em produção.";

  it("a Nina bloqueia, a Lena corrige uma vez com as indicações dela e o rascunho passa", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [
        draft(`Domino SQL. ${kube}`),
        draft("Domino SQL.", { perguntas: ["Tens alguma experiência com Kubernetes? Em que projeto?"] }),
      ],
      nina: [check([blocking(kube)]), check([], [])],
    });
    await t.service.start("ACME");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "review", draftVersion: 2, draft: "Domino SQL." });
    expect(d.checks).toHaveLength(2);
    expect(d.check).toMatchObject({ passed: true, afterAutoReturn: true, version: 2 });
    expect(d.checks?.[0]).toMatchObject({ passed: false, version: 1 });
    expect(d.questions).toEqual(["Tens alguma experiência com Kubernetes? Em que projeto?"]);
    const fix = t.calledBy("lena")[1].text;
    expect(fix).toContain(kube);
    expect(fix).toContain("A Nina (revisora independente) pediu estas correções");
    expect(t.calledBy("nina")[1].text).toContain("segunda verificação");
    // Nunca esteve na fila de aprovação enquanto havia um problema que bloqueia.
    expect(t.approvalCalls.filter((c) => c.startsWith("request:"))).toEqual(["request:lena:Dossier: Candidatura ACME:Domino SQL."]);
    expect(t.delegates()).toContain("nina>lena");
    expect(t.path()).toEqual([
      "atlas/ceo",
      "research/mira",
      "drafting/lena",
      "checking/nina",
      "drafting/lena",
      "checking/nina",
      "review/user",
    ]);
  });

  it("se o problema continua depois da devolução, não vai para a fila de aprovação: tu decides, devolvendo com uma nota", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [draft(`SQL. ${kube}`), draft(`SQL. ${kube}`), draft("SQL. Contribuí para a migração do ERP.")],
      nina: [check([blocking(kube)]), check([blocking(kube)]), check()],
    });
    await t.service.start("ACME");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "review", holder: "user", draftVersion: 2 });
    expect(d.check).toMatchObject({ passed: false });
    expect(d.approvalId).toBeUndefined();
    expect(canApprove(d)).toBe(false);
    expect(t.approvalCalls.filter((c) => c.startsWith("request:"))).toHaveLength(0);
    expect(t.calledBy("lena")).toHaveLength(2);
    // Só uma devolução automática: não entra em ciclo.
    expect(t.calledBy("nina")).toHaveLength(2);
    // Aprovar fica bloqueado com uma mensagem clara.
    t.service.approve(d.id);
    expect(t.service.current()?.stage).toBe("review");
    expect(t.errors().at(-1)).toContain("A Nina ainda vê problemas");
    // O utilizador devolve com uma nota (um novo ciclo, com uma nova devolução automática possível) e passa.
    await t.service.returnDraft(d.id, "Tira a parte do Kubernetes");
    expect(t.service.current()).toMatchObject({ stage: "review", draftVersion: 3, check: { passed: true } });
    expect(t.approvalCalls.filter((c) => c.startsWith("request:"))).toHaveLength(1);
  });

  it("a Nina só bloqueia por factos; sugestões de estilo e factos por confirmar não impedem a bandeja", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [draft("Carta")],
      nina: [
        check(
          [{ gravidade: "opcional", frase: "Prezados,", problema: "Genérica", correcao: "Personaliza" }],
          ["Confirma o ano da migração"],
        ),
      ],
    });
    await t.service.start("ACME");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "review", check: { passed: true } });
    expect(d.check?.issues).toHaveLength(1);
    expect(d.check?.confirmations).toEqual(["Confirma o ano da migração"]);
    expect(t.calledBy("lena")).toHaveLength(1);
  });
});

describe("dossier: revisão do utilizador que traz um facto novo", () => {
  it("o facto da nota entra na evidência (fonte NOTA) para a Lena e para a Nina, e a Nina pede que o confirmes", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [
        draft("Contribuí para a migração do ERP."),
        draft("Liderei a migração do ERP.", { evidencias: [{ afirmacao: "Liderou a migração do ERP", fonte: "NOTA", detalhe: "v1" }] }),
      ],
      nina: [check(), check([], ["A migração do ERP: confirmas que a lideraste (o perfil só diz que contribuíste)?"])],
    });
    await t.service.start("ACME");
    const id = (t.service.current() as Dossier).id;
    const profileBefore = (t.service.current() as Dossier).profileSnapshot;
    await t.service.returnDraft(id, "Diz que liderei a migração do ERP");
    const lena = t.calledBy("lena")[1].text;
    const nina = t.calledBy("nina")[1].text;
    for (const prompt of [lena, nina]) {
      expect(prompt).toContain("[NOTA]");
      expect(prompt).toContain("v1: Diz que liderei a migração do ERP");
      expect(prompt).toContain("Contribuí para a migração do ERP");
    }
    expect(lena).toContain("fonte NOTA");
    expect(nina).toContain("Liderou a migração do ERP [NOTA: v1]");
    const d = t.service.current() as Dossier;
    // Não bloqueia (o facto veio do utilizador), mas fica visível para ele confirmar.
    expect(d).toMatchObject({ stage: "review", draftVersion: 2, check: { passed: true } });
    expect(d.check?.confirmations[0]).toContain("confirmas que a lideraste");
    expect(d.profileSnapshot).toBe(profileBefore);
  });

  it("se a Lena reforçar um facto que nem a nota sustenta, a Nina bloqueia e a Lena é obrigada a corrigir", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [draft("Carta v1"), draft("Liderei toda a transformação digital da empresa."), draft("Liderei a migração do ERP.")],
      nina: [check(), check([blocking("Liderei toda a transformação digital da empresa.")]), check()],
    });
    await t.service.start("ACME");
    await t.service.returnDraft((t.service.current() as Dossier).id, "Diz que liderei a migração do ERP");
    expect(t.calledBy("lena")).toHaveLength(3);
    expect(t.calledBy("lena")[2].text).toContain("Liderei toda a transformação digital da empresa.");
    expect(t.service.current()).toMatchObject({
      stage: "review",
      draftVersion: 3,
      draft: "Liderei a migração do ERP.",
      check: { passed: true, afterAutoReturn: true },
    });
  });
});

describe("dossier: falhas e retoma", () => {
  it("a Nina responde mal duas vezes: o dossier fica bloqueado na verificação e tentar outra vez retoma só a verificação", async () => {
    const t = setup({
      ceo: [ok(PLAN)],
      mira: [research()],
      lena: [draft("Carta")],
      nina: [ok("Está bom."), ok("Está bom mesmo."), check()],
    });
    await t.service.start("ACME");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "checking", holder: "nina", blocked: { stage: "checking" }, draftVersion: 1 });
    expect(d.blocked?.reason).toContain("A Nina não conseguiu verificar");
    expect(t.approvalCalls).toHaveLength(0);
    await t.service.retry(d.id);
    expect(t.calledBy("lena")).toHaveLength(1);
    expect(t.calledBy("mira")).toHaveLength(1);
    expect(t.service.current()).toMatchObject({ stage: "review", check: { passed: true } });
  });

  it("pesquisa falhada: fica na Mira e tentar outra vez continua o fluxo", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [fail("Tempo máximo excedido."), research()], lena: [draft("Carta")], nina: [check()] });
    await t.service.start("ACME");
    const blocked = t.service.current() as Dossier;
    expect(blocked).toMatchObject({ stage: "research", holder: "mira", blocked: { stage: "research" } });
    expect(blocked.blocked?.reason).toContain("Tempo máximo excedido.");
    await t.service.retry(blocked.id);
    expect(t.service.current()).toMatchObject({ stage: "review" });
  });

  it("o Atlas falha: bloqueia no Atlas; uma resposta sem JSON usa o plano por defeito", async () => {
    const a = setup({ ceo: [fail("sem quota")] });
    await a.service.start("ACME");
    expect(a.service.current()).toMatchObject({ stage: "atlas", holder: "ceo", blocked: { stage: "atlas" } });
    const b = setup({ ceo: [ok("não sei fazer JSON")], mira: [research()], lena: [draft("Carta")], nina: [check()] });
    await b.service.start("Vaga de analista na Beta em inglês");
    expect(b.service.current()).toMatchObject({ stage: "review", language: "inglês", scope: "vaga" });
  });

  it("os materiais do utilizador entram na evidência", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [research()], lena: [draft("Carta")], nina: [check()] });
    await t.service.start("ACME", "Liderei uma equipa de 4 analistas em 2024");
    expect(t.calledBy("lena")[0].text).toContain("[MATERIAIS]");
    expect(t.calledBy("lena")[0].text).toContain("Liderei uma equipa de 4 analistas em 2024");
    expect(t.calledBy("nina")[0].text).toContain("Liderei uma equipa de 4 analistas em 2024");
  });

  it("uma exceção inesperada também deixa o dossier bloqueado em vez de a meio", async () => {
    const t = setup({ ceo: [ok(PLAN)] });
    await t.service.start("ACME");
    expect((t.service.current() as Dossier).blocked?.reason).toContain("Erro inesperado");
  });

  it("depois de um reinício, um passo a meio aparece bloqueado; uma pergunta à espera de ti e um rascunho à espera de revisão ficam como estavam", () => {
    const base: Dossier = {
      id: 3,
      title: "ACME",
      request: "ACME",
      stage: "checking",
      holder: "nina",
      draftVersion: 1,
      reviews: [],
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const t = setup({}, base);
    expect(t.service.current()).toMatchObject({ stage: "checking", blocked: { stage: "checking" } });
    expect(t.service.current()?.blocked?.reason).toContain("reiniciou");
    const waiting: Dossier = {
      ...base,
      stage: "research",
      holder: "user",
      clarification: { questions: ["Qual vaga?"], reason: "Vaga ambígua" },
    };
    expect(setup({}, waiting).service.current()).toEqual(waiting);
    const review: Dossier = {
      ...base,
      stage: "review",
      holder: "user",
      draft: "Carta",
      check: { version: 1, passed: true, checked: ["x"], issues: [], confirmations: [], ts: 1, afterAutoReturn: false },
    };
    expect(setup({}, review).service.current()).toEqual(review);
  });
});

describe("dossier: regras gerais", () => {
  it("só há um dossier ativo; depois de aprovado pode abrir-se outro", async () => {
    const t = setup({
      ceo: [ok(PLAN), ok(PLAN)],
      mira: [research(), research()],
      lena: [draft("C1"), draft("C2")],
      nina: [check(), check()],
    });
    await t.service.start("ACME");
    await t.service.start("Outra empresa");
    expect(t.errors().some((m) => m.includes("Já há um dossier em curso"))).toBe(true);
    expect(t.service.current()?.id).toBe(1);
    t.service.approve(1);
    await t.service.start("Outra empresa");
    expect(t.service.current()).toMatchObject({ id: 2, stage: "review" });
  });

  it("não deixa devolver, aprovar ou responder quando não é a vez do utilizador", async () => {
    const t = setup({ ceo: [fail("x")] });
    await t.service.start("ACME");
    const id = (t.service.current() as Dossier).id;
    t.service.approve(id);
    await t.service.returnDraft(id, "nota");
    await t.service.answer(id, "resposta");
    await t.service.returnDraft(999, "nota");
    expect(t.service.current()?.stage).toBe("atlas");
    expect(t.errors()).toHaveLength(4);
  });
});

describe("dossier: dossiers criados antes da Nina e da pesquisa estruturada", () => {
  const legacy: Dossier = {
    id: 5,
    title: "Candidatura antiga",
    request: "ACME",
    stage: "review",
    holder: "user",
    briefs: { mira: "m", lena: "l" },
    findings: "Texto livre da Mira",
    draft: "Carta antiga",
    draftVersion: 1,
    approvalId: 9,
    reviews: [],
    history: [{ ts: 1, text: "Rascunho v1 pronto para ti" }],
    createdAt: 1,
    updatedAt: 1,
  };

  it("continuam acessíveis: aprovam-se como antes (sem verificação) e mantêm o texto da pesquisa", () => {
    const t = setup({}, legacy);
    expect(t.service.current()).toEqual(legacy);
    expect(canApprove(legacy)).toBe(true);
    t.service.approve(5);
    expect(t.service.current()).toMatchObject({ stage: "approved" });
    expect(t.approvalCalls).toContain("decide:9:true");
  });

  it("devolver um dossier antigo à Lena usa o caminho antigo e volta à bandeja sem a Nina", async () => {
    const t = setup({ lena: [ok("Carta antiga revista")] }, legacy);
    await t.service.returnDraft(5, "Mais curta");
    expect(t.service.current()).toMatchObject({ stage: "review", holder: "user", draftVersion: 2, draft: "Carta antiga revista" });
    expect(t.calledBy("nina")).toHaveLength(0);
    expect(t.calledBy("lena")[0].text).toContain("Mais curta");
    expect(t.approvalCalls.filter((c) => c.startsWith("request:"))).toHaveLength(1);
  });
});

describe("dossier: plano do Atlas", () => {
  it("analisa o plano (âmbito e idioma) e recusa respostas incompletas", () => {
    expect(parseDossierPlan(`Aqui vai: ${PLAN}`)).toEqual({
      title: "Candidatura ACME",
      scope: "vaga",
      language: "português de Portugal",
      mira: "Pesquisa a ACME",
      lena: "Escreve a carta para a ACME",
    });
    expect(parseDossierPlan('{"title":"t","mira":"m","lena":"l","scope":"empresa","language":"inglês"}')).toMatchObject({
      scope: "empresa",
      language: "inglês",
    });
    expect(parseDossierPlan('{"title":"t","mira":"m","lena":"l"}')).toMatchObject({ scope: "vaga", language: "português de Portugal" });
    expect(parseDossierPlan('{"title":"","mira":"x","lena":"y"}')).toBeNull();
    expect(parseDossierPlan("sem json")).toBeNull();
    expect(parseDossierPlan(JSON.stringify({ title: "x".repeat(200), mira: "m", lena: "l" }))?.title).toHaveLength(60);
  });

  it("o pedido ao Atlas e o plano por defeito têm o que é preciso", () => {
    expect(dossierPlanPrompt("ACME")).toContain("«ACME»");
    expect(dossierPlanPrompt("ACME")).toContain("APENAS com um objeto JSON");
    expect(dossierPlanPrompt("ACME")).toContain("Nina");
    expect(fallbackPlan("Candidatura espontânea à Beta")).toMatchObject({ scope: "empresa" });
    expect(fallbackPlan("Vaga na Beta, carta em inglês")).toMatchObject({ scope: "vaga", language: "inglês" });
    expect(revisionPrompt("Escreve a carta", "Rascunho antigo", 2, "mais curto")).toContain("«mais curto»");
  });
});
