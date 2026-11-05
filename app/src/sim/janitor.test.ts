import { describe, expect, it } from "vitest";
import { AGENTS } from "../data/agents";
import { stepAgent } from "./agent";
import { CLEAN_MS, createJanitor, janitorUpdate, requestCleaning } from "./janitor";
import { buildLocations } from "./locations";

function run(j: ReturnType<typeof createJanitor>, locs: ReturnType<typeof buildLocations>, now: { t: number }, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) {
    now.t += 50;
    stepAgent(j.agent, 0.05);
    janitorUpdate(j, locs, now.t);
  }
}

describe("o Joaquim da limpeza", () => {
  it("fica quieto enquanto não há nada para limpar", () => {
    const j = createJanitor();
    const locs = buildLocations(AGENTS);
    const start = { x: j.agent.x, z: j.agent.z };
    run(j, locs, { t: 0 }, 5);
    expect({ x: j.agent.x, z: j.agent.z }).toEqual(start);
    expect(j.agent.kind).toBe("desk");
  });

  it("vai à secretária pedida, limpa e volta para o sítio", () => {
    const j = createJanitor();
    const locs = buildLocations(AGENTS);
    const target = AGENTS[1].id;
    const home = { x: j.agent.x, z: j.agent.z };
    const now = { t: 0 };
    requestCleaning(j, target);
    janitorUpdate(j, locs, now.t);
    expect(j.agent.kind).toBe("clean");
    expect(j.agent.dest?.key).toBe(`clean-${target}`);

    run(j, locs, now, 40);
    expect(j.agent.kind).toBe("desk");
    expect(j.agent.x).toBeCloseTo(home.x);
    expect(j.agent.z).toBeCloseTo(home.z);
    expect(j.working).toBe(false);
    expect(CLEAN_MS).toBeGreaterThan(0);
  });

  it("não ocupa o lugar de quem vem entregar um papel", () => {
    const j = createJanitor();
    const locs = buildLocations(AGENTS);
    const target = AGENTS[1].id;
    requestCleaning(j, target);
    janitorUpdate(j, locs, 0);
    expect(locs[`visit-${target}`].owner).toBeNull();
  });

  it("ignora um id desconhecido e pedidos repetidos contam uma vez", () => {
    const j = createJanitor();
    const locs = buildLocations(AGENTS);
    requestCleaning(j, "nao-existe");
    janitorUpdate(j, locs, 0);
    expect(j.working).toBe(false);
    requestCleaning(j, AGENTS[1].id);
    requestCleaning(j, AGENTS[1].id);
    expect(j.queue).toHaveLength(1);
  });
});
