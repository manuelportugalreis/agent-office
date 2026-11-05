import { describe, expect, it } from "vitest";
import { AGENTS } from "../data/agents";
import { createAgent, isSettled, stepAgent, type Agent } from "./agent";
import { buildLocations, LANE } from "./locations";
import { arrivedAtDesk, clickCorridor, createPlayer, goToDesk, isInCorridor, nearestDesk, stopWalking, walkAlongCorridor } from "./player";

function world() {
  const locs = buildLocations(AGENTS);
  const agents = AGENTS.map((d) => createAgent(d, locs[`desk-${d.id}`]));
  return { locs, agents, player: createPlayer() };
}

function walkUntilSettled(agents: readonly Agent[], player: Agent, seconds = 90): void {
  for (let i = 0; i < seconds * 20 && !isSettled(player); i++) {
    agents.forEach((a) => stepAgent(a, 0.05));
    stepAgent(player, 0.05);
  }
}

describe("avatar do utilizador", () => {
  it("começa de pé no corredor", () => {
    const { player } = world();
    expect(isInCorridor(player)).toBe(true);
    expect(player.sit).toBe(0);
    expect(player.route).toEqual([]);
  });

  it("clicar no corredor leva-o até lá; fora do corredor não faz nada", () => {
    const { agents, player } = world();
    expect(clickCorridor(player, { x: 12, z: LANE })).toBe(true);
    walkUntilSettled(agents, player);
    expect(player.x).toBeCloseTo(12, 1);
    expect(player.z).toBeCloseTo(LANE, 1);
    expect(clickCorridor(player, { x: 12, z: 2 })).toBe(false);
    expect(clickCorridor(player, { x: 40, z: LANE })).toBe(false);
  });

  it("vai até à secretária de qualquer pessoa e sabe que chegou", () => {
    const { agents, locs, player } = world();
    for (const a of agents) {
      expect(goToDesk(player, locs, a.def.id), a.def.id).toBe(true);
      expect(arrivedAtDesk(player)).toBeNull();
      walkUntilSettled(agents, player);
      expect(arrivedAtDesk(player), a.def.id).toBe(a.def.id);
      expect(Math.hypot(player.x - a.def.x, player.z - a.def.z), a.def.id).toBeLessThan(1.4);
    }
    expect(goToDesk(player, locs, "ninguem")).toBe(false);
  });

  it("as setas andam ao longo do corredor e largar a tecla pára onde está", () => {
    const { agents, player } = world();
    for (let i = 0; i < 40; i++) {
      walkAlongCorridor(player, 1);
      stepAgent(player, 0.05);
    }
    expect(player.x).toBeGreaterThan(3);
    stopWalking(player);
    const stoppedAt = player.x;
    agents.forEach((a) => stepAgent(a, 0.05));
    for (let i = 0; i < 20; i++) stepAgent(player, 0.05);
    expect(player.x).toBeCloseTo(stoppedAt, 1);
    expect(player.route).toEqual([]);
  });

  it("a andar para oeste e para este alterna sem ficar preso", () => {
    const { player } = world();
    for (let i = 0; i < 60; i++) {
      walkAlongCorridor(player, 1);
      stepAgent(player, 0.05);
    }
    const east = player.x;
    for (let i = 0; i < 60; i++) {
      walkAlongCorridor(player, -1);
      stepAgent(player, 0.05);
    }
    expect(player.x).toBeLessThan(east);
  });

  it("carregar numa seta dentro de uma sala sai pela porta antes de andar no corredor", () => {
    const { agents, locs, player } = world();
    goToDesk(player, locs, "dean");
    walkUntilSettled(agents, player);
    expect(isInCorridor(player)).toBe(false);
    walkAlongCorridor(player, 1);
    for (let i = 0; i < 20 * 120 && !isSettled(player); i++) stepAgent(player, 0.05);
    expect(isInCorridor(player)).toBe(true);
    expect(player.x).toBeGreaterThan(22);
  });

  it("clicar no chão de uma sala escolhe a secretária mais próxima", () => {
    const { agents } = world();
    const mira = agents.find((a) => a.def.id === "mira")!;
    expect(nearestDesk(agents, { x: mira.def.x + 0.5, z: mira.def.z })?.def.id).toBe("mira");
    expect(nearestDesk(agents, { x: 30, z: 30 })).toBeNull();
  });
});
