import { describe, expect, it } from "vitest";
import { AGENTS } from "../data/agents";
import { createAgent, sendTo, stateOf, stepAgent, teleport, type Agent } from "./agent";
import { buildLocations, freeLoc, LANE, routeBetween } from "./locations";

function world() {
  const locs = buildLocations(AGENTS);
  const agents = AGENTS.map((d) => createAgent(d, locs[`desk-${d.id}`]));
  const get = (id: string): Agent => {
    const a = agents.find((x) => x.def.id === id);
    if (!a) throw new Error(`agente ${id} em falta`);
    return a;
  };
  return { locs, agents, get };
}

function runUntilIdle(a: Agent, maxSeconds = 120): void {
  for (let t = 0; t < maxSeconds && a.route.length > 0; t += 0.05) stepAgent(a, 0.05);
  for (let t = 0; t < 5; t += 0.05) stepAgent(a, 0.05);
}

describe("locations", () => {
  const { locs } = world();

  it("tem um lugar na secretária por agente, todos distintos", () => {
    const desks = Object.keys(locs).filter((k) => k.startsWith("desk-"));
    expect(desks).toHaveLength(AGENTS.length);
  });

  it("todos os caminhos começam no corredor", () => {
    for (const l of Object.values(locs)) expect(l.pts[0].z).toBe(LANE);
  });

  it("a rota de uma secretária até ao descanso termina no lugar de destino", () => {
    const route = routeBetween(locs["desk-mira"], locs.rest0);
    const last = route[route.length - 1];
    expect(last).toEqual(locs.rest0.pts[locs.rest0.pts.length - 1]);
    expect(route.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
  });

  it("freeLoc ignora lugares ocupados", () => {
    const l = buildLocations(AGENTS);
    l.rest0.owner = "x";
    expect(freeLoc(l, "rest")?.key).toBe("rest1");
  });
});

describe("agent movement", () => {
  it("chega ao descanso, senta-se e fica no estado 'rest'", () => {
    const { locs, get } = world();
    const a = get("mira");
    sendTo(a, locs.rest0, "rest");
    runUntilIdle(a);
    expect(a.route).toHaveLength(0);
    expect(a.loc.key).toBe("rest0");
    expect(a.sit).toBeGreaterThan(0.9);
    expect(stateOf(a)).toBe("rest");
  });

  it("levanta-se antes de andar", () => {
    const { locs, get } = world();
    const a = get("scout");
    sendTo(a, locs.rest3, "rest");
    stepAgent(a, 0.05);
    expect(a.sitTarget).toBe(0);
    expect(a.x).toBeCloseTo(a.def.x);
  });

  it("liberta o lugar anterior e ocupa o novo", () => {
    const { locs, get } = world();
    const a = get("mira");
    sendTo(a, locs.rest1, "rest");
    expect(locs["desk-mira"].owner).toBeNull();
    expect(locs.rest1.owner).toBe("mira");
  });

  it("teleport coloca o agente no lugar sem animação", () => {
    const { locs, get } = world();
    const a = get("dean");
    teleport(a, locs.rest0, "rest");
    expect(a.kind).toBe("rest");
    expect(a.x).toBe(16 - 2);
  });
});
