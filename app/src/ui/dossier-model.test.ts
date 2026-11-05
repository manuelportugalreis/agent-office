import { describe, expect, it } from "vitest";
import type { Dossier } from "../../../shared/protocol";
import { boardView, chipText, findingsPreview, holderName, sceneLabel, statusOf, timelineOf, waitingForUser } from "./dossier-model";

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

describe("estado do dossier para quem olha para o escritório", () => {
  it("diz quem tem o dossier e o que vem a seguir em cada fase", () => {
    expect(statusOf(base).headline).toBe("Com o Atlas, a planear");
    expect(statusOf(at({ stage: "research", holder: "mira" })).next).toContain("Lena");
    expect(statusOf(at({ stage: "drafting", holder: "lena" })).headline).toBe("Com a Lena, a redigir a carta");
    expect(statusOf(at({ stage: "drafting", holder: "lena", pendingNote: "mais curto" })).headline).toContain("nota");
    expect(statusOf(at({ stage: "approved", holder: "user" })).tone).toBe("done");
  });

  it("em revisão a equipa está à espera de ti; bloqueado diz onde e porquê", () => {
    const review = at({ stage: "review", holder: "user", draftVersion: 2 });
    expect(statusOf(review)).toMatchObject({ tone: "wait" });
    expect(statusOf(review).headline).toContain("v2");
    expect(waitingForUser(review)).toBe(true);
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
  });

  it("a linha do tempo marca o que está feito, quem tem o dossier e o que falta", () => {
    expect(timelineOf(at({ stage: "drafting", holder: "lena" })).map((s) => `${s.label}:${s.state}`)).toEqual([
      "Atlas:done",
      "Mira:done",
      "Lena:active",
      "Tu:todo",
    ]);
    expect(timelineOf(at({ stage: "research", holder: "mira", blocked: { stage: "research", reason: "x" } })).map((s) => s.state)).toEqual([
      "done",
      "blocked",
      "todo",
      "todo",
    ]);
    expect(timelineOf(at({ stage: "approved", holder: "user" })).every((s) => s.state === "done")).toBe(true);
  });

  it("o rótulo da cena e o HUD respondem ao teste de aceitação", () => {
    expect(sceneLabel(at({ stage: "review", holder: "user" }))).toEqual({ title: "Candidatura ACME", line: "à tua espera" });
    expect(sceneLabel(at({ stage: "research", holder: "mira" })).line).toBe("com a Mira");
    expect(sceneLabel(at({ stage: "research", holder: "mira", blocked: { stage: "research", reason: "x" } })).line).toContain("parado");
    expect(chipText(at({ stage: "review", holder: "user" }))).toBe("Candidatura ACME · à tua espera");
    expect(chipText(at({ stage: "drafting", holder: "lena" }))).toBe("Candidatura ACME · com a Lena, a redigir a carta");
    expect(holderName("user")).toBe("Tu");
  });

  it("o excerto da pesquisa limpa Markdown e corta o que é comprido", () => {
    expect(findingsPreview("**ACME** vende [software](https://x.pt)\n\n> bom")).toBe("ACME vende software bom");
    expect(findingsPreview("x".repeat(500), 50)).toHaveLength(50);
    expect(findingsPreview(undefined)).toBe("");
  });
});

describe("quadro da sala de Gestão", () => {
  it("sem dossier diz que não há nenhum e onde abrir", () => {
    expect(boardView(null)).toMatchObject({ tone: "empty", headline: "Sem dossier ativo", hint: "Abre um em 📁 Dossier" });
  });

  it("em curso: quem tem o dossier e o que está a fazer", () => {
    expect(boardView(at({ stage: "research", holder: "mira" }))).toMatchObject({
      tone: "work",
      headline: "Com a Mira",
      title: "Candidatura ACME",
      lines: ["A pesquisar a empresa"],
    });
    expect(boardView(at({ stage: "atlas", holder: "ceo" })).headline).toBe("Com o Atlas");
    expect(boardView(at({ stage: "drafting", holder: "lena" })).lines).toEqual(["A redigir a carta"]);
    expect(boardView(at({ stage: "drafting", holder: "lena", pendingNote: "mais curta" })).lines).toEqual(["A rever com a tua nota"]);
  });

  it("à tua espera é a linha principal e distingue a primeira versão de uma revisão", () => {
    const first = boardView(at({ stage: "review", holder: "user", draftVersion: 1 }));
    expect(first).toMatchObject({ tone: "wait", headline: "À tua espera", lines: ["Rascunho v1 · primeira versão"] });
    const revised = boardView(
      at({ stage: "review", holder: "user", draftVersion: 2, reviews: [{ ts: 1, kind: "returned", note: "mais curta", version: 1 }] }),
    );
    expect(revised.lines).toEqual(["Rascunho v2 · revisto"]);
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
