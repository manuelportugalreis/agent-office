import { describe, expect, it } from "vitest";
import type { Dossier, NinaCheck } from "../../../shared/protocol";
import {
  boardView,
  checkSummary,
  chipText,
  findingsPreview,
  hasQuestion,
  holderName,
  nextActionOf,
  openQuestions,
  reviewHasProblems,
  sceneLabel,
  statusOf,
  timelineOf,
  waitingForUser,
} from "./dossier-model";

const base: Dossier = {
  id: 1,
  title: "Candidatura ACME",
  request: "ACME, Business Analyst",
  stage: "atlas",
  holder: "ceo",
  draftVersion: 0,
  reviews: [],
  history: [],
  createdAt: 1,
  updatedAt: 1,
};
const at = (patch: Partial<Dossier>): Dossier => ({ ...base, ...patch });
const passed: NinaCheck = { version: 1, passed: true, checked: ["Cargo"], issues: [], confirmations: [], ts: 1, afterAutoReturn: false };
const failed: NinaCheck = {
  ...passed,
  passed: false,
  issues: [{ severity: "bloqueia", quote: "Liderei a migração", problem: "O perfil diz que contribuiu", fix: "Escreve contribuí" }],
};

describe("estado do dossier para quem olha para o escritório", () => {
  it("diz quem tem o dossier e o que vem a seguir em cada fase", () => {
    expect(statusOf(base).headline).toBe("Com o Atlas, a planear");
    expect(statusOf(at({ stage: "research", holder: "mira" })).next).toContain("Lena");
    expect(statusOf(at({ stage: "drafting", holder: "lena" })).headline).toBe("Com a Lena, a redigir a carta");
    expect(statusOf(at({ stage: "drafting", holder: "lena", pendingNote: "mais curto" })).headline).toContain("nota");
    expect(statusOf(at({ stage: "drafting", holder: "lena", pendingCorrections: failed.issues })).headline).toBe(
      "Com a Lena, a corrigir com a Nina",
    );
    expect(statusOf(at({ stage: "checking", holder: "nina" })).headline).toBe("Com a Nina, a verificar o rascunho");
    expect(statusOf(at({ stage: "approved", holder: "user" })).tone).toBe("done");
  });

  it("em revisão a equipa está à espera de ti; se a Nina ainda vê problemas diz-te que não se pode aprovar", () => {
    const review = at({ stage: "review", holder: "user", draftVersion: 2, check: passed });
    expect(statusOf(review)).toMatchObject({ tone: "wait" });
    expect(statusOf(review).headline).toContain("v2");
    expect(statusOf(review).headline).toContain("verificado");
    expect(waitingForUser(review)).toBe(true);
    expect(reviewHasProblems(review)).toBe(false);
    const problems = at({ stage: "review", holder: "user", draftVersion: 2, check: failed });
    expect(statusOf(problems)).toMatchObject({ tone: "blocked" });
    expect(statusOf(problems).headline).toContain("a Nina ainda vê problemas");
    expect(statusOf(problems).next).toContain("não se pode aprovar");
    expect(reviewHasProblems(problems)).toBe(true);
    expect(waitingForUser(problems)).toBe(true);
    // Um dossier antigo (sem verificação) continua a poder aprovar-se.
    expect(reviewHasProblems(at({ stage: "review", holder: "user" }))).toBe(false);
  });

  it("uma pergunta da Mira também é a equipa à espera de ti", () => {
    const asking = at({ stage: "research", holder: "user", clarification: { questions: ["Qual das vagas?"], reason: "Vaga ambígua" } });
    expect(hasQuestion(asking)).toBe(true);
    expect(waitingForUser(asking)).toBe(true);
    expect(statusOf(asking)).toMatchObject({ tone: "wait", headline: "À tua espera: a Mira precisa de uma resposta" });
    expect(chipText(asking)).toBe("Candidatura ACME · à tua espera");
    expect(sceneLabel(asking).line).toBe("à tua espera: pergunta");
  });

  it("bloqueado diz onde e porquê", () => {
    const blocked = at({
      stage: "research",
      holder: "mira",
      blocked: { stage: "research", reason: "A pesquisa da Mira falhou: sem quota" },
    });
    expect(statusOf(blocked)).toMatchObject({ tone: "blocked" });
    expect(statusOf(blocked).headline).toBe("Parado com a Mira");
    expect(statusOf(blocked).next).toContain("sem quota");
    expect(waitingForUser(blocked)).toBe(false);
    expect(waitingForUser(null)).toBe(false);
    expect(waitingForUser(at({ stage: "research" }))).toBe(false);
    expect(statusOf(at({ stage: "checking", holder: "nina", blocked: { stage: "checking", reason: "x" } })).headline).toBe(
      "Parado com a Nina",
    );
  });

  it("a linha do tempo tem a Nina e marca o que está feito, quem tem o dossier e o que falta", () => {
    expect(timelineOf(at({ stage: "drafting", holder: "lena" })).map((s) => `${s.label}:${s.state}`)).toEqual([
      "Atlas:done",
      "Mira:done",
      "Lena:active",
      "Nina:todo",
      "Tu:todo",
    ]);
    expect(timelineOf(at({ stage: "checking", holder: "nina" })).map((s) => s.state)).toEqual(["done", "done", "done", "active", "todo"]);
    expect(timelineOf(at({ stage: "review", holder: "user", check: passed })).map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "wait",
    ]);
    expect(timelineOf(at({ stage: "research", holder: "mira", blocked: { stage: "research", reason: "x" } })).map((s) => s.state)).toEqual([
      "done",
      "blocked",
      "todo",
      "todo",
      "todo",
    ]);
    expect(
      timelineOf(at({ stage: "research", holder: "user", clarification: { questions: ["?"], reason: "x" } })).map((s) => s.state),
    ).toEqual(["done", "wait", "todo", "todo", "todo"]);
    expect(timelineOf(at({ stage: "approved", holder: "user" })).every((s) => s.state === "done")).toBe(true);
  });

  it("o rótulo da cena e o HUD respondem ao teste de aceitação", () => {
    expect(sceneLabel(at({ stage: "review", holder: "user" }))).toEqual({ title: "Candidatura ACME", line: "à tua espera" });
    expect(sceneLabel(at({ stage: "review", holder: "user", check: failed })).line).toBe("à tua espera: problemas");
    expect(sceneLabel(at({ stage: "checking", holder: "nina" })).line).toBe("com a Nina");
    expect(sceneLabel(at({ stage: "research", holder: "mira", blocked: { stage: "research", reason: "x" } })).line).toContain("parado");
    expect(chipText(at({ stage: "review", holder: "user", check: passed }))).toBe("Candidatura ACME · à tua espera");
    expect(chipText(at({ stage: "checking", holder: "nina" }))).toBe("Candidatura ACME · com a Nina, a verificar o rascunho");
    expect(holderName("nina")).toBe("Nina");
    expect(holderName("user")).toBe("Tu");
  });

  it("o excerto de texto limpa Markdown e corta o que é comprido", () => {
    expect(findingsPreview("**ACME** vende [software](https://x.pt)\n\n> bom")).toBe("ACME vende software bom");
    expect(findingsPreview("x".repeat(500), 50)).toHaveLength(50);
    expect(findingsPreview(undefined)).toBe("");
  });
});

