import { describe, expect, it } from "vitest";
import type { Dossier } from "../../shared/protocol.ts";
import {
  formatFixPrompt,
  needsClarification,
  parseResearch,
  renderResearch,
  researchInputOf,
  researchPrompt,
  todayOf,
  urlsIn,
} from "./dossier-research.ts";

const verified = {
  kind: "vaga_verificada",
  role: "Business Analyst",
  company: "ACME",
  sourceUrl: "https://acme.com/careers/ba",
  checkedAt: "2026-11-05",
  mandatory: [
    { text: "3 anos como analista de negócio", source: "https://acme.com/careers/ba" },
    { text: "SQL", source: "https://acme.com/careers/ba" },
  ],
  desirable: [{ text: "Experiência com Jira", source: "https://acme.com/careers/ba" }],
  findings: [
    { text: "A ACME vende software de faturação", source: "https://acme.com/about", verified: true },
    { text: "Terá cerca de 200 pessoas", source: "https://news.example/acme", verified: false },
  ],
  unknowns: ["Salário não indicado"],
  clarifications: [],
  summary: "Vaga remota de BA na ACME.",
};
const reply = (patch: Record<string, unknown> = {}): string => `Aqui vai: ${JSON.stringify({ ...verified, ...patch })}`;

describe("pesquisa da Mira: validação na passagem de mão", () => {
  it("aceita uma vaga verificada com anúncio, requisitos com fonte e factos separados dos não confirmados", () => {
    const r = parseResearch(reply());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.brief).toMatchObject({
      kind: "vaga_verificada",
      role: "Business Analyst",
      company: "ACME",
      sourceUrl: "https://acme.com/careers/ba",
      checkedAt: "2026-11-05",
    });
    expect(r.brief.mandatory.map((m) => m.text)).toEqual(["3 anos como analista de negócio", "SQL"]);
    expect(r.brief.findings.map((f) => f.verified)).toEqual([true, false]);
    expect(r.brief.unknowns).toEqual(["Salário não indicado"]);
  });

  it("recusa uma resposta que não é JSON ou está incompleta (não basta ser não vazia)", () => {
    expect(parseResearch("Pesquisei e a ACME parece boa.")).toMatchObject({ ok: false });
    expect(parseResearch("{ isto não é json }")).toMatchObject({ ok: false });
    expect(parseResearch(reply({ kind: "talvez" }))).toMatchObject({ ok: false });
    expect(parseResearch(reply({ company: "" }))).toMatchObject({ ok: false });
    expect(parseResearch(reply({ summary: "" }))).toMatchObject({ ok: false });
    expect(parseResearch(reply({ checkedAt: "2026-02-31" }))).toMatchObject({ ok: false });
  });

  it("uma vaga verificada exige o anúncio original, o cargo e fontes nos requisitos obrigatórios", () => {
    expect(parseResearch(reply({ sourceUrl: null }))).toMatchObject({ ok: false, reason: expect.stringContaining("URL do anúncio") });
    expect(parseResearch(reply({ role: "" }))).toMatchObject({ ok: false });
    expect(parseResearch(reply({ mandatory: [] }))).toMatchObject({ ok: false, reason: expect.stringContaining("requisito obrigatório") });
    expect(parseResearch(reply({ mandatory: [{ text: "SQL" }] }))).toMatchObject({ ok: false, reason: expect.stringContaining("fonte") });
  });

  it("recusa factos 'verificados' sem fonte e fontes que não são URLs", () => {
    expect(parseResearch(reply({ findings: [{ text: "x", verified: true }] }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("verified"),
    });
    expect(parseResearch(reply({ findings: [{ text: "x", source: "javascript:alert(1)" }] }))).toMatchObject({ ok: false });
    expect(parseResearch(reply({ sourceUrl: "ftp://acme.com" }))).toMatchObject({ ok: false });
  });

  it("vaga ambígua ou não encontrada tem de dizer o que falta para a resolver", () => {
    const base = { kind: "vaga_ambigua", sourceUrl: null, mandatory: [], desirable: [] };
    expect(parseResearch(reply({ ...base, clarifications: [] }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("clarifications"),
    });
    const ok = parseResearch(
      reply({ ...base, clarifications: ["Qual das duas vagas de analista?"], unknowns: ["Duas vagas com o mesmo nome"] }),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.brief.clarifications).toEqual(["Qual das duas vagas de analista?"]);
  });

  it("só empresa é válido (sem vaga, sem anúncio) quando o utilizador pediu só a empresa", () => {
    const r = parseResearch(reply({ kind: "so_empresa", role: "", sourceUrl: null, mandatory: [], desirable: [] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(needsClarification(r.brief, "empresa")).toBe(false);
    // ...mas se queria uma carta para uma vaga concreta, falta saber qual.
    expect(needsClarification(r.brief, "vaga")).toBe(true);
    expect(needsClarification({ ...r.brief, kind: "vaga_verificada" }, "vaga")).toBe(false);
  });
});

describe("pesquisa da Mira: método e apresentação", () => {
  it("encontra os links do pedido e ignora pontuação à volta", () => {
    expect(urlsIn("Vaga em https://acme.com/careers/ba, e também (https://jobs.lever.co/acme/123).")).toEqual([
      "https://acme.com/careers/ba",
      "https://jobs.lever.co/acme/123",
    ]);
    expect(urlsIn("sem links")).toEqual([]);
    expect(urlsIn("javascript:alert(1) ftp://x.y")).toEqual([]);
  });

  it("o pedido à Mira traz o método, o link dado, a data e o formato; sem link manda procurar o original", () => {
    const base = { request: "BA na ACME", scope: "vaga" as const, answers: [], atlasBrief: "Pesquisa a ACME", today: "2026-11-05" };
    const withLink = researchPrompt({ ...base, links: ["https://acme.com/careers/ba"] });
    expect(withLink).toContain("https://acme.com/careers/ba");
    expect(withLink).toContain("2026-11-05");
    expect(withLink).toContain("obrigatórios");
    expect(withLink).toContain("verified");
    expect(withLink).toContain("APENAS com um objeto JSON");
    const without = researchPrompt({ ...base, links: [] });
    expect(without).toContain("procura tu o anúncio original");
    expect(researchPrompt({ ...base, scope: "empresa", links: [] })).toContain("so_empresa");
    expect(researchPrompt({ ...base, links: [], answers: ["É a vaga de Lisboa"] })).toContain("É a vaga de Lisboa");
  });

  it("o texto da pesquisa mostra o anúncio, a data, as fontes e o que não foi confirmado", () => {
    const r = parseResearch(reply());
    if (!r.ok) throw new Error("devia ser válida");
    const text = renderResearch(r.brief);
    expect(text).toContain("Anúncio: https://acme.com/careers/ba (visto em 2026-11-05)");
    expect(text).toContain("Requisitos obrigatórios:");
    expect(text).toContain("(fonte: https://acme.com/careers/ba)");
    expect(text).toContain("[verificado] A ACME vende software de faturação");
    expect(text).toContain("[por verificar] Terá cerca de 200 pessoas");
    expect(text).toContain("Por confirmar:");
    expect(text).toContain("- Salário não indicado");
  });

  it("o pedido de correção diz porquê e inclui o resultado anterior", () => {
    const p = formatFixPrompt("falta o URL do anúncio", "resposta antiga");
    expect(p).toContain("falta o URL do anúncio");
    expect(p).toContain("resposta antiga");
  });

  it("monta a entrada a partir do dossier (links, respostas e âmbito)", () => {
    const d = {
      id: 1,
      title: "t",
      request: "BA na ACME",
      stage: "research",
      holder: "mira",
      draftVersion: 0,
      reviews: [],
      history: [],
      createdAt: 1,
      updatedAt: 1,
      sourceUrls: ["https://acme.com/x"],
      answers: ["Lisboa"],
      scope: "empresa",
    } as Dossier;
    expect(researchInputOf(d, "brief", "2026-11-05")).toMatchObject({
      scope: "empresa",
      links: ["https://acme.com/x"],
      answers: ["Lisboa"],
    });
    expect(todayOf(new Date(2026, 10, 5).getTime())).toBe("2026-11-05");
  });
});
