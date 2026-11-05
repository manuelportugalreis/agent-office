import { describe, expect, it } from "vitest";
import type { Dossier, ResearchBrief } from "../../shared/protocol.ts";
import { checkPrompt, draftPrompt, jsonFixPrompt, notesOf, parseCheck, parseDraft, renderEvidence } from "./dossier-review.ts";

const brief: ResearchBrief = {
  kind: "vaga_verificada",
  role: "Business Analyst",
  company: "ACME",
  sourceUrl: "https://acme.com/careers/ba",
  checkedAt: "2026-11-05",
  mandatory: [{ text: "Kubernetes em produção", source: "https://acme.com/careers/ba" }],
  desirable: [],
  findings: [{ text: "A ACME vende software", source: "https://acme.com/about", verified: true }],
  unknowns: ["Salário"],
  clarifications: [],
  summary: "Vaga de BA.",
};
const evidence = renderEvidence({
  profile: "Mestrando em AI in Business. Contribuí para a migração do ERP.",
  materials: "",
  answers: [],
  notes: [],
});

describe("evidência sobre o candidato", () => {
  it("mostra cada fonte com a sua etiqueta e só inclui o que existe", () => {
    const text = renderEvidence({ profile: "Perfil X", materials: "Materiais Y", answers: ["Resposta Z"], notes: ["v1: Nota W"] });
    expect(text).toContain("[PERFIL]\nPerfil X");
    expect(text).toContain("[MATERIAIS]");
    expect(text).toContain("- Resposta Z");
    expect(text).toContain("- v1: Nota W");
    expect(renderEvidence({ profile: "", materials: "", answers: [], notes: [] })).toContain("o perfil está vazio");
    expect(renderEvidence({ profile: "P", materials: "", answers: [], notes: [] })).not.toContain("[MATERIAIS]");
  });

  it("as notas do utilizador saem das devoluções, com a versão", () => {
    const d = {
      reviews: [
        { ts: 1, kind: "returned", note: "Liderei a migração", version: 1 },
        { ts: 2, kind: "approved", version: 2 },
      ],
    } as unknown as Dossier;
    expect(notesOf(d)).toEqual(["v1: Liderei a migração"]);
  });
});

describe("pedido à Lena", () => {
  const base = { atlasBrief: "Escreve a carta", language: "português de Portugal", brief, evidence };

  it("traz a pesquisa, a evidência e as regras de não reforçar nem inventar; perguntas fora da carta", () => {
    const p = draftPrompt(base);
    expect(p).toContain("Kubernetes em produção");
    expect(p).toContain("[PERFIL]");
    expect(p).toContain("Idioma da carta: português de Portugal.");
    expect(p).toContain("nunca a reforces");
    expect(p).toContain("em vez de preencher a carta com generalidades");
    expect(p).toContain('"perguntas"');
    expect(p).toContain("fora da carta");
  });

  it("numa devolução automática inclui as correções da Nina; numa revisão do utilizador, a nota e a permissão de factos novos", () => {
    const corrections = [
      {
        severity: "bloqueia" as const,
        quote: "Liderei a migração do ERP",
        problem: "O perfil diz que contribuiu",
        fix: "Escreve que contribuíste para a migração",
      },
    ];
    const auto = draftPrompt({ ...base, previousDraft: "Carta v1", previousVersion: 1, corrections });
    expect(auto).toContain("Liderei a migração do ERP");
    expect(auto).toContain("Escreve que contribuíste para a migração");
    expect(auto).toContain("Carta v1");
    const user = draftPrompt({ ...base, previousDraft: "Carta v1", previousVersion: 1, userNote: "Menciona que liderei a migração" });
    expect(user).toContain("«Menciona que liderei a migração»");
    expect(user).toContain("fonte NOTA");
  });

  it("lê a carta, as perguntas e o mapa de evidências; ignora evidências com fonte desconhecida", () => {
    const reply = JSON.stringify({
      carta: "Prezados, contribuí para a migração do ERP.",
      perguntas: ["Tens experiência com Kubernetes? Qual?", ""],
      evidencias: [
        { afirmacao: "Contribuiu para a migração do ERP", fonte: "PERFIL", detalhe: "linha 1" },
        { afirmacao: "Inventado", fonte: "INTERNET" },
      ],
    });
    const parsed = parseDraft(`Claro: ${reply}`);
    expect(parsed).toMatchObject({ letter: "Prezados, contribuí para a migração do ERP.", fallback: false });
    expect(parsed?.questions).toEqual(["Tens experiência com Kubernetes? Qual?"]);
    expect(parsed?.claims).toEqual([{ claim: "Contribuiu para a migração do ERP", source: "PERFIL", detail: "linha 1" }]);
  });

  it("se a resposta não vier em JSON trata o texto como carta mas avisa que não há mapa de evidências", () => {
    expect(parseDraft("Prezados,\nCarta simples.")).toMatchObject({ letter: "Prezados,\nCarta simples.", fallback: true, claims: [] });
    expect(parseDraft("")).toBeNull();
    expect(parseDraft('{"carta":"  "}')).toBeNull();
  });
});