describe("perguntas que ainda precisam da tua resposta", () => {
  it("junta as da Mira, as da Lena e os factos que a Nina quer que confirmes, cada uma com quem pergunta", () => {
    const d = at({
      stage: "review",
      holder: "user",
      questions: ["Tens experiência com Kubernetes? Qual?"],
      check: { ...passed, confirmations: ["Confirmas que lideraste a migração?"] },
    });
    expect(openQuestions(d)).toEqual([
      { from: "Lena", text: "Tens experiência com Kubernetes? Qual?" },
      { from: "Nina", text: "Confirmas que lideraste a migração?" },
    ]);
    const asking = at({ stage: "research", holder: "user", clarification: { questions: ["Qual das vagas?"], reason: "x" } });
    expect(openQuestions(asking)).toEqual([{ from: "Mira", text: "Qual das vagas?" }]);
    // Perguntas de um rascunho que já foi devolvido para revisão não contam.
    expect(openQuestions(at({ stage: "drafting", holder: "lena", questions: ["velha"] }))).toEqual([]);
  });

  it("resume a verificação da Nina numa linha", () => {
    expect(checkSummary(undefined)).toBe("");
    expect(checkSummary(passed)).toBe("Passou");
    expect(checkSummary(failed)).toBe("1 problema(s) que bloqueiam");
    expect(
      checkSummary({
        ...passed,
        issues: [{ severity: "opcional", quote: "a", problem: "b", fix: "c" }],
        confirmations: ["x", "y"],
      }),
    ).toBe("Passou · 1 sugestão(ões) de estilo · 2 facto(s) por confirmares");
  });
});

