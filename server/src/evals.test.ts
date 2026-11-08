import { describe, expect, it } from "vitest";
import { REAL_AGENTS } from "./agents.ts";
import { COLLEAGUE_VOICE, EVAL_CASES, type EvalContext, grade, NO_INVENTED_YEARS, section, selectCases, urls } from "./evals.ts";

const ctx = (reply: string, files: Record<string, string> = {}, written: string[] = []): EvalContext => ({
  reply,
  written,
  read: (rel) => files[rel] ?? null,
});
const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;

describe("avaliações dos agentes", () => {
  it("cada caso tem um agente real, um id único e verificações", () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const c of EVAL_CASES) {
      expect(
        REAL_AGENTS.some((a) => a.id === c.agent),
        c.id,
      ).toBe(true);
      expect(c.checks.length, c.id).toBeGreaterThan(0);
    }
  });

  it("uma boa resposta da Mira passa; uma sem fontes falha e diz porquê", () => {
    const good =
      "A Anthropic foi fundada em 2021, com sede em São Francisco.\n\nPor confirmar: nada\n\nFontes: https://www.anthropic.com/company";
    expect(grade(byId("mira-fontes"), ctx(good)).passed).toBe(true);
    const bad = grade(byId("mira-fontes"), ctx("Foi fundada em 2021 — em São Francisco."));
    expect(bad.passed).toBe(false);
    expect(bad.failed).toEqual(expect.arrayContaining(["cita pelo menos 1 link(s)", "tem a secção «Fontes»", "sem travessões longos"]));
  });

  it("a edição da nota só passa se o ficheiro em disco tiver a linha nova e o resto", () => {
    const c = byId("lena-editar-nota");
    const note = "---\ntipo: reuniao\n---\n- Eles enviam os ficheiros na sexta.\n- Próximo passo: enviar a proposta\n";
    expect(grade(c, ctx("Feito.", { "notas/reuniao.md": note }, ["C:\\w\\lena\\notas\\reuniao.md"])).passed).toBe(true);
    expect(
      grade(c, ctx("Feito, acrescentei a linha.", { "notas/reuniao.md": "- Próximo passo: enviar a proposta" }, [])).failed,
    ).toHaveLength(3);
  });

  it("o plano do Atlas tem de pôr a Lena depois da Mira", () => {
    const c = byId("atlas-plano");
    const ok = '{"summary":"s","tasks":[{"agent":"mira","task":"pesquisa"},{"agent":"lena","task":"email","after":["mira"]}]}';
    const parallel = '{"summary":"s","tasks":[{"agent":"mira","task":"pesquisa"},{"agent":"lena","task":"email"}]}';
    expect(grade(c, ctx(ok)).passed).toBe(true);
    expect(grade(c, ctx(parallel)).passed).toBe(false);
  });

  it("verificações de voz, de factos inventados, de secções e de links", () => {
    expect(COLLEAGUE_VOICE.ok(ctx("Posso ajudar em mais alguma coisa?"))).toBe(false);
    expect(COLLEAGUE_VOICE.ok(ctx("Feito. Próximo passo: rever a carta."))).toBe(true);
    expect(NO_INVENTED_YEARS.ok(ctx("Tenho 5 anos de experiência em dados."))).toBe(false);
    expect(section("Por confirmar").ok(ctx("**Por confirmar:** nada"))).toBe(true);
    expect(section("Por confirmar").ok(ctx("está tudo por confirmar"))).toBe(false);
    expect(urls(2).ok(ctx("https://a.pt/x e https://a.pt/x"))).toBe(false);
  });

  it("escolhe casos por id ou por agente", () => {
    expect(selectCases("").length).toBe(EVAL_CASES.length);
    expect(selectCases("lena").every((c) => c.agent === "lena")).toBe(true);
    expect(selectCases("atlas-plano,nina").map((c) => c.id)).toEqual(["atlas-plano", "nina-revisao"]);
  });
});
