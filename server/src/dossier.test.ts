import { describe, expect, it } from "vitest";
import type { Dossier, ServerMsg } from "../../shared/protocol.ts";
import { createDossierService, dossierPlanPrompt, fallbackPlan, parseDossierPlan, revisionPrompt } from "./dossier.ts";
import type { RunResult } from "./hub.ts";

type Script = Record<string, RunResult[]>;

const PLAN = JSON.stringify({ title: "Candidatura ACME", mira: "Pesquisa a ACME", lena: "Escreve a carta para a ACME" });
const ok = (reply: string): RunResult => ({ ok: true, reply });
const fail = (error: string): RunResult => ({ ok: false, reply: "", error });

/** Hub de mentira: devolve, por agente, os resultados combinados e regista o que lhe foi pedido. */
function setup(script: Script, saved: Dossier | null = null) {
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
    request: (agentId: string, title: string, draft?: string) => {
      approvalCalls.push(`request:${agentId}:${title}:${draft}`);
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
    now: () => (clock += 10),
  });
  const stages = (): string[] =>
    out.flatMap((m) =>
      m.type === "dossier" && m.dossier ? [`${m.dossier.stage}/${m.dossier.holder}${m.dossier.blocked ? "!" : ""}`] : [],
    );
  const delegates = (): string[] => out.flatMap((m) => (m.type === "delegate" ? [`${m.from}>${m.to}`] : []));
  return { service, out, calls, approvalCalls, stages, delegates, stored: () => stored };
}

describe("dossier: fluxo completo Atlas > Mira > Lena > revisão", () => {
  it("passa de mão em mão e acaba à espera do utilizador, com o rascunho e o pedido de aprovação", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ok("A ACME vende software; cultura aberta.")], lena: [ok("Carta v1 [PREENCHER]")] });
    await t.service.start("Candidatura à ACME, vaga de Business Analyst");
    expect(t.stages()).toEqual(["atlas/ceo", "atlas/ceo", "atlas/ceo", "research/mira", "research/mira", "drafting/lena", "review/user"]);
    expect(t.delegates()).toEqual(["ceo>mira", "mira>lena", "lena>tray"]);
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ title: "Candidatura ACME", stage: "review", holder: "user", draftVersion: 1, draft: "Carta v1 [PREENCHER]" });
    expect(d.findings).toContain("cultura aberta");
    expect(d.history.map((h) => h.text)).toEqual([
      "Pedido recebido pelo Atlas",
      "O Atlas atribuiu a pesquisa à Mira",
      "A Mira está a pesquisar",
      "A Mira entregou os resultados",
      "A Lena recebeu os resultados da Mira e está a redigir",
      "Rascunho v1 pronto para ti",
    ]);
    // A Lena recebe o que a Mira encontrou, e o pedido de aprovação é feito pelo dossier (não duas vezes).
    const lena = t.calls.find((c) => c.agent === "lena");
    expect(lena?.text).toContain("cultura aberta");
    expect(lena?.opts).toMatchObject({ skipComplete: true });
    expect(t.approvalCalls).toEqual(["request:lena:Dossier: Candidatura ACME:Carta v1 [PREENCHER]"]);
    expect(t.stored()).toEqual(d);
  });

  it("devolver com uma nota: a Lena revê com a nota e o dossier volta a ficar à espera do utilizador", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ok("Resultados")], lena: [ok("Carta v1"), ok("Carta v2 mais curta")] });
    await t.service.start("ACME");
    const id = (t.service.current() as Dossier).id;
    await t.service.returnDraft(id, "Mais curta e menos formal");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "review", holder: "user", draftVersion: 2, draft: "Carta v2 mais curta" });
    expect(d.pendingNote).toBeUndefined();
    expect(d.reviews).toMatchObject([{ kind: "returned", note: "Mais curta e menos formal", version: 1 }]);
    const revision = t.calls.filter((c) => c.agent === "lena")[1];
    expect(revision.text).toContain("Mais curta e menos formal");
    expect(revision.text).toContain("Carta v1");
    expect(t.approvalCalls).toContain("supersede:lena");
    expect(t.stages().slice(-2)).toEqual(["drafting/lena", "review/user"]);
    // Voltar à Lena é só uma mudança de dono: ninguém tem de andar para o trabalho avançar.
    expect(t.delegates().filter((x) => x === "mira>lena")).toHaveLength(1);
  });

  it("aprovar regista a decisão e não envia nada", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ok("R")], lena: [ok("Carta")] });
    await t.service.start("ACME");
    const d0 = t.service.current() as Dossier;
    t.service.approve(d0.id);
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "approved", holder: "user" });
    expect(d.reviews).toMatchObject([{ kind: "approved", version: 1 }]);
    expect(t.approvalCalls).toContain("decide:1:true");
    expect(d.history.at(-1)?.text).toBe("Aprovaste o rascunho v1. Nada foi enviado.");
  });
});

