import { describe, expect, it } from "vitest";
import { parseGroupMove } from "./group.ts";

const AGENTS = [
  "ceo:Atlas",
  "rhea:Rhea",
  "mira:Mira",
  "vera:Vera",
  "scout:Scout",
  "nina:Nina",
  "lena:Lena",
  "theo:Theo",
  "dean:Dean",
  "ada:Ada",
  "turing:Turing",
].map((s) => ({ id: s.split(":")[0], name: s.split(":")[1] }));
const ALL = AGENTS.map((a) => a.id);

describe("ordens de grupo", () => {
  it("'vai toda a gente para a sala de jogos' manda os 11", () => {
    expect(parseGroupMove("vai toda a gente para a sala de jogos", AGENTS)).toEqual({ agents: ALL, to: { kind: "place", id: "games" } });
  });

  it("formas do dia a dia", () => {
    const cases: [string, string[] | "all", string | "own"][] = [
      ["toda a gente para a sala de jogos", "all", "games"],
      ["Atlas, manda toda a gente à copa", "all", "rest"],
      ["vão todos à sala de reuniões", "all", "gestao"],
      ["todos para a copa", "all", "rest"],
      ["os chefes à sala de reuniões", ["ceo", "rhea", "vera", "nina", "dean"], "gestao"],
      ["os chefes, venham à sala de reuniões", ["ceo", "rhea", "vera", "nina", "dean"], "gestao"],
      ["a Mira e a Lena venham ao meu gabinete", ["mira", "lena"], "mine"],
      ["Mira, Lena e Scout vão para o ginásio", ["mira", "lena", "scout"], "gym"],
      ["o gabinete de Projetos vai à sala de reuniões", ["rhea", "mira"], "gestao"],
      ["cada um para o seu gabinete", "all", "own"],
      ["cada um vai para a sua secretária", "all", "own"],
      ["voltem aos vossos lugares", "all", "own"],
      ["toda a gente ao trabalho", "all", "own"],
    ];
    for (const [text, who, where] of cases) {
      const g = parseGroupMove(text, AGENTS);
      expect(g?.agents, text).toEqual(who === "all" ? ALL : who);
      const to = g?.to;
      expect(to === "own" ? "own" : to?.kind === "mine" ? "mine" : to?.kind === "place" ? to.id : null, text).toBe(where);
    }
  });

  it("não confunde com trabalho nem com ordens a uma só pessoa", () => {
    for (const text of [
      "Mira, vai ao meu gabinete",
      "pesquisa todas as vagas da empresa",
      "todos os relatórios para a pasta Projetos",
      "a equipa precisa de um plano",
      "toda a gente da sala de jogos",
      "manda a Mira à copa",
    ])
      expect(parseGroupMove(text, AGENTS), text).toBeNull();
  });
});