describe("quadro da sala de Gestão", () => {
  it("sem dossier diz que não há nenhum e onde abrir", () => {
    expect(boardView(null)).toMatchObject({ tone: "empty", headline: "Sem dossier ativo", hint: "Abre um em «Novo dossier», lá em cima" });
  });

  it("em curso: quem tem o dossier e o que está a fazer, incluindo a Nina a verificar", () => {
    expect(boardView(at({ stage: "research", holder: "mira" }))).toMatchObject({
      tone: "work",
      headline: "Com a Mira",
      title: "Candidatura ACME",
      lines: ["A pesquisar a vaga"],
    });
    expect(boardView(at({ stage: "atlas", holder: "ceo" })).headline).toBe("Com o Atlas");
    expect(boardView(at({ stage: "drafting", holder: "lena" })).lines).toEqual(["A redigir a carta"]);
    expect(boardView(at({ stage: "drafting", holder: "lena", pendingNote: "mais curta" })).lines).toEqual(["A rever com a tua nota"]);
    expect(boardView(at({ stage: "drafting", holder: "lena", pendingCorrections: failed.issues })).lines).toEqual([
      "A corrigir com as indicações da Nina",
    ]);
    expect(boardView(at({ stage: "checking", holder: "nina" }))).toMatchObject({
      tone: "work",
      headline: "Com a Nina",
      lines: ["A verificar o rascunho"],
    });
  });

  it("à tua espera é a linha principal: primeira versão ou revisto, verificado pela Nina e perguntas abertas", () => {
    const first = boardView(at({ stage: "review", holder: "user", draftVersion: 1, check: passed }));
    expect(first).toMatchObject({ tone: "wait", headline: "À tua espera" });
    expect(first.lines).toEqual(["Rascunho v1 · primeira versão", "Verificado pela Nina"]);
    const revised = boardView(
      at({
        stage: "review",
        holder: "user",
        draftVersion: 2,
        check: { ...passed, confirmations: ["Confirmas?"] },
        questions: ["Que projeto?"],
        reviews: [{ ts: 1, kind: "returned", note: "mais curta", version: 1 }],
      }),
    );
    expect(revised.lines).toEqual(["Rascunho v2 · revisto", "Verificado pela Nina · 2 pergunta(s) para ti"]);
    expect(boardView(at({ stage: "review", holder: "user", draftVersion: 1 })).lines).toEqual(["Rascunho v1 · primeira versão"]);
  });

  it("a Nina com problemas por resolver mantém 'À tua espera' mas em vermelho e manda devolver à Lena", () => {
    const v = boardView(at({ stage: "review", holder: "user", draftVersion: 2, check: failed }));
    expect(v).toMatchObject({ tone: "blocked", headline: "À tua espera", hint: "Abre o cartão para devolver com uma nota" });
    expect(v.lines).toEqual(["Rascunho v2 · primeira versão", "A Nina ainda vê problemas: devolve à Lena"]);
  });

  it("uma pergunta da Mira aparece como à tua espera", () => {
    const v = boardView(at({ stage: "research", holder: "user", clarification: { questions: ["Qual?"], reason: "x" } }));
    expect(v).toMatchObject({
      tone: "wait",
      headline: "À tua espera",
      lines: ["A Mira precisa de uma resposta tua"],
      hint: "Abre o cartão para responder",
    });
  });

  it("parado diz onde parou, porquê e que o cartão permite tentar outra vez", () => {
    const v = boardView(
      at({ stage: "research", holder: "mira", blocked: { stage: "research", reason: "A pesquisa da Mira falhou: Parado por ti." } }),
    );
    expect(v).toMatchObject({ tone: "blocked", headline: "Parado", hint: "Abre o cartão para tentar outra vez" });
    expect(v.lines[0]).toBe("Parado na pesquisa da Mira");
    expect(v.lines[1]).toContain("Parado por ti");
    expect(boardView(at({ stage: "drafting", holder: "lena", blocked: { stage: "drafting", reason: "x" } })).lines[0]).toBe(
      "Parado na redação da Lena",
    );
    expect(boardView(at({ stage: "checking", holder: "nina", blocked: { stage: "checking", reason: "x" } })).lines[0]).toBe(
      "Parado na verificação da Nina",
    );
  });

  it("aprovado é um estado calmo", () => {
    expect(boardView(at({ stage: "approved", holder: "user" }))).toMatchObject({
      tone: "done",
      headline: "Aprovado",
      lines: ["Nada foi enviado"],
    });
  });

  it("um título comprido é cortado para caber no quadro", () => {
    expect(boardView(at({ title: "x".repeat(100) })).title).toHaveLength(40);
  });
});

