import { describe, expect, it } from "vitest";
import { AGENTS } from "../data/agents";
import { createAgent, stateOf, stepAgent } from "./agent";
import { lifeUpdate } from "./life";
import { buildLocations } from "./locations";
import { candidateLocs, moveStatus, startMove } from "./orders";

const setup = () => {
  const locs = buildLocations(AGENTS);
  const agents = AGENTS.map((d) => createAgent(d, locs[`desk-${d.id}`]));
  const mira = agents.find((a) => a.def.id === "mira")!;
  return { locs, agents, mira };
};

const walk = (a: ReturnType<typeof setup>["mira"], seconds: number): void => {
  for (let t = 0; t < seconds * 20; t++) stepAgent(a, 0.05);
};

describe("ordens de movimento na cena", () => {
  it("leva a Mira à sala de Gestão, confirma a chegada e ela fica lá", () => {
    const { locs, agents, mira } = setup();
    const m = startMove(mira, "gestao", locs, 1);
    if ("error" in m) throw new Error(m.error);
    expect(moveStatus(m)).toBe("walking");
    walk(mira, 40);
    expect(moveStatus(m)).toBe("arrived");
    expect(mira.loc.key).toMatch(/^meet\d$/);
    expect(stateOf(mira)).toBe("go");
    // A vida de ambiente não a manda de volta à secretária.
    lifeUpdate(agents, locs, 10_000_000);
    expect(mira.route).toEqual([]);
    expect(mira.loc.key).toMatch(/^meet\d$/);
  });

  it("quem já trabalha na sala vai para a própria secretária; secretária de outro é ao lado dela", () => {
    expect(candidateLocs("pesquisa", "mira")).toEqual(["desk-mira"]);
    expect(candidateLocs("desk:lena", "mira")).toEqual(["visit-lena"]);
    expect(candidateLocs("desk:mira", "mira")).toEqual(["desk-mira"]);
  });

  it("sítio sem lugares no mapa devolve um motivo (não fica à espera para sempre)", () => {
    const { locs, mira } = setup();
    expect(startMove(mira, "telhado", locs, 2)).toMatchObject({ error: expect.stringContaining("não há lugar") });
  });

  it("desviada antes de chegar: o servidor sabe que não chegou", () => {
    const { locs, mira } = setup();
    const m = startMove(mira, "gestao", locs, 3);
    if ("error" in m) throw new Error(m.error);
    walk(mira, 1);
    startMove(mira, "rest", locs, 4);
    expect(moveStatus(m)).toBe("diverted");
  });
});
