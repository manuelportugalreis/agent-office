import { describe, expect, it } from "vitest";
import { AGENTS } from "../data/agents";
import { createAgent, stateOf, stepAgent } from "./agent";
import { lifeUpdate } from "./life";
import { buildLocations } from "./locations";
import { candidateLocs, moveStatus, startMove } from "./orders";
import { crowdLocs } from "./crowd";

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

  it("a divisória da Gestão separa o gabinete do Atlas da sala de reuniões: ninguém a atravessa", () => {
    const { locs } = setup();
    const crosses = (pts: readonly { x: number; z: number }[]): boolean =>
      pts.some((p, i) => i > 0 && p.z > 7 && pts[i - 1].z > 7 && (p.x - 9) * (pts[i - 1].x - 9) < 0);
    for (const key of ["meet0", "meet1", "meet2", "meet3", "desk-ceo", "visit-ceo"]) expect(crosses(locs[key].pts), key).toBe(false);
    expect(candidateLocs("ceo-office", "mira")).toEqual(["visit-ceo"]);
    expect(candidateLocs("gestao", "mira")).toEqual(["meet0", "meet1", "meet2", "meet3"]);
    expect(candidateLocs("ceo-office", "ceo")).toEqual(["desk-ceo"]);
  });

  it("toda a gente para a sala de jogos: 11 lugares diferentes, todos dentro da sala, e todos chegam", () => {
    const { locs, agents } = setup();
    for (const [i, a] of agents.entries()) {
      const m = startMove(a, "games", locs, 100 + i);
      if ("error" in m) throw new Error(m.error);
    }
    const spots = agents.map((a) => a.dest?.key);
    expect(new Set(spots).size).toBe(agents.length);
    for (const a of agents) for (let t = 0; t < 60 * 20; t++) stepAgent(a, 0.05);
    for (const a of agents) {
      expect(a.route, a.def.id).toEqual([]);
      expect(a.x, a.def.id).toBeGreaterThan(18);
      expect(a.z, a.def.id).toBeGreaterThan(7);
    }
  });

  it("as salas grandes têm lugar para a equipa inteira; a sala de reuniões para os chefes", () => {
    const { locs } = setup();
    const capacity = (place: string): number => candidateLocs(place, "x").length + crowdLocs(place, locs).length;
    for (const place of ["pesquisa", "search", "apply", "masters", "rest", "games", "wc"])
      expect(capacity(place), place).toBeGreaterThanOrEqual(11);
    expect(capacity("gestao")).toBeGreaterThanOrEqual(5);
    expect(capacity("ceo-office")).toBeGreaterThanOrEqual(3);
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