describe("próxima ação (barra de topo)", () => {
  it("sem dossier não há nada à espera de ti e o botão abre um novo", () => {
    expect(nextActionOf(null)).toMatchObject({ tone: "idle", title: "Sem dossier ativo", cta: "Novo dossier", view: "new" });
  });

  it("um rascunho à espera traz o título, a versão e leva direto ao rascunho", () => {
    const n = nextActionOf(at({ stage: "review", holder: "user", draftVersion: 3, check: passed }));
    expect(n).toMatchObject({ tone: "wait", title: "Rascunho v3 à tua espera", cta: "Rever rascunho", view: "draft" });
    expect(n.sub).toBe("Candidatura ACME · verificado pela Nina");
  });

  it("com problemas da Nina o botão manda devolver; uma pergunta da Mira manda responder", () => {
    expect(nextActionOf(at({ stage: "review", holder: "user", draftVersion: 2, check: failed }))).toMatchObject({
      tone: "blocked",
      title: "A Nina vê problemas na v2",
      cta: "Devolver à Lena",
      view: "draft",
    });
    expect(nextActionOf(at({ stage: "research", holder: "user", clarification: { questions: ["?"], reason: "x" } }))).toMatchObject({
      tone: "wait",
      title: "A Mira precisa de uma resposta",
      view: "question",
    });
  });

  it("em curso diz quem está a trabalhar e em quê; parado diz onde e porquê", () => {
    expect(nextActionOf(at({ stage: "research", holder: "mira" }))).toMatchObject({
      tone: "work",
      title: "A Mira · A pesquisar a vaga",
      cta: "Ver andamento",
      view: "progress",
    });
    expect(nextActionOf(at({ stage: "checking", holder: "nina" })).title).toBe("A Nina · A verificar o rascunho");
    expect(nextActionOf(at({ stage: "drafting", holder: "lena", pendingNote: "x" })).title).toBe("A Lena · A rever com a tua nota");
    const blocked = nextActionOf(
      at({ stage: "research", holder: "mira", blocked: { stage: "research", reason: "A pesquisa da Mira falhou: sem quota" } }),
    );
    expect(blocked).toMatchObject({ tone: "blocked", title: "Parado na pesquisa da Mira", cta: "Ver e tentar outra vez", view: "blocked" });
    expect(blocked.sub).toContain("sem quota");
  });

  it("aprovado é calmo e o botão abre um novo dossier", () => {
    expect(nextActionOf(at({ stage: "approved", holder: "user" }))).toMatchObject({
      tone: "done",
      title: "Dossier aprovado",
      cta: "Novo dossier",
      view: "new",
    });
  });
});
