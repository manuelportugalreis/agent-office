import { describe, expect, it } from "vitest";
import { AGENTS } from "../data/agents";
import { createAgent, isSettled, stateOf, stepAgent } from "./agent";
import { lifeTick, lifeUpdate } from "./life";
import { buildLocations } from "./locations";

function world() {
  const locs = buildLocations(AGENTS);
  const agents = AGENTS.map((d) => createAgent(d, locs[`desk-${d.id}`]));
  return { locs, agents };
}

/** Gerador que devolve valores fixos e depois repete o último. */
const fixed = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

describe("ginásio e sala de servidores", () => {
  it("há três lugares no ginásio e dois na sala de servidores", () => {
    const { locs } = world();
    expect(["gym0", "gym1", "gym2", "srv0", "srv1"].every((k) => locs[k] !== undefined)).toBe(true);
  });

  it("quem está livre vai treinar, chega, e volta sozinho para a secretária", () => {
    const { locs, agents } = world();
    // Um sorteio de gesto por agente (falha), depois café e casa de banho (falham) e o ginásio (acerta).
    lifeTick(agents, locs, 1000, fixed(...Array<number>(agents.length + 2).fill(0.99), 0.0, 0.5));
    const away = agents.find((a) => a.kind === "gym");
    expect(away, "alguém foi ao ginásio").toBeDefined();
    const now = { t: 1000 };
    for (let i = 0; i < 20 * 120 && !(isSettled(away!) && away!.kind === "desk"); i++) {
      now.t += 50;
      agents.forEach((a) => stepAgent(a, 0.05));
      lifeUpdate(agents, locs, now.t);
    }
    expect(away!.kind).toBe("desk");
    expect(stateOf(away!)).toBe("idle");
  });
});