describe("dossier: bloqueios", () => {
  it("pesquisa falhada: fica na Mira, com o motivo, e tentar outra vez continua o fluxo", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [fail("Tempo máximo excedido."), ok("Agora sim")], lena: [ok("Carta")] });
    await t.service.start("ACME");
    const blocked = t.service.current() as Dossier;
    expect(blocked).toMatchObject({ stage: "research", holder: "mira", blocked: { stage: "research" } });
    expect(blocked.blocked?.reason).toContain("Tempo máximo excedido.");
    expect(t.calls.some((c) => c.agent === "lena")).toBe(false);
    await t.service.retry(blocked.id);
    expect(t.service.current()).toMatchObject({ stage: "review", draft: "Carta" });
    expect(t.service.current()?.blocked).toBeUndefined();
  });

  it("redação bloqueada: fica na Lena e a tentativa seguinte não repete a pesquisa", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ok("R")], lena: [fail("Parado por ti."), ok("Carta")] });
    await t.service.start("ACME");
    const d = t.service.current() as Dossier;
    expect(d).toMatchObject({ stage: "drafting", holder: "lena", blocked: { stage: "drafting" } });
    expect(d.findings).toBe("R");
    await t.service.retry(d.id);
    expect(t.calls.filter((c) => c.agent === "mira")).toHaveLength(1);
    expect(t.service.current()).toMatchObject({ stage: "review", draft: "Carta" });
  });

  it("revisão bloqueada mantém a nota e o rascunho anterior para a nova tentativa", async () => {
    const t = setup({ ceo: [ok(PLAN)], mira: [ok("R")], lena: [ok("Carta v1"), fail("erro"), ok("Carta v2")] });
    await t.service.start("ACME");
    const id = (t.service.current() as Dossier).id;
    await t.service.returnDraft(id, "mais curta");
    expect(t.service.current()).toMatchObject({
      stage: "drafting",
      blocked: { stage: "drafting" },
      pendingNote: "mais curta",
      draft: "Carta v1",
    });
    await t.service.retry(id);
    expect(t.calls.filter((c) => c.agent === "lena")[2].text).toContain("mais curta");
    expect(t.service.current()).toMatchObject({ stage: "review", draftVersion: 2 });
  });

  it("o Atlas falha: bloqueia no Atlas; resposta sem JSON usa o plano por defeito", async () => {
    const a = setup({ ceo: [fail("sem quota")] });
    await a.service.start("ACME");
    expect(a.service.current()).toMatchObject({ stage: "atlas", holder: "ceo", blocked: { stage: "atlas" } });
    const b = setup({ ceo: [ok("não sei fazer JSON")], mira: [ok("R")], lena: [ok("Carta")] });
    await b.service.start("Vaga de analista na Beta");
    expect(b.service.current()).toMatchObject({ stage: "review", title: "Vaga de analista na Beta" });
    expect(b.calls.find((c) => c.agent === "mira")?.text).toContain("Vaga de analista na Beta");
  });

  it("uma exceção inesperada também deixa o dossier bloqueado em vez de a meio", async () => {
    const t = setup({ ceo: [ok(PLAN)] }); // a Mira não tem resultado combinado: o hub de mentira lança
    await t.service.start("ACME");
    const d = t.service.current() as Dossier;
    expect(d.blocked?.reason).toContain("Erro inesperado");
    expect(d.holder).toBe("mira");
  });
});