describe("pedido e leitura da verificação da Nina", () => {
  const input = {
    language: "português de Portugal",
    brief,
    evidence,
    letter: "Liderei a migração do ERP.",
    version: 1,
    claims: [],
    afterAutoReturn: false,
  };

  it("a Nina recebe a mesma pesquisa e a mesma evidência que a Lena, os critérios e o exemplo de reforço", () => {
    const p = checkPrompt(input);
    expect(p).toContain("Kubernetes em produção");
    expect(p).toContain(evidence);
    expect(p).toContain("Liderei a migração do ERP.");
    expect(p).toContain("«contribuí para a migração»");
    expect(p).toContain("«liderei a migração»");
    expect(p).toContain("Nunca bloqueies por estilo");
    expect(p).toContain("A Lena não deixou mapa de evidências");
    expect(p).not.toContain("segunda verificação");
    const asked = checkPrompt({ ...input, questions: ["Tens experiência com Kubernetes?"] });
    expect(asked).toContain("Perguntas que a Lena já fez");
    expect(asked).toContain("- Tens experiência com Kubernetes?");
    const second = checkPrompt({ ...input, afterAutoReturn: true, claims: [{ claim: "Contribuiu para a migração", source: "PERFIL" }] });
    expect(second).toContain("segunda verificação");
    expect(second).toContain("- Contribuiu para a migração [PERFIL]");
  });

  it("passa quando só há sugestões opcionais e fica retida quando há um problema que bloqueia", () => {
    const optional = JSON.stringify({
      verificado: ["Cargo e empresa", "Requisitos obrigatórios"],
      problemas: [{ gravidade: "opcional", frase: "Prezados,", problema: "Saudação genérica", correcao: "Usa o nome do recrutador" }],
      confirmacoes: ["Confirma que trabalhaste no ERP de 2023"],
    });
    const ok = parseCheck(optional, 1, 100, false);
    expect(ok).toMatchObject({ ok: true, check: { passed: true, version: 1, ts: 100, afterAutoReturn: false } });
    if (ok.ok) {
      expect(ok.check.confirmations).toEqual(["Confirma que trabalhaste no ERP de 2023"]);
      expect(ok.check.issues[0].severity).toBe("opcional");
    }
    const blocked = parseCheck(
      JSON.stringify({
        verificado: ["Afirmações sobre o candidato"],
        problemas: [
          {
            gravidade: "bloqueia",
            frase: "Liderei a migração do ERP",
            problema: "O perfil diz que contribuiu",
            correcao: "Escreve «contribuí para»",
          },
        ],
      }),
      2,
      200,
      true,
    );
    expect(blocked).toMatchObject({ ok: true, check: { passed: false, afterAutoReturn: true } });
  });

  it("recusa verificações sem o que foi conferido ou com problemas incompletos", () => {
    expect(parseCheck("sem json", 1, 1, false)).toMatchObject({ ok: false });
    expect(parseCheck(JSON.stringify({ verificado: [], problemas: [] }), 1, 1, false)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("verificado"),
    });
    expect(parseCheck(JSON.stringify({ verificado: ["x"] }), 1, 1, false)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("problemas"),
    });
    expect(
      parseCheck(JSON.stringify({ verificado: ["x"], problemas: [{ gravidade: "grave", frase: "a", problema: "b" }] }), 1, 1, false),
    ).toMatchObject({ ok: false });
    expect(
      parseCheck(JSON.stringify({ verificado: ["x"], problemas: [{ gravidade: "bloqueia", frase: "a", problema: "b" }] }), 1, 1, false),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("correção"),
    });
  });

  it("o pedido de correção do formato diz porquê e repete o formato", () => {
    const p = jsonFixPrompt("falta o que conferiste", "resposta", "check");
    expect(p).toContain("falta o que conferiste");
    expect(p).toContain('"verificado"');
    expect(jsonFixPrompt("x", "y", "draft")).toContain('"carta"');
  });
});