describe("dossier: regras", () => {
  it("só há um dossier ativo; depois de aprovado pode abrir-se outro", async () => {
    const t = setup({ ceo: [ok(PLAN), ok(PLAN)], mira: [ok("R"), ok("R2")], lena: [ok("C1"), ok("C2")] });
    await t.service.start("ACME");
    await t.service.start("Outra empresa");
    expect(t.out.some((m) => m.type === "error" && m.message.includes("Já há um dossier em curso"))).toBe(true);
    expect(t.service.current()?.id).toBe(1);
    t.service.approve(1);
    await t.service.start("Outra empresa");
    expect(t.service.current()).toMatchObject({ id: 2, stage: "review" });
  });

  it("não deixa devolver ou aprovar um dossier que não está em revisão", async () => {
    const t = setup({ ceo: [fail("x")] });
    await t.service.start("ACME");
    const id = (t.service.current() as Dossier).id;
    t.service.approve(id);
    await t.service.returnDraft(id, "nota");
    await t.service.returnDraft(999, "nota");
    expect(t.service.current()?.stage).toBe("atlas");
    expect(t.out.filter((m) => m.type === "error")).toHaveLength(3);
  });

  it("depois de um reinício, um passo que ficou a meio aparece bloqueado (com o rascunho já feito, se houver)", () => {
    const saved: Dossier = {
      id: 3,
      title: "ACME",
      request: "ACME",
      stage: "research",
      holder: "mira",
      draftVersion: 0,
      reviews: [],
      history: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const t = setup({}, saved);
    expect(t.service.current()).toMatchObject({ id: 3, stage: "research", holder: "mira", blocked: { stage: "research" } });
    expect(t.service.current()?.blocked?.reason).toContain("reiniciou");
    // Um dossier que estava à espera do utilizador fica exatamente como estava.
    const waiting: Dossier = { ...saved, stage: "review", holder: "user", draft: "Carta", draftVersion: 1, findings: "R" };
    const w = setup({}, waiting);
    expect(w.service.current()).toEqual(waiting);
  });
});

describe("dossier: prompts", () => {
  it("analisa a resposta do Atlas e recusa respostas incompletas", () => {
    expect(parseDossierPlan(`Aqui vai: ${PLAN}`)).toEqual({
      title: "Candidatura ACME",
      mira: "Pesquisa a ACME",
      lena: "Escreve a carta para a ACME",
    });
    expect(parseDossierPlan('{"title":"","mira":"x","lena":"y"}')).toBeNull();
    expect(parseDossierPlan('{"title":"t","mira":"x"}')).toBeNull();
    expect(parseDossierPlan("sem json")).toBeNull();
    expect(parseDossierPlan(JSON.stringify({ title: "x".repeat(200), mira: "m", lena: "l" }))?.title).toHaveLength(60);
  });
  it("os pedidos têm o que é preciso", () => {
    expect(dossierPlanPrompt("ACME")).toContain("«ACME»");
    expect(dossierPlanPrompt("ACME")).toContain("APENAS com um objeto JSON");
    expect(fallbackPlan("ACME").lena).toContain("[PREENCHER]");
    const p = revisionPrompt("Escreve a carta", "Rascunho antigo", 2, "mais curto");
    expect(p).toContain("versão 2");
    expect(p).toContain("Rascunho antigo");
    expect(p).toContain("«mais curto»");
  });
});
